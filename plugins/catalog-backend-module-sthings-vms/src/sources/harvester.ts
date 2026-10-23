import { LoggerService } from '@backstage/backend-plugin-api';
import { VmRecord, VmSource } from '../types';
import { pinnedFetch } from './proxmox';

export const HARVESTER_ANNOTATION_PREFIX = 'harvester.stuttgart-things.com';

/** Harvester keeps its VM tags as labels `tag.harvesterhci.io/<tag>`. */
const HARVESTER_TAG_LABEL = 'tag.harvesterhci.io/';

export interface HarvesterSourceOptions {
  /**
   * Kubernetes API of the Harvester cluster, e.g.
   * https://harvester.sthings.lab:6443
   */
  endpoint: string;
  /** Bearer token of a ServiceAccount that may get/list VMs and VMIs. */
  token: string;
  /** Only VMs in these namespaces; empty or unset means every namespace. */
  namespaces?: string[];
  /**
   * Harvester UI base URL for the entity link, e.g. https://harvester.sthings.lab.
   * Unset: no link.
   */
  uiUrl?: string;
  /** PEM to trust for this endpoint instead of the Node trust store. */
  caCert?: string;
  logger: LoggerService;
  fetch?: typeof fetch;
}

/** The parts of a kubevirt.io/v1 VirtualMachine that we read. */
interface KubevirtVm {
  metadata: {
    name: string;
    namespace: string;
    uid?: string;
    creationTimestamp?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: {
    runStrategy?: string;
    running?: boolean;
    template?: {
      spec?: {
        networks?: { name: string; multus?: { networkName?: string } }[];
        volumes?: {
          name: string;
          persistentVolumeClaim?: { claimName?: string };
          dataVolume?: { name?: string };
        }[];
        domain?: {
          cpu?: { cores?: number; sockets?: number; threads?: number };
          devices?: { interfaces?: { name: string; macAddress?: string }[] };
          memory?: { guest?: string };
          resources?: {
            limits?: Record<string, string>;
            requests?: Record<string, string>;
          };
        };
      };
    };
  };
  status?: { printableStatus?: string };
}

/** The parts of a kubevirt.io/v1 VirtualMachineInstance that we read. */
interface KubevirtVmi {
  metadata: { name: string; namespace: string };
  status?: {
    nodeName?: string;
    guestOSInfo?: { prettyName?: string; name?: string; versionId?: string };
    interfaces?: {
      name?: string;
      mac?: string;
      ipAddress?: string;
      ipAddresses?: string[];
    }[];
  };
}

/** The parts of a v1 PersistentVolumeClaim that we read (the VM's disks). */
interface Pvc {
  metadata: {
    name: string;
    namespace: string;
    annotations?: Record<string, string>;
  };
  spec?: { resources?: { requests?: { storage?: string } } };
}

/** One disk of a VM: its volume, size and the Harvester image it came from. */
interface Disk {
  volume: string;
  size?: string;
  image?: string;
}

/** Where Harvester keeps the image a disk was created from (PVC annotation). */
const IMAGE_ANNOTATION = 'harvesterhci.io/imageId';
/** Disks of VMs from Rancher node pools, before their PVCs exist (VM annotation). */
const VOLUME_CLAIM_TEMPLATES = 'harvesterhci.io/volumeClaimTemplates';

interface List<T> {
  items?: T[];
  metadata?: { continue?: string };
}

const STATUSES: Record<string, string> = {
  Running: 'running',
  Stopped: 'stopped',
  Paused: 'suspended',
};

/**
 * Lists the VMs of a Harvester cluster: KubeVirt VirtualMachines through the
 * Kubernetes API, and their VirtualMachineInstances for node and IP. A
 * ServiceAccount that may get/list both is enough. VM images are not VMs and
 * are not listed.
 */
export class HarvesterVmSource implements VmSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  /** PVCs not readable (403): warned once, then disks come from the VM only. */
  private pvcsForbidden = false;

  constructor(private readonly options: HarvesterSourceOptions) {
    this.baseUrl = options.endpoint.replace(/\/+$/, '');
    this.fetchImpl =
      options.fetch ?? (options.caCert ? pinnedFetch(options.caCert) : fetch);
  }

  async listVms(): Promise<VmRecord[]> {
    const namespaces = this.options.namespaces?.length
      ? this.options.namespaces
      : [undefined];
    const vms: KubevirtVm[] = [];
    const vmis = new Map<string, KubevirtVmi>();
    const pvcs = new Map<string, Pvc>();
    for (const ns of namespaces) {
      vms.push(...(await this.list<KubevirtVm>('virtualmachines', ns)));
      for (const vmi of await this.list<KubevirtVmi>(
        'virtualmachineinstances',
        ns,
      )) {
        vmis.set(`${vmi.metadata.namespace}/${vmi.metadata.name}`, vmi);
      }
      for (const pvc of await this.listPvcs(ns)) {
        pvcs.set(`${pvc.metadata.namespace}/${pvc.metadata.name}`, pvc);
      }
    }

    // Entity names carry no namespace. A name that exists in two namespaces
    // would be one entity twice, so those get the namespace in front.
    const count = new Map<string, number>();
    for (const vm of vms) {
      count.set(vm.metadata.name, (count.get(vm.metadata.name) ?? 0) + 1);
    }
    for (const [name, n] of count) {
      if (n > 1) {
        this.options.logger.warn(
          `Harvester VM name '${name}' exists in ${n} namespaces; named <namespace>-${name}`,
        );
      }
    }

    return vms.map(vm => {
      const { name, namespace } = vm.metadata;
      const vmi = vmis.get(`${namespace}/${name}`);
      const nic = nicOf(vm, vmi);
      const ipv4 = ipv4Of(vmi, nic.name);
      const annotations: Record<string, string> = {
        [`${HARVESTER_ANNOTATION_PREFIX}/namespace`]: namespace,
      };
      if (vm.metadata.uid) {
        annotations[`${HARVESTER_ANNOTATION_PREFIX}/uid`] = vm.metadata.uid;
      }
      if (vmi?.status?.nodeName) {
        annotations[`${HARVESTER_ANNOTATION_PREFIX}/node`] =
          vmi.status.nodeName;
      }
      if (ipv4) annotations[`${HARVESTER_ANNOTATION_PREFIX}/ipv4`] = ipv4;

      const labels = vm.metadata.labels ?? {};
      const vmAnnotations = vm.metadata.annotations ?? {};
      const disks = disksOf(vm, pvcs);
      const set = (key: string, value: string | undefined) => {
        if (value) annotations[`${HARVESTER_ANNOTATION_PREFIX}/${key}`] = value;
      };
      set('network', nic.network);
      set('mac', nic.mac);
      set(
        'disks',
        disks
          .map(d => (d.size ? `${d.volume} ${d.size}` : d.volume))
          .join(', '),
      );
      set(
        'image',
        [...new Set(disks.map(d => d.image).filter(Boolean))]
          // `default/sthings-u26` in namespace default reads `sthings-u26`
          .map(i => i!.replace(new RegExp(`^${namespace}/`), ''))
          .join(', '),
      );
      set('guest-cluster', labels['guestcluster.harvesterhci.io/name']);
      set('creator', labels['harvesterhci.io/creator']);
      set('run-strategy', runStrategyOf(vm));
      set('created', vm.metadata.creationTimestamp);

      const printable = vm.status?.printableStatus;
      const domain = vm.spec?.template?.spec?.domain;
      const ui = this.options.uiUrl?.replace(/\/+$/, '');
      return {
        name: (count.get(name) ?? 0) > 1 ? `${namespace}-${name}` : name,
        cloud: 'harvester',
        template: false,
        status: printable && (STATUSES[printable] ?? printable.toLowerCase()),
        cpus: cpusOf(domain?.cpu),
        memoryMiB: toMiB(
          domain?.memory?.guest ??
            domain?.resources?.limits?.memory ??
            domain?.resources?.requests?.memory,
        ),
        ipv4,
        os: osOf(vmi),
        description:
          vmAnnotations['field.cattle.io/description'] ??
          vmAnnotations.description,
        tags: Object.keys(labels)
          .filter(l => l.startsWith(HARVESTER_TAG_LABEL))
          .map(l => l.slice(HARVESTER_TAG_LABEL.length)),
        annotations,
        url: ui
          ? `${ui}/dashboard/harvester/c/local/kubevirt.io.virtualmachine/${namespace}/${name}`
          : undefined,
      };
    });
  }

  /**
   * PVCs, for disk sizes and images. Optional: a token without list on
   * persistentvolumeclaims still gets every VM, warned once.
   */
  private async listPvcs(namespace?: string): Promise<Pvc[]> {
    if (this.pvcsForbidden) return [];
    try {
      return await this.list<Pvc>(
        'persistentvolumeclaims',
        namespace,
        '/api/v1',
      );
    } catch (e) {
      if (!/ failed: 403 /.test((e as Error).message)) throw e;
      this.pvcsForbidden = true;
      this.options.logger.warn(
        'Harvester: no list on persistentvolumeclaims; disks only from volumeClaimTemplates',
      );
      return [];
    }
  }

  /** Every object of `resource` (default kubevirt.io/v1), following `continue`. */
  private async list<T>(
    resource: string,
    namespace?: string,
    api = '/apis/kubevirt.io/v1',
  ): Promise<T[]> {
    const base = namespace
      ? `${api}/namespaces/${encodeURIComponent(namespace)}/${resource}`
      : `${api}/${resource}`;
    const out: T[] = [];
    let cont: string | undefined;
    do {
      const path = `${base}?limit=500${cont ? `&continue=${encodeURIComponent(cont)}` : ''}`;
      const page = await this.get<List<T>>(path);
      out.push(...(page.items ?? []));
      cont = page.metadata?.continue || undefined;
    } while (cont);
    return out;
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Accept: 'application/json',
        },
      });
    } catch (e) {
      // fetch hides the real reason (TLS, DNS, ...) in `cause`.
      const cause = (e as { cause?: { code?: string; message?: string } })
        .cause;
      const reason = cause?.code ?? cause?.message;
      throw new Error(
        `Harvester GET ${path} failed: ${(e as Error).message}${reason ? ` (${reason})` : ''}`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `Harvester GET ${path} failed: ${res.status} ${res.statusText}`,
      );
    }
    return (await res.json()) as T;
  }
}

/** cores x sockets x threads; KubeVirt's default is one of each. */
function cpusOf(cpu?: {
  cores?: number;
  sockets?: number;
  threads?: number;
}): number | undefined {
  if (!cpu) return undefined;
  return (cpu.cores ?? 1) * (cpu.sockets ?? 1) * (cpu.threads ?? 1);
}

const UNITS: Record<string, number> = {
  Ki: 1 / 1024,
  Mi: 1,
  Gi: 1024,
  Ti: 1024 * 1024,
  K: 1000 / 1024 / 1024,
  M: 1000 ** 2 / 1024 ** 2,
  G: 1000 ** 3 / 1024 ** 2,
  T: 1000 ** 4 / 1024 ** 2,
  '': 1 / 1024 / 1024,
};

/** A Kubernetes quantity (`8Gi`, `4096Mi`, `8G`) in MiB; undefined if unparsable. */
export function toMiB(quantity?: string): number | undefined {
  const m = quantity?.trim().match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G|T)?$/);
  if (!m) return undefined;
  return Math.round(Number(m[1]) * UNITS[m[2] ?? '']);
}

/**
 * IPv4 of the VM's network `nic` (needs the qemu guest agent), else the first
 * one the guest reports at all. A guest that is a Kubernetes node also reports
 * its pod interfaces, in no fixed order.
 */
function ipv4Of(vmi?: KubevirtVmi, nic?: string): string | undefined {
  const interfaces = vmi?.status?.interfaces ?? [];
  const own = interfaces.filter(i => nic && i.name === nic);
  for (const iface of [...own, ...interfaces]) {
    for (const ip of [iface.ipAddress, ...(iface.ipAddresses ?? [])]) {
      if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !ip.startsWith('127.')) {
        return ip;
      }
    }
  }
  return undefined;
}

/** `spec.runStrategy`, or what the older `spec.running` means as one. */
function runStrategyOf(vm: KubevirtVm): string | undefined {
  if (vm.spec?.runStrategy) return vm.spec.runStrategy;
  if (vm.spec?.running === undefined) return undefined;
  return vm.spec.running ? 'Always' : 'Halted';
}

/** `Ubuntu 26.04 LTS` from the guest agent, else none. */
function osOf(vmi?: KubevirtVmi): string | undefined {
  const os = vmi?.status?.guestOSInfo;
  return (
    os?.prettyName ||
    [os?.name, os?.versionId].filter(Boolean).join(' ') ||
    undefined
  );
}

/**
 * The VM's first network (the one the IP comes from) and its MAC. The guest
 * reports many more interfaces (a Kubernetes node has one per pod); only the
 * ones named after a VM network count.
 */
function nicOf(
  vm: KubevirtVm,
  vmi?: KubevirtVmi,
): { name?: string; network?: string; mac?: string } {
  const net = vm.spec?.template?.spec?.networks?.[0];
  if (!net) return {};
  return {
    name: net.name,
    network: net.multus?.networkName ?? 'pod',
    mac:
      vmi?.status?.interfaces?.find(i => i.name === net.name)?.mac ??
      vm.spec?.template?.spec?.domain?.devices?.interfaces?.find(
        i => i.name === net.name,
      )?.macAddress,
  };
}

/**
 * Disks backed by a PVC, in volume order. Size and image come from the PVC;
 * VMs of a Rancher node pool also describe theirs in the VM annotation
 * `harvesterhci.io/volumeClaimTemplates`, which fills in when the PVC is not
 * readable.
 */
function disksOf(vm: KubevirtVm, pvcs: Map<string, Pvc>): Disk[] {
  const templates = new Map<string, Pvc>();
  try {
    const raw = vm.metadata.annotations?.[VOLUME_CLAIM_TEMPLATES];
    for (const t of raw ? (JSON.parse(raw) as Pvc[]) : []) {
      if (t?.metadata?.name) templates.set(t.metadata.name, t);
    }
  } catch {
    // not ours to validate; the PVCs still count
  }
  const disks: Disk[] = [];
  for (const v of vm.spec?.template?.spec?.volumes ?? []) {
    const claim = v.persistentVolumeClaim?.claimName ?? v.dataVolume?.name;
    if (!claim) continue;
    const pvc =
      pvcs.get(`${vm.metadata.namespace}/${claim}`) ?? templates.get(claim);
    disks.push({
      volume: v.name,
      size: pvc?.spec?.resources?.requests?.storage,
      image: pvc?.metadata.annotations?.[IMAGE_ANNOTATION],
    });
  }
  return disks;
}

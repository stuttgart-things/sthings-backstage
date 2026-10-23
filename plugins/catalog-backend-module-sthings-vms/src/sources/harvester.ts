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
    labels?: Record<string, string>;
  };
  spec?: {
    template?: {
      spec?: {
        domain?: {
          cpu?: { cores?: number; sockets?: number; threads?: number };
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
    interfaces?: { ipAddress?: string; ipAddresses?: string[] }[];
  };
}

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
    for (const ns of namespaces) {
      vms.push(...(await this.list<KubevirtVm>('virtualmachines', ns)));
      for (const vmi of await this.list<KubevirtVmi>(
        'virtualmachineinstances',
        ns,
      )) {
        vmis.set(`${vmi.metadata.namespace}/${vmi.metadata.name}`, vmi);
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
      const ipv4 = ipv4Of(vmi);
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
        tags: Object.keys(vm.metadata.labels ?? {})
          .filter(l => l.startsWith(HARVESTER_TAG_LABEL))
          .map(l => l.slice(HARVESTER_TAG_LABEL.length)),
        annotations,
        url: ui
          ? `${ui}/dashboard/harvester/c/local/kubevirt.io.virtualmachine/${namespace}/${name}`
          : undefined,
      };
    });
  }

  /** Every object of `resource` (kubevirt.io/v1), following `continue`. */
  private async list<T>(resource: string, namespace?: string): Promise<T[]> {
    const base = namespace
      ? `/apis/kubevirt.io/v1/namespaces/${encodeURIComponent(namespace)}/${resource}`
      : `/apis/kubevirt.io/v1/${resource}`;
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

/** First IPv4 the guest reports (needs the qemu guest agent), else none. */
function ipv4Of(vmi?: KubevirtVmi): string | undefined {
  for (const iface of vmi?.status?.interfaces ?? []) {
    for (const ip of [iface.ipAddress, ...(iface.ipAddresses ?? [])]) {
      if (ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) && !ip.startsWith('127.')) {
        return ip;
      }
    }
  }
  return undefined;
}

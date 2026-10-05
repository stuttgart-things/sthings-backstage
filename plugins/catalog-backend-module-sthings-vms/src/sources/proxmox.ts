import { LoggerService } from '@backstage/backend-plugin-api';
import { VmRecord, VmSource } from '../types';

export const PROXMOX_ANNOTATION_PREFIX = 'proxmox.stuttgart-things.com';

export interface ProxmoxSourceOptions {
  endpoint: string;
  pool: string;
  tokenId: string;
  tokenSecret: string;
  logger: LoggerService;
  fetch?: typeof fetch;
}

/** Subset of a `/cluster/resources?type=vm` row that we read. */
interface ProxmoxResource {
  type: string;
  vmid: number;
  name?: string;
  node: string;
  pool?: string;
  status?: string;
  template?: number;
  tags?: string;
  maxcpu?: number;
  maxmem?: number;
}

interface GuestInterface {
  name: string;
  'ip-addresses'?: { 'ip-address-type': string; 'ip-address': string }[];
}

/**
 * Lists the VMs of one Proxmox pool via the cluster API. A read-only token
 * (PVEAuditor) is enough. TLS uses the Node trust store; for a private CA set
 * NODE_EXTRA_CA_CERTS.
 */
export class ProxmoxVmSource implements VmSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ProxmoxSourceOptions) {
    this.baseUrl = options.endpoint.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listVms(): Promise<VmRecord[]> {
    const resources = await this.get<ProxmoxResource[]>(
      '/api2/json/cluster/resources?type=vm',
    );
    const ours = resources.filter(
      r => r.type === 'qemu' && r.pool === this.options.pool,
    );
    return Promise.all(ours.map(r => this.toRecord(r)));
  }

  private async toRecord(r: ProxmoxResource): Promise<VmRecord> {
    const template = r.template === 1;
    const ipv4 =
      !template && r.status === 'running' ? await this.guestIpv4(r) : undefined;

    const annotations: Record<string, string> = {
      [`${PROXMOX_ANNOTATION_PREFIX}/vmid`]: String(r.vmid),
      [`${PROXMOX_ANNOTATION_PREFIX}/node`]: r.node,
      [`${PROXMOX_ANNOTATION_PREFIX}/pool`]: this.options.pool,
    };
    if (ipv4) annotations[`${PROXMOX_ANNOTATION_PREFIX}/ipv4`] = ipv4;

    return {
      name: r.name ?? `vm-${r.vmid}`,
      cloud: 'proxmox',
      template,
      status: r.status,
      cpus: r.maxcpu,
      memoryMiB: r.maxmem ? Math.round(r.maxmem / 1024 / 1024) : undefined,
      ipv4,
      tags: (r.tags ?? '').split(/[;,\s]+/).filter(Boolean),
      annotations,
      url: `${this.baseUrl}/#v1:0:=qemu%2F${r.vmid}`,
    };
  }

  /** First non-loopback IPv4 from the guest agent; undefined if unavailable. */
  private async guestIpv4(r: ProxmoxResource): Promise<string | undefined> {
    try {
      const data = await this.get<{ result: GuestInterface[] }>(
        `/api2/json/nodes/${encodeURIComponent(r.node)}/qemu/${r.vmid}/agent/network-get-interfaces`,
      );
      for (const iface of data.result ?? []) {
        if (iface.name === 'lo') continue;
        const addr = iface['ip-addresses']?.find(
          a =>
            a['ip-address-type'] === 'ipv4' &&
            !a['ip-address'].startsWith('127.'),
        );
        if (addr) return addr['ip-address'];
      }
    } catch (e) {
      // No guest agent is normal; the entity just has no IP.
      this.options.logger.debug(
        `No guest agent IP for VM ${r.vmid}: ${(e as Error).message}`,
      );
    }
    return undefined;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `PVEAPIToken=${this.options.tokenId}=${this.options.tokenSecret}`,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Proxmox GET ${path} failed: ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json()) as { data: T };
    return body.data;
  }
}

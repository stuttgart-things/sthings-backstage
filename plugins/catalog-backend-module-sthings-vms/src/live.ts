/**
 * Live state of one VM, asked from the hypervisor at request time
 * (sthings-backstage#244). The catalog annotations are a snapshot of the last
 * provider run; this is what the VM is doing right now.
 */
export interface VmLiveInfo {
  /** Source kind: `proxmox`, `vsphere` or `harvester`. */
  cloud: string;
  /** Power state, normalized like the catalog: `running`, `stopped`, ... */
  status?: string;
  /** Seconds since the VM was last started; absent while it is off. */
  uptimeSeconds?: number;
  /** Non-loopback, non-link-local addresses the guest reports. */
  ipAddresses: string[];
  /** Hypervisor node / ESXi host it runs on. */
  host?: string;
  cpu?: {
    count?: number;
    /** 0..100, share of the VM's own vCPUs. */
    usagePercent?: number;
  };
  memory?: {
    totalMiB?: number;
    /** Guest-active (vSphere) or host-side used (Proxmox) memory. */
    usedMiB?: number;
  };
  /** When the hypervisor was asked (ISO 8601). */
  fetchedAt: string;
}

/** Where a VM lives in its source, read from the entity's annotations. */
export type VmLocator =
  | { cloud: 'proxmox'; vmid: number }
  | { cloud: 'vsphere'; moid: string }
  | { cloud: 'harvester'; namespace: string; name: string };

/** A VM inventory that can also answer for one VM live. */
export interface LiveVmSource {
  liveInfo(locator: VmLocator): Promise<VmLiveInfo>;
}

/** Raised when the source does not know the VM (deleted, moved, other pool). */
export class VmNotFoundError extends Error {
  readonly name = 'NotFoundError';
}

/** Drops loopback, link-local and empty addresses, keeps order, dedupes. */
export function usableAddresses(addresses: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of addresses) {
    const a = raw?.trim();
    if (!a) continue;
    if (a.startsWith('127.') || a === '::1') continue;
    if (a.toLowerCase().startsWith('fe80:') || a.startsWith('169.254.')) {
      continue;
    }
    if (!out.includes(a)) out.push(a);
  }
  return out;
}

/** 0..1 fraction to a percentage with one decimal; undefined stays undefined. */
export function toPercent(fraction: number | undefined): number | undefined {
  if (fraction === undefined || !Number.isFinite(fraction)) return undefined;
  return Math.round(Math.min(Math.max(fraction, 0), 1) * 1000) / 10;
}

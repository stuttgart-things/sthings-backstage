import { InfoCard, StructuredMetadataTable } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';

/**
 * Details of a VM Resource from the sthings-vms provider
 * (plugins/catalog-backend-module-sthings-vms), read from its annotations:
 * `vm.stuttgart-things.com/*` (every source) first, then the source's own
 * `<cloud>.stuttgart-things.com/*` (harvester, vsphere, proxmox).
 */
const VM_PREFIX = 'vm.stuttgart-things.com/';
const SOURCE_PREFIX =
  /^(harvester|vsphere|proxmox)\.stuttgart-things\.com\/(.+)$/;

/** Labels for keys that do not read well as they are. */
const LABELS: Record<string, string> = {
  os: 'OS',
  cpus: 'vCPU',
  'memory-mib': 'Memory',
  ipv4: 'IPv4',
  mac: 'MAC',
  uid: 'UID',
  moid: 'MoID',
  vmid: 'VMID',
};

/** Shown by the generic rows already, or of no use to a reader. */
const SKIP = new Set(['ipv4']);

function label(key: string): string {
  return (
    LABELS[key] ?? key.replace(/-/g, ' ').replace(/^./, c => c.toUpperCase())
  );
}

function memory(mib: string): string {
  const n = Number(mib);
  if (!Number.isFinite(n)) return mib;
  return n < 1024 ? `${n} MiB` : `${Math.round((n / 1024) * 10) / 10} GiB`;
}

export function VmDetailsCard() {
  const { entity } = useEntity();
  const annotations = entity.metadata.annotations ?? {};
  const rows: Record<string, string> = {};

  for (const key of ['status', 'os', 'cpus', 'memory-mib']) {
    const value = annotations[`${VM_PREFIX}${key}`];
    if (value) rows[label(key)] = key === 'memory-mib' ? memory(value) : value;
  }
  const source = Object.entries(annotations)
    .map(([k, v]) => [k.match(SOURCE_PREFIX), v] as const)
    .filter(([m, v]) => m && v);
  // IPv4 right after the size, whichever source it comes from
  for (const [m, v] of source) if (m![2] === 'ipv4') rows[label('ipv4')] = v;
  for (const [m, v] of source) {
    if (!SKIP.has(m![2])) rows[label(m![2])] = v;
  }

  return (
    <InfoCard title="VM">
      <StructuredMetadataTable metadata={rows} />
    </InfoCard>
  );
}

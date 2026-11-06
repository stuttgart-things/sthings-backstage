import { InfoCard, StructuredMetadataTable } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';

/**
 * Live details of a `kubernetes-cluster` Resource, from the annotations the
 * SthingsClusterProcessor (plugins/catalog-backend-module-sthings-vms) adds
 * when the cluster is configured under catalog.providers.sthingsClusters.
 */
const PREFIX = 'cluster.stuttgart-things.com/';

const ROWS: [key: string, label: string][] = [
  ['status', 'Status'],
  ['error', 'Error'],
  ['version', 'Version'],
  ['distribution', 'Distribution'],
  ['nodes', 'Nodes'],
  ['control-planes', 'Control planes'],
  ['cpus', 'vCPU'],
  ['memory-mib', 'Memory'],
  ['node-names', 'Node names'],
  ['checked', 'Last checked'],
];

function memory(mib: string): string {
  const n = Number(mib);
  if (!Number.isFinite(n)) return mib;
  return n < 1024 ? `${n} MiB` : `${Math.round((n / 1024) * 10) / 10} GiB`;
}

export function ClusterDetailsCard() {
  const { entity } = useEntity();
  const annotations = entity.metadata.annotations ?? {};
  const rows: Record<string, string> = {};

  for (const [key, label] of ROWS) {
    const value = annotations[`${PREFIX}${key}`];
    if (!value) continue;
    if (key === 'memory-mib') rows[label] = memory(value);
    else if (key === 'nodes') {
      const ready = annotations[`${PREFIX}nodes-ready`];
      rows[label] = ready && ready !== value ? `${ready}/${value} ready` : value;
    } else if (key === 'checked') rows[label] = new Date(value).toLocaleString();
    else rows[label] = value;
  }

  return (
    <InfoCard title="Cluster">
      {Object.keys(rows).length ? (
        <StructuredMetadataTable metadata={rows} />
      ) : (
        'No live data: this cluster is not configured under catalog.providers.sthingsClusters.'
      )}
    </InfoCard>
  );
}

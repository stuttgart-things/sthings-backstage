import {
  InfoCard,
  StatusAborted,
  StatusError,
  StatusOK,
  StatusWarning,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';

/**
 * Flux Kustomizations/HelmReleases and Argo CD Applications of a
 * `kubernetes-cluster` Resource, from the JSON annotation the
 * SthingsClusterProcessor (plugins/catalog-backend-module-sthings-vms) writes.
 */
const ANNOTATION = 'cluster.stuttgart-things.com/deployments';
const SUMMARY = 'cluster.stuttgart-things.com/deployments-summary';

interface Deployment {
  tool: 'flux' | 'argocd';
  kind: string;
  namespace: string;
  name: string;
  ready: boolean;
  status: string;
  source?: string;
  revision?: string;
  message?: string;
}

function StatusCell({ d }: { d: Deployment }) {
  if (d.ready) return <StatusOK>{d.status}</StatusOK>;
  if (d.status === 'Suspended')
    return <StatusAborted>{d.status}</StatusAborted>;
  if (/Unknown|Progressing|Missing/.test(d.status)) {
    return <StatusWarning>{d.status}</StatusWarning>;
  }
  return <StatusError>{d.status}</StatusError>;
}

const columns: TableColumn<Deployment>[] = [
  { title: 'Status', render: d => <StatusCell d={d} />, width: '15%' },
  {
    title: 'Name',
    render: d => `${d.namespace}/${d.name}`,
    customFilterAndSearch: (term, d) =>
      `${d.namespace}/${d.name}`.includes(term),
  },
  {
    title: 'Kind',
    render: d => `${d.tool === 'argocd' ? 'Argo CD' : 'Flux'} ${d.kind}`,
  },
  { title: 'Source', field: 'source' },
  { title: 'Revision', field: 'revision' },
  { title: 'Message', field: 'message' },
];

function parse(value?: string): Deployment[] | undefined {
  if (!value) return undefined;
  try {
    const list = JSON.parse(value);
    return Array.isArray(list) ? list : undefined;
  } catch {
    return undefined;
  }
}

export function ClusterDeploymentsCard() {
  const { entity } = useEntity();
  const annotations = entity.metadata.annotations ?? {};
  const deployments = parse(annotations[ANNOTATION]);

  if (!deployments) {
    return (
      <InfoCard title="Deployments">
        No Flux or Argo CD data: the cluster is not configured under
        catalog.providers.sthingsClusters, or neither is installed or readable.
      </InfoCard>
    );
  }

  return (
    <Table<Deployment>
      title={`Deployments (${annotations[SUMMARY] ?? deployments.length})`}
      columns={columns}
      data={deployments}
      options={{
        paging: deployments.length > 20,
        pageSize: 20,
        search: deployments.length > 10,
        padding: 'dense',
      }}
    />
  );
}

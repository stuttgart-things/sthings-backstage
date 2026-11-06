import { LoggerService } from '@backstage/backend-plugin-api';
import { Entity } from '@backstage/catalog-model';
import { CatalogProcessor } from '@backstage/plugin-catalog-node';
import { formatMiB } from './entity';
import { toMiB } from './sources/harvester';
import { pinnedFetch } from './sources/proxmox';

export const CLUSTER_ANNOTATION_PREFIX = 'cluster.stuttgart-things.com';

/** What one look at a cluster's API tells us. */
export interface ClusterFacts {
  /** `ready` (every node Ready), `degraded` (some not) or `unreachable`. */
  status: 'ready' | 'degraded' | 'unreachable';
  /** gitVersion of the API server, e.g. `v1.33.4+rke2r1`. */
  version?: string;
  /** From the version suffix: `rke2`, `k3s`, ...; unset for plain builds. */
  distribution?: string;
  nodes?: number;
  nodesReady?: number;
  controlPlanes?: number;
  /** Sum of node capacity. */
  cpus?: number;
  memoryMiB?: number;
  /** Node names, sorted. */
  nodeNames?: string[];
  /** Why the cluster is unreachable. */
  error?: string;
  /** ISO time of the last successful look. */
  checked?: string;
}

export interface ClusterSourceOptions {
  /** Kubernetes API, e.g. https://10.100.136.121:6443 */
  endpoint: string;
  /** Bearer token of a ServiceAccount that may get/list nodes. */
  token: string;
  /** PEM to trust for this endpoint instead of the Node trust store. */
  caCert?: string;
  fetch?: typeof fetch;
}

/** The parts of a v1 Node that we read. */
interface Node {
  metadata: { name: string; labels?: Record<string, string> };
  status?: {
    capacity?: Record<string, string>;
    conditions?: { type: string; status: string }[];
  };
}

/**
 * Reads version and nodes of one cluster straight from its API: `/version`
 * and `/api/v1/nodes`, nothing else. No Backstage Kubernetes plugin and no
 * agent on the cluster, only a read-only ServiceAccount token.
 */
export class KubernetesClusterSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClusterSourceOptions) {
    this.baseUrl = options.endpoint.replace(/\/+$/, '');
    this.fetchImpl =
      options.fetch ?? (options.caCert ? pinnedFetch(options.caCert) : fetch);
  }

  async read(): Promise<ClusterFacts> {
    const version = await this.get<{ gitVersion?: string }>('/version');
    const nodes = await this.get<{ items?: Node[] }>('/api/v1/nodes');
    return clusterFacts(version.gitVersion, nodes.items ?? []);
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new Error(`GET ${path}: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }
}

/** Shapes `/version` and the node list into the facts we show. */
export function clusterFacts(
  gitVersion: string | undefined,
  nodes: Node[],
): ClusterFacts {
  const ready = nodes.filter(n =>
    n.status?.conditions?.some(c => c.type === 'Ready' && c.status === 'True'),
  ).length;
  const sum = (f: (n: Node) => number | undefined) =>
    nodes.reduce((acc, n) => acc + (f(n) ?? 0), 0);
  return {
    status: nodes.length > 0 && ready === nodes.length ? 'ready' : 'degraded',
    version: gitVersion,
    distribution: gitVersion?.match(/\+([a-z0-9]+?)(?:r\d+|\d+)$/)?.[1],
    nodes: nodes.length,
    nodesReady: ready,
    controlPlanes: nodes.filter(n =>
      Object.keys(n.metadata.labels ?? {}).some(
        l =>
          l === 'node-role.kubernetes.io/control-plane' ||
          l === 'node-role.kubernetes.io/master',
      ),
    ).length,
    cpus: sum(n => cpusOf(n.status?.capacity?.cpu)),
    memoryMiB: sum(n => toMiB(n.status?.capacity?.memory)),
    nodeNames: nodes.map(n => n.metadata.name).sort(),
  };
}

/** `4` -> 4, `3500m` -> 3.5. */
function cpusOf(quantity?: string): number | undefined {
  const m = quantity?.trim().match(/^(\d+(?:\.\d+)?)(m)?$/);
  if (!m) return undefined;
  return m[2] ? Number(m[1]) / 1000 : Number(m[1]);
}

/** `v1.33.4+rke2r1 · 3 nodes · 24 vCPU · 48 GiB · ready` */
export function clusterDescription(facts: ClusterFacts): string {
  let nodes: string | undefined;
  if (facts.nodes !== undefined && facts.nodesReady !== facts.nodes) {
    nodes = `${facts.nodesReady}/${facts.nodes} nodes ready`;
  } else if (facts.nodes !== undefined) {
    nodes = `${facts.nodes} ${facts.nodes === 1 ? 'node' : 'nodes'}`;
  }
  return [
    facts.version,
    nodes,
    facts.cpus ? `${Math.round(facts.cpus * 10) / 10} vCPU` : undefined,
    facts.memoryMiB ? formatMiB(facts.memoryMiB) : undefined,
    facts.status,
  ]
    .filter(Boolean)
    .join(' · ');
}

export interface ClusterTarget {
  /** Name of the `Resource` entity of type `kubernetes-cluster` to enrich. */
  entity: string;
  source: { read(): Promise<ClusterFacts> };
}

/**
 * Adds live facts to cluster entities that already exist, e.g. the
 * hand-maintained files in stuttgart-things `catalog/clusters/`. Those keep
 * what only a person knows (links, dependsOn on the VMs); this adds what the
 * API knows. Opt-in per cluster: an entity without a configured target stays
 * as it is.
 *
 * `refresh()` asks every cluster's API on a schedule and keeps the answers;
 * processing only reads them, so a slow cluster never holds up the catalog.
 */
export class SthingsClusterProcessor implements CatalogProcessor {
  private readonly facts = new Map<string, ClusterFacts>();

  constructor(
    private readonly targets: ClusterTarget[],
    private readonly logger: LoggerService,
  ) {}

  getProcessorName(): string {
    return 'SthingsClusterProcessor';
  }

  async refresh(): Promise<void> {
    await Promise.all(
      this.targets.map(async t => {
        try {
          const facts = await t.source.read();
          this.facts.set(t.entity, {
            ...facts,
            checked: new Date().toISOString(),
          });
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          this.logger.warn(`sthings-clusters: ${t.entity}: ${error}`);
          // Keep what we knew, but say that it is not current.
          const last = this.facts.get(t.entity);
          this.facts.set(t.entity, { ...last, status: 'unreachable', error });
        }
      }),
    );
  }

  async preProcessEntity(entity: Entity): Promise<Entity> {
    if (
      entity.kind !== 'Resource' ||
      (entity.spec as { type?: string } | undefined)?.type !==
        'kubernetes-cluster' ||
      (entity.metadata.namespace ?? 'default') !== 'default'
    ) {
      return entity;
    }
    const facts = this.facts.get(entity.metadata.name);
    if (!facts) return entity;
    return withClusterFacts(entity, facts);
  }
}

/** The entity with `facts` as annotations and appended to its description. */
export function withClusterFacts(entity: Entity, facts: ClusterFacts): Entity {
  const p = CLUSTER_ANNOTATION_PREFIX;
  const annotations: Record<string, string> = {
    ...entity.metadata.annotations,
    [`${p}/status`]: facts.status,
  };
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') {
      annotations[`${p}/${key}`] = String(value);
    }
  };
  set('version', facts.version);
  set('distribution', facts.distribution);
  set('nodes', facts.nodes);
  set('nodes-ready', facts.nodesReady);
  set('control-planes', facts.controlPlanes);
  set('cpus', facts.cpus);
  set('memory-mib', facts.memoryMiB);
  set('node-names', facts.nodeNames?.join(', '));
  set('error', facts.error);
  set('checked', facts.checked);

  const description = [
    entity.metadata.description?.trim(),
    clusterDescription(facts),
  ]
    .filter(Boolean)
    .join(' -- ');

  return {
    ...entity,
    metadata: { ...entity.metadata, description, annotations },
  };
}

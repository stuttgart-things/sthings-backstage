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
  /**
   * What Flux and Argo CD deploy on the cluster; unset when neither is
   * installed (or readable).
   */
  deployments?: Deployment[];
  /** Why the cluster is unreachable. */
  error?: string;
  /** ISO time of the last successful look. */
  checked?: string;
}

/** One Flux Kustomization/HelmRelease or Argo CD Application. */
export interface Deployment {
  tool: 'flux' | 'argocd';
  kind: 'Kustomization' | 'HelmRelease' | 'Application';
  namespace: string;
  name: string;
  /** Flux: Ready=True and not suspended. Argo CD: Synced and Healthy. */
  ready: boolean;
  /**
   * Flux: `Ready`, `NotReady`, `Unknown` or `Suspended`.
   * Argo CD: `<sync>/<health>`, e.g. `Synced/Healthy`, `OutOfSync/Degraded`.
   */
  status: string;
  /** HelmRelease: `<chart>@<version>`; Application: chart or repo path. */
  source?: string;
  /** Applied revision, e.g. `main@sha1:1a2b3c4` or a chart version. */
  revision?: string;
  /** Why it is not ready, shortened. */
  message?: string;
}

export interface ClusterSourceOptions {
  /** Kubernetes API, e.g. https://10.100.136.121:6443 */
  endpoint: string;
  /** Bearer token of a ServiceAccount that may get/list nodes. */
  token: string;
  /** PEM to trust for this endpoint instead of the Node trust store. */
  caCert?: string;
  /** Read Flux and Argo CD objects too. Default true. */
  deployments?: boolean;
  logger?: LoggerService;
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

interface Condition {
  type: string;
  status: string;
  message?: string;
}

/** The parts of a Flux Kustomization or HelmRelease that we read. */
interface FluxObject {
  metadata: { name: string; namespace: string };
  spec?: {
    suspend?: boolean;
    chart?: { spec?: { chart?: string; version?: string } };
    chartRef?: { kind?: string; name?: string };
  };
  status?: {
    conditions?: Condition[];
    lastAppliedRevision?: string;
    lastAttemptedRevision?: string;
    history?: { chartName?: string; chartVersion?: string }[];
  };
}

/** The parts of an Argo CD Application that we read. */
interface ArgoApplication {
  metadata: { name: string; namespace: string };
  spec?: {
    source?: ArgoSource;
    sources?: ArgoSource[];
    destination?: { namespace?: string };
  };
  status?: {
    sync?: { status?: string; revision?: string; revisions?: string[] };
    health?: { status?: string; message?: string };
    conditions?: { type?: string; message?: string }[];
    operationState?: { phase?: string; message?: string };
  };
}

interface ArgoSource {
  repoURL?: string;
  path?: string;
  chart?: string;
  targetRevision?: string;
}

/** API paths per kind. Flux v1/v2 are the GA versions (Flux 2.3+). */
const FLUX_KUSTOMIZATIONS =
  '/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations';
const FLUX_HELMRELEASES = '/apis/helm.toolkit.fluxcd.io/v2/helmreleases';
const ARGO_APPLICATIONS = '/apis/argoproj.io/v1alpha1/applications';

/** Longest message we keep per deployment; annotations are not a log. */
const MAX_MESSAGE = 200;

class HttpError extends Error {
  constructor(
    path: string,
    readonly status: number,
    statusText: string,
  ) {
    super(`GET ${path}: ${status} ${statusText}`);
  }
}

/**
 * Reads version and nodes of one cluster straight from its API: `/version`
 * and `/api/v1/nodes`, plus the Flux Kustomizations/HelmReleases and Argo CD
 * Applications when those are installed. No Backstage Kubernetes plugin and
 * no agent on the cluster, only a read-only ServiceAccount token.
 */
export class KubernetesClusterSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  /** Deployment APIs we may not read (403): warned once, then skipped. */
  private readonly forbidden = new Set<string>();

  constructor(private readonly options: ClusterSourceOptions) {
    this.baseUrl = options.endpoint.replace(/\/+$/, '');
    this.fetchImpl =
      options.fetch ?? (options.caCert ? pinnedFetch(options.caCert) : fetch);
  }

  async read(): Promise<ClusterFacts> {
    const version = await this.get<{ gitVersion?: string }>('/version');
    const nodes = await this.get<{ items?: Node[] }>('/api/v1/nodes');
    const facts = clusterFacts(version.gitVersion, nodes.items ?? []);
    if (this.options.deployments !== false) {
      facts.deployments = await this.readDeployments();
    }
    return facts;
  }

  /**
   * Flux and Argo CD objects. A missing API (404: not installed) is no
   * error; neither is a forbidden one, which is warned about once. Unset
   * when none of the three APIs answered.
   */
  private async readDeployments(): Promise<Deployment[] | undefined> {
    const [kustomizations, helmReleases, applications] = await Promise.all([
      this.list<FluxObject>(FLUX_KUSTOMIZATIONS),
      this.list<FluxObject>(FLUX_HELMRELEASES),
      this.list<ArgoApplication>(ARGO_APPLICATIONS),
    ]);
    if (!kustomizations && !helmReleases && !applications) return undefined;
    return [
      ...(kustomizations ?? []).map(k => fluxDeployment('Kustomization', k)),
      ...(helmReleases ?? []).map(h => fluxDeployment('HelmRelease', h)),
      ...(applications ?? []).map(argoDeployment),
    ].sort(
      (a, b) =>
        Number(a.ready) - Number(b.ready) ||
        a.tool.localeCompare(b.tool) ||
        a.namespace.localeCompare(b.namespace) ||
        a.name.localeCompare(b.name),
    );
  }

  private async list<T>(path: string): Promise<T[] | undefined> {
    if (this.forbidden.has(path)) return undefined;
    try {
      return (await this.get<{ items?: T[] }>(path)).items ?? [];
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return undefined;
      if (e instanceof HttpError && e.status === 403) {
        this.forbidden.add(path);
        this.options.logger?.warn(
          `${this.baseUrl}: ${e.message}; not listing these deployments (see README for the RBAC)`,
        );
        return undefined;
      }
      throw e;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      throw new HttpError(path, res.status, res.statusText);
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

export function fluxDeployment(
  kind: 'Kustomization' | 'HelmRelease',
  obj: FluxObject,
): Deployment {
  const readyCondition = obj.status?.conditions?.find(c => c.type === 'Ready');
  const suspended = obj.spec?.suspend === true;
  let status = 'Unknown';
  if (suspended) status = 'Suspended';
  else if (readyCondition?.status === 'True') status = 'Ready';
  else if (readyCondition?.status === 'False') status = 'NotReady';
  const ready = status === 'Ready';

  let source: string | undefined;
  if (kind === 'HelmRelease') {
    const last = obj.status?.history?.[0];
    const chart =
      last?.chartName ??
      obj.spec?.chart?.spec?.chart ??
      obj.spec?.chartRef?.name;
    const version = last?.chartVersion ?? obj.spec?.chart?.spec?.version;
    source = chart && version ? `${chart}@${version}` : chart;
  }

  return compact({
    tool: 'flux',
    kind,
    namespace: obj.metadata.namespace,
    name: obj.metadata.name,
    ready,
    status,
    source,
    revision:
      obj.status?.lastAppliedRevision ?? obj.status?.lastAttemptedRevision,
    message: ready ? undefined : shorten(readyCondition?.message),
  });
}

export function argoDeployment(app: ArgoApplication): Deployment {
  const sync = app.status?.sync?.status ?? 'Unknown';
  const health = app.status?.health?.status ?? 'Unknown';
  const ready = sync === 'Synced' && health === 'Healthy';
  const src = app.spec?.source ?? app.spec?.sources?.[0];
  let source: string | undefined;
  if (src?.chart) {
    source = src.targetRevision
      ? `${src.chart}@${src.targetRevision}`
      : src.chart;
  } else if (src?.repoURL) {
    source = [
      src.repoURL.replace(/^https?:\/\//, '').replace(/\.git$/, ''),
      src.path,
    ]
      .filter(Boolean)
      .join('/');
  }
  const revision =
    app.status?.sync?.revision ?? app.status?.sync?.revisions?.[0];
  const message =
    app.status?.conditions?.[0]?.message ??
    app.status?.health?.message ??
    (app.status?.operationState?.phase !== 'Succeeded'
      ? app.status?.operationState?.message
      : undefined);

  return compact({
    tool: 'argocd',
    kind: 'Application',
    namespace: app.metadata.namespace,
    name: app.metadata.name,
    ready,
    status: `${sync}/${health}`,
    source,
    // A chart version is already in `source`; a git sha reads better short.
    revision:
      revision && /^[0-9a-f]{40}$/.test(revision)
        ? revision.slice(0, 7)
        : revision,
    message: ready ? undefined : shorten(message),
  });
}

function shorten(message?: string): string | undefined {
  const m = message?.replace(/\s+/g, ' ').trim();
  if (!m) return undefined;
  return m.length > MAX_MESSAGE ? `${m.slice(0, MAX_MESSAGE - 1)}…` : m;
}

/** Drops undefined fields, so the JSON annotation stays small. */
function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  ) as T;
}

/** `flux 23/24 ready`, `argocd 12/12 ready`, per tool that has any. */
export function deploymentsSummary(deployments: Deployment[]): string[] {
  return (['flux', 'argocd'] as const).flatMap(tool => {
    const own = deployments.filter(d => d.tool === tool);
    if (!own.length) return [];
    return [`${tool} ${own.filter(d => d.ready).length}/${own.length} ready`];
  });
}

/** `4` -> 4, `3500m` -> 3.5. */
function cpusOf(quantity?: string): number | undefined {
  const m = quantity?.trim().match(/^(\d+(?:\.\d+)?)(m)?$/);
  if (!m) return undefined;
  return m[2] ? Number(m[1]) / 1000 : Number(m[1]);
}

/** `v1.33.4+rke2r1 · 3 nodes · 24 vCPU · 48 GiB · ready · flux 23/24 ready` */
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
    ...deploymentsSummary(facts.deployments ?? []),
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
  if (facts.deployments) {
    const summary = deploymentsSummary(facts.deployments);
    set('deployments-summary', summary.join(', ') || 'none');
    // JSON for the app's Deployments card; the catalog keeps strings only.
    set('deployments', JSON.stringify(facts.deployments));
  }
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

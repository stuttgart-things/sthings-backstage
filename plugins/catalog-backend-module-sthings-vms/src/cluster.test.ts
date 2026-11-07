import { Entity } from '@backstage/catalog-model';
import {
  argoDeployment,
  clusterDescription,
  clusterFacts,
  fluxDeployment,
  KubernetesClusterSource,
  SthingsClusterProcessor,
  withClusterFacts,
} from './cluster';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

const node = (name: string, ready = true, controlPlane = false) => ({
  metadata: {
    name,
    labels: (controlPlane
      ? { 'node-role.kubernetes.io/control-plane': 'true' }
      : {}) as Record<string, string>,
  },
  status: {
    capacity: { cpu: '8', memory: '16393940Ki' },
    conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
  },
});

const cluster = (extra: Partial<Entity['metadata']> = {}): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name: 'machinery-cluster',
    description: 'rke2 cluster machinery in LabDA (vsphere)',
    annotations: { 'github.com/project-slug': 'stuttgart-things/x' },
    ...extra,
  },
  spec: { type: 'kubernetes-cluster', owner: 'team-infrastructure' },
});

describe('clusterFacts', () => {
  it('sums nodes and reads the distribution from the version', () => {
    expect(
      clusterFacts('v1.33.4+rke2r1', [
        node('m-2'),
        node('m-1', true, true),
        node('m-3'),
      ]),
    ).toEqual({
      status: 'ready',
      version: 'v1.33.4+rke2r1',
      distribution: 'rke2',
      nodes: 3,
      nodesReady: 3,
      controlPlanes: 1,
      cpus: 24,
      memoryMiB: 48030,
      nodeNames: ['m-1', 'm-2', 'm-3'],
    });
    expect(clusterFacts('v1.30.2+k3s1', []).distribution).toBe('k3s');
    expect(clusterFacts('v1.31.0', []).distribution).toBeUndefined();
  });

  it('is degraded when a node is not ready, or there are none', () => {
    expect(clusterFacts('v1', [node('a'), node('b', false)]).status).toBe(
      'degraded',
    );
    expect(clusterFacts('v1', []).status).toBe('degraded');
  });
});

describe('KubernetesClusterSource', () => {
  it('asks /version and /api/v1/nodes with the token', async () => {
    const calls: { url: string; auth?: string }[] = [];
    const impl = (async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        auth: (init?.headers as Record<string, string>).Authorization,
      });
      const body = url.endsWith('/version')
        ? { gitVersion: 'v1.33.4+rke2r1' }
        : { items: [node('a')] };
      return { ok: true, status: 200, json: async () => body } as Response;
    }) as unknown as typeof fetch;

    const facts = await new KubernetesClusterSource({
      endpoint: 'https://k8s:6443/',
      token: 't0k',
      deployments: false,
      fetch: impl,
    }).read();

    expect(calls).toEqual([
      { url: 'https://k8s:6443/version', auth: 'Bearer t0k' },
      { url: 'https://k8s:6443/api/v1/nodes', auth: 'Bearer t0k' },
    ]);
    expect(facts.nodes).toBe(1);
  });

  it('throws on an error status', async () => {
    const impl = (async () =>
      ({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      }) as Response) as unknown as typeof fetch;
    await expect(
      new KubernetesClusterSource({
        endpoint: 'https://k8s:6443',
        token: 't',
        fetch: impl,
      }).read(),
    ).rejects.toThrow('GET /version: 403 Forbidden');
  });
});

describe('withClusterFacts', () => {
  it('appends the facts to the description and annotates', () => {
    const e = withClusterFacts(
      cluster(),
      clusterFacts('v1.33.4+rke2r1', [node('a'), node('b', false)]),
    );
    expect(e.metadata.description).toBe(
      'rke2 cluster machinery in LabDA (vsphere) -- v1.33.4+rke2r1 · 1/2 nodes ready · 16 vCPU · 31.3 GiB · degraded',
    );
    expect(e.metadata.annotations).toMatchObject({
      'github.com/project-slug': 'stuttgart-things/x',
      'cluster.stuttgart-things.com/status': 'degraded',
      'cluster.stuttgart-things.com/nodes': '2',
      'cluster.stuttgart-things.com/nodes-ready': '1',
      'cluster.stuttgart-things.com/node-names': 'a, b',
    });
  });
});

describe('SthingsClusterProcessor', () => {
  it('enriches configured clusters only, from the last refresh', async () => {
    let fail = false;
    const processor = new SthingsClusterProcessor(
      [
        {
          entity: 'machinery-cluster',
          source: {
            read: async () => {
              if (fail) throw new Error('connect ECONNREFUSED');
              return clusterFacts('v1.33.4+rke2r1', [node('a')]);
            },
          },
        },
      ],
      logger,
    );

    // nothing known yet
    expect(await processor.preProcessEntity(cluster())).toEqual(cluster());

    await processor.refresh();
    const enriched = await processor.preProcessEntity(cluster());
    expect(enriched.metadata.description).toBe(
      'rke2 cluster machinery in LabDA (vsphere) -- v1.33.4+rke2r1 · 1 node · 8 vCPU · 15.6 GiB · ready',
    );

    // other clusters and other kinds are left alone
    const other = cluster({ name: 'sthings-infra-cluster' });
    expect(await processor.preProcessEntity(other)).toEqual(other);
    const vm = { ...cluster(), spec: { type: 'vm' } };
    expect(await processor.preProcessEntity(vm)).toEqual(vm);

    // unreachable: the last facts stay, marked as such
    fail = true;
    await processor.refresh();
    const stale = await processor.preProcessEntity(cluster());
    expect(stale.metadata.annotations).toMatchObject({
      'cluster.stuttgart-things.com/status': 'unreachable',
      'cluster.stuttgart-things.com/version': 'v1.33.4+rke2r1',
      'cluster.stuttgart-things.com/error': 'connect ECONNREFUSED',
    });
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe('fluxDeployment', () => {
  it('reads Ready, the applied revision and the chart', () => {
    expect(
      fluxDeployment('HelmRelease', {
        metadata: { name: 'cert-manager', namespace: 'flux-system' },
        spec: { chart: { spec: { chart: 'cert-manager', version: '1.x' } } },
        status: {
          conditions: [{ type: 'Ready', status: 'True', message: 'ok' }],
          lastAttemptedRevision: '1.16.2',
          history: [{ chartName: 'cert-manager', chartVersion: '1.16.2' }],
        },
      }),
    ).toEqual({
      tool: 'flux',
      kind: 'HelmRelease',
      namespace: 'flux-system',
      name: 'cert-manager',
      ready: true,
      status: 'Ready',
      source: 'cert-manager@1.16.2',
      revision: '1.16.2',
    });
  });

  it('keeps the message of a failing one, and knows suspended', () => {
    const failing = fluxDeployment('Kustomization', {
      metadata: { name: 'apps', namespace: 'flux-system' },
      status: {
        conditions: [
          { type: 'Ready', status: 'False', message: `x${'y'.repeat(300)}` },
        ],
        lastAppliedRevision: 'main@sha1:1a2b3c4',
      },
    });
    expect(failing).toMatchObject({ ready: false, status: 'NotReady' });
    expect(failing.message).toHaveLength(200);
    expect(failing.revision).toBe('main@sha1:1a2b3c4');

    expect(
      fluxDeployment('Kustomization', {
        metadata: { name: 'old', namespace: 'flux-system' },
        spec: { suspend: true },
        status: { conditions: [{ type: 'Ready', status: 'True' }] },
      }),
    ).toMatchObject({ ready: false, status: 'Suspended' });
  });
});

describe('argoDeployment', () => {
  it('is ready when Synced and Healthy, with a short sha', () => {
    expect(
      argoDeployment({
        metadata: { name: 'cicd-platform', namespace: 'argocd' },
        spec: {
          source: {
            repoURL: 'https://github.com/stuttgart-things/stuttgart-things.git',
            path: 'clusters/labul/vsphere/platform-sthings/cicd',
          },
        },
        status: {
          sync: {
            status: 'Synced',
            revision: '0123456789abcdef0123456789abcdef01234567',
          },
          health: { status: 'Healthy' },
        },
      }),
    ).toEqual({
      tool: 'argocd',
      kind: 'Application',
      namespace: 'argocd',
      name: 'cicd-platform',
      ready: true,
      status: 'Synced/Healthy',
      source:
        'github.com/stuttgart-things/stuttgart-things/clusters/labul/vsphere/platform-sthings/cicd',
      revision: '0123456',
    });
  });

  it('shows chart sources and why it is not ready', () => {
    expect(
      argoDeployment({
        metadata: { name: 'network', namespace: 'argocd' },
        spec: { sources: [{ chart: 'cilium', targetRevision: '1.17.0' }] },
        status: {
          sync: { status: 'OutOfSync', revision: '1.17.0' },
          health: { status: 'Degraded', message: 'pod crashloop' },
        },
      }),
    ).toMatchObject({
      ready: false,
      status: 'OutOfSync/Degraded',
      source: 'cilium@1.17.0',
      revision: '1.17.0',
      message: 'pod crashloop',
    });
  });
});

describe('KubernetesClusterSource deployments', () => {
  const answer = (status: number, body: unknown = {}) =>
    ({
      ok: status < 400,
      status,
      statusText: String(status),
      json: async () => body,
    }) as Response;

  function api(routes: Record<string, Response>) {
    return (async (url: string) =>
      routes[new URL(url).pathname] ?? answer(404)) as unknown as typeof fetch;
  }

  it('lists Flux and Argo CD, skipping APIs that are not installed', async () => {
    const warn = jest.fn();
    const source = new KubernetesClusterSource({
      endpoint: 'https://k8s:6443',
      token: 't',
      logger: { ...logger, warn },
      fetch: api({
        '/version': answer(200, { gitVersion: 'v1.33.4+rke2r1' }),
        '/api/v1/nodes': answer(200, { items: [node('a')] }),
        '/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations': answer(200, {
          items: [
            {
              metadata: { name: 'infra', namespace: 'flux-system' },
              status: { conditions: [{ type: 'Ready', status: 'True' }] },
            },
            {
              metadata: { name: 'apps', namespace: 'flux-system' },
              status: { conditions: [{ type: 'Ready', status: 'False' }] },
            },
          ],
        }),
        '/apis/helm.toolkit.fluxcd.io/v2/helmreleases': answer(403),
        // argoproj.io: 404, not installed
      }),
    });

    const facts = await source.read();
    // not ready first
    expect(facts.deployments?.map(d => d.name)).toEqual(['apps', 'infra']);
    expect(clusterDescription(facts)).toBe(
      'v1.33.4+rke2r1 · 1 node · 8 vCPU · 15.6 GiB · ready · flux 1/2 ready',
    );
    expect(warn).toHaveBeenCalledTimes(1);

    // 403 is not asked again
    await source.read();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('has no deployments when neither is installed, or when switched off', async () => {
    const routes = {
      '/version': answer(200, { gitVersion: 'v1' }),
      '/api/v1/nodes': answer(200, { items: [] }),
    };
    const none = await new KubernetesClusterSource({
      endpoint: 'https://k8s',
      token: 't',
      fetch: api(routes),
    }).read();
    expect(none.deployments).toBeUndefined();

    const calls: string[] = [];
    const off = await new KubernetesClusterSource({
      endpoint: 'https://k8s',
      token: 't',
      deployments: false,
      fetch: (async (url: string) => {
        calls.push(new URL(url).pathname);
        return api(routes)(url);
      }) as unknown as typeof fetch,
    }).read();
    expect(off.deployments).toBeUndefined();
    expect(calls).toEqual(['/version', '/api/v1/nodes']);
  });
});

describe('withClusterFacts deployments', () => {
  it('writes a summary and the JSON list', () => {
    const facts = {
      ...clusterFacts('v1', [node('a')]),
      deployments: [
        {
          tool: 'argocd' as const,
          kind: 'Application' as const,
          namespace: 'argocd',
          name: 'x',
          ready: true,
          status: 'Synced/Healthy',
        },
      ],
    };
    const a = withClusterFacts(cluster(), facts).metadata.annotations!;
    expect(a['cluster.stuttgart-things.com/deployments-summary']).toBe(
      'argocd 1/1 ready',
    );
    expect(JSON.parse(a['cluster.stuttgart-things.com/deployments'])).toEqual(
      facts.deployments,
    );
  });
});

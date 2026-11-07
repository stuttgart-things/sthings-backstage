import { Entity } from '@backstage/catalog-model';
import {
  clusterFacts,
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

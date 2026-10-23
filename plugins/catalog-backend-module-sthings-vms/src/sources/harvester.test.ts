import { HarvesterVmSource, toMiB } from './harvester';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

function json(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Unauthorized',
    json: async () => body,
  } as Response;
}

const vm = (
  namespace: string,
  name: string,
  extra: Record<string, unknown> = {},
) => ({
  metadata: { name, namespace, uid: `uid-${name}`, ...extra },
  spec: {
    template: {
      spec: {
        domain: {
          cpu: { cores: 2, sockets: 2, threads: 1 },
          memory: { guest: '8Gi' },
        },
      },
    },
  },
  status: { printableStatus: 'Running' },
});

/** A fetch that answers from `routes` (path without query -> pages) and records calls. */
function fakeApi(routes: Record<string, unknown[]>) {
  const calls: { url: string; auth?: string }[] = [];
  const pages = new Map(Object.entries(routes).map(([k, v]) => [k, [...v]]));
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      auth: (init?.headers as Record<string, string>)?.Authorization,
    });
    const path = new URL(url).pathname;
    const queue = pages.get(path);
    if (!queue?.length) return json({ items: [] });
    return json(queue.shift());
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('HarvesterVmSource', () => {
  it('maps VMs with their VMI, across every namespace', async () => {
    const api = fakeApi({
      '/apis/kubevirt.io/v1/virtualmachines': [
        {
          items: [
            vm('vms', 'homerun2-dev', {
              labels: {
                'tag.harvesterhci.io/team': 'sthings',
                'harvesterhci.io/creator': 'terraform',
              },
            }),
          ],
          metadata: { continue: 'page2' },
        },
        {
          items: [
            {
              ...vm('default', 'stopped-one'),
              spec: {
                template: {
                  spec: {
                    domain: { resources: { limits: { memory: '4096Mi' } } },
                  },
                },
              },
              status: { printableStatus: 'Stopped' },
            },
          ],
        },
      ],
      '/apis/kubevirt.io/v1/virtualmachineinstances': [
        {
          items: [
            {
              metadata: { name: 'homerun2-dev', namespace: 'vms' },
              status: {
                nodeName: 'harvester-1',
                interfaces: [
                  {
                    ipAddress: 'fe80::1',
                    ipAddresses: ['fe80::1', '10.31.103.21'],
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const source = new HarvesterVmSource({
      endpoint: 'https://harvester.sthings.lab:6443/',
      token: 't0ken',
      uiUrl: 'https://harvester.sthings.lab',
      logger: logger as any,
      fetch: api.impl,
    });

    const vms = await source.listVms();

    expect(vms).toEqual([
      {
        name: 'homerun2-dev',
        cloud: 'harvester',
        template: false,
        status: 'running',
        cpus: 4,
        memoryMiB: 8192,
        ipv4: '10.31.103.21',
        tags: ['team'],
        annotations: {
          'harvester.stuttgart-things.com/namespace': 'vms',
          'harvester.stuttgart-things.com/uid': 'uid-homerun2-dev',
          'harvester.stuttgart-things.com/node': 'harvester-1',
          'harvester.stuttgart-things.com/ipv4': '10.31.103.21',
        },
        url: 'https://harvester.sthings.lab/dashboard/harvester/c/local/kubevirt.io.virtualmachine/vms/homerun2-dev',
      },
      {
        name: 'stopped-one',
        cloud: 'harvester',
        template: false,
        status: 'stopped',
        cpus: undefined,
        memoryMiB: 4096,
        ipv4: undefined,
        tags: [],
        annotations: {
          'harvester.stuttgart-things.com/namespace': 'default',
          'harvester.stuttgart-things.com/uid': 'uid-stopped-one',
        },
        url: 'https://harvester.sthings.lab/dashboard/harvester/c/local/kubevirt.io.virtualmachine/default/stopped-one',
      },
    ]);
    // Paging followed, bearer token sent.
    expect(api.calls.map(c => c.url)).toContain(
      'https://harvester.sthings.lab:6443/apis/kubevirt.io/v1/virtualmachines?limit=500&continue=page2',
    );
    expect(api.calls.every(c => c.auth === 'Bearer t0ken')).toBe(true);
  });

  it('reads only the configured namespaces', async () => {
    const api = fakeApi({
      '/apis/kubevirt.io/v1/namespaces/vms/virtualmachines': [
        { items: [vm('vms', 'a')] },
      ],
    });
    const source = new HarvesterVmSource({
      endpoint: 'https://h:6443',
      token: 't',
      namespaces: ['vms'],
      logger: logger as any,
      fetch: api.impl,
    });

    const vms = await source.listVms();

    expect(vms.map(v => [v.name, v.url])).toEqual([['a', undefined]]);
    expect(api.calls.map(c => new URL(c.url).pathname)).toEqual([
      '/apis/kubevirt.io/v1/namespaces/vms/virtualmachines',
      '/apis/kubevirt.io/v1/namespaces/vms/virtualmachineinstances',
    ]);
  });

  it('prefixes the namespace when a name exists twice', async () => {
    const api = fakeApi({
      '/apis/kubevirt.io/v1/virtualmachines': [
        { items: [vm('vms', 'dev'), vm('team-b', 'dev'), vm('vms', 'solo')] },
      ],
    });
    const source = new HarvesterVmSource({
      endpoint: 'https://h:6443',
      token: 't',
      logger: logger as any,
      fetch: api.impl,
    });

    const names = (await source.listVms()).map(v => v.name);

    expect(names).toEqual(['vms-dev', 'team-b-dev', 'solo']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("'dev' exists in 2 namespaces"),
    );
  });

  it('fails on an API error, so the provider keeps the old entities', async () => {
    const source = new HarvesterVmSource({
      endpoint: 'https://h:6443',
      token: 'wrong',
      logger: logger as any,
      fetch: (async () => json({}, 401)) as unknown as typeof fetch,
    });

    await expect(source.listVms()).rejects.toThrow(
      'Harvester GET /apis/kubevirt.io/v1/virtualmachines?limit=500 failed: 401 Unauthorized',
    );
  });

  it('names the TLS reason a failed fetch hides in cause', async () => {
    const source = new HarvesterVmSource({
      endpoint: 'https://h:6443',
      token: 't',
      logger: logger as any,
      fetch: (async () => {
        throw new TypeError('fetch failed', {
          cause: { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
        });
      }) as unknown as typeof fetch,
    });

    await expect(source.listVms()).rejects.toThrow(
      /fetch failed \(UNABLE_TO_VERIFY_LEAF_SIGNATURE\)/,
    );
  });
});

describe('toMiB', () => {
  it.each([
    ['8Gi', 8192],
    ['4096Mi', 4096],
    ['1Ti', 1048576],
    ['512Ki', 1],
    ['8G', 7629],
    ['2147483648', 2048],
    ['1.5Gi', 1536],
  ])('%s -> %d MiB', (q, mib) => {
    expect(toMiB(q)).toBe(mib);
  });

  it('is undefined for nothing or garbage', () => {
    expect(toMiB(undefined)).toBeUndefined();
    expect(toMiB('lots')).toBeUndefined();
  });
});

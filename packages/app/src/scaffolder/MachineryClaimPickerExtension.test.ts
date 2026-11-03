import {
  loadClaims,
  MachineryResource,
  ownedBy,
  proxyPathsOf,
} from './MachineryClaimPickerExtension';

const claim = (annotations: Record<string, string>): MachineryResource => ({
  kind: 'NativeVsphereVM',
  apiVersion: 'resources.stuttgart-things.com/v1alpha1',
  name: 'x',
  ready: true,
  annotations,
});

describe('ownedBy', () => {
  const biff = [
    'user:default/biff',
    'group:default/beta-vm-machinery',
    'group:default/hill-valley',
  ];

  it('offers claims ordered by the user', () => {
    expect(
      ownedBy(claim({ 'stuttgart-things.com/requested-by': 'biff' }), biff),
    ).toBe(true);
  });

  it('offers claims owned by one of their groups, case-insensitively', () => {
    expect(
      ownedBy(
        claim({
          'stuttgart-things.com/requested-by': 'user:default/doc',
          'stuttgart-things.com/owner': 'group:default/Hill-Valley',
        }),
        biff,
      ),
    ).toBe(true);
  });

  it("hides other people's claims and claims without owner or requester", () => {
    expect(
      ownedBy(
        claim({
          'stuttgart-things.com/requested-by': 'user:default/doc',
          'stuttgart-things.com/owner': 'user:default/doc',
        }),
        biff,
      ),
    ).toBe(false);
    expect(ownedBy(claim({}), biff)).toBe(false);
  });
});

describe('proxyPathsOf', () => {
  it('defaults to the one machinery proxy', () => {
    expect(proxyPathsOf({})).toEqual(['machinery']);
    expect(proxyPathsOf({ proxyPath: 'machinery-labul' })).toEqual([
      'machinery-labul',
    ]);
  });

  it('takes proxyPaths over proxyPath, as a list or comma-separated', () => {
    expect(
      proxyPathsOf({
        proxyPath: 'x',
        proxyPaths: ['machinery', 'machinery-labul'],
      }),
    ).toEqual(['machinery', 'machinery-labul']);
    expect(
      proxyPathsOf({ proxyPaths: 'machinery, machinery-labul,machinery' }),
    ).toEqual(['machinery', 'machinery-labul']);
  });
});

describe('loadClaims', () => {
  const vm = (
    name: string,
    sourcePath: string,
    cluster: string,
  ): MachineryResource => ({
    kind: 'NativeProxmoxVM',
    apiVersion: 'resources.stuttgart-things.com/v1alpha1',
    name,
    namespace: 'default',
    ready: true,
    annotations: {
      'stuttgart-things.com/source-path': sourcePath,
      'stuttgart-things.com/management-cluster': cluster,
    },
  });
  const labda = vm(
    'a-vm',
    'clusters/labda/vsphere/machinery-orders-xrs/a.yaml',
    'machinery',
  );
  const labul = vm(
    'b-vm',
    'clusters/labul/proxmox/machinery-labul-orders-xrs/b.yaml',
    'machinery-labul',
  );
  // The same XR name on both factories is two claims: two files.
  const labulA = vm(
    'a-vm',
    'clusters/labul/proxmox/machinery-labul-orders-xrs/a.yaml',
    'machinery-labul',
  );

  const fetcher = (byProxy: Record<string, MachineryResource[] | number>) => {
    const urls: string[] = [];
    const fn = async (url: string) => {
      urls.push(url);
      const proxy = url.split('/api/proxy/')[1].split('/')[0];
      const r = byProxy[proxy];
      return typeof r === 'number'
        ? {
            ok: false,
            status: r,
            statusText: 'Bad Gateway',
            json: async () => ({}),
          }
        : {
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ items: r }),
          };
    };
    return { fn, urls };
  };

  it('merges the claims of every machinery instance', async () => {
    const { fn, urls } = fetcher({
      machinery: [labda],
      'machinery-labul': [labul, labulA],
    });
    const got = await loadClaims(
      fn,
      'http://b',
      ['machinery', 'machinery-labul'],
      'annotation=x',
    );
    expect(urls).toEqual([
      'http://b/api/proxy/machinery/api/v1/resources?annotation=x',
      'http://b/api/proxy/machinery-labul/api/v1/resources?annotation=x',
    ]);
    expect(got).toEqual({ items: [labda, labul, labulA], failed: [] });
  });

  it('drops a claim two endpoints both return (same file)', async () => {
    const { fn } = fetcher({ machinery: [labda], other: [labda] });
    expect(
      (await loadClaims(fn, 'http://b', ['machinery', 'other'], '')).items,
    ).toEqual([labda]);
  });

  it('still offers the reachable instance when one fails, and says which', async () => {
    const { fn } = fetcher({ machinery: [labda], 'machinery-labul': 502 });
    expect(
      await loadClaims(fn, 'http://b', ['machinery', 'machinery-labul'], ''),
    ).toEqual({
      items: [labda],
      failed: ['machinery-labul: 502 Bad Gateway'],
    });
  });

  it('fails when every instance fails', async () => {
    const { fn } = fetcher({ machinery: 503 });
    await expect(loadClaims(fn, 'http://b', ['machinery'], '')).rejects.toThrow(
      'Failed to fetch resources: machinery: 503 Bad Gateway',
    );
  });

  it('keeps ownedOnly working on the merged list', async () => {
    const mine = {
      ...labul,
      annotations: {
        ...labul.annotations,
        'stuttgart-things.com/owner': 'user:default/doc',
      },
    };
    const { fn } = fetcher({ machinery: [labda], 'machinery-labul': [mine] });
    const { items } = await loadClaims(
      fn,
      'http://b',
      ['machinery', 'machinery-labul'],
      '',
    );
    expect(items.filter(r => ownedBy(r, ['user:default/doc']))).toEqual([mine]);
  });
});

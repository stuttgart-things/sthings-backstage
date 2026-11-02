import {
  claimToEntity,
  MachineryClaimSource,
  MachineryOrderEntityProvider,
  MachineryResource,
} from './machinery';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

const defaults = {
  providerId: 'machinery-labda',
  system: 'labda',
  owner: 'team-infrastructure',
  lifecycle: 'production',
  repoUrl: 'https://github.com/stuttgart-things/stuttgart-things',
  uiUrl: 'https://machinery.example',
};

const ordered: MachineryResource = {
  kind: 'NativeVsphereVM',
  apiVersion: 'resources.stuttgart-things.com/v1alpha1',
  name: 'biff-vm',
  namespace: 'default',
  ready: false,
  statusMessage: 'Creating',
  creationTimestamp: '2026-11-02T15:00:00Z',
  annotations: {
    'stuttgart-things.com/source-path':
      'clusters/labda/vsphere/machinery-xrs/biff-vm.yaml',
    'stuttgart-things.com/requested-by': 'user:default/biff',
    'stuttgart-things.com/owner': 'group:default/hill-valley',
  },
};

describe('claimToEntity', () => {
  it('makes an order owned by the group it was ordered for', () => {
    const e = claimToEntity(ordered, defaults);
    expect(e.metadata.name).toBe('biff-vm-order');
    expect(e.spec).toEqual({
      type: 'machinery-order',
      lifecycle: 'production',
      owner: 'group:default/hill-valley',
      system: 'labda',
    });
    expect(e.metadata.annotations).toMatchObject({
      'backstage.stuttgart-things.com/requested-by': 'user:default/biff',
      'machinery.stuttgart-things.com/kind': 'NativeVsphereVM',
      'machinery.stuttgart-things.com/ready': 'false',
      'machinery.stuttgart-things.com/status': 'not-ready',
      'machinery.stuttgart-things.com/status-message': 'Creating',
      'machinery.stuttgart-things.com/source-path':
        'clusters/labda/vsphere/machinery-xrs/biff-vm.yaml',
    });
    expect(e.metadata.description).toBe(
      'NativeVsphereVM · Not ready: Creating · ordered by user:default/biff',
    );
    expect(e.metadata.tags).toEqual([
      'order',
      'nativevspherevm',
      'not-ready',
      'labda',
    ]);
    expect(e.metadata.links).toEqual([
      {
        url: 'https://github.com/stuttgart-things/stuttgart-things/blob/main/clusters/labda/vsphere/machinery-xrs/biff-vm.yaml',
        title: 'Order (git)',
        icon: 'github',
      },
      {
        url: 'https://machinery.example/detail?kind=NativeVsphereVM&name=biff-vm',
        title: 'Status (machinery)',
        icon: 'dashboard',
      },
    ]);
  });

  it('falls back to the requester, then to the default owner', () => {
    const byUser = claimToEntity(
      {
        ...ordered,
        ready: true,
        annotations: { 'stuttgart-things.com/requested-by': 'Doc' },
      },
      defaults,
    );
    expect(byUser.spec?.owner).toBe('user:default/doc');
    expect(byUser.metadata.description).toBe(
      'NativeVsphereVM · Ready · ordered by user:default/doc',
    );

    const old = claimToEntity({ ...ordered, annotations: {} }, defaults);
    expect(old.spec?.owner).toBe('team-infrastructure');
    expect(old.metadata.annotations).not.toHaveProperty(
      'backstage.stuttgart-things.com/requested-by',
    );
  });

  it('keeps a non-default namespace in the name and the detail link', () => {
    const e = claimToEntity({ ...ordered, namespace: 'team-a' }, defaults);
    expect(e.metadata.name).toBe('biff-vm-team-a-order');
    expect(e.metadata.links?.[1].url).toBe(
      'https://machinery.example/detail?kind=NativeVsphereVM&name=biff-vm&namespace=team-a',
    );
  });
});

describe('MachineryClaimSource', () => {
  it('asks for the order kinds with a source path and drops other kinds', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        items: [ordered, { ...ordered, kind: 'Kustomization', name: 'x' }],
      }),
    })) as unknown as typeof fetch;
    const source = new MachineryClaimSource({
      endpoint: 'https://machinery.example/',
      fetch: fetchImpl,
    });
    const claims = await source.listClaims();
    expect(claims.map(c => c.name)).toEqual(['biff-vm']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://machinery.example/api/v1/resources?kind=NativeVsphereVM%2CNativeProxmoxVM&annotation=stuttgart-things.com%2Fsource-path',
      expect.anything(),
    );
  });

  it('throws on HTTP errors and keeps the cause of network errors', async () => {
    const notOk = new MachineryClaimSource({
      endpoint: 'https://m',
      fetch: (async () => ({
        ok: false,
        status: 502,
      })) as unknown as typeof fetch,
    });
    await expect(notOk.listClaims()).rejects.toThrow('HTTP 502');

    const down = new MachineryClaimSource({
      endpoint: 'https://m',
      fetch: (async () => {
        throw new TypeError('fetch failed', {
          cause: new Error('getaddrinfo ENOTFOUND m'),
        });
      }) as unknown as typeof fetch,
    });
    await expect(down.listClaims()).rejects.toThrow('ENOTFOUND');
  });
});

describe('MachineryOrderEntityProvider', () => {
  it('applies a full mutation and leaves the catalog alone when the source fails', async () => {
    const connection = { applyMutation: jest.fn(), refresh: jest.fn() };
    const provider = new MachineryOrderEntityProvider(
      { listClaims: async () => [ordered] },
      defaults,
      logger as any,
    );
    await provider.connect(connection);
    await provider.refresh();
    expect(connection.applyMutation).toHaveBeenCalledWith({
      type: 'full',
      entities: [
        {
          entity: expect.objectContaining({
            metadata: expect.objectContaining({ name: 'biff-vm-order' }),
          }),
          locationKey: 'sthings-vms:machinery-labda',
        },
      ],
    });

    connection.applyMutation.mockClear();
    const failing = new MachineryOrderEntityProvider(
      {
        listClaims: async () => {
          throw new Error('down');
        },
      },
      defaults,
      logger as any,
    );
    await failing.connect(connection);
    await expect(failing.refresh()).rejects.toThrow('down');
    expect(connection.applyMutation).not.toHaveBeenCalled();
  });
});

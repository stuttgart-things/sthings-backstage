import { Entity } from '@backstage/catalog-model';
import express from 'express';
import { AddressInfo } from 'node:net';
import { usableAddresses, VmLiveInfo, VmNotFoundError } from './live';
import { HarvesterVmSource } from './sources/harvester';
import { ProxmoxVmSource } from './sources/proxmox';
import { VsphereVmSource } from './sources/vsphere';
import {
  createVmInfoRouter,
  LiveInfoCache,
  registerListLiveVmsAction,
  registerLiveVmInfoAction,
  vmLocatorOf,
} from './vmInfo';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

const proxmoxJson = (data: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Not Found',
    json: async () => ({ data }),
  }) as Response;

const k8sJson = (body: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    statusText: status < 400 ? 'OK' : 'Not Found',
    json: async () => body,
  }) as Response;

describe('usableAddresses', () => {
  it('drops loopback, link-local and duplicates', () => {
    expect(
      usableAddresses([
        '127.0.0.1',
        '10.31.103.21',
        'fe80::1',
        '::1',
        '169.254.1.1',
        undefined,
        '',
        '10.31.103.21',
        '2001:db8::5',
      ]),
    ).toEqual(['10.31.103.21', '2001:db8::5']);
  });
});

describe('ProxmoxVmSource.liveInfo', () => {
  const resources = [
    {
      type: 'qemu',
      vmid: 117,
      name: 'homerun2',
      node: 'ul-pve02',
      pool: 'stuttgart-things',
      status: 'running',
      uptime: 3725,
      cpu: 0.2345,
      maxcpu: 4,
      mem: 3 * 1024 ** 3,
      maxmem: 8 * 1024 ** 3,
    },
    { type: 'qemu', vmid: 300, node: 'ul-pve01', pool: 'someone-else' },
  ];
  const make = (fetchImpl: jest.Mock) =>
    new ProxmoxVmSource({
      endpoint: 'https://pve.example:8006',
      pool: 'stuttgart-things',
      tokenId: 'backstage@pve!catalog',
      tokenSecret: 's3cret',
      logger: logger as any,
      fetch: fetchImpl as unknown as typeof fetch,
    });

  it('reports state, usage and every guest address from the current node', async () => {
    const fetchImpl = jest.fn(async (url: string) =>
      url.endsWith('/cluster/resources?type=vm')
        ? proxmoxJson(resources)
        : proxmoxJson({
            result: [
              {
                name: 'lo',
                'ip-addresses': [
                  { 'ip-address-type': 'ipv4', 'ip-address': '127.0.0.1' },
                ],
              },
              {
                name: 'eth0',
                'ip-addresses': [
                  { 'ip-address-type': 'ipv4', 'ip-address': '10.31.103.21' },
                  { 'ip-address-type': 'ipv6', 'ip-address': 'fe80::a' },
                  { 'ip-address-type': 'ipv6', 'ip-address': '2001:db8::7' },
                ],
              },
            ],
          }),
    );

    const info = await make(fetchImpl).liveInfo({
      cloud: 'proxmox',
      vmid: 117,
    });

    expect(info).toEqual({
      cloud: 'proxmox',
      status: 'running',
      uptimeSeconds: 3725,
      ipAddresses: ['10.31.103.21', '2001:db8::7'],
      host: 'ul-pve02',
      cpu: { count: 4, usagePercent: 23.5 },
      memory: { totalMiB: 8192, usedMiB: 3072 },
      fetchedAt: expect.any(String),
    });
    // The agent is asked on the node the cluster reports now, not an old one.
    expect(fetchImpl.mock.calls[1][0]).toBe(
      'https://pve.example:8006/api2/json/nodes/ul-pve02/qemu/117/agent/network-get-interfaces',
    );
  });

  it('does not ask the agent of a stopped VM', async () => {
    const fetchImpl = jest.fn(async () =>
      proxmoxJson([
        { ...resources[0], status: 'stopped', uptime: 0, cpu: 0, mem: 0 },
      ]),
    );
    const info = await make(fetchImpl).liveInfo({
      cloud: 'proxmox',
      vmid: 117,
    });
    expect(info.status).toBe('stopped');
    expect(info.uptimeSeconds).toBeUndefined();
    expect(info.ipAddresses).toEqual([]);
    expect(info.cpu?.usagePercent).toBeUndefined();
    expect(info.memory?.usedMiB).toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses VMs outside its pool', async () => {
    const fetchImpl = jest.fn(async () => proxmoxJson(resources));
    await expect(
      make(fetchImpl).liveInfo({ cloud: 'proxmox', vmid: 300 }),
    ).rejects.toBeInstanceOf(VmNotFoundError);
  });
});

describe('VsphereVmSource.liveInfo', () => {
  const envelope = (body: string) =>
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"' +
    ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"' +
    ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
  const response = (method: string, returnval = '') =>
    envelope(
      `<${method}Response xmlns="urn:vim25">${returnval}</${method}Response>`,
    );
  const prop = (name: string, xsiType: string, value: string) =>
    `<propSet><name>${name}</name><val xsi:type="${xsiType}">${value}</val></propSet>`;
  const serviceContent =
    '<returnval><about><instanceUuid>vc-uuid</instanceUuid></about>' +
    '<propertyCollector type="PropertyCollector">propertyCollector</propertyCollector>' +
    '<searchIndex type="SearchIndex">SearchIndex</searchIndex>' +
    '<sessionManager type="SessionManager">SessionManager</sessionManager>' +
    '<viewManager type="ViewManager">ViewManager</viewManager></returnval>';

  function fakeVcenter(vmProps: string | 'fault') {
    const methods: string[] = [];
    const impl = jest.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as string;
      const method = /<soapenv:Body><(\w+) xmlns="urn:vim25">/.exec(body)![1];
      methods.push(method);
      const xml = (() => {
        switch (method) {
          case 'RetrieveServiceContent':
            return response(method, serviceContent);
          case 'RetrievePropertiesEx':
            if (body.includes('<type>HostSystem</type>')) {
              return response(
                method,
                '<returnval><objects><obj type="HostSystem">host-48</obj>' +
                  prop('name', 'xsd:string', 'esx-01.lab') +
                  '</objects></returnval>',
              );
            }
            if (vmProps === 'fault') {
              return envelope(
                '<soapenv:Fault><faultcode>ServerFaultCode</faultcode>' +
                  '<faultstring>The object has already been deleted or has not been completely created</faultstring></soapenv:Fault>',
              );
            }
            return response(
              method,
              `<returnval><objects><obj type="VirtualMachine">vm-1</obj>${vmProps}</objects></returnval>`,
            );
          default:
            return response(method);
        }
      })();
      return new Response(xml, {
        status: xml.includes('Fault') ? 500 : 200,
        headers: { 'set-cookie': 'vmware_soap_session="52a1"; Path=/' },
      });
    });
    return { impl, methods };
  }

  const make = (impl: jest.Mock) =>
    new VsphereVmSource({
      endpoint: 'https://vc.example',
      folder: 'dc/vm/stuttgart-things',
      username: 'reader',
      password: 'pw',
      logger: logger as any,
      fetch: impl as unknown as typeof fetch,
    });

  it('reads state, uptime, usage, host and every guest address, then logs out', async () => {
    const api = fakeVcenter(
      prop('runtime.powerState', 'VirtualMachinePowerState', 'poweredOn') +
        '<propSet><name>runtime.host</name><val type="HostSystem" xsi:type="ManagedObjectReference">host-48</val></propSet>' +
        prop('summary.quickStats.uptimeSeconds', 'xsd:int', '86400') +
        prop('summary.quickStats.overallCpuUsage', 'xsd:int', '1200') +
        prop('summary.runtime.maxCpuUsage', 'xsd:int', '9600') +
        prop('summary.quickStats.guestMemoryUsage', 'xsd:int', '2048') +
        prop('summary.config.numCpu', 'xsd:int', '4') +
        prop('summary.config.memorySizeMB', 'xsd:int', '8192') +
        prop('guest.ipAddress', 'xsd:string', '10.100.136.111') +
        '<propSet><name>guest.net</name><val xsi:type="ArrayOfGuestNicInfo">' +
        '<GuestNicInfo><ipAddress>10.100.136.111</ipAddress><ipAddress>fe80::1</ipAddress></GuestNicInfo>' +
        '<GuestNicInfo><ipAddress>192.168.1.5</ipAddress></GuestNicInfo>' +
        '</val></propSet>',
    );

    const info = await make(api.impl).liveInfo({
      cloud: 'vsphere',
      moid: 'vm-1',
    });

    expect(info).toEqual({
      cloud: 'vsphere',
      status: 'running',
      uptimeSeconds: 86400,
      ipAddresses: ['10.100.136.111', '192.168.1.5'],
      host: 'esx-01.lab',
      cpu: { count: 4, usagePercent: 12.5 },
      memory: { totalMiB: 8192, usedMiB: 2048 },
      fetchedAt: expect.any(String),
    });
    expect(api.methods[api.methods.length - 1]).toBe('Logout');
  });

  it('maps a deleted VM to VmNotFoundError and still logs out', async () => {
    const api = fakeVcenter('fault');
    await expect(
      make(api.impl).liveInfo({ cloud: 'vsphere', moid: 'vm-gone' }),
    ).rejects.toBeInstanceOf(VmNotFoundError);
    expect(api.methods).toContain('Logout');
  });
});

describe('HarvesterVmSource.liveInfo', () => {
  const vm = {
    metadata: { name: 'homerun2-dev', namespace: 'vms' },
    spec: {
      template: {
        spec: {
          domain: { cpu: { cores: 2, sockets: 2 }, memory: { guest: '8Gi' } },
        },
      },
    },
    status: { printableStatus: 'Running' },
  };
  const make = (routes: Record<string, unknown>) => {
    const impl = jest.fn(async (url: string) => {
      const path = new URL(url).pathname;
      return path in routes ? k8sJson(routes[path]) : k8sJson({}, 404);
    });
    return new HarvesterVmSource({
      endpoint: 'https://harvester.example:6443',
      token: 't0ken',
      logger: logger as any,
      fetch: impl as unknown as typeof fetch,
    });
  };
  const base = '/apis/kubevirt.io/v1/namespaces/vms';

  it('combines VM and VMI into state, uptime, node and addresses', async () => {
    const started = new Date(Date.now() - 7200 * 1000).toISOString();
    const source = make({
      [`${base}/virtualmachines/homerun2-dev`]: vm,
      [`${base}/virtualmachineinstances/homerun2-dev`]: {
        metadata: { name: 'homerun2-dev', namespace: 'vms' },
        status: {
          nodeName: 'harvester-1',
          phaseTransitionTimestamps: [
            { phase: 'Scheduled', phaseTransitionTimestamp: started },
            { phase: 'Running', phaseTransitionTimestamp: started },
          ],
          interfaces: [
            { ipAddress: 'fe80::1', ipAddresses: ['fe80::1', '10.31.103.21'] },
          ],
        },
      },
    });

    const info = await source.liveInfo({
      cloud: 'harvester',
      namespace: 'vms',
      name: 'homerun2-dev',
    });

    expect(info).toMatchObject({
      cloud: 'harvester',
      status: 'running',
      ipAddresses: ['10.31.103.21'],
      host: 'harvester-1',
      cpu: { count: 4 },
      memory: { totalMiB: 8192 },
    });
    expect(info.uptimeSeconds).toBeGreaterThanOrEqual(7199);
    expect(info.uptimeSeconds).toBeLessThan(7300);
  });

  it('is stopped without a VMI, and not found without a VM', async () => {
    const stopped = make({
      [`${base}/virtualmachines/homerun2-dev`]: {
        ...vm,
        status: { printableStatus: 'Stopped' },
      },
    });
    const info = await stopped.liveInfo({
      cloud: 'harvester',
      namespace: 'vms',
      name: 'homerun2-dev',
    });
    expect(info.status).toBe('stopped');
    expect(info.uptimeSeconds).toBeUndefined();
    expect(info.ipAddresses).toEqual([]);

    await expect(
      make({}).liveInfo({ cloud: 'harvester', namespace: 'vms', name: 'x' }),
    ).rejects.toBeInstanceOf(VmNotFoundError);
  });
});

const vmEntity = (annotations: Record<string, string>, title?: string) =>
  ({
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: { name: 'homerun2-proxmox-vm', title, annotations },
    spec: { type: 'vm' },
  }) as Entity;

describe('vmLocatorOf', () => {
  it('reads provider and id per source', () => {
    expect(
      vmLocatorOf(
        vmEntity({
          'backstage.io/managed-by-location': 'sthings-vms:proxmox-labul',
          'proxmox.stuttgart-things.com/vmid': '117',
        }),
      ),
    ).toEqual({
      providerId: 'proxmox-labul',
      locator: { cloud: 'proxmox', vmid: 117 },
    });
    expect(
      vmLocatorOf(
        vmEntity({
          'backstage.io/managed-by-location': 'sthings-vms:vsphere-labda',
          'vsphere.stuttgart-things.com/moid': 'vm-33695',
        }),
      )?.locator,
    ).toEqual({ cloud: 'vsphere', moid: 'vm-33695' });
    expect(
      vmLocatorOf(
        vmEntity(
          {
            'backstage.io/managed-by-location': 'sthings-vms:harvester-lab',
            'harvester.stuttgart-things.com/namespace': 'vms',
          },
          'homerun2-dev',
        ),
      )?.locator,
    ).toEqual({ cloud: 'harvester', namespace: 'vms', name: 'homerun2-dev' });
  });

  it('ignores VMs the provider did not create', () => {
    expect(
      vmLocatorOf(
        vmEntity({
          'backstage.io/managed-by-location':
            'url:https://github.com/x/y/blob/main/catalog-info.yaml',
          'proxmox.stuttgart-things.com/vmid': '117',
        }),
      ),
    ).toBeUndefined();
  });
});

describe('LiveInfoCache', () => {
  const info = { cloud: 'proxmox', ipAddresses: [], fetchedAt: 'x' };

  it('shares one request within the TTL and asks again after it', async () => {
    let now = 0;
    const cache = new LiveInfoCache(30_000, () => now);
    const load = jest.fn(async () => info as VmLiveInfo);
    await Promise.all([cache.get('a', load), cache.get('a', load)]);
    now = 29_000;
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(1);
    now = 31_000;
    await cache.get('a', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not keep failures', async () => {
    const cache = new LiveInfoCache(30_000, () => 0);
    const failing = jest.fn(async () => {
      throw new Error('boom');
    });
    await expect(cache.get('a', failing)).rejects.toThrow('boom');
    const ok = jest.fn(async () => info as VmLiveInfo);
    await expect(cache.get('a', ok)).resolves.toBe(info);
  });
});

describe('createVmInfoRouter', () => {
  const proxmoxVm = vmEntity({
    'backstage.io/managed-by-location': 'sthings-vms:proxmox-labul',
    'proxmox.stuttgart-things.com/vmid': '117',
  });

  async function serve(options: {
    entity?: Entity;
    liveInfo?: jest.Mock;
  }): Promise<{ url: string; close: () => void; liveInfo: jest.Mock }> {
    const liveInfo =
      options.liveInfo ??
      jest.fn(async () => ({
        cloud: 'proxmox',
        status: 'running',
        ipAddresses: ['10.31.103.21'],
        fetchedAt: 'now',
      }));
    const app = express();
    app.use(
      createVmInfoRouter({
        sources: new Map([['proxmox-labul', { liveInfo }]]),
        cache: new LiveInfoCache(30_000),
        logger: logger as any,
        getEntity: async () => options.entity,
      }),
    );
    // Minimal stand-in for Backstage's error middleware.
    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(err.name === 'NotFoundError' ? 404 : 500).json({
          error: { name: err.name, message: err.message },
        });
      },
    );
    const server = app.listen(0);
    const { port } = server.address() as AddressInfo;
    return {
      url: `http://127.0.0.1:${port}`,
      close: () => server.close(),
      liveInfo,
    };
  }

  it('answers with the live info of a visible VM', async () => {
    const s = await serve({ entity: proxmoxVm });
    try {
      const res = await fetch(`${s.url}/entity/default/homerun2-proxmox-vm`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        status: 'running',
        ipAddresses: ['10.31.103.21'],
      });
      expect(s.liveInfo).toHaveBeenCalledWith({ cloud: 'proxmox', vmid: 117 });
    } finally {
      s.close();
    }
  });

  it('is 404 for an entity the caller cannot see, without asking the hypervisor', async () => {
    const s = await serve({ entity: undefined });
    try {
      const res = await fetch(`${s.url}/entity/default/secret-vm`);
      expect(res.status).toBe(404);
      expect(s.liveInfo).not.toHaveBeenCalled();
    } finally {
      s.close();
    }
  });

  it('is 404 for a VM of an unconfigured source', async () => {
    const s = await serve({
      entity: vmEntity({
        'backstage.io/managed-by-location': 'sthings-vms:proxmox-other',
        'proxmox.stuttgart-things.com/vmid': '117',
      }),
    });
    try {
      const res = await fetch(`${s.url}/entity/default/x`);
      expect(res.status).toBe(404);
    } finally {
      s.close();
    }
  });

  it('is 502 when the hypervisor fails, 404 when it does not know the VM', async () => {
    const failing = await serve({
      entity: proxmoxVm,
      liveInfo: jest.fn(async () => {
        throw new Error('Proxmox GET /x failed: 500 Internal Server Error');
      }),
    });
    try {
      const res = await fetch(`${failing.url}/entity/default/x`);
      expect(res.status).toBe(502);
    } finally {
      failing.close();
    }

    const gone = await serve({
      entity: proxmoxVm,
      liveInfo: jest.fn(async () => {
        throw new VmNotFoundError('gone');
      }),
    });
    try {
      const res = await fetch(`${gone.url}/entity/default/x`);
      expect(res.status).toBe(404);
    } finally {
      gone.close();
    }
  });
});

describe('get-live-vm-info action', () => {
  const managed = vmEntity({
    'backstage.io/managed-by-location': 'sthings-vms:proxmox-labul',
    'proxmox.stuttgart-things.com/vmid': '101',
  });
  const liveInfo = {
    cloud: 'proxmox',
    status: 'running',
    ipAddresses: ['10.31.103.5'],
    fetchedAt: '2026-11-24T10:00:00Z',
  };

  function setup(entities: Record<string, Entity | undefined>) {
    let registered: any;
    const source = { liveInfo: jest.fn(async () => liveInfo) };
    const catalog = {
      getEntityByRef: jest.fn(async (ref: any) => entities[ref.name]),
    };
    registerLiveVmInfoAction({
      actionsRegistry: { register: (a: any) => (registered = a) },
      catalog: catalog as any,
      sources: new Map([['proxmox-labul', source]]),
      cache: new LiveInfoCache(30_000),
    });
    const run = (entityRef: string) =>
      registered.action({
        input: { entityRef },
        credentials: { principal: 'service' },
      });
    return { registered, source, catalog, run };
  }

  it('is registered as a read-only, idempotent action', () => {
    const { registered } = setup({});
    expect(registered.name).toBe('get-live-vm-info');
    expect(registered.attributes).toEqual({
      readOnly: true,
      idempotent: true,
      destructive: false,
    });
  });

  it('answers with the live info of a VM, looked up with the caller', async () => {
    const t = setup({ 'homerun2-proxmox-vm': managed });
    const result = await t.run('homerun2-proxmox-vm');
    expect(result.output).toEqual({ found: true, info: liveInfo });
    expect(t.catalog.getEntityByRef).toHaveBeenCalledWith(
      { kind: 'resource', namespace: 'default', name: 'homerun2-proxmox-vm' },
      { credentials: { principal: 'service' } },
    );
    expect(t.source.liveInfo).toHaveBeenCalledWith({
      cloud: 'proxmox',
      vmid: 101,
    });
  });

  it('reports a VM without live source as not found', async () => {
    const t = setup({ handmade: vmEntity({}) });
    const result = await t.run('resource:default/handmade');
    expect(result.output).toEqual({
      found: false,
      message: 'This VM is not managed by a live VM source',
    });
  });

  it('rejects unknown entities and non-VMs', async () => {
    const cluster = { ...managed, spec: { type: 'kubernetes-cluster' } };
    const t = setup({ cluster });
    await expect(t.run('nope')).rejects.toThrow(
      'No entity resource:default/nope found',
    );
    await expect(t.run('cluster')).rejects.toThrow('is not a VM');
    expect(t.source.liveInfo).not.toHaveBeenCalled();
  });
});

describe('list-live-vms action', () => {
  const vm = (name: string, vmid: string, provider = 'proxmox-labul') =>
    ({
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: {
        name,
        namespace: 'default',
        annotations: {
          'backstage.io/managed-by-location': `sthings-vms:${provider}`,
          'proxmox.stuttgart-things.com/vmid': vmid,
        },
      },
      spec: { type: 'vm' },
    }) as Entity;
  const live = (status: string) => ({
    cloud: 'proxmox',
    status,
    ipAddresses: [],
    fetchedAt: '2026-11-24T12:00:00Z',
  });

  function setup(
    entities: Entity[],
    byVmid: Record<number, () => Promise<any>>,
  ) {
    let registered: any;
    const source = {
      liveInfo: jest.fn(async (l: any) => byVmid[l.vmid]()),
    };
    const catalog = {
      getEntities: jest.fn(async () => ({ items: entities })),
    };
    registerListLiveVmsAction({
      actionsRegistry: { register: (a: any) => (registered = a) },
      catalog: catalog as any,
      sources: new Map([['proxmox-labul', source]]),
      cache: new LiveInfoCache(30_000),
    });
    const run = (input: any) =>
      registered.action({ input, credentials: { principal: 'service' } });
    return { registered, source, catalog, run };
  }

  it('is read-only and names the providers it can ask', () => {
    const { registered } = setup([], {});
    expect(registered.name).toBe('list-live-vms');
    expect(registered.attributes.readOnly).toBe(true);
    expect(registered.description).toContain('proxmox-labul');
  });

  it('lists every VM of the provider with its live state, sorted', async () => {
    const t = setup([vm('b-vm', '102'), vm('a-vm', '101')], {
      101: async () => live('running'),
      102: async () => live('stopped'),
    });
    const { output } = await t.run({ provider: 'proxmox-labul' });
    expect(output.total).toBe(2);
    expect(output.vms.map((v: any) => [v.entityRef, v.info.status])).toEqual([
      ['resource:default/a-vm', 'running'],
      ['resource:default/b-vm', 'stopped'],
    ]);
    expect(t.catalog.getEntities).toHaveBeenCalledWith(
      {
        filter: {
          kind: 'Resource',
          'spec.type': 'vm',
          'metadata.annotations.backstage.io/managed-by-location':
            'sthings-vms:proxmox-labul',
        },
      },
      { credentials: { principal: 'service' } },
    );
  });

  it('filters by status but keeps VMs it could not check', async () => {
    const t = setup([vm('a', '101'), vm('b', '102'), vm('c', '103')], {
      101: async () => live('running'),
      102: async () => live('stopped'),
      103: async () => {
        throw new Error('GET /cluster/resources: 500');
      },
    });
    const { output } = await t.run({
      provider: 'proxmox-labul',
      status: 'stopped',
    });
    expect(output.total).toBe(3);
    expect(output.vms).toEqual([
      expect.objectContaining({ entityRef: 'resource:default/b', found: true }),
      expect.objectContaining({
        entityRef: 'resource:default/c',
        found: false,
        message: expect.stringContaining('GET /cluster/resources: 500'),
      }),
    ]);
  });

  it('rejects a provider that is not configured here', async () => {
    const t = setup([], {});
    await expect(t.run({ provider: 'vsphere-labda' })).rejects.toThrow(
      "VM provider 'vsphere-labda' is not configured here; this instance has: proxmox-labul",
    );
    expect(t.catalog.getEntities).not.toHaveBeenCalled();
  });

  it('asks the hypervisor at most four VMs at a time', async () => {
    let inFlight = 0;
    let peak = 0;
    const entities = Array.from({ length: 10 }, (_, i) =>
      vm(`vm-${i}`, String(200 + i)),
    );
    const byVmid: Record<number, () => Promise<any>> = {};
    for (let i = 0; i < 10; i++) {
      byVmid[200 + i] = async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 5));
        inFlight--;
        return live('running');
      };
    }
    const t = setup(entities, byVmid);
    const { output } = await t.run({ provider: 'proxmox-labul' });
    expect(output.vms).toHaveLength(10);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

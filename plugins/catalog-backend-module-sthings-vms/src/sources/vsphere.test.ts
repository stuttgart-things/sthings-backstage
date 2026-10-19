import { VsphereVmSource } from './vsphere';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

const ref = (type: string, value: string) => ({
  _typeName: 'ManagedObjectReference',
  type,
  value,
});
const prop = (name: string, _typeName: string, _value: unknown) => ({
  name,
  val: { _typeName, _value },
});
const refProp = (name: string, type: string, value: string) => ({
  name,
  val: ref(type, value),
});

const API = 'https://vc.example/sdk/vim25/8.0.1.0';

/** Answers the VI/JSON calls the source makes, like vCenter 8.0 U1 would. */
function vcenter(overrides: Record<string, () => Response> = {}) {
  const calls: { path: string; body?: any; session?: string }[] = [];
  const reply = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status: body === undefined ? 204 : 200,
      headers,
    });

  const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.slice(API.length + 1);
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      path,
      body: init.body ? JSON.parse(init.body as string) : undefined,
      session: headers['vmware-api-session-id'],
    });
    if (overrides[path]) return overrides[path]();

    switch (path) {
      case 'SessionManager/SessionManager/Login':
        return reply({ key: 'x' }, { 'vmware-api-session-id': 'sess-1' });
      case 'SessionManager/SessionManager/Logout':
        return reply(undefined);
      case 'ServiceInstance/ServiceInstance/content':
        return reply({
          about: { instanceUuid: 'vc-uuid' },
          propertyCollector: ref('PropertyCollector', 'propertyCollector'),
          searchIndex: ref('SearchIndex', 'SearchIndex'),
          viewManager: ref('ViewManager', 'ViewManager'),
        });
      case 'SearchIndex/SearchIndex/FindByInventoryPath':
        return reply(ref('Folder', 'group-v1'));
      case 'ViewManager/ViewManager/CreateContainerView': {
        const type = JSON.parse(init.body as string).type[0];
        return reply(ref('ContainerView', `session[x]${type}`));
      }
      case 'PropertyCollector/propertyCollector/RetrievePropertiesEx': {
        const spec = JSON.parse(init.body as string).specSet[0];
        const type = spec.propSet[0].type;
        if (type === 'VirtualMachine') {
          return reply({
            objects: [
              {
                obj: ref('VirtualMachine', 'vm-33695'),
                propSet: [
                  prop('name', 'string', 'vault-vsphere'),
                  refProp('parent', 'Folder', 'group-v2'),
                  prop('config.template', 'boolean', false),
                  prop(
                    'runtime.powerState',
                    'VirtualMachinePowerState',
                    'poweredOn',
                  ),
                  refProp('runtime.host', 'HostSystem', 'host-48'),
                  {
                    name: 'datastore',
                    val: {
                      _typeName: 'ArrayOfManagedObjectReference',
                      _value: [ref('Datastore', 'datastore-2')],
                    },
                  },
                  prop('summary.config.numCpu', 'int', 4),
                  prop('summary.config.memorySizeMB', 'int', 8192),
                  prop('guest.ipAddress', 'string', '10.100.136.111'),
                ],
              },
            ],
            token: 'page-2',
          });
        }
        if (type === 'Folder') {
          return reply({
            objects: [
              {
                obj: ref('Folder', 'group-v2'),
                propSet: [
                  prop('name', 'string', 'infra'),
                  refProp('parent', 'Folder', 'group-v1'),
                ],
              },
              {
                obj: ref('Folder', 'group-v3'),
                propSet: [
                  prop('name', 'string', 'vm-templates'),
                  refProp('parent', 'Folder', 'group-v1'),
                ],
              },
            ],
          });
        }
        // Host and datastore names.
        return reply({
          objects: [
            {
              obj: ref('HostSystem', 'host-44'),
              propSet: [prop('name', 'string', '10.100.135.44')],
            },
            {
              obj: ref('HostSystem', 'host-48'),
              propSet: [prop('name', 'string', '10.100.135.48')],
            },
            {
              obj: ref('Datastore', 'datastore-2'),
              propSet: [prop('name', 'string', 'NetApp-HCI-Datastore-02')],
            },
          ],
        });
      }
      case 'PropertyCollector/propertyCollector/ContinueRetrievePropertiesEx':
        return reply({
          objects: [
            {
              obj: ref('VirtualMachine', 'vm-45955'),
              propSet: [
                prop('name', 'string', 'sthings-u26'),
                refProp('parent', 'Folder', 'group-v3'),
                prop('config.template', 'boolean', true),
                prop(
                  'runtime.powerState',
                  'VirtualMachinePowerState',
                  'poweredOff',
                ),
                refProp('runtime.host', 'HostSystem', 'host-44'),
                prop('summary.config.numCpu', 'int', 2),
                prop('summary.config.memorySizeMB', 'int', 4096),
              ],
            },
          ],
        });
      default:
        return reply(undefined);
    }
  });
  return { fetchImpl, calls };
}

function source(fetchImpl: jest.Mock) {
  return new VsphereVmSource({
    endpoint: 'https://vc.example/',
    folder: 'NetApp-HCI-Datacenter/vm/stuttgart-things',
    username: 'backstage@vsphere.local',
    password: 's3cret',
    logger: logger as any,
    fetch: fetchImpl as unknown as typeof fetch,
  });
}

describe('VsphereVmSource', () => {
  it('lists VMs and templates below the folder, across result pages', async () => {
    const { fetchImpl, calls } = vcenter();
    const vms = await source(fetchImpl).listVms();

    expect(vms).toEqual([
      {
        name: 'vault-vsphere',
        cloud: 'vsphere',
        template: false,
        status: 'running',
        cpus: 4,
        memoryMiB: 8192,
        ipv4: '10.100.136.111',
        tags: [],
        annotations: {
          'vsphere.stuttgart-things.com/moid': 'vm-33695',
          'vsphere.stuttgart-things.com/host': '10.100.135.48',
          'vsphere.stuttgart-things.com/folder': 'stuttgart-things/infra',
          'vsphere.stuttgart-things.com/datastore': 'NetApp-HCI-Datastore-02',
          'vsphere.stuttgart-things.com/ipv4': '10.100.136.111',
        },
        url: 'https://vc.example/ui/app/vm;nav=v/urn:vmomi:VirtualMachine:vm-33695:vc-uuid/summary',
      },
      expect.objectContaining({
        name: 'sthings-u26',
        template: true,
        status: 'stopped',
        ipv4: undefined,
        annotations: {
          'vsphere.stuttgart-things.com/moid': 'vm-45955',
          'vsphere.stuttgart-things.com/host': '10.100.135.44',
          'vsphere.stuttgart-things.com/folder':
            'stuttgart-things/vm-templates',
        },
      }),
    ]);

    const login = calls[0];
    expect(login.body).toEqual({
      userName: 'backstage@vsphere.local',
      password: 's3cret',
    });
    expect(calls.slice(1).every(c => c.session === 'sess-1')).toBe(true);
    expect(
      calls.find(c => c.path.endsWith('FindByInventoryPath'))?.body,
    ).toEqual({
      inventoryPath: 'NetApp-HCI-Datacenter/vm/stuttgart-things',
    });
    expect(
      calls
        .filter(c => c.path.endsWith('CreateContainerView'))
        .map(c => c.body),
    ).toEqual([
      expect.objectContaining({ type: ['VirtualMachine'], recursive: true }),
      expect.objectContaining({ type: ['Folder'], recursive: true }),
    ]);
    expect(calls.filter(c => c.path.endsWith('/DestroyView'))).toHaveLength(2);
    expect(calls[calls.length - 1].path).toBe(
      'SessionManager/SessionManager/Logout',
    );
  });

  it('fails when the folder does not exist, and still logs out', async () => {
    const { fetchImpl, calls } = vcenter({
      'SearchIndex/SearchIndex/FindByInventoryPath': () =>
        new Response(null, { status: 204 }),
    });
    await expect(source(fetchImpl).listVms()).rejects.toThrow(
      "vSphere folder 'NetApp-HCI-Datacenter/vm/stuttgart-things' not found",
    );
    expect(calls[calls.length - 1].path).toBe(
      'SessionManager/SessionManager/Logout',
    );
  });

  it('fails when the login is rejected', async () => {
    const { fetchImpl } = vcenter({
      'SessionManager/SessionManager/Login': () =>
        new Response('{}', { status: 401, statusText: 'Unauthorized' }),
    });
    await expect(source(fetchImpl).listVms()).rejects.toThrow(
      'vSphere SessionManager/SessionManager/Login failed: 401 Unauthorized',
    );
  });

  it('names the cause when the request itself fails', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
      });
    });
    await expect(source(fetchImpl).listVms()).rejects.toThrow(
      'vSphere SessionManager/SessionManager/Login failed: fetch failed (DEPTH_ZERO_SELF_SIGNED_CERT)',
    );
  });
});

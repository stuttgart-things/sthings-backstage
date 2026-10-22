import { VsphereVmSource } from './vsphere';

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
};

const SDK = 'https://vc.example/sdk';
const COOKIE = 'vmware_soap_session="52a1"';

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
const fault = (message: string) =>
  envelope(
    '<soapenv:Fault><faultcode>ServerFaultCode</faultcode>' +
      `<faultstring>${message}</faultstring></soapenv:Fault>`,
  );

const moRef = (tag: string, type: string, value: string) =>
  `<${tag} type="${type}">${value}</${tag}>`;
const prop = (name: string, xsiType: string, value: string) =>
  `<propSet><name>${name}</name><val xsi:type="${xsiType}">${value}</val></propSet>`;
const refProp = (name: string, type: string, value: string) =>
  `<propSet><name>${name}</name><val type="${type}" xsi:type="ManagedObjectReference">${value}</val></propSet>`;
const refArrayProp = (name: string, type: string, values: string[]) =>
  `<propSet><name>${name}</name><val xsi:type="ArrayOfManagedObjectReference">${values
    .map(v => moRef('ManagedObjectReference', type, v))
    .join('')}</val></propSet>`;
const returnval = (...parts: string[]) =>
  `<returnval>${parts.join('')}</returnval>`;
const object = (type: string, value: string, props: string) =>
  `<objects>${moRef('obj', type, value)}${props}</objects>`;

const vaultVm = object(
  'VirtualMachine',
  'vm-33695',
  prop('name', 'xsd:string', 'vault-vsphere') +
    refProp('parent', 'Folder', 'group-v2') +
    prop('config.template', 'xsd:boolean', 'false') +
    prop('runtime.powerState', 'VirtualMachinePowerState', 'poweredOn') +
    refProp('runtime.host', 'HostSystem', 'host-48') +
    refArrayProp('datastore', 'Datastore', ['datastore-2']) +
    prop('summary.config.numCpu', 'xsd:int', '4') +
    prop('summary.config.memorySizeMB', 'xsd:int', '8192') +
    prop('guest.ipAddress', 'xsd:string', '10.100.136.111'),
);
const templateVm = object(
  'VirtualMachine',
  'vm-45955',
  prop('name', 'xsd:string', 'sthings-u26') +
    refProp('parent', 'Folder', 'group-v3') +
    prop('config.template', 'xsd:boolean', 'true') +
    prop('runtime.powerState', 'VirtualMachinePowerState', 'poweredOff') +
    refProp('runtime.host', 'HostSystem', 'host-44') +
    prop('summary.config.numCpu', 'xsd:int', '2') +
    prop('summary.config.memorySizeMB', 'xsd:int', '4096'),
);

/** Answers the vim25 SOAP calls the source makes, like vCenter 7.0.3 would. */
function vcenter(overrides: Record<string, () => Response> = {}) {
  const calls: {
    method: string;
    body: string;
    headers: Record<string, string>;
  }[] = [];
  const xml = (
    body: string,
    status = 200,
    headers: Record<string, string> = {},
  ) =>
    new Response(body, {
      status,
      headers: { 'content-type': 'text/xml; charset=utf-8', ...headers },
    });

  const fetchImpl = jest.fn(async (url: string, init: RequestInit = {}) => {
    expect(url).toBe(SDK);
    const body = init.body as string;
    const method = /<soapenv:Body><(\w+) xmlns="urn:vim25">/.exec(body)![1];
    calls.push({
      method,
      body,
      headers: init.headers as Record<string, string>,
    });
    if (overrides[method]) return overrides[method]();

    switch (method) {
      case 'RetrieveServiceContent':
        return xml(
          response(
            method,
            returnval(
              moRef('rootFolder', 'Folder', 'group-d1'),
              moRef(
                'propertyCollector',
                'PropertyCollector',
                'propertyCollector',
              ),
              moRef('viewManager', 'ViewManager', 'ViewManager'),
              '<about><name>VMware vCenter Server</name><apiVersion>7.0.3.0</apiVersion>',
              '<instanceUuid>vc-uuid</instanceUuid></about>',
              moRef('searchIndex', 'SearchIndex', 'SearchIndex'),
              moRef('sessionManager', 'SessionManager', 'SessionManager'),
            ),
          ),
          200,
          { 'set-cookie': `${COOKIE}; Path=/; HttpOnly; Secure;` },
        );
      case 'Login':
        return xml(
          response(method, '<returnval><userName>u</userName></returnval>'),
        );
      case 'Logout':
      case 'DestroyView':
        return xml(response(method));
      case 'FindByInventoryPath':
        return xml(response(method, moRef('returnval', 'Folder', 'group-v1')));
      case 'CreateContainerView': {
        const type = /<type>(\w+)<\/type>/.exec(body)![1];
        return xml(
          response(
            method,
            moRef('returnval', 'ContainerView', `session[x]${type}`),
          ),
        );
      }
      case 'RetrievePropertiesEx': {
        if (body.includes('<type>VirtualMachine</type>')) {
          return xml(
            response(
              method,
              `<returnval><token>page-2</token>${vaultVm}</returnval>`,
            ),
          );
        }
        if (body.includes('<type>Folder</type>')) {
          return xml(
            response(
              method,
              returnval(
                object(
                  'Folder',
                  'group-v2',
                  prop('name', 'xsd:string', 'infra') +
                    refProp('parent', 'Folder', 'group-v1'),
                ),
                object(
                  'Folder',
                  'group-v3',
                  prop('name', 'xsd:string', 'vm-templates') +
                    refProp('parent', 'Folder', 'group-v1'),
                ),
              ),
            ),
          );
        }
        // Host and datastore names.
        return xml(
          response(
            method,
            returnval(
              object(
                'HostSystem',
                'host-44',
                prop('name', 'xsd:string', '10.100.135.44'),
              ),
              object(
                'HostSystem',
                'host-48',
                prop('name', 'xsd:string', '10.100.135.48'),
              ),
              object(
                'Datastore',
                'datastore-2',
                prop('name', 'xsd:string', 'NetApp-HCI-Datastore-02'),
              ),
            ),
          ),
        );
      }
      case 'ContinueRetrievePropertiesEx':
        return xml(response(method, `<returnval>${templateVm}</returnval>`));
      default:
        return xml(fault(`unexpected ${method}`), 500);
    }
  });
  return { fetchImpl, calls };
}

function source(fetchImpl: jest.Mock, password = 's3cret') {
  return new VsphereVmSource({
    endpoint: 'https://vc.example/',
    folder: 'NetApp-HCI-Datacenter/vm/stuttgart-things',
    username: 'backstage@vsphere.local',
    password,
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
        cpus: 2,
        memoryMiB: 4096,
        ipv4: undefined,
        annotations: {
          'vsphere.stuttgart-things.com/moid': 'vm-45955',
          'vsphere.stuttgart-things.com/host': '10.100.135.44',
          'vsphere.stuttgart-things.com/folder':
            'stuttgart-things/vm-templates',
        },
      }),
    ]);

    expect(calls.map(c => c.method)).toEqual([
      'RetrieveServiceContent',
      'Login',
      'FindByInventoryPath',
      'CreateContainerView',
      'RetrievePropertiesEx',
      'ContinueRetrievePropertiesEx',
      'DestroyView',
      'CreateContainerView',
      'RetrievePropertiesEx',
      'DestroyView',
      'RetrievePropertiesEx',
      'Logout',
    ]);
    expect(calls[0].headers.Cookie).toBeUndefined();
    expect(calls.slice(1).every(c => c.headers.Cookie === COOKIE)).toBe(true);
    expect(
      calls.every(c => c.headers.SOAPAction === '"urn:vim25/7.0.3.0"'),
    ).toBe(true);
    expect(calls[1].body).toContain(
      '<userName>backstage@vsphere.local</userName><password>s3cret</password>',
    );
    expect(calls[2].body).toContain(
      '<inventoryPath>NetApp-HCI-Datacenter/vm/stuttgart-things</inventoryPath>',
    );
    expect(calls[3].body).toContain(
      '<container type="Folder">group-v1</container><type>VirtualMachine</type><recursive>true</recursive>',
    );
    expect(calls[4].body).toContain(
      '<selectSet xsi:type="TraversalSpec"><name>traverseView</name>',
    );
    expect(calls[5].body).toContain('<token>page-2</token>');
  });

  it('escapes credentials in the request', async () => {
    const { fetchImpl, calls } = vcenter();
    await source(fetchImpl, '<a&b>"').listVms();
    expect(calls[1].body).toContain(
      '<password>&lt;a&amp;b&gt;&quot;</password>',
    );
  });

  it('fails when the folder does not exist, and still logs out', async () => {
    const { fetchImpl, calls } = vcenter({
      FindByInventoryPath: () =>
        new Response(response('FindByInventoryPath'), { status: 200 }),
    });
    await expect(source(fetchImpl).listVms()).rejects.toThrow(
      "vSphere folder 'NetApp-HCI-Datacenter/vm/stuttgart-things' not found",
    );
    expect(calls[calls.length - 1].method).toBe('Logout');
  });

  it('reports the SOAP fault when the login is rejected', async () => {
    const { fetchImpl } = vcenter({
      Login: () =>
        new Response(
          fault(
            'Cannot complete login due to an incorrect user name or password.',
          ),
          { status: 500, statusText: 'Internal Server Error' },
        ),
    });
    await expect(source(fetchImpl).listVms()).rejects.toThrow(
      'vSphere Login failed: Cannot complete login due to an incorrect user name or password.',
    );
  });

  it('reports the HTTP status when the answer is not SOAP', async () => {
    const { fetchImpl } = vcenter({
      RetrieveServiceContent: () =>
        new Response('', { status: 404, statusText: 'Not Found' }),
    });
    await expect(source(fetchImpl).listVms()).rejects.toThrow(
      'vSphere RetrieveServiceContent failed: 404 Not Found',
    );
  });

  it('names the cause when the request itself fails', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
      });
    });
    await expect(source(fetchImpl).listVms()).rejects.toThrow(
      'vSphere RetrieveServiceContent failed: fetch failed (DEPTH_ZERO_SELF_SIGNED_CERT)',
    );
  });
});

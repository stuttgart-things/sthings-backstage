import { LoggerService } from '@backstage/backend-plugin-api';
import { VmRecord, VmSource } from '../types';
import { pinnedFetch } from './proxmox';

export const VSPHERE_ANNOTATION_PREFIX = 'vsphere.stuttgart-things.com';

/** First VI/JSON release; vCenter 8.0 U1 and later serve it. */
export const DEFAULT_VSPHERE_API_RELEASE = '8.0.1.0';

export interface VsphereSourceOptions {
  /** vCenter base URL, e.g. https://10.100.135.50 */
  endpoint: string;
  /**
   * Inventory path of the VM folder, e.g.
   * `NetApp-HCI-Datacenter/vm/stuttgart-things`. Its subfolders are included.
   */
  folder: string;
  username: string;
  password: string;
  /** VI/JSON API release in the URL path. */
  apiRelease?: string;
  /** PEM to trust for this endpoint instead of the Node trust store. */
  caCert?: string;
  logger: LoggerService;
  fetch?: typeof fetch;
}

interface MoRef {
  type: string;
  value: string;
}

interface ObjectContent {
  obj: MoRef;
  propSet?: { name: string; val: unknown }[];
}

interface RetrieveResult {
  objects?: ObjectContent[];
  token?: string;
}

interface ServiceContent {
  about: { instanceUuid: string };
  propertyCollector: MoRef;
  searchIndex: MoRef;
  viewManager: MoRef;
}

const VM_PROPERTIES = [
  'name',
  'parent',
  'config.template',
  'runtime.powerState',
  'runtime.host',
  'datastore',
  'summary.config.numCpu',
  'summary.config.memorySizeMB',
  'guest.ipAddress',
];

const POWER_STATES: Record<string, string> = {
  poweredOn: 'running',
  poweredOff: 'stopped',
  suspended: 'suspended',
};

/**
 * Lists the VMs and templates under one vCenter folder via the VI/JSON API
 * (vCenter 8.0 U1+). Unlike the Automation REST API (/api/vcenter/vm), it also
 * returns templates kept in folders. A read-only user is enough.
 */
export class VsphereVmSource implements VmSource {
  private readonly baseUrl: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VsphereSourceOptions) {
    this.baseUrl = options.endpoint.replace(/\/+$/, '');
    this.apiBase = `${this.baseUrl}/sdk/vim25/${
      options.apiRelease ?? DEFAULT_VSPHERE_API_RELEASE
    }`;
    this.fetchImpl =
      options.fetch ?? (options.caCert ? pinnedFetch(options.caCert) : fetch);
  }

  async listVms(): Promise<VmRecord[]> {
    const session = await this.login();
    try {
      return await this.listWithSession(session);
    } finally {
      await this.call(session, 'SessionManager/SessionManager/Logout').catch(
        e =>
          this.options.logger.debug(
            `vSphere logout failed: ${(e as Error).message}`,
          ),
      );
    }
  }

  private async listWithSession(session: string): Promise<VmRecord[]> {
    const content = await this.call<ServiceContent>(
      session,
      'ServiceInstance/ServiceInstance/content',
      undefined,
      'GET',
    );
    const root = await this.call<MoRef | undefined>(
      session,
      `SearchIndex/${content.searchIndex.value}/FindByInventoryPath`,
      { inventoryPath: this.options.folder },
    );
    if (!root) {
      throw new Error(`vSphere folder '${this.options.folder}' not found`);
    }

    const vms = await this.retrieveView(
      session,
      content,
      root,
      'VirtualMachine',
      VM_PROPERTIES,
    );
    const folders = await this.retrieveView(session, content, root, 'Folder', [
      'name',
      'parent',
    ]);
    const rootName = this.options.folder.split('/').filter(Boolean).pop()!;
    const folderPath = folderPaths(root, rootName, folders);

    const refs = new Map<string, MoRef>();
    for (const vm of vms) {
      const host = vm.props['runtime.host'] as MoRef | undefined;
      const datastore = (vm.props.datastore as MoRef[] | undefined)?.[0];
      for (const ref of [host, datastore]) {
        if (ref) refs.set(`${ref.type}:${ref.value}`, ref);
      }
    }
    const names = await this.names(session, content, [...refs.values()]);

    return vms.map(vm => {
      const p = vm.props;
      const template = p['config.template'] === true;
      const host = p['runtime.host'] as MoRef | undefined;
      const datastore = (p.datastore as MoRef[] | undefined)?.[0];
      const parent = p.parent as MoRef | undefined;
      const ipv4 = ipv4Of(p['guest.ipAddress']);

      const annotations: Record<string, string> = {
        [`${VSPHERE_ANNOTATION_PREFIX}/moid`]: vm.obj.value,
      };
      const set = (key: string, value: string | undefined) => {
        if (value) annotations[`${VSPHERE_ANNOTATION_PREFIX}/${key}`] = value;
      };
      set('host', host && names.get(host.value));
      set('folder', parent && folderPath.get(parent.value));
      set('datastore', datastore && names.get(datastore.value));
      set('ipv4', ipv4);

      const powerState = p['runtime.powerState'] as string | undefined;
      return {
        name: (p.name as string | undefined) ?? vm.obj.value,
        cloud: 'vsphere',
        template,
        status: powerState && (POWER_STATES[powerState] ?? powerState),
        cpus: p['summary.config.numCpu'] as number | undefined,
        memoryMiB: p['summary.config.memorySizeMB'] as number | undefined,
        ipv4,
        tags: [],
        annotations,
        url: `${this.baseUrl}/ui/app/vm;nav=v/urn:vmomi:VirtualMachine:${vm.obj.value}:${content.about.instanceUuid}/summary`,
      };
    });
  }

  /** All objects of `type` below `root` (recursive), with the given properties. */
  private async retrieveView(
    session: string,
    content: ServiceContent,
    root: MoRef,
    type: string,
    pathSet: string[],
  ): Promise<{ obj: MoRef; props: Record<string, unknown> }[]> {
    const view = await this.call<MoRef>(
      session,
      `ViewManager/${content.viewManager.value}/CreateContainerView`,
      { container: moRef(root), type: [type], recursive: true },
    );
    try {
      return await this.retrieve(session, content, {
        _typeName: 'PropertyFilterSpec',
        propSet: [{ _typeName: 'PropertySpec', type, pathSet }],
        objectSet: [
          {
            _typeName: 'ObjectSpec',
            obj: moRef(view),
            skip: true,
            selectSet: [
              {
                _typeName: 'TraversalSpec',
                name: 'traverseView',
                type: 'ContainerView',
                path: 'view',
                skip: false,
              },
            ],
          },
        ],
      });
    } finally {
      await this.call(session, `ContainerView/${view.value}/DestroyView`).catch(
        () => undefined,
      );
    }
  }

  /** Names of hosts and datastores, keyed by moid. */
  private async names(
    session: string,
    content: ServiceContent,
    refs: MoRef[],
  ): Promise<Map<string, string>> {
    if (refs.length === 0) return new Map();
    const types = [...new Set(refs.map(r => r.type))];
    const objects = await this.retrieve(session, content, {
      _typeName: 'PropertyFilterSpec',
      propSet: types.map(type => ({
        _typeName: 'PropertySpec',
        type,
        pathSet: ['name'],
      })),
      objectSet: refs.map(ref => ({
        _typeName: 'ObjectSpec',
        obj: moRef(ref),
      })),
    });
    return new Map(objects.map(o => [o.obj.value, o.props.name as string]));
  }

  private async retrieve(
    session: string,
    content: ServiceContent,
    specSet: unknown,
  ): Promise<{ obj: MoRef; props: Record<string, unknown> }[]> {
    const pc = content.propertyCollector.value;
    const out: { obj: MoRef; props: Record<string, unknown> }[] = [];
    let result = await this.call<RetrieveResult | undefined>(
      session,
      `PropertyCollector/${pc}/RetrievePropertiesEx`,
      { specSet: [specSet], options: { _typeName: 'RetrieveOptions' } },
    );
    for (;;) {
      for (const o of result?.objects ?? []) {
        const props: Record<string, unknown> = {};
        for (const p of o.propSet ?? []) props[p.name] = unwrap(p.val);
        out.push({ obj: o.obj, props });
      }
      if (!result?.token) return out;
      result = await this.call<RetrieveResult | undefined>(
        session,
        `PropertyCollector/${pc}/ContinueRetrievePropertiesEx`,
        { token: result.token },
      );
    }
  }

  private async login(): Promise<string> {
    const res = await this.request('SessionManager/SessionManager/Login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: this.options.username,
        password: this.options.password,
      }),
    });
    const session = res.headers.get('vmware-api-session-id');
    if (!session) {
      throw new Error('vSphere login returned no vmware-api-session-id');
    }
    return session;
  }

  private async call<T>(
    session: string,
    path: string,
    body?: unknown,
    method: 'GET' | 'POST' = 'POST',
  ): Promise<T> {
    const res = await this.request(path, {
      method,
      headers: {
        'vmware-api-session-id': session,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    // Methods without a result (Logout, DestroyView, a FindBy* miss) answer
    // 204 or an empty body.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.apiBase}/${path}`, init);
    } catch (e) {
      // fetch hides the real reason (TLS, DNS, ...) in `cause`.
      const cause = (e as { cause?: { code?: string; message?: string } })
        .cause;
      const reason = cause?.code ?? cause?.message;
      throw new Error(
        `vSphere ${path} failed: ${(e as Error).message}${reason ? ` (${reason})` : ''}`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `vSphere ${path} failed: ${res.status} ${res.statusText}`,
      );
    }
    return res;
  }
}

/** VI/JSON wraps `xsd:anyType` values as `{_typeName, _value}`. */
function unwrap(val: unknown): unknown {
  if (val && typeof val === 'object' && '_value' in val) {
    return (val as { _value: unknown })._value;
  }
  return val;
}

/** A MoRef as VI/JSON expects it in a request body. */
function moRef(ref: MoRef) {
  return {
    _typeName: 'ManagedObjectReference',
    type: ref.type,
    value: ref.value,
  };
}

/**
 * Path of every folder below `root`, starting with the root's own name, e.g.
 * `stuttgart-things/infra`, keyed by moid.
 */
function folderPaths(
  root: MoRef,
  rootName: string,
  folders: { obj: MoRef; props: Record<string, unknown> }[],
): Map<string, string> {
  const byId = new Map(folders.map(f => [f.obj.value, f.props]));
  const paths = new Map<string, string>([[root.value, rootName]]);
  const resolve = (id: string, depth = 0): string | undefined => {
    if (paths.has(id)) return paths.get(id);
    const folder = byId.get(id);
    const parent = folder?.parent as MoRef | undefined;
    if (!folder || !parent || depth > 50) return undefined;
    const parentPath = resolve(parent.value, depth + 1);
    if (parentPath === undefined) return undefined;
    const path = `${parentPath}/${folder.name as string}`;
    paths.set(id, path);
    return path;
  };
  for (const id of byId.keys()) resolve(id);
  return paths;
}

/** guest.ipAddress is the primary IP and can be IPv6; only IPv4 is kept. */
function ipv4Of(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{1,3}(\.\d{1,3}){3}$/.test(value)
    ? value
    : undefined;
}

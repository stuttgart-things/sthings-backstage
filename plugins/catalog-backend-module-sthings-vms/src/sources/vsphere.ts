import { LoggerService } from '@backstage/backend-plugin-api';
import { XMLParser } from 'fast-xml-parser';
import { VmRecord, VmSource } from '../types';
import { pinnedFetch } from './proxmox';

export const VSPHERE_ANNOTATION_PREFIX = 'vsphere.stuttgart-things.com';

/**
 * vim25 version sent in SOAPAction. 7.0.3.0 is what LabDA's vCenter serves
 * and newer vCenters still answer it.
 */
export const DEFAULT_VSPHERE_API_VERSION = '7.0.3.0';

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
  /** vim25 API version for SOAPAction. */
  apiVersion?: string;
  /** PEM to trust for this endpoint instead of the Node trust store. */
  caCert?: string;
  logger: LoggerService;
  fetch?: typeof fetch;
}

interface MoRef {
  type: string;
  value: string;
}

interface ServiceContent {
  instanceUuid: string;
  propertyCollector: MoRef;
  searchIndex: MoRef;
  sessionManager: MoRef;
  viewManager: MoRef;
}

type Props = Record<string, unknown>;
type XmlNode = Record<string, any>;

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

const SOAP_ENVELOPE_OPEN =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"' +
  ' xmlns:xsd="http://www.w3.org/2001/XMLSchema"' +
  ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: name =>
    name === 'objects' ||
    name === 'propSet' ||
    name === 'ManagedObjectReference',
});

/**
 * One vim25 SOAP session: every call carries the session cookie that vCenter
 * set on an earlier response.
 */
class SoapSession {
  private cookie?: string;

  constructor(
    private readonly post: (init: RequestInit) => Promise<Response>,
    private readonly apiVersion: string,
  ) {}

  /** Calls `method` and returns its `returnval`, or undefined if it has none. */
  async call(method: string, body: string): Promise<any> {
    let res: Response;
    try {
      res = await this.post({
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"urn:vim25/${this.apiVersion}"`,
          ...(this.cookie && { Cookie: this.cookie }),
        },
        body: `${SOAP_ENVELOPE_OPEN}<soapenv:Body><${method} xmlns="urn:vim25">${body}</${method}></soapenv:Body></soapenv:Envelope>`,
      });
    } catch (e) {
      // fetch hides the real reason (TLS, DNS, ...) in `cause`.
      const cause = (e as { cause?: { code?: string; message?: string } })
        .cause;
      const reason = cause?.code ?? cause?.message;
      throw new Error(
        `vSphere ${method} failed: ${(e as Error).message}${reason ? ` (${reason})` : ''}`,
      );
    }

    const session = sessionCookie(res.headers);
    if (session) this.cookie = session;

    const xml = await res.text();
    const soapBody = envelopeBody(xml);
    const fault = soapBody && child(soapBody, 'Fault');
    if (fault) {
      throw new Error(
        `vSphere ${method} failed: ${text(fault.faultstring) || 'SOAP fault'}`,
      );
    }
    if (!res.ok || !soapBody) {
      throw new Error(
        `vSphere ${method} failed: ${res.status} ${res.statusText}`,
      );
    }
    return soapBody[`${method}Response`]?.returnval;
  }
}

/**
 * Lists the VMs and templates under one vCenter folder via the vSphere Web
 * Services API (SOAP, vim25). Unlike the Automation REST API
 * (/api/vcenter/vm), it also returns templates kept in folders; unlike the
 * VI/JSON API, it is served by vCenter 7 as well. A read-only user is enough.
 */
export class VsphereVmSource implements VmSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VsphereSourceOptions) {
    this.baseUrl = options.endpoint.replace(/\/+$/, '');
    this.fetchImpl =
      options.fetch ?? (options.caCert ? pinnedFetch(options.caCert) : fetch);
  }

  async listVms(): Promise<VmRecord[]> {
    const session = new SoapSession(
      init => this.fetchImpl(`${this.baseUrl}/sdk`, init),
      this.options.apiVersion ?? DEFAULT_VSPHERE_API_VERSION,
    );
    const content = serviceContent(
      await session.call(
        'RetrieveServiceContent',
        moRefXml('_this', {
          type: 'ServiceInstance',
          value: 'ServiceInstance',
        }),
      ),
    );
    await session.call(
      'Login',
      moRefXml('_this', content.sessionManager) +
        el('userName', this.options.username) +
        el('password', this.options.password),
    );
    try {
      return await this.listWithSession(session, content);
    } finally {
      await session
        .call('Logout', moRefXml('_this', content.sessionManager))
        .catch(e =>
          this.options.logger.debug(
            `vSphere logout failed: ${(e as Error).message}`,
          ),
        );
    }
  }

  private async listWithSession(
    session: SoapSession,
    content: ServiceContent,
  ): Promise<VmRecord[]> {
    const found = await session.call(
      'FindByInventoryPath',
      moRefXml('_this', content.searchIndex) +
        el('inventoryPath', this.options.folder),
    );
    if (!found) {
      throw new Error(`vSphere folder '${this.options.folder}' not found`);
    }
    const root = toMoRef(found);
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
        url: `${this.baseUrl}/ui/app/vm;nav=v/urn:vmomi:VirtualMachine:${vm.obj.value}:${content.instanceUuid}/summary`,
      };
    });
  }

  /** All objects of `type` below `root` (recursive), with the given properties. */
  private async retrieveView(
    session: SoapSession,
    content: ServiceContent,
    root: MoRef,
    type: string,
    pathSet: string[],
  ): Promise<{ obj: MoRef; props: Props }[]> {
    const view = toMoRef(
      await session.call(
        'CreateContainerView',
        moRefXml('_this', content.viewManager) +
          moRefXml('container', root) +
          el('type', type) +
          el('recursive', 'true'),
      ),
    );
    try {
      return await this.retrieve(
        session,
        content,
        wrap(
          'propSet',
          el('type', type) + pathSet.map(p => el('pathSet', p)).join(''),
        ) +
          wrap(
            'objectSet',
            `${moRefXml('obj', view)}${el('skip', 'true')}` +
              `<selectSet xsi:type="TraversalSpec">${el('name', 'traverseView')}` +
              `${el('type', 'ContainerView')}${el('path', 'view')}` +
              `${el('skip', 'false')}</selectSet>`,
          ),
      );
    } finally {
      await session
        .call('DestroyView', moRefXml('_this', view))
        .catch(() => undefined);
    }
  }

  /** Names of hosts and datastores, keyed by moid. */
  private async names(
    session: SoapSession,
    content: ServiceContent,
    refs: MoRef[],
  ): Promise<Map<string, string>> {
    if (refs.length === 0) return new Map();
    const types = [...new Set(refs.map(r => r.type))];
    const objects = await this.retrieve(
      session,
      content,
      types
        .map(type => wrap('propSet', el('type', type) + el('pathSet', 'name')))
        .join('') +
        refs.map(ref => wrap('objectSet', moRefXml('obj', ref))).join(''),
    );
    return new Map(objects.map(o => [o.obj.value, o.props.name as string]));
  }

  /** RetrievePropertiesEx for one PropertyFilterSpec, following the paging token. */
  private async retrieve(
    session: SoapSession,
    content: ServiceContent,
    filterSpec: string,
  ): Promise<{ obj: MoRef; props: Props }[]> {
    const pc = moRefXml('_this', content.propertyCollector);
    const out: { obj: MoRef; props: Props }[] = [];
    let result: XmlNode | undefined = await session.call(
      'RetrievePropertiesEx',
      `${pc}${wrap('specSet', filterSpec)}<options></options>`,
    );
    for (;;) {
      for (const o of (result?.objects ?? []) as XmlNode[]) {
        const props: Props = {};
        for (const p of (o.propSet ?? []) as XmlNode[]) {
          props[text(p.name)] = fromXml(p.val);
        }
        out.push({ obj: toMoRef(o.obj), props });
      }
      const token = result?.token;
      if (!token) return out;
      result = await session.call(
        'ContinueRetrievePropertiesEx',
        pc + el('token', text(token)),
      );
    }
  }
}

/** `vmware_soap_session="..."` from Set-Cookie, ready for a Cookie header. */
function sessionCookie(headers: Headers): string | undefined {
  const cookies =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : [headers.get('set-cookie') ?? ''];
  return cookies
    .map(c => c.split(';')[0].trim())
    .find(c => c.startsWith('vmware_soap_session='));
}

function envelopeBody(xml: string): XmlNode | undefined {
  if (!xml) return undefined;
  const envelope = child(xmlParser.parse(xml), 'Envelope');
  return envelope && child(envelope, 'Body');
}

/** Child element by local name, whatever namespace prefix it carries. */
function child(node: XmlNode, localName: string): XmlNode | undefined {
  const key = Object.keys(node).find(
    k => k === localName || k.endsWith(`:${localName}`),
  );
  return key === undefined ? undefined : node[key];
}

function text(node: unknown): string {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') return String((node as XmlNode)['#text'] ?? '');
  return String(node);
}

function toMoRef(node: XmlNode | string): MoRef {
  return { type: (node as XmlNode)['@_type'] ?? '', value: text(node) };
}

/** A property value, typed by its xsi:type. */
function fromXml(val: unknown): unknown {
  if (val === undefined || val === null || typeof val !== 'object') return val;
  const node = val as XmlNode;
  const type = String(node['@_xsi:type'] ?? '').replace(/^xsd:/, '');
  switch (type) {
    case 'ManagedObjectReference':
      return toMoRef(node);
    case 'ArrayOfManagedObjectReference':
      return ((node.ManagedObjectReference ?? []) as XmlNode[]).map(toMoRef);
    case 'boolean':
      return text(node) === 'true';
    case 'int':
    case 'long':
    case 'short':
      return Number(text(node));
    default:
      return text(node);
  }
}

function serviceContent(node: XmlNode): ServiceContent {
  return {
    instanceUuid: text(node.about?.instanceUuid),
    propertyCollector: toMoRef(node.propertyCollector),
    searchIndex: toMoRef(node.searchIndex),
    sessionManager: toMoRef(node.sessionManager),
    viewManager: toMoRef(node.viewManager),
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** `<name>value</name>` with the value escaped. */
function el(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

/** `<name>xml</name>` around already-built elements. */
function wrap(name: string, xml: string): string {
  return `<${name}>${xml}</${name}>`;
}

function moRefXml(name: string, ref: MoRef): string {
  return `<${name} type="${escapeXml(ref.type)}">${escapeXml(ref.value)}</${name}>`;
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

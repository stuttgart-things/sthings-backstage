import {
  coreServices,
  createBackendPlugin,
  HttpAuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import {
  ActionsRegistryService,
  actionsRegistryServiceRef,
} from '@backstage/backend-plugin-api/alpha';
import {
  Entity,
  ANNOTATION_LOCATION,
  parseEntityRef,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { Config } from '@backstage/config';
import { InputError, NotFoundError } from '@backstage/errors';
import {
  CatalogService,
  catalogServiceRef,
} from '@backstage/plugin-catalog-node';
import express from 'express';
import Router from 'express-promise-router';
import { LiveVmSource, VmLiveInfo, VmLocator, VmNotFoundError } from './live';
import { HARVESTER_ANNOTATION_PREFIX } from './sources/harvester';
import { PROXMOX_ANNOTATION_PREFIX } from './sources/proxmox';
import { VSPHERE_ANNOTATION_PREFIX } from './sources/vsphere';
import {
  createVmSource,
  VM_SOURCE_TYPES,
  VMS_CONFIG_KEY,
} from './sources/factory';

/** How long one answer is served before the hypervisor is asked again. */
export const DEFAULT_CACHE_SECONDS = 30;

/**
 * Which provider manages the entity, and where the VM is in it. Undefined for
 * entities the sthings-vms provider did not create (hand-written VMs,
 * Terraform VMs): there is nothing to ask live.
 */
export function vmLocatorOf(
  entity: Entity,
): { providerId: string; locator: VmLocator } | undefined {
  const a = entity.metadata.annotations ?? {};
  const location = a[ANNOTATION_LOCATION] ?? '';
  if (!location.startsWith('sthings-vms:')) return undefined;
  const providerId = location.slice('sthings-vms:'.length);

  const vmid = a[`${PROXMOX_ANNOTATION_PREFIX}/vmid`];
  if (vmid && /^\d+$/.test(vmid)) {
    return { providerId, locator: { cloud: 'proxmox', vmid: Number(vmid) } };
  }
  const moid = a[`${VSPHERE_ANNOTATION_PREFIX}/moid`];
  if (moid) return { providerId, locator: { cloud: 'vsphere', moid } };
  const namespace = a[`${HARVESTER_ANNOTATION_PREFIX}/namespace`];
  if (namespace) {
    // Entities from before the name annotation: the title is the VM name
    // unless it had to be prefixed with the namespace.
    const name =
      a[`${HARVESTER_ANNOTATION_PREFIX}/name`] ??
      entity.metadata.title ??
      entity.metadata.name;
    return {
      providerId,
      locator: { cloud: 'harvester', namespace, name },
    };
  }
  return undefined;
}

interface CacheEntry {
  expires: number;
  value: Promise<VmLiveInfo>;
}

/**
 * Answers from a short-lived cache, so a page reload or several viewers
 * of the same VM cost one hypervisor request. Concurrent misses share the
 * pending request; failures are not cached.
 */
export class LiveInfoCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string, load: () => Promise<VmLiveInfo>): Promise<VmLiveInfo> {
    const t = this.now();
    const hit = this.entries.get(key);
    if (hit && hit.expires > t) return hit.value;
    if (this.entries.size > 1000) this.prune(t);
    const value = load();
    this.entries.set(key, { expires: t + this.ttlMs, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }

  private prune(t: number) {
    for (const [k, e] of this.entries)
      if (e.expires <= t) this.entries.delete(k);
  }
}

export interface VmInfoRouterOptions {
  sources: Map<string, LiveVmSource>;
  getEntity: (
    ref: { namespace: string; name: string },
    req: express.Request,
  ) => Promise<Entity | undefined>;
  cache: LiveInfoCache;
  logger: LoggerService;
}

/** Outcome of asking for one entity's live info. */
export type LiveInfoLookup =
  { found: true; info: VmLiveInfo } | { found: false; message: string };

/**
 * Live info for a VM entity the caller could read. Not found when the entity
 * is not provider-managed, its source is not configured here or the
 * hypervisor does not know the VM; other hypervisor errors are thrown.
 * Shared by the HTTP route and the `get-live-vm-info` action.
 */
export async function lookupLiveInfo(
  entity: Entity,
  sources: Map<string, LiveVmSource>,
  cache: LiveInfoCache,
): Promise<LiveInfoLookup> {
  const target = vmLocatorOf(entity);
  if (!target) {
    return {
      found: false,
      message: 'This VM is not managed by a live VM source',
    };
  }
  const source = sources.get(target.providerId);
  if (!source) {
    return {
      found: false,
      message: `VM source '${target.providerId}' is not configured here`,
    };
  }
  const key = `${target.providerId}:${JSON.stringify(target.locator)}`;
  try {
    return {
      found: true,
      info: await cache.get(key, () => source.liveInfo(target.locator)),
    };
  } catch (e) {
    if (e instanceof VmNotFoundError)
      return { found: false, message: e.message };
    // Hypervisor errors carry no credentials (only method, path, status).
    throw new Error(`Live VM info for ${key} failed: ${(e as Error).message}`);
  }
}

/**
 * `GET /entity/:namespace/:name` -- live info for one VM Resource.
 *
 * The VM is looked up through the catalog with the caller's own credentials,
 * so whoever cannot see the entity gets 404 and the hypervisor is never
 * asked. Provider and VM id come only from the entity's annotations.
 */
export function createVmInfoRouter(
  options: VmInfoRouterOptions,
): express.Router {
  const { sources, getEntity, cache, logger } = options;
  const router = Router();

  router.get('/entity/:namespace/:name', async (req, res) => {
    const { namespace, name } = req.params;
    const entity = await getEntity({ namespace, name }, req);
    if (!entity) {
      throw new NotFoundError(`No resource ${namespace}/${name}`);
    }
    try {
      const result = await lookupLiveInfo(entity, sources, cache);
      if (result.found) {
        res.json(result.info);
      } else {
        res
          .status(404)
          .json({ error: { name: 'NotFoundError', message: result.message } });
      }
    } catch (e) {
      logger.warn((e as Error).message);
      res.status(502).json({
        error: { name: 'BadGatewayError', message: (e as Error).message },
      });
    }
  });

  return router;
}

/** One LiveVmSource per configured VM provider (machinery entries skipped). */
export function liveSourcesFromConfig(
  config: Config,
  logger: LoggerService,
): Map<string, LiveVmSource> {
  const sources = new Map<string, LiveVmSource>();
  const providers = config.getOptionalConfig(VMS_CONFIG_KEY);
  for (const id of providers?.keys() ?? []) {
    const c = providers!.getConfig(id);
    const type = c.getString('type');
    if (!(VM_SOURCE_TYPES as readonly string[]).includes(type)) continue;
    sources.set(id, createVmSource(id, c, logger.child({ vmSource: id })));
  }
  return sources;
}

async function userCredentials(
  httpAuth: HttpAuthService,
  req: express.Request,
) {
  return httpAuth.credentials(req, { allow: ['user'] });
}

/**
 * MCP/actions tool `vm-info:get-live-vm-info` (#277): the same live info as
 * the entity page card, for AI clients. Read-only; the VM is looked up with
 * the caller's credentials like the HTTP route.
 */
export function registerLiveVmInfoAction(options: {
  actionsRegistry: ActionsRegistryService;
  catalog: CatalogService;
  sources: Map<string, LiveVmSource>;
  cache: LiveInfoCache;
}) {
  const { actionsRegistry, catalog, sources, cache } = options;
  actionsRegistry.register({
    name: 'get-live-vm-info',
    title: 'Get live VM info',
    description: `
Asks the hypervisor (Proxmox, vSphere or Harvester) right now for the state of
one VM from the software catalog: power status, uptime, IP addresses, host,
CPU and memory usage. The catalog's vm.stuttgart-things.com annotations are
only a snapshot of the last inventory run; use this when the current state
matters. VMs are catalog entities of kind Resource with spec.type "vm"; find
them with the catalog query action first. Answers are cached for a few
seconds.
    `.trim(),
    attributes: { readOnly: true, idempotent: true, destructive: false },
    schema: {
      input: z =>
        z.object({
          entityRef: z
            .string()
            .describe(
              'Entity ref of the VM, e.g. "resource:default/k3s-node1-proxmox-vm" or just its name',
            ),
        }),
      output: z =>
        z.object({
          found: z.boolean(),
          message: z
            .string()
            .optional()
            .describe(
              'Why there is no live info, or the hypervisor error, when found is false',
            ),
          info: z
            .object({})
            .passthrough()
            .optional()
            .describe(
              'cloud, status, uptimeSeconds, ipAddresses, host, cpu {count, usagePercent}, memory {totalMiB, usedMiB}, fetchedAt',
            ),
        }),
    },
    action: async ({ input, credentials }) => {
      const ref = parseEntityRef(input.entityRef, {
        defaultKind: 'resource',
        defaultNamespace: 'default',
      });
      const entity = await catalog.getEntityByRef(ref, { credentials });
      if (!entity) {
        throw new InputError(`No entity ${stringifyEntityRef(ref)} found`);
      }
      if (entity.spec?.type !== 'vm') {
        throw new InputError(
          `${stringifyEntityRef(ref)} is not a VM (spec.type ${String(entity.spec?.type)})`,
        );
      }
      // A hypervisor error is an answer, not a failure of the tool: thrown,
      // it reached MCP clients only as "Request failed with 500".
      let result: LiveInfoLookup;
      try {
        result = await lookupLiveInfo(entity, sources, cache);
      } catch (e) {
        result = { found: false, message: (e as Error).message };
      }
      return {
        output: result.found
          ? { found: true, info: { ...result.info } }
          : { found: false, message: result.message },
      };
    },
  });
}

/** At most this many VMs per `list-live-vms` call. */
export const LIST_LIVE_VMS_MAX = 100;
/** Hypervisor requests in flight at once for one `list-live-vms` call. */
const LIST_LIVE_VMS_CONCURRENCY = 4;

/** Runs `fn` over `items` with at most `limit` calls at a time, in order. */
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/**
 * MCP/actions tool `vm-info:list-live-vms` (#277): the live state of every VM
 * of one provider in one call, instead of a catalog query plus one
 * `get-live-vm-info` per VM. The VMs are the provider's catalog entities the
 * caller can read; a VM the hypervisor fails for is reported with its error
 * and does not fail the list.
 */
export function registerListLiveVmsAction(options: {
  actionsRegistry: ActionsRegistryService;
  catalog: CatalogService;
  sources: Map<string, LiveVmSource>;
  cache: LiveInfoCache;
}) {
  const { actionsRegistry, catalog, sources, cache } = options;
  const configured = [...sources.keys()];
  actionsRegistry.register({
    name: 'list-live-vms',
    title: 'List VMs with their live state',
    description: `
Asks the hypervisor right now for every VM of one VM provider (a Proxmox pool,
a vCenter folder or Harvester namespaces) that is in the software catalog:
power status, uptime, IP addresses, host, CPU and memory per VM. Use it for
overviews and questions like "which VMs are stopped" instead of calling
get-live-vm-info once per VM. The provider is the part after "sthings-vms:" in
a VM's backstage.io/managed-by-location annotation. Providers this portal
instance can ask live: ${configured.join(', ') || 'none'}. Optionally filter by
live status (e.g. "stopped", "running"); VMs without live info (found: false,
with the reason or the hypervisor error) are always listed. Answers are cached
for a few seconds.
    `.trim(),
    attributes: { readOnly: true, idempotent: true, destructive: false },
    schema: {
      input: z =>
        z.object({
          provider: z
            .string()
            .describe(
              `VM provider id, e.g. ${configured[0] ?? 'proxmox-labul'}`,
            ),
          status: z
            .string()
            .optional()
            .describe(
              'Only VMs whose live status is this, e.g. "stopped" or "running"',
            ),
        }),
      output: z =>
        z.object({
          provider: z.string(),
          total: z.number().describe('VMs of the provider in the catalog'),
          vms: z.array(
            z.object({
              entityRef: z.string(),
              found: z.boolean(),
              message: z
                .string()
                .optional()
                .describe('Why there is no live info, or the hypervisor error'),
              info: z
                .object({})
                .passthrough()
                .optional()
                .describe(
                  'cloud, status, uptimeSeconds, ipAddresses, host, cpu, memory, fetchedAt',
                ),
            }),
          ),
        }),
    },
    action: async ({ input, credentials }) => {
      if (!sources.has(input.provider)) {
        throw new InputError(
          `VM provider '${input.provider}' is not configured here; this instance has: ${configured.join(', ') || 'none'}`,
        );
      }
      const { items } = await catalog.getEntities(
        {
          filter: {
            kind: 'Resource',
            'spec.type': 'vm',
            [`metadata.annotations.${ANNOTATION_LOCATION}`]: `sthings-vms:${input.provider}`,
          },
        },
        { credentials },
      );
      if (items.length > LIST_LIVE_VMS_MAX) {
        throw new InputError(
          `${items.length} VMs for '${input.provider}', more than ${LIST_LIVE_VMS_MAX}; ask per VM with get-live-vm-info`,
        );
      }
      const entities = [...items].sort((a, b) =>
        a.metadata.name.localeCompare(b.metadata.name),
      );
      const results = await mapLimited(
        entities,
        LIST_LIVE_VMS_CONCURRENCY,
        async entity => {
          const entityRef = stringifyEntityRef(entity);
          try {
            const r = await lookupLiveInfo(entity, sources, cache);
            return r.found
              ? { entityRef, found: true, info: { ...r.info } }
              : { entityRef, found: false, message: r.message };
          } catch (e) {
            return {
              entityRef,
              found: false,
              message: (e as Error).message,
            };
          }
        },
      );
      // VMs without live info stay in the list: "none stopped" must not
      // look the same as "could not check".
      const vms = input.status
        ? results.filter(
            r => !r.found || (r.info as VmLiveInfo).status === input.status,
          )
        : results;
      return {
        output: { provider: input.provider, total: entities.length, vms },
      };
    },
  });
}

/**
 * Backend plugin `vm-info` (sthings-backstage#244): live state of VM
 * Resources for the entity page, from the same hypervisor config and
 * credentials as the sthings-vms catalog module. Read-only; start/stop is a
 * later step behind the permission framework.
 */
export const vmInfoPlugin = createBackendPlugin({
  pluginId: 'vm-info',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        catalog: catalogServiceRef,
        actionsRegistry: actionsRegistryServiceRef,
      },
      async init({
        config,
        logger,
        httpRouter,
        httpAuth,
        catalog,
        actionsRegistry,
      }) {
        const sources = liveSourcesFromConfig(config, logger);
        const ttl =
          config.getOptionalNumber('vmInfo.cacheSeconds') ??
          DEFAULT_CACHE_SECONDS;
        logger.info(
          `Live VM info for ${sources.size} source(s): ${[...sources.keys()].join(', ') || 'none'}`,
        );
        const cache = new LiveInfoCache(ttl * 1000);
        registerLiveVmInfoAction({ actionsRegistry, catalog, sources, cache });
        registerListLiveVmsAction({ actionsRegistry, catalog, sources, cache });
        httpRouter.use(
          createVmInfoRouter({
            sources,
            cache,
            logger,
            getEntity: async (ref, req) => {
              const credentials = await userCredentials(httpAuth, req);
              return catalog.getEntityByRef(
                { kind: 'resource', ...ref },
                { credentials },
              );
            },
          }),
        );
      },
    });
  },
});

import {
  coreServices,
  createBackendPlugin,
  HttpAuthService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { Entity, ANNOTATION_LOCATION } from '@backstage/catalog-model';
import { Config } from '@backstage/config';
import { NotFoundError } from '@backstage/errors';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
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
    const target = vmLocatorOf(entity);
    if (!target) {
      res.status(404).json({
        error: {
          name: 'NotFoundError',
          message: 'This VM is not managed by a live VM source',
        },
      });
      return;
    }
    const source = sources.get(target.providerId);
    if (!source) {
      res.status(404).json({
        error: {
          name: 'NotFoundError',
          message: `VM source '${target.providerId}' is not configured here`,
        },
      });
      return;
    }

    const key = `${target.providerId}:${JSON.stringify(target.locator)}`;
    try {
      const info = await cache.get(key, () => source.liveInfo(target.locator));
      res.json(info);
    } catch (e) {
      if (e instanceof VmNotFoundError) {
        res
          .status(404)
          .json({ error: { name: 'NotFoundError', message: e.message } });
        return;
      }
      // Hypervisor errors carry no credentials (only method, path, status).
      logger.warn(`Live VM info for ${key} failed: ${(e as Error).message}`);
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
      },
      async init({ config, logger, httpRouter, httpAuth, catalog }) {
        const sources = liveSourcesFromConfig(config, logger);
        const ttl =
          config.getOptionalNumber('vmInfo.cacheSeconds') ??
          DEFAULT_CACHE_SECONDS;
        logger.info(
          `Live VM info for ${sources.size} source(s): ${[...sources.keys()].join(', ') || 'none'}`,
        );
        httpRouter.use(
          createVmInfoRouter({
            sources,
            cache: new LiveInfoCache(ttl * 1000),
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

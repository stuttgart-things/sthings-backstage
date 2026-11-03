import { LoggerService } from '@backstage/backend-plugin-api';
import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
  Entity,
} from '@backstage/catalog-model';
import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { toEntityName, toTag } from './entity';

/**
 * One object from the machinery JSON API (`GET /api/v1/resources`). machinery
 * returns only annotations under `stuttgart-things.com/`.
 */
export interface MachineryResource {
  kind: string;
  apiVersion?: string;
  name: string;
  namespace?: string;
  ready: boolean;
  statusMessage?: string;
  creationTimestamp?: string;
  annotations?: Record<string, string>;
}

/** Claim annotations the order templates write (create-vm). */
export const CLAIM_OWNER_ANNOTATION = 'stuttgart-things.com/owner';
export const CLAIM_REQUESTED_BY_ANNOTATION =
  'stuttgart-things.com/requested-by';
export const CLAIM_SOURCE_PATH_ANNOTATION = 'stuttgart-things.com/source-path';

export const ORDER_ANNOTATION_PREFIX = 'machinery.stuttgart-things.com';
/** Same key as on the BackstageTemplateRun of the request templates. */
export const ORDER_REQUESTED_BY_ANNOTATION =
  'backstage.stuttgart-things.com/requested-by';

export const DEFAULT_ORDER_KINDS = ['NativeVsphereVM', 'NativeProxmoxVM'];

export interface MachineryOrderDefaults {
  providerId: string;
  system: string;
  /** Owner when the claim names none, e.g. claims made before owner existed. */
  owner: string;
  lifecycle: string;
  /** Repository the claims live in, for the source link. */
  repoUrl: string;
  /** machinery UI base URL for the detail link; defaults to the API endpoint. */
  uiUrl?: string;
}

/**
 * Reads the claims of the configured kinds from machinery. Only claims that
 * carry a source path count as orders -- those were written into git by a
 * template, everything else (bootstrap objects, test claims) stays out.
 */
export class MachineryClaimSource {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly options: {
      endpoint: string;
      kinds?: string[];
      fetch?: typeof fetch;
    },
  ) {
    this.baseUrl = options.endpoint.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listClaims(): Promise<MachineryResource[]> {
    const kinds = this.options.kinds ?? DEFAULT_ORDER_KINDS;
    const url =
      `${this.baseUrl}/api/v1/resources` +
      `?kind=${encodeURIComponent(kinds.join(','))}` +
      `&annotation=${encodeURIComponent(CLAIM_SOURCE_PATH_ANNOTATION)}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      // fetch hides the real reason (TLS, DNS, ...) in `cause`.
      const cause = (error as { cause?: { message?: string } }).cause;
      throw new Error(
        `machinery ${url}: ${cause?.message ?? (error as Error).message}`,
      );
    }
    if (!res.ok) {
      throw new Error(`machinery ${url}: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { items?: MachineryResource[] };
    return (body.items ?? []).filter(
      item => item?.name && item?.kind && kinds.includes(item.kind),
    );
  }
}

/** `user:default/biff` stays; `biff` becomes `user:default/biff`. */
function asOwnerRef(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  return v.includes(':') ? v.toLowerCase() : `user:default/${v.toLowerCase()}`;
}

/**
 * One ordered claim as a Resource entity, owned by whoever it was ordered for:
 * the claim's owner annotation (a user or one of their groups), else the
 * requester, else the configured default. Owned in the catalog then lists a
 * user's orders and their groups' orders.
 */
export function claimToEntity(
  claim: MachineryResource,
  defaults: MachineryOrderDefaults,
): Entity {
  const location = `sthings-vms:${defaults.providerId}`;
  const ann = claim.annotations ?? {};
  const requestedBy = asOwnerRef(ann[CLAIM_REQUESTED_BY_ANNOTATION]);
  const owner =
    asOwnerRef(ann[CLAIM_OWNER_ANNOTATION]) ?? requestedBy ?? defaults.owner;
  const status = claim.ready ? 'ready' : 'not-ready';
  const namespace =
    claim.namespace && claim.namespace !== 'default'
      ? claim.namespace
      : undefined;

  const annotations: Record<string, string> = {
    [ANNOTATION_LOCATION]: location,
    [ANNOTATION_ORIGIN_LOCATION]: location,
    [`${ORDER_ANNOTATION_PREFIX}/kind`]: claim.kind,
    [`${ORDER_ANNOTATION_PREFIX}/name`]: claim.name,
    [`${ORDER_ANNOTATION_PREFIX}/namespace`]: claim.namespace ?? 'default',
    [`${ORDER_ANNOTATION_PREFIX}/ready`]: String(claim.ready),
    [`${ORDER_ANNOTATION_PREFIX}/status`]: status,
  };
  if (claim.statusMessage) {
    annotations[`${ORDER_ANNOTATION_PREFIX}/status-message`] =
      claim.statusMessage;
  }
  if (claim.creationTimestamp) {
    annotations[`${ORDER_ANNOTATION_PREFIX}/created`] = claim.creationTimestamp;
  }
  if (requestedBy) annotations[ORDER_REQUESTED_BY_ANNOTATION] = requestedBy;
  const sourcePath = ann[CLAIM_SOURCE_PATH_ANNOTATION];
  if (sourcePath) {
    annotations[`${ORDER_ANNOTATION_PREFIX}/source-path`] = sourcePath;
  }

  const repo = defaults.repoUrl.replace(/\/+$/, '');
  const ui = (defaults.uiUrl ?? '').replace(/\/+$/, '');
  const links = [
    ...(sourcePath
      ? [
          {
            url: `${repo}/blob/main/${sourcePath}`,
            title: 'Order (git)',
            icon: 'github',
          },
        ]
      : []),
    ...(ui
      ? [
          {
            url: `${ui}/detail?kind=${encodeURIComponent(claim.kind)}&name=${encodeURIComponent(claim.name)}${namespace ? `&namespace=${encodeURIComponent(namespace)}` : ''}`,
            title: 'Status (machinery)',
            icon: 'dashboard',
          },
        ]
      : []),
  ];

  // machinery's generic message ("Not Ready") repeats the state; only a real
  // reason ("Creating", "ReconcileError: ...") is worth appending.
  const reason = claim.statusMessage?.trim();
  const hasReason =
    !!reason && !/^(not ready|ready|no conditions found)$/i.test(reason);
  const description = [
    claim.kind,
    claim.ready ? 'Ready' : `Not ready${hasReason ? `: ${reason}` : ''}`,
    requestedBy ? `ordered by ${requestedBy}` : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name: toEntityName(
        [claim.name, namespace, 'order'].filter(Boolean).join('-'),
      ),
      title: claim.name,
      description,
      annotations,
      tags: [
        ...new Set(
          ['order', toTag(claim.kind), status, defaults.system]
            .map(toTag)
            .filter(Boolean),
        ),
      ],
      ...(links.length && { links }),
    },
    spec: {
      type: 'machinery-order',
      lifecycle: defaults.lifecycle,
      owner,
      system: defaults.system,
    },
  };
}

/**
 * Mirrors the ordered claims on machinery into the catalog with full
 * mutations: a new order appears, a deleted claim disappears, and the status
 * follows the claim on every refresh.
 */
export class MachineryOrderEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly source: Pick<MachineryClaimSource, 'listClaims'>,
    private readonly defaults: MachineryOrderDefaults,
    private readonly logger: LoggerService,
  ) {}

  getProviderName(): string {
    return `sthings-vms:${this.defaults.providerId}`;
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      throw new Error(`${this.getProviderName()} is not connected yet`);
    }
    // A failing source throws here, before applyMutation, so the previous
    // entities stay in place instead of being wiped by an empty result.
    const claims = await this.source.listClaims();
    const locationKey = this.getProviderName();
    await this.connection.applyMutation({
      type: 'full',
      entities: claims.map(claim => ({
        entity: claimToEntity(claim, this.defaults),
        locationKey,
      })),
    });
    const ready = claims.filter(c => c.ready).length;
    this.logger.info(
      `${locationKey}: synced ${claims.length} orders (${ready} ready)`,
    );
  }
}

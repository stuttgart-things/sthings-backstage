import { createHash } from 'crypto';
import { LoggerService } from '@backstage/backend-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { Config } from '@backstage/config';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import {
  AugmentationIndexer,
  EmbeddingsSource,
  EntityFilterShape,
} from '@roadiehq/rag-ai-node';
import { embeddingEntity } from './augmenter';

export const DEFAULT_INDEX_SCHEDULE = '0 3 * * *';

const TECHDOCS_REF_ANNOTATION = 'backstage.io/techdocs-ref';

export type RagAiIndexingOptions = {
  enabled: boolean;
  /** Crontab string, evaluated in the pod's time zone (usually UTC). */
  schedule: string;
};

export function readIndexingOptions(config: Config): RagAiIndexingOptions {
  const indexing = config.getOptionalConfig('ragAi.indexing');
  return {
    enabled: indexing?.getOptionalBoolean('enabled') ?? true,
    schedule:
      indexing?.getOptionalString('schedule')?.trim() || DEFAULT_INDEX_SCHEDULE,
  };
}

/**
 * The embeddings settings a slice's hash depends on: changing the model or
 * the chunking re-indexes everything on the next run.
 */
export function readIndexFingerprint(config: Config): string {
  const embeddings = config.getOptionalConfig('ai.embeddings');
  return JSON.stringify([
    embeddings?.getOptionalString('openai.modelName'),
    embeddings?.getOptionalNumber('chunkSize'),
    embeddings?.getOptionalNumber('chunkOverlap'),
  ]);
}

/** A TechDocs search index section, as Roadie indexes it. */
export type TechDocsSection = { location: string; text: string };

/** Hash of the content last indexed per slice (`catalog:<kind>`, `tech-docs:<ref>`). */
export type IndexState = {
  load: () => Promise<Map<string, string>>;
  save: (key: string, hash: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

/** What the indexing run needs; module.ts wires the real services. */
export type IndexingDeps = {
  logger: LoggerService;
  indexer: AugmentationIndexer;
  catalog: CatalogApi;
  /** Token for calls to the catalog. */
  catalogToken: () => Promise<string>;
  /**
   * Builds the TechDocs of an entity (techdocs `/sync`) and returns the
   * sections of its search index (none when the build failed).
   */
  buildTechDocs: (ref: EntityName) => Promise<TechDocsSection[]>;
  /** source, entityRef and kind of all stored embeddings. */
  listIndexed: () => Promise<
    { source: string; entityRef: string; kind: string }[]
  >;
  state: IndexState;
  /** See readIndexFingerprint. */
  fingerprint: string;
};

export type EntityName = { kind: string; namespace: string; name: string };

export type IndexingResult = {
  catalog: number;
  techDocs: number;
  /** Catalog entities and TechDocs whose content did not change. */
  unchanged: number;
  skipped: string[];
  failed: string[];
  removed: string[];
};

/**
 * Re-creates the RAG-AI embeddings of the catalog and of all TechDocs.
 *
 * Every embeddings request counts against the provider's rate limit, so
 * only what changed since the last successful run is re-indexed: each
 * catalog entity (in the reduced form that is embedded, see embeddingEntity)
 * and each TechDocs entity has a content hash, and an entity is re-indexed
 * when the hash differs or it has no embeddings.
 *
 * Roadie's createEmbeddings deletes the matched embeddings before it creates
 * new ones, so a failed embeddings call (e.g. a rate limit) loses them until
 * the next run. All changed catalog entities go into one call (that is the
 * cheapest: one request per 128 chunks), TechDocs one entity at a time, and
 * an entity whose docs do not build keeps its old embeddings. Embeddings of
 * entities gone from the catalog are removed.
 */
export async function runIndexing(deps: IndexingDeps): Promise<IndexingResult> {
  const { logger, catalog } = deps;
  const result: IndexingResult = {
    catalog: 0,
    techDocs: 0,
    unchanged: 0,
    skipped: [],
    failed: [],
    removed: [],
  };
  const hashes = await deps.state.load();
  const indexed = await deps.listIndexed();
  const isIndexed = (source: string, entityRef: string) =>
    indexed.some(e => e.source === source && e.entityRef === entityRef);
  const hashOf = (content: unknown) =>
    createHash('sha256')
      .update(deps.fingerprint)
      .update(JSON.stringify(content))
      .digest('hex');
  // State keys of this run; all others belong to entities gone from the
  // catalog (or to an older key format) and are dropped at the end.
  const seen = new Set<string>();

  const { items: entities } = await catalog.getEntities(
    {},
    { token: await deps.catalogToken() },
  );

  // Catalog: every changed entity in one createEmbeddings call.
  const changed: Entity[] = [];
  const pending = new Map<string, string>();
  for (const entity of entities) {
    const ref = stringifyEntityRef(entity);
    const key = `catalog:${ref}`;
    const hash = hashOf(embeddingEntity(entity));
    seen.add(key);
    if (isIndexed('catalog', ref) && hashes.get(key) === hash) {
      result.unchanged += 1;
    } else {
      changed.push(entity);
      pending.set(key, hash);
    }
  }
  if (changed.length > 0) {
    try {
      result.catalog = await deps.indexer.createEmbeddings(
        'catalog',
        catalogFilter(changed, entities),
      );
      for (const [key, hash] of pending) {
        await deps.state.save(key, hash);
      }
    } catch (e) {
      logger.warn(
        `RAG-AI indexing: catalog (${changed.length} entities) failed: ${e}`,
      );
      result.failed.push('catalog');
      // Their embeddings may be gone: re-index them next time.
      for (const key of pending.keys()) {
        await deps.state.remove(key).catch(() => {});
      }
    }
  }

  // TechDocs: one entity at a time; each needs its docs built first.
  const withDocs = entities.filter(
    e => e.metadata.annotations?.[TECHDOCS_REF_ANNOTATION],
  );
  for (const entity of withDocs) {
    const name: EntityName = {
      kind: entity.kind,
      namespace: entity.metadata.namespace ?? 'default',
      name: entity.metadata.name,
    };
    const ref = stringifyEntityRef(name);
    const key = `tech-docs:${ref}`;
    seen.add(key);
    try {
      const sections = await deps.buildTechDocs(name);
      if (sections.length === 0) {
        logger.warn(
          `RAG-AI indexing: no TechDocs for ${ref}, keeping its old embeddings`,
        );
        result.skipped.push(ref);
        continue;
      }
      const hash = hashOf(sections);
      if (isIndexed('tech-docs', ref) && hashes.get(key) === hash) {
        result.unchanged += 1;
        continue;
      }
      result.techDocs += await deps.indexer.createEmbeddings('tech-docs', {
        kind: name.kind,
        'metadata.namespace': name.namespace,
        'metadata.name': name.name,
      });
      await deps.state.save(key, hash);
    } catch (e) {
      logger.warn(`RAG-AI indexing: TechDocs of ${ref} failed: ${e}`);
      result.failed.push(`tech-docs:${ref}`);
      await deps.state.remove(key).catch(() => {});
    }
  }

  // An empty answer more likely means a catalog problem than an empty
  // catalog; deleting everything would be the wrong reaction.
  if (entities.length === 0) {
    logger.warn('RAG-AI indexing: catalog is empty, removing nothing');
  } else {
    result.removed = await removeOrphans(deps, indexed, entities);
    for (const key of hashes.keys()) {
      if (!seen.has(key)) {
        await deps.state.remove(key);
      }
    }
  }

  logger.info(
    `RAG-AI indexing done: ${result.catalog} catalog and ${result.techDocs} TechDocs embeddings, ` +
      `unchanged ${result.unchanged}, skipped ${result.skipped.length}, ` +
      `failed ${result.failed.length}, ` +
      `removed ${result.removed.length} entities no longer in the catalog`,
  );
  return result;
}

/**
 * Entity filter matching exactly the changed entities, one clause per kind
 * and namespace. A group whose entities all changed (e.g. on the first run)
 * is matched by kind and namespace alone, which keeps the catalog query
 * short.
 */
export function catalogFilter(
  changed: Entity[],
  all: Entity[],
): EntityFilterShape {
  const group = (e: Entity) =>
    JSON.stringify([e.kind, e.metadata.namespace ?? 'default']);
  const sizes = new Map<string, number>();
  for (const e of all) {
    sizes.set(group(e), (sizes.get(group(e)) ?? 0) + 1);
  }
  const names = new Map<string, string[]>();
  for (const e of changed) {
    names.set(group(e), [...(names.get(group(e)) ?? []), e.metadata.name]);
  }
  return [...names].map(([key, groupNames]) => {
    const [kind, namespace] = JSON.parse(key) as [string, string];
    const clause: Record<string, string | string[]> = {
      kind,
      'metadata.namespace': namespace,
    };
    if (groupNames.length !== sizes.get(key)) {
      clause['metadata.name'] = groupNames;
    }
    return clause;
  });
}

/** Deletes embeddings whose entity is no longer in the catalog. */
async function removeOrphans(
  deps: IndexingDeps,
  indexed: { source: string; entityRef: string }[],
  entities: Entity[],
): Promise<string[]> {
  const existing = new Set(entities.map(e => stringifyEntityRef(e)));
  const removed: string[] = [];
  const done = new Set<string>();
  for (const { source, entityRef } of indexed) {
    const key = `${source}:${entityRef}`;
    if (!entityRef || existing.has(entityRef) || done.has(key)) {
      continue;
    }
    done.add(key);
    await deps.indexer.vectorStore.deleteDocuments({
      filter: { source: source as EmbeddingsSource, entityRef },
    });
    removed.push(key);
  }
  return removed;
}

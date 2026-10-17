import { createHash } from 'crypto';
import { LoggerService } from '@backstage/backend-plugin-api';
import { CATALOG_FILTER_EXISTS, CatalogApi } from '@backstage/catalog-client';
import { Config } from '@backstage/config';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import {
  AugmentationIndexer,
  EmbeddingsSource,
  EntityFilterShape,
} from '@roadiehq/rag-ai-node';

export const DEFAULT_INDEX_SCHEDULE = '0 3 * * *';

const TECHDOCS_REF_ANNOTATION =
  'metadata.annotations.backstage.io/techdocs-ref';

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
  /** Slices whose content did not change since the last run. */
  unchanged: string[];
  skipped: string[];
  failed: string[];
  removed: string[];
};

/**
 * Re-creates the RAG-AI embeddings of the catalog and of all TechDocs.
 *
 * Every embeddings request counts against the provider's rate limit, so a
 * slice (catalog kind, TechDocs entity) is only re-indexed when its content
 * hash differs from the last successful run or it has no embeddings.
 *
 * Roadie's createEmbeddings deletes the matched embeddings before it creates
 * new ones, so a failed embeddings call (e.g. a rate limit) loses them until
 * the next run. The small slices keep that loss small, and an entity whose
 * docs do not build keeps its old embeddings. Embeddings of entities gone
 * from the catalog are removed.
 */
export async function runIndexing(deps: IndexingDeps): Promise<IndexingResult> {
  const { logger, catalog } = deps;
  const result: IndexingResult = {
    catalog: 0,
    techDocs: 0,
    unchanged: [],
    skipped: [],
    failed: [],
    removed: [],
  };
  const hashes = await deps.state.load();
  const indexed = await deps.listIndexed();
  const run = createSliceRunner(deps, hashes, result);

  const { facets } = await catalog.getEntityFacets(
    { facets: ['kind'] },
    { token: await deps.catalogToken() },
  );
  for (const { value: kind } of facets.kind ?? []) {
    const hasEmbeddings = indexed.some(
      e => e.source === 'catalog' && e.kind === kind,
    );
    await run('catalog', kind, { kind }, hasEmbeddings, async () => {
      const { items } = await catalog.getEntities(
        { filter: { kind } },
        { token: await deps.catalogToken() },
      );
      return items.map(withoutEtag).sort(byRef);
    });
  }

  const { items: withDocs } = await catalog.getEntities(
    {
      filter: { [TECHDOCS_REF_ANNOTATION]: CATALOG_FILTER_EXISTS },
      fields: ['kind', 'metadata.namespace', 'metadata.name'],
    },
    { token: await deps.catalogToken() },
  );
  // One entity at a time: free models allow 20 requests/minute.
  for (const entity of withDocs) {
    const name: EntityName = {
      kind: entity.kind,
      namespace: entity.metadata.namespace ?? 'default',
      name: entity.metadata.name,
    };
    const ref = stringifyEntityRef(name);
    const hasEmbeddings = indexed.some(
      e => e.source === 'tech-docs' && e.entityRef === ref,
    );
    const filter = {
      kind: name.kind,
      'metadata.namespace': name.namespace,
      'metadata.name': name.name,
    };
    await run('tech-docs', ref, filter, hasEmbeddings, async () => {
      const sections = await deps.buildTechDocs(name);
      if (sections.length === 0) {
        logger.warn(
          `RAG-AI indexing: no TechDocs for ${ref}, keeping its old embeddings`,
        );
        result.skipped.push(ref);
        return undefined;
      }
      return sections;
    });
  }

  result.removed = await removeOrphans(deps, indexed);

  logger.info(
    `RAG-AI indexing done: ${result.catalog} catalog and ${result.techDocs} TechDocs embeddings, ` +
      `unchanged ${result.unchanged.length}, skipped ${result.skipped.length}, ` +
      `failed ${result.failed.length}, ` +
      `removed ${result.removed.length} entities no longer in the catalog`,
  );
  return result;
}

/**
 * Returns a function that re-indexes one slice if its content changed.
 * `read` returns the content the hash is built from, or undefined to leave
 * the slice as it is.
 */
function createSliceRunner(
  deps: IndexingDeps,
  hashes: Map<string, string>,
  result: IndexingResult,
) {
  return async (
    source: EmbeddingsSource,
    id: string,
    filter: EntityFilterShape,
    hasEmbeddings: boolean,
    read: () => Promise<unknown | undefined>,
  ) => {
    const key = `${source}:${id}`;
    try {
      const content = await read();
      if (content === undefined) {
        return;
      }
      const hash = createHash('sha256')
        .update(deps.fingerprint)
        .update(JSON.stringify(content))
        .digest('hex');
      if (hasEmbeddings && hashes.get(key) === hash) {
        result.unchanged.push(key);
        return;
      }
      const count = await deps.indexer.createEmbeddings(source, filter);
      if (source === 'catalog') {
        result.catalog += count;
      } else {
        result.techDocs += count;
      }
      await deps.state.save(key, hash);
    } catch (e) {
      deps.logger.warn(`RAG-AI indexing: ${key} failed: ${e}`);
      result.failed.push(key);
      // Its embeddings may be gone: re-index it next time.
      await deps.state.remove(key).catch(() => {});
    }
  };
}

/** Deletes embeddings whose entity is no longer in the catalog. */
async function removeOrphans(
  deps: IndexingDeps,
  indexed: { source: string; entityRef: string }[],
): Promise<string[]> {
  const { items } = await deps.catalog.getEntities(
    { fields: ['kind', 'metadata.namespace', 'metadata.name'] },
    { token: await deps.catalogToken() },
  );
  // An empty answer more likely means a catalog problem than an empty
  // catalog; deleting everything would be the wrong reaction.
  if (items.length === 0) {
    deps.logger.warn('RAG-AI indexing: catalog is empty, removing nothing');
    return [];
  }
  const existing = new Set(items.map(e => stringifyEntityRef(e)));
  const removed: string[] = [];
  const seen = new Set<string>();
  for (const { source, entityRef } of indexed) {
    const key = `${source}:${entityRef}`;
    if (!entityRef || existing.has(entityRef) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    await deps.indexer.vectorStore.deleteDocuments({
      filter: { source: source as EmbeddingsSource, entityRef },
    });
    await deps.state.remove(key);
    removed.push(key);
  }
  return removed;
}

/** The etag changes on every catalog refresh, the content may not. */
function withoutEtag(entity: Entity): Entity {
  const { etag, ...metadata } = entity.metadata;
  return { ...entity, metadata };
}

function byRef(a: Entity, b: Entity): number {
  return stringifyEntityRef(a).localeCompare(stringifyEntityRef(b));
}

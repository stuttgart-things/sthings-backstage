import { LoggerService } from '@backstage/backend-plugin-api';
import { CATALOG_FILTER_EXISTS, CatalogApi } from '@backstage/catalog-client';
import { Config } from '@backstage/config';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { AugmentationIndexer, EmbeddingsSource } from '@roadiehq/rag-ai-node';

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

/** What the indexing run needs; module.ts wires the real services. */
export type IndexingDeps = {
  logger: LoggerService;
  indexer: AugmentationIndexer;
  catalog: CatalogApi;
  /** Token for calls to the catalog. */
  catalogToken: () => Promise<string>;
  /**
   * Builds the TechDocs of an entity (techdocs `/sync`) and returns the number
   * of indexable sections in its search index (0 when the build failed).
   */
  buildTechDocs: (ref: EntityName) => Promise<number>;
  /** source + entityRef of all stored embeddings. */
  listIndexed: () => Promise<{ source: string; entityRef: string }[]>;
};

export type EntityName = { kind: string; namespace: string; name: string };

export type IndexingResult = {
  catalog: number;
  techDocs: number;
  skipped: string[];
  failed: string[];
  removed: string[];
};

/**
 * Re-creates the RAG-AI embeddings of the catalog and of all TechDocs.
 *
 * Roadie's createEmbeddings deletes the matched embeddings before it creates
 * new ones, so a failed embeddings call (e.g. a rate limit) loses them until
 * the next run. To keep that loss small, the catalog is indexed per kind and
 * TechDocs per entity, and an entity whose docs do not build keeps its old
 * embeddings. Embeddings of entities gone from the catalog are removed.
 */
export async function runIndexing(deps: IndexingDeps): Promise<IndexingResult> {
  const { logger, indexer, catalog } = deps;
  const result: IndexingResult = {
    catalog: 0,
    techDocs: 0,
    skipped: [],
    failed: [],
    removed: [],
  };

  const { facets } = await catalog.getEntityFacets(
    { facets: ['kind'] },
    { token: await deps.catalogToken() },
  );
  for (const { value: kind } of facets.kind ?? []) {
    try {
      result.catalog += await indexer.createEmbeddings('catalog', { kind });
    } catch (e) {
      logger.warn(`RAG-AI indexing: catalog kind ${kind} failed: ${e}`);
      result.failed.push(`catalog:${kind}`);
    }
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
    try {
      if ((await deps.buildTechDocs(name)) === 0) {
        logger.warn(
          `RAG-AI indexing: no TechDocs for ${ref}, keeping its old embeddings`,
        );
        result.skipped.push(ref);
        continue;
      }
      result.techDocs += await indexer.createEmbeddings('tech-docs', {
        kind: name.kind,
        'metadata.namespace': name.namespace,
        'metadata.name': name.name,
      });
    } catch (e) {
      logger.warn(`RAG-AI indexing: TechDocs of ${ref} failed: ${e}`);
      result.failed.push(`tech-docs:${ref}`);
    }
  }

  result.removed = await removeOrphans(deps);

  logger.info(
    `RAG-AI indexing done: ${result.catalog} catalog and ${result.techDocs} TechDocs embeddings, ` +
      `skipped ${result.skipped.length}, failed ${result.failed.length}, ` +
      `removed ${result.removed.length} entities no longer in the catalog`,
  );
  return result;
}

/** Deletes embeddings whose entity is no longer in the catalog. */
async function removeOrphans(deps: IndexingDeps): Promise<string[]> {
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
  for (const { source, entityRef } of await deps.listIndexed()) {
    if (!entityRef || existing.has(entityRef)) {
      continue;
    }
    await deps.indexer.vectorStore.deleteDocuments({
      filter: { source: source as EmbeddingsSource, entityRef },
    });
    removed.push(`${source}:${entityRef}`);
  }
  return removed;
}

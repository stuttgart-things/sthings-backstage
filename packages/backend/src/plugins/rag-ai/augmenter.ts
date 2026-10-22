import {
  AuthService,
  DiscoveryService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { Entity } from '@backstage/catalog-model';
import { Config } from '@backstage/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import {
  AugmentationOptions,
  DefaultVectorAugmentationIndexer,
} from '@roadiehq/rag-ai-backend-retrieval-augmenter';
import { EmbeddingsSource, RoadieVectorStore } from '@roadiehq/rag-ai-node';

/** Flips with the VM's power state (catalog-backend-module-sthings-vms). */
const VM_STATUS_ANNOTATION = 'vm.stuttgart-things.com/status';

/**
 * The part of a catalog entity that is embedded and hashed.
 *
 * Left out is what costs embeddings without helping to answer questions:
 * - `etag`, `uid`: change on refresh or re-creation, carry no meaning.
 * - `relations`, `status`: computed by the catalog; adding a VM would
 *   re-embed its System and owner Group. Membership is still in each
 *   entity's own spec (`spec.system`, `spec.owner`).
 * - the VM status annotation: stale by the next question anyway.
 * - `spec.steps` of Templates: action wiring, the larger half of the big
 *   templates; title, description and parameters stay.
 */
export function embeddingEntity(entity: Entity): Entity {
  const { relations, status, ...rest } = entity as Entity & {
    status?: unknown;
  };
  const { etag, uid, annotations, ...metadata } = entity.metadata;
  const reduced: Entity = { ...rest, metadata };
  if (annotations) {
    const { [VM_STATUS_ANNOTATION]: vmStatus, ...kept } = annotations;
    reduced.metadata.annotations = kept;
  }
  if (entity.kind === 'Template' && entity.spec) {
    const { steps, ...spec } = entity.spec;
    reduced.spec = spec;
  }
  return reduced;
}

/**
 * Roadie's default indexer, embedding `embeddingEntity` instead of the full
 * catalog entity. The embeddings are set up as in Roadie's
 * RoadieOpenAiAugmenter (@roadiehq/rag-ai-backend-embeddings-openai), from
 * the same `ai.embeddings` config.
 */
export class SthingsAugmentationIndexer extends DefaultVectorAugmentationIndexer {
  constructor(options: {
    vectorStore: RoadieVectorStore;
    catalogApi: CatalogApi;
    logger: LoggerService;
    auth: AuthService;
    discovery: DiscoveryService;
    config: Config;
  }) {
    const { config, ...deps } = options;
    const embeddingsConfig = config.getOptionalConfig('ai.embeddings');
    const augmentationOptions: AugmentationOptions = {
      chunkSize: embeddingsConfig?.getOptionalNumber('chunkSize'),
      chunkOverlap: embeddingsConfig?.getOptionalNumber('chunkOverlap'),
      concurrencyLimit: embeddingsConfig?.getOptionalNumber('concurrencyLimit'),
    };
    // Read raw like Roadie does: batchSize must stay a number.
    const openAi = config.get('ai.embeddings.openai') as {
      openAiBaseUrl?: string;
      openAiApiKey?: string;
      batchSize?: number;
      modelName?: string;
      embeddingsDimensions?: number;
    };
    super({
      ...deps,
      logger: deps.logger.child({ label: 'roadie-openai-embeddings' }),
      augmentationOptions,
      embeddings: new OpenAIEmbeddings({
        configuration: { baseURL: openAi.openAiBaseUrl },
        openAIApiKey: openAi.openAiApiKey,
        batchSize: openAi.batchSize,
        modelName: openAi.modelName || 'text-embedding-3-small',
        dimensions: openAi.embeddingsDimensions,
      }),
    });
  }

  protected constructCatalogEmbeddingDocuments(
    entities: Entity[],
    source: EmbeddingsSource,
  ) {
    return super.constructCatalogEmbeddingDocuments(
      entities.map(embeddingEntity),
      source,
    );
  }
}

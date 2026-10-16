import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import {
  augmentationIndexerExtensionPoint,
  modelExtensionPoint,
  retrievalPipelineExtensionPoint,
} from '@roadiehq/rag-ai-node';
import { initializeOpenAiEmbeddings } from '@roadiehq/rag-ai-backend-embeddings-openai';
import { createDefaultRetrievalPipeline } from '@roadiehq/rag-ai-backend-retrieval-augmenter';
import { createRoadiePgVectorStore } from '@roadiehq/rag-ai-storage-pgvector';
import { createChatModel, readLlmOptions } from './llm';

/**
 * Wires the Roadie RAG-AI backend (pluginId `rag-ai`): OpenAI-compatible
 * embeddings and chat model (OpenRouter by default), pgvector storage in the
 * plugin's own database (backend.database.plugin.rag-ai) and Roadie's default
 * retrieval pipeline. Loaded only when ragAi.enabled is true, see index.ts.
 */
export default createBackendModule({
  pluginId: 'rag-ai',
  moduleId: 'openrouter',

  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        database: coreServices.database,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
        indexer: augmentationIndexerExtensionPoint,
        pipeline: retrievalPipelineExtensionPoint,
        model: modelExtensionPoint,
      },
      async init({
        logger,
        config,
        database,
        discovery,
        auth,
        indexer,
        pipeline,
        model,
      }) {
        const llmOptions = readLlmOptions(config);

        const vectorStore = await createRoadiePgVectorStore({
          logger,
          database,
          config,
        });

        const augmentationIndexer = await initializeOpenAiEmbeddings({
          logger,
          auth,
          vectorStore,
          catalogApi: new CatalogClient({ discoveryApi: discovery }),
          discovery,
          config,
        });

        indexer.setAugmentationIndexer(augmentationIndexer);
        pipeline.setRetrievalPipeline(
          createDefaultRetrievalPipeline({
            discovery,
            logger,
            vectorStore: augmentationIndexer.vectorStore,
            auth,
          }),
        );
        model.setBaseLLM(createChatModel(llmOptions));

        logger.info(
          `RAG-AI enabled: chat ${llmOptions.models.join(', ')} via ${
            llmOptions.baseUrl
          }, embeddings ${config.getOptionalString(
            'ai.embeddings.openai.modelName',
          )}`,
        );
      },
    });
  },
});

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
import { readIndexingOptions, runIndexing } from './indexing';

/**
 * Wires the Roadie RAG-AI backend (pluginId `rag-ai`): OpenAI-compatible
 * embeddings and chat model (OpenRouter by default), pgvector storage in the
 * plugin's own database (backend.database.plugin.rag-ai) and Roadie's default
 * retrieval pipeline. Loaded only when ragAi.enabled is true, see index.ts.
 * Re-indexes catalog and TechDocs on ragAi.indexing.schedule (indexing.ts).
 */
export default createBackendModule({
  pluginId: 'rag-ai',
  moduleId: 'llm',

  register(env) {
    env.registerInit({
      deps: {
        logger: coreServices.logger,
        config: coreServices.rootConfig,
        database: coreServices.database,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
        scheduler: coreServices.scheduler,
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
        scheduler,
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

        const catalogApi = new CatalogClient({ discoveryApi: discovery });
        const augmentationIndexer = await initializeOpenAiEmbeddings({
          logger,
          auth,
          vectorStore,
          catalogApi,
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

        const indexing = readIndexingOptions(config);
        if (indexing.enabled) {
          const pluginToken = async (targetPluginId: string) =>
            (
              await auth.getPluginRequestToken({
                onBehalfOf: await auth.getOwnServiceCredentials(),
                targetPluginId,
              })
            ).token;
          const db = await database.getClient();

          await scheduler.scheduleTask({
            id: 'rag-ai-indexing',
            frequency: { cron: indexing.schedule },
            timeout: { minutes: 30 },
            // One run per schedule, also with several replicas.
            scope: 'global',
            fn: async () => {
              await runIndexing({
                logger,
                indexer: augmentationIndexer,
                catalog: catalogApi,
                catalogToken: () => pluginToken('catalog'),
                buildTechDocs: async ({ kind, namespace, name }) => {
                  // TechDocs are built on demand and not persisted across pod
                  // restarts, so build them before Roadie reads the index.
                  const base = await discovery.getBaseUrl('techdocs');
                  const path = `${namespace}/${kind}/${name}`;
                  const headers = {
                    Authorization: `Bearer ${await pluginToken('techdocs')}`,
                  };
                  const sync = await fetch(`${base}/sync/${path}`, { headers });
                  const events = await sync.text();
                  if (!sync.ok || events.includes('event: error')) {
                    return 0;
                  }
                  const index = await fetch(
                    `${base}/static/docs/${path}/search/search_index.json`,
                    { headers },
                  );
                  if (!index.ok) {
                    return 0;
                  }
                  const { docs = [] } = (await index.json()) as {
                    docs?: { location?: string; text?: string }[];
                  };
                  // Same sections Roadie indexes.
                  return docs.filter(d => d.location?.includes('#') && d.text)
                    .length;
                },
                listIndexed: async () =>
                  (
                    await db.raw(
                      `SELECT DISTINCT metadata->>'source' AS source,
                         metadata->>'entityRef' AS "entityRef"
                       FROM embeddings`,
                    )
                  ).rows,
              });
            },
          });
        }

        logger.info(
          `RAG-AI enabled: chat ${llmOptions.models.join(', ')} via ${
            llmOptions.baseUrl
          }, embeddings ${config.getOptionalString(
            'ai.embeddings.openai.modelName',
          )}, indexing ${
            indexing.enabled ? `on '${indexing.schedule}'` : 'off'
          }`,
        );
      },
    });
  },
});

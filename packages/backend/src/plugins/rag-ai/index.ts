import {
  coreServices,
  createBackendFeatureLoader,
} from '@backstage/backend-plugin-api';

/**
 * Loads the Roadie RAG-AI backend plugin and its OpenRouter module only when
 * ragAi.enabled is true (RAG_AI_ENABLED). Instances without a RAG database
 * stay unchanged. See README "RAG-AI".
 */
export default createBackendFeatureLoader({
  deps: { config: coreServices.rootConfig },
  async *loader({ config }) {
    if (!config.getOptionalBoolean('ragAi.enabled')) {
      return;
    }
    yield import('@roadiehq/rag-ai-backend');
    yield import('./module');
  },
});

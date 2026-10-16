export interface Config {
  ragAi?: {
    /**
     * Loads the Roadie RAG-AI backend plugin (pluginId rag-ai). Set via
     * RAG_AI_ENABLED. See README "RAG-AI".
     */
    enabled?: boolean | string;
    /** Chat model behind an OpenAI-compatible endpoint (OpenRouter by default). */
    llm?: {
      /** Defaults to https://openrouter.ai/api/v1 */
      baseUrl?: string;
      /**
       * API key of the endpoint (OPENROUTER_API_KEY).
       * @visibility secret
       */
      apiKey?: string;
      /** Comma-separated model ids; the first is used, up to 3 more are OpenRouter fallbacks. */
      models?: string;
      /** Answer token cap, including a reasoning model's thinking. Defaults to 4000. */
      maxTokens?: number | string;
      temperature?: number | string;
    };
  };
}

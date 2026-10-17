export interface Config {
  ragAi?: {
    /**
     * Shows the RAG-AI assistant (sidebar entry, ctrl+,). Set via
     * RAG_AI_ENABLED; the backend loads the rag-ai plugin from the same key.
     * @visibility frontend
     */
    enabled?: boolean | string;
  };
}

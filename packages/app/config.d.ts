export interface Config {
  app?: {
    auth?: {
      /**
       * Shows the Zitadel/OIDC button on the SignInPage. Set via
       * AUTH_OIDC_ENABLED; the backend loads the OIDC provider from the same
       * env var.
       * @visibility frontend
       */
      oidcEnabled?: boolean | string;
      /**
       * Shows the guest button on the SignInPage. Set via AUTH_GUEST_ENABLED;
       * the backend loads the guest provider unless it is false.
       * @visibility frontend
       */
      guestEnabled?: boolean | string;
    };
  };
  ragAi?: {
    /**
     * Shows the RAG-AI assistant (sidebar entry, ctrl+,). Set via
     * RAG_AI_ENABLED; the backend loads the rag-ai plugin from the same key.
     * @visibility frontend
     */
    enabled?: boolean | string;
  };
}

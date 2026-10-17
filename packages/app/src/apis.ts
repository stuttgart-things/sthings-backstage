import {
  ScmIntegrationsApi,
  scmIntegrationsApiRef,
  ScmAuth,
} from '@backstage/integration-react';
import {
  AnyApiFactory,
  alertApiRef,
  configApiRef,
  createApiFactory,
  createApiRef,
  discoveryApiRef,
  fetchApiRef,
  identityApiRef,
  oauthRequestApiRef,
  OAuthApi,
  ProfileInfoApi,
  BackstageIdentityApi,
  SessionApi,
} from '@backstage/core-plugin-api';
import { toastApiRef } from '@backstage/frontend-plugin-api';
import { OAuth2 } from '@backstage/core-app-api';
import { ragAiApiRef, RoadieRagAiClient } from '@roadiehq/rag-ai';

// Generic OIDC auth API — used to talk to any OIDC IdP configured under
// auth.providers.oidc in app-config (today: Zitadel for the PR-preview auth
// spike, sthings-backstage#82). The factory below is registered
// unconditionally, but only takes effect when the backend module is loaded
// (AUTH_OIDC_ENABLED=true) and the SignInPage offers it as a choice
// (app.auth.oidcEnabled=true).
export const oidcAuthApiRef = createApiRef<
  OAuthApi & ProfileInfoApi & BackstageIdentityApi & SessionApi
>({
  id: 'auth.oidc',
});

export const apis: AnyApiFactory[] = [
  createApiFactory({
    api: scmIntegrationsApiRef,
    deps: { configApi: configApiRef },
    factory: ({ configApi }) => ScmIntegrationsApi.fromConfig(configApi),
  }),
  ScmAuth.createDefaultApiFactory(),
  // Bridge the new-frontend-system ToastApi (core.toast) onto the legacy
  // AlertApi so plugins built against the new frontend system work in this
  // legacy createApp() runtime. @backstage/plugin-notifications'
  // NotificationsSidebarItem calls useApi(toastApiRef), which is otherwise
  // unbound here and throws NotImplementedError. The legacy app already
  // renders AlertDisplay, so forwarded toasts surface in the standard
  // snackbar. Mapping follows the AlertMessage deprecation guide.
  createApiFactory({
    api: toastApiRef,
    deps: { alertApi: alertApiRef },
    factory: ({ alertApi }) => ({
      post(toast) {
        const severity = (
          {
            neutral: 'info',
            info: 'info',
            success: 'success',
            warning: 'warning',
            danger: 'error',
          } as const
        )[toast.status ?? 'success'];
        const message = [toast.title, toast.description]
          .filter(part => typeof part === 'string' && part.length > 0)
          .join(' — ');
        alertApi.post({
          message: message || 'Notification',
          severity,
          display: toast.timeout ? 'transient' : 'permanent',
        });
        return { close() {} };
      },
    }),
  }),
  // Roadie RAG-AI ("Ask AI"). ragAiPlugin brings this factory itself, but the
  // legacy createApp() only collects plugin APIs from the route tree, and
  // SidebarRagModal sits in Root's sidebar -- without this, opening it throws
  // NotImplementedError for apiRef{plugin.rag-ai.api}. Same factory as the
  // plugin's; harmless while ragAi.enabled is false (nothing calls it).
  createApiFactory({
    api: ragAiApiRef,
    deps: {
      configApi: configApiRef,
      discoveryApi: discoveryApiRef,
      fetchApi: fetchApiRef,
      identityApi: identityApiRef,
    },
    factory: ({ configApi, discoveryApi, fetchApi, identityApi }) =>
      new RoadieRagAiClient({ configApi, discoveryApi, fetchApi, identityApi }),
  }),
  createApiFactory({
    api: oidcAuthApiRef,
    deps: {
      configApi: configApiRef,
      discoveryApi: discoveryApiRef,
      oauthRequestApi: oauthRequestApiRef,
    },
    factory: ({ configApi, discoveryApi, oauthRequestApi }) =>
      OAuth2.create({
        configApi,
        discoveryApi,
        oauthRequestApi,
        provider: {
          id: 'oidc',
          title: 'OIDC',
          icon: () => null,
        },
        environment:
          configApi.getOptionalString('auth.environment') ?? 'development',
        defaultScopes: ['openid', 'profile', 'email'],
      }),
  }),
];

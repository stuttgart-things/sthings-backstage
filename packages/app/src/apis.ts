import {
  ScmIntegrationsApi,
  scmIntegrationsApiRef,
  ScmAuth,
} from '@backstage/integration-react';
import {
  AnyApiFactory,
  configApiRef,
  createApiFactory,
  createApiRef,
  discoveryApiRef,
  oauthRequestApiRef,
  OAuthApi,
  ProfileInfoApi,
  BackstageIdentityApi,
  SessionApi,
} from '@backstage/core-plugin-api';
import { OAuth2 } from '@backstage/core-app-api';

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
        environment: configApi.getOptionalString('auth.environment') ?? 'development',
        defaultScopes: ['openid', 'profile', 'email'],
      }),
  }),
];

import { createBackendModule } from '@backstage/backend-plugin-api';
import {
  authProvidersExtensionPoint,
  createOAuthProviderFactory,
} from '@backstage/plugin-auth-node';
import {
  oidcAuthenticator,
  oidcSignInResolvers,
} from '@backstage/plugin-auth-backend-module-oidc-provider';
import { zitadelProjectRolesResolver } from './resolver';

/**
 * The `oidc` auth provider (Zitadel), registered with the upstream OIDC
 * authenticator plus the `zitadelProjectRoles` sign-in resolver. Replaces
 * `@backstage/plugin-auth-backend-module-oidc-provider`'s own module, which
 * registers the same provider id without our resolver.
 *
 * Configure under auth.providers.oidc.<env>.signIn.resolvers, see
 * docs/zitadel.md.
 */
export default createBackendModule({
  pluginId: 'auth',
  moduleId: 'zitadel-oidc-provider',
  register(reg) {
    reg.registerInit({
      deps: { providers: authProvidersExtensionPoint },
      async init({ providers }) {
        providers.registerProvider({
          providerId: 'oidc',
          factory: createOAuthProviderFactory({
            authenticator: oidcAuthenticator,
            signInResolverFactories: {
              ...oidcSignInResolvers,
              zitadelProjectRoles: zitadelProjectRolesResolver,
            },
          }),
        });
      },
    });
  },
});

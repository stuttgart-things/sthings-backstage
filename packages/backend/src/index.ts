/*
 * Hi!
 *
 * Note that this is an EXAMPLE Backstage backend. Please check the README.
 *
 * Happy hacking!
 */

import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-proxy-backend'));

// scaffolder plugin
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));
backend.add(
  import('@backstage/plugin-scaffolder-backend-module-notifications'),
);

// roadiehq scaffolder utils (merge, json/yaml manipulation, etc.)
backend.add(import('@roadiehq/scaffolder-backend-module-utils/new-backend'));

// claim-machinery scaffolder module
backend.add(import('./plugins/scaffolder-claim-machinery'));

// yaml-utils scaffolder module
backend.add(import('./plugins/scaffolder-yaml-utils'));

// techdocs plugin
backend.add(import('@backstage/plugin-techdocs-backend'));

// auth plugin
backend.add(import('@backstage/plugin-auth-backend'));
// See https://backstage.io/docs/backend-system/building-backends/migrating#the-auth-plugin
// Guest sign-in -- on by default for local development, switched off in
// production with AUTH_GUEST_ENABLED=false. Guest counts as a developer in the
// permission policy, so leaving it on lets anyone run developer templates
// without a login. The SignInPage reads app.auth.guestEnabled from the same
// env var.
if (process.env.AUTH_GUEST_ENABLED !== 'false') {
  backend.add(import('@backstage/plugin-auth-backend-module-guest-provider'));
}
backend.add(import('@backstage/plugin-auth-backend-module-github-provider'));
// OIDC (Zitadel) provider — opt-in via AUTH_OIDC_ENABLED=true to keep
// GitHub-only environments fully unchanged. When enabled, the provider
// reads auth.providers.oidc.development from app-config (sthings-backstage#82).
if (process.env.AUTH_OIDC_ENABLED === 'true') {
  backend.add(import('@backstage/plugin-auth-backend-module-oidc-provider'));
}
// See https://backstage.io/docs/auth/guest/provider

// catalog plugin
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(
  import('@backstage/plugin-catalog-backend-module-scaffolder-entity-model'),
);

// See https://backstage.io/docs/features/software-catalog/configuration#subscribing-to-catalog-errors
backend.add(import('@backstage/plugin-catalog-backend-module-logs'));
// Entities that failed processing (e.g. Location conflicts), shown under
// /devtools -> Unprocessed Entities. Platform-only via the permission policy.
backend.add(import('@backstage/plugin-catalog-backend-module-unprocessed'));

// DevTools: version, config, external dependencies, scheduled tasks.
// Platform-only via the permission policy.
backend.add(import('@backstage/plugin-devtools-backend'));

// VM inventories (Proxmox today) mirrored into the catalog. Off unless
// catalog.providers.sthingsVms is configured. See plugins/catalog-backend-module-sthings-vms.
backend.add(
  import('@stuttgart-things/backstage-plugin-catalog-backend-module-sthings-vms'),
);

// permission plugin
backend.add(import('@backstage/plugin-permission-backend'));
// Separates platform-team from developers: templates are platform-only unless
// annotated backstage.stuttgart-things.com/audience: developers; developers see
// only their own tasks and cannot import/unregister entities, edit templates or
// use the kubernetes proxy. See docs/permissions.md.
backend.add(import('./plugins/permission-template-audience'));

// search plugin
backend.add(import('@backstage/plugin-search-backend'));

// search engine
// See https://backstage.io/docs/features/search/search-engines
backend.add(import('@backstage/plugin-search-backend-module-pg'));

// search collators
backend.add(import('@backstage/plugin-search-backend-module-catalog'));
backend.add(import('@backstage/plugin-search-backend-module-techdocs'));

// kubernetes plugin
backend.add(import('@backstage/plugin-kubernetes-backend'));

// Roadie RAG-AI (questions on catalog and TechDocs). Off unless
// ragAi.enabled=true (RAG_AI_ENABLED); needs its own pgvector database.
// See packages/backend/src/plugins/rag-ai and README "RAG-AI".
backend.add(import('./plugins/rag-ai'));

// notifications and signals plugins
backend.add(import('@backstage/plugin-notifications-backend'));
backend.add(import('@backstage/plugin-signals-backend'));

backend.start();

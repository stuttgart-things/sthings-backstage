import { apiDocsPlugin, ApiExplorerPage } from '@backstage/plugin-api-docs';
import { CatalogEntityPage, catalogPlugin } from '@backstage/plugin-catalog';
import {
  CatalogImportPage,
  catalogImportPlugin,
} from '@backstage/plugin-catalog-import';
import { orgPlugin } from '@backstage/plugin-org';
import {
  ScaffolderFieldExtensions,
  ScaffolderPage,
  scaffolderPlugin,
} from '@backstage/plugin-scaffolder';
import { SearchPage } from '@backstage/plugin-search';
import {
  TechDocsIndexPage,
  techdocsPlugin,
  TechDocsReaderPage,
} from '@backstage/plugin-techdocs';
import { ReportIssue } from '@backstage/plugin-techdocs-module-addons-contrib';
import { TechDocsAddons } from '@backstage/plugin-techdocs-react';
import { UserSettingsPage } from '@backstage/plugin-user-settings';
import { Navigate, Route } from 'react-router-dom';
import { apis } from './apis';
import { entityPage } from './components/catalog/EntityPage';
import { CustomCatalogPage } from './components/catalog/CustomCatalogPage';
import { Root } from './components/Root';
import { searchPage } from './components/search/SearchPage';
import {
  ClaimMachineryParametersFieldExtension,
  ClaimMachineryPickerFieldExtension,
  ClaimMachineryMultiClaimFieldExtension,
  MachineryClaimPickerFieldExtension,
  TemplateCard,
  templateGroups,
} from './scaffolder';

import { createApp } from '@backstage/app-defaults';
import { AppRouter, FlatRoutes } from '@backstage/core-app-api';
import {
  AlertDisplay,
  OAuthRequestDialog,
  SignInPage,
  SignInProviderConfig,
} from '@backstage/core-components';
import {
  githubAuthApiRef,
  useApi,
  configApiRef,
} from '@backstage/core-plugin-api';
import { oidcAuthApiRef } from './apis';
import { UnifiedThemeProvider } from '@backstage/theme';
import LightIcon from '@material-ui/icons/WbSunny';
import DarkIcon from '@material-ui/icons/Brightness2';
import { sthingsLightTheme, sthingsDarkTheme } from './theme';
import { catalogEntityCreatePermission } from '@backstage/plugin-catalog-common/alpha';
import { CatalogGraphPage } from '@backstage/plugin-catalog-graph';
import { devToolsAdministerPermission } from '@backstage/plugin-devtools-common';
import { PlatformDevToolsPage } from './components/devtools/DevToolsPage';
import { devToolsPlugin } from '@backstage/plugin-devtools';
import { catalogUnprocessedEntitiesPlugin } from '@backstage/plugin-catalog-unprocessed-entities';
import { NotificationsPage } from '@backstage/plugin-notifications';
import { RequirePermission } from '@backstage/plugin-permission-react';
import { SignalsDisplay } from '@backstage/plugin-signals';

const app = createApp({
  apis,
  // /devtools is built from the plugins' content components, not their
  // routable pages, so the app never discovers these plugins from the routes
  // and their API factories (devToolsApiRef, catalogUnprocessedEntitiesApiRef)
  // stay unregistered: the page crashed with "No implementation available for
  // apiRef{plugin.devtools.service}". Registering the plugins adds them.
  plugins: [devToolsPlugin, catalogUnprocessedEntitiesPlugin],
  __experimentalTranslations: {
    resources: [
      {
        $$type: '@backstage/TranslationMessages' as const,
        id: 'catalog',
        full: false,
        messages: {
          'indexPage.title': 'using modularity to speed up parallel builds',
        },
      },
    ],
  },
  themes: [
    {
      id: 'sthings-light',
      title: 'Light',
      variant: 'light',
      icon: <LightIcon />,
      Provider: ({ children }) => (
        <UnifiedThemeProvider theme={sthingsLightTheme} children={children} />
      ),
    },
    {
      id: 'sthings-dark',
      title: 'Dark',
      variant: 'dark',
      icon: <DarkIcon />,
      Provider: ({ children }) => (
        <UnifiedThemeProvider theme={sthingsDarkTheme} children={children} />
      ),
    },
  ],
  bindRoutes({ bind }) {
    bind(catalogPlugin.externalRoutes, {
      createComponent: scaffolderPlugin.routes.root,
      viewTechDoc: techdocsPlugin.routes.docRoot,
      createFromTemplate: scaffolderPlugin.routes.selectedTemplate,
    });
    bind(apiDocsPlugin.externalRoutes, {
      registerApi: catalogImportPlugin.routes.importPage,
    });
    bind(scaffolderPlugin.externalRoutes, {
      registerComponent: catalogImportPlugin.routes.importPage,
      viewTechDoc: techdocsPlugin.routes.docRoot,
    });
    bind(orgPlugin.externalRoutes, {
      catalogIndex: catalogPlugin.routes.catalogIndex,
    });
  },
  components: {
    // Config-driven SignInPage: GitHub stays always-on; OIDC (Zitadel) is
    // appended only when `app.auth.oidcEnabled=true` in app-config. The
    // backend-side OIDC module is gated by AUTH_OIDC_ENABLED — both flags
    // are driven by the same env var via Flux substitution. GitHub-only
    // environments see exactly the same SignInPage as before.
    SignInPage: props => {
      const configApi = useApi(configApiRef);
      const oidcEnabled =
        configApi.getOptionalBoolean('app.auth.oidcEnabled') ?? false;
      const guestEnabled =
        configApi.getOptionalBoolean('app.auth.guestEnabled') ?? true;
      const providers: Array<'guest' | SignInProviderConfig> = [
        ...(guestEnabled ? ['guest' as const] : []),
        {
          id: 'github-auth-provider',
          title: 'GitHub',
          message: 'Sign in using GitHub',
          apiRef: githubAuthApiRef,
        },
        ...(oidcEnabled
          ? [
              {
                id: 'oidc-auth-provider',
                title: 'Zitadel',
                message: 'Sign in using Zitadel SSO',
                apiRef: oidcAuthApiRef,
              },
            ]
          : []),
      ];
      return <SignInPage {...props} auto providers={providers} />;
    },
  },
});

const routes = (
  <FlatRoutes>
    <Route path="/" element={<Navigate to="catalog" />} />
    <Route path="/catalog" element={<CustomCatalogPage />} />
    <Route
      path="/catalog/:namespace/:kind/:name"
      element={<CatalogEntityPage />}
    >
      {entityPage}
    </Route>
    <Route path="/docs" element={<TechDocsIndexPage />} />
    <Route
      path="/docs/:namespace/:kind/:name/*"
      element={<TechDocsReaderPage />}
    >
      <TechDocsAddons>
        <ReportIssue />
      </TechDocsAddons>
    </Route>
    <Route
      path="/create"
      element={
        <ScaffolderPage
          components={{ TemplateCardComponent: TemplateCard }}
          groups={templateGroups}
        />
      }
    >
      <ScaffolderFieldExtensions>
        <ClaimMachineryPickerFieldExtension />
        <ClaimMachineryParametersFieldExtension />
        <ClaimMachineryMultiClaimFieldExtension />
        <MachineryClaimPickerFieldExtension />
      </ScaffolderFieldExtensions>
    </Route>
    <Route path="/api-docs" element={<ApiExplorerPage />} />
    <Route
      path="/catalog-import"
      element={
        <RequirePermission permission={catalogEntityCreatePermission}>
          <CatalogImportPage />
        </RequirePermission>
      }
    />
    <Route path="/search" element={<SearchPage />}>
      {searchPage}
    </Route>
    <Route path="/settings" element={<UserSettingsPage />} />
    <Route path="/catalog-graph" element={<CatalogGraphPage />} />
    <Route path="/notifications" element={<NotificationsPage />} />
    <Route
      path="/devtools/*"
      element={
        <RequirePermission permission={devToolsAdministerPermission}>
          <PlatformDevToolsPage />
        </RequirePermission>
      }
    />
  </FlatRoutes>
);

export default app.createRoot(
  <>
    <AlertDisplay />
    <OAuthRequestDialog />
    <SignalsDisplay />
    <AppRouter>
      <Root>{routes}</Root>
    </AppRouter>
  </>,
);

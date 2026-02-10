import { createBackendModule, coreServices } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node/alpha';
import { claimRegistryDeleteAction } from './action';

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'claim-registry',

  register(env) {
    env.registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ scaffolderActions, config }) {
        scaffolderActions.addActions(
          claimRegistryDeleteAction({ config }),
        );
      },
    });
  },
});

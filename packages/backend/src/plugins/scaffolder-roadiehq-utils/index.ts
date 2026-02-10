import { createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node/alpha';
import {
  createAppendFileAction,
  createJSONataAction,
  createJsonJSONataTransformAction,
  createMergeAction,
  createMergeJSONAction,
  createParseFileAction,
  createReplaceInFileAction,
  createSerializeJsonAction,
  createSerializeYamlAction,
  createSleepAction,
  createWriteFileAction,
  createYamlJSONataTransformAction,
  createZipAction,
} from '@roadiehq/scaffolder-backend-module-utils';

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'roadiehq-utils',
  register(env) {
    env.registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
      },
      async init({ scaffolderActions }) {
        scaffolderActions.addActions(
          createAppendFileAction(),
          createJSONataAction(),
          createJsonJSONataTransformAction(),
          createMergeAction(),
          createMergeJSONAction(),
          createParseFileAction(),
          createReplaceInFileAction(),
          createSerializeJsonAction(),
          createSerializeYamlAction(),
          createSleepAction(),
          createWriteFileAction(),
          createYamlJSONataTransformAction(),
          createZipAction(),
        );
      },
    });
  },
});

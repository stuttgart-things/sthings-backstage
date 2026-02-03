import { createBackendModule } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node/alpha';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';

const yamlParseAction = () => {
  return createTemplateAction<{
    filePath: string;
  }>({
    id: 'utils:yaml:parse',
    description:
      'Reads a YAML file from the scaffolder workspace and outputs its parsed content',

    async handler(ctx) {
      const filePath = path.resolve(ctx.workspacePath, ctx.input.filePath);

      const exists = await fs.pathExists(filePath);
      if (!exists) {
        ctx.logger.warn(`File not found: ${ctx.input.filePath}, returning empty object`);
        ctx.output('content', {});
        return;
      }

      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = yaml.load(raw);

        if (!parsed || typeof parsed !== 'object') {
          ctx.logger.warn(
            `File ${ctx.input.filePath} did not contain a YAML object, returning empty object`,
          );
          ctx.output('content', {});
          return;
        }

        ctx.output('content', parsed);
      } catch (err) {
        ctx.logger.warn(
          `Failed to parse YAML file ${ctx.input.filePath}: ${err}, returning empty object`,
        );
        ctx.output('content', {});
      }
    },
  });
};

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'yaml-utils',
  register(env) {
    env.registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
      },
      async init({ scaffolderActions }) {
        scaffolderActions.addActions(yamlParseAction());
      },
    });
  },
});

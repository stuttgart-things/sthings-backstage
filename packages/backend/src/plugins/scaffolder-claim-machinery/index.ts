import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node/alpha';
import fs from 'fs-extra';
import fetch from 'node-fetch';
import path from 'path';

const claimMachineryRenderAction = (options: { config: any }) => {
  const { config } = options;

  return createTemplateAction<{
    template: string;
    parameters?: Record<string, any>;
    nameOverride?: string;
    outputPath?: string;
  }>({
    id: 'claim-machinery:render',
    description: 'Render a Claim Machinery template into workspace files',

    async handler(ctx) {
      const template = ctx.input.template;
      const nameOverride = ctx.input.nameOverride;
      const parameters = {
        ...ctx.input.parameters,
        ...(nameOverride ? { name: nameOverride } : {}),
      };
      const outputPath = ctx.input.outputPath || '.';

      // Read API URL from config, with a fallback
      const baseUrl = config.getOptionalString('claimMachinery.apiUrl')
        ?? 'https://claim-api.idp.kubermatic.sva.dev';

      ctx.logger.info(`Rendering template: ${template}`);
      ctx.logger.info(`Using API: ${baseUrl}`);

      const requestBody = { parameters };
      const url = `${baseUrl}/api/v1/claim-templates/${template}/order`;

      ctx.logger.info(`POST ${url}`);
      ctx.logger.info(`Request body: ${JSON.stringify(requestBody)}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        ctx.logger.info(`Response status: ${res.status}`);

        if (!res.ok) {
          const errorText = await res.text();
          ctx.logger.error(`API error response: ${errorText}`);
          throw new Error(`API returned ${res.status}: ${errorText}`);
        }

        const contentType = res.headers.get('content-type');
        if (!contentType?.includes('application/json')) {
          const responseText = await res.text();
          ctx.logger.error(`Unexpected content type: ${contentType}`);
          ctx.logger.error(`Response body: ${responseText.substring(0, 500)}`);
          throw new Error(`Expected JSON response but got ${contentType}. Response: ${responseText.substring(0, 200)}`);
        }

        const response = (await res.json()) as { rendered: string };

        ctx.logger.info('Template rendered successfully!');

        const targetDir = path.join(ctx.workspacePath, outputPath);
        await fs.ensureDir(targetDir);

        const fileName = `${template}.yaml`;
        const filePath = path.join(targetDir, fileName);

        await fs.writeFile(filePath, response.rendered);

        ctx.output('manifest', response.rendered);
        ctx.output('filePath', fileName);
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof Error && err.name === 'AbortError') {
          throw new Error('Request timed out after 60 seconds');
        }
        throw err;
      }
    },
  });
};

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'claim-machinery',
  register(env) {
    env.registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ scaffolderActions, config }) {
        const action = claimMachineryRenderAction({ config });
        scaffolderActions.addActions(action);
      },
    });
  },
});

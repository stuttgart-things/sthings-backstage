import {
  createBackendModule,
  coreServices,
} from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import {
  AUDIENCE_ANNOTATION,
  AUDIENCE_DEVELOPERS,
  BETA_TRACK_ANNOTATION,
  DEFAULT_DEVELOPER_GROUPS,
  DEFAULT_PLATFORM_GROUPS,
  TemplateAudiencePolicy,
} from './policy';

export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'template-audience-policy',

  register(env) {
    env.registerInit({
      deps: {
        policy: policyExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ policy, config, logger }) {
        const platformGroups =
          config.getOptionalStringArray(
            'permission.templateAudience.platformGroups',
          ) ?? DEFAULT_PLATFORM_GROUPS;

        logger.info(
          `Templates are visible to ${platformGroups.join(', ')}; everyone ` +
            `else sees only templates annotated ` +
            `${AUDIENCE_ANNOTATION}: ${AUDIENCE_DEVELOPERS}, their own ` +
            `tasks, and no catalog import/unregister, template editor or ` +
            `kubernetes proxy`,
        );
        const developerGroups =
          config.getOptionalStringArray(
            'permission.templateAudience.developerGroups',
          ) ?? DEFAULT_DEVELOPER_GROUPS;
        logger.info(
          `Beta testers (group:default/beta-<track>) also see templates ` +
            `annotated ${BETA_TRACK_ANNOTATION}: <track>; the developer ` +
            `templates only if they hold one of ${developerGroups.join(', ')}`,
        );
        policy.setPolicy(
          new TemplateAudiencePolicy(platformGroups, developerGroups),
        );
      },
    });
  },
});

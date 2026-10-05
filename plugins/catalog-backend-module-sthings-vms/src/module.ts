import {
  coreServices,
  createBackendModule,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
  SchedulerServiceTaskScheduleDefinition,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { SthingsVmEntityProvider } from './provider';
import { ProxmoxVmSource } from './sources/proxmox';

const CONFIG_KEY = 'catalog.providers.sthingsVms';

const DEFAULT_SCHEDULE: SchedulerServiceTaskScheduleDefinition = {
  frequency: { minutes: 10 },
  timeout: { minutes: 2 },
  initialDelay: { seconds: 30 },
};

export default createBackendModule({
  pluginId: 'catalog',
  moduleId: 'sthings-vms',

  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogProcessingExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, config, logger, scheduler }) {
        const providersConfig = config.getOptionalConfig(CONFIG_KEY);
        if (!providersConfig) {
          logger.info(`No ${CONFIG_KEY} configured, VM entity provider is off`);
          return;
        }

        for (const providerId of providersConfig.keys()) {
          const c = providersConfig.getConfig(providerId);
          const type = c.getString('type');
          if (type !== 'proxmox') {
            throw new Error(
              `${CONFIG_KEY}.${providerId}: type '${type}' is not supported yet (only 'proxmox')`,
            );
          }

          const source = new ProxmoxVmSource({
            endpoint: c.getString('endpoint'),
            pool: c.getString('pool'),
            tokenId: c.getString('tokenId'),
            tokenSecret: c.getString('tokenSecret'),
            logger,
          });
          const provider = new SthingsVmEntityProvider(
            source,
            {
              providerId,
              system: c.getString('system'),
              owner: c.getOptionalString('owner') ?? 'team-infrastructure',
              lifecycle: c.getOptionalString('lifecycle') ?? 'production',
            },
            logger,
          );
          catalog.addEntityProvider(provider);

          const schedule = c.has('schedule')
            ? readSchedulerServiceTaskScheduleDefinitionFromConfig(
                c.getConfig('schedule'),
              )
            : DEFAULT_SCHEDULE;
          await scheduler.scheduleTask({
            id: `${provider.getProviderName()}:refresh`,
            ...schedule,
            fn: () => provider.refresh(),
          });
        }
      },
    });
  },
});

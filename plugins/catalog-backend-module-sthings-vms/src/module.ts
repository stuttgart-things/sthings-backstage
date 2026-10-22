import {
  coreServices,
  createBackendModule,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
  SchedulerServiceTaskScheduleDefinition,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { SthingsVmEntityProvider } from './provider';
import { ProxmoxVmSource } from './sources/proxmox';
import { VsphereVmSource } from './sources/vsphere';
import { VmSource } from './types';

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
          let source: VmSource;
          if (type === 'proxmox') {
            source = new ProxmoxVmSource({
              endpoint: c.getString('endpoint'),
              pool: c.getString('pool'),
              tokenId: c.getString('tokenId'),
              tokenSecret: c.getString('tokenSecret'),
              caCert: c.getOptionalString('caCert'),
              logger,
            });
          } else if (type === 'vsphere') {
            source = new VsphereVmSource({
              endpoint: c.getString('endpoint'),
              folder: c.getString('folder'),
              username: c.getString('username'),
              password: c.getString('password'),
              apiVersion: c.getOptionalString('apiVersion'),
              caCert: c.getOptionalString('caCert'),
              logger,
            });
          } else {
            throw new Error(
              `${CONFIG_KEY}.${providerId}: type '${type}' is not supported (proxmox, vsphere)`,
            );
          }

          const provider = new SthingsVmEntityProvider(
            source,
            {
              providerId,
              system: c.getString('system'),
              owner: c.getOptionalString('owner') ?? 'team-infrastructure',
              lifecycle: c.getOptionalString('lifecycle') ?? 'production',
            },
            logger,
            { exclude: c.getOptionalStringArray('exclude') },
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

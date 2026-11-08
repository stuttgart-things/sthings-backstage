import {
  coreServices,
  createBackendModule,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
  SchedulerServiceTaskScheduleDefinition,
} from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import { KubernetesClusterSource, SthingsClusterProcessor } from './cluster';
import {
  MachineryClaimSource,
  MachineryOrderEntityProvider,
} from './machinery';
import { SthingsVmEntityProvider } from './provider';
import { HarvesterVmSource } from './sources/harvester';
import { ProxmoxVmSource } from './sources/proxmox';
import { VsphereVmSource } from './sources/vsphere';
import { VmSource } from './types';

const CONFIG_KEY = 'catalog.providers.sthingsVms';
const CLUSTERS_CONFIG_KEY = 'catalog.providers.sthingsClusters';

const CLUSTER_SCHEDULE: SchedulerServiceTaskScheduleDefinition = {
  frequency: { minutes: 5 },
  timeout: { minutes: 1 },
  initialDelay: { seconds: 15 },
};

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
        // Live facts for existing kubernetes-cluster entities, opt-in per cluster.
        const clustersConfig = config.getOptionalConfig(CLUSTERS_CONFIG_KEY);
        if (clustersConfig) {
          const processor = new SthingsClusterProcessor(
            clustersConfig.keys().map(entity => {
              const c = clustersConfig.getConfig(entity);
              return {
                entity,
                source: new KubernetesClusterSource({
                  endpoint: c.getString('endpoint'),
                  token: c.getString('token'),
                  caCert: c.getOptionalString('caCert'),
                  deployments: c.getOptionalBoolean('deployments'),
                  routes: c.getOptionalBoolean('routes'),
                  logger,
                }),
              };
            }),
            logger,
          );
          catalog.addProcessor(processor);
          await scheduler.scheduleTask({
            id: 'sthings-clusters:refresh',
            ...CLUSTER_SCHEDULE,
            fn: () => processor.refresh(),
          });
        }

        const providersConfig = config.getOptionalConfig(CONFIG_KEY);
        if (!providersConfig) {
          if (!clustersConfig) {
            logger.info(
              `No ${CONFIG_KEY} configured, VM entity provider is off`,
            );
          }
          return;
        }

        for (const providerId of providersConfig.keys()) {
          const c = providersConfig.getConfig(providerId);
          const type = c.getString('type');
          const schedule = c.has('schedule')
            ? readSchedulerServiceTaskScheduleDefinitionFromConfig(
                c.getConfig('schedule'),
              )
            : DEFAULT_SCHEDULE;

          // Orders: claims on machinery, owned by whoever they were ordered for.
          if (type === 'machinery') {
            const endpoint = c.getString('endpoint');
            const orders = new MachineryOrderEntityProvider(
              new MachineryClaimSource({
                endpoint,
                kinds: c.getOptionalStringArray('kinds'),
                caCert: c.getOptionalString('caCert'),
              }),
              {
                providerId,
                system: c.getString('system'),
                owner: c.getOptionalString('owner') ?? 'team-infrastructure',
                lifecycle: c.getOptionalString('lifecycle') ?? 'production',
                repoUrl:
                  c.getOptionalString('repoUrl') ??
                  'https://github.com/stuttgart-things/stuttgart-things',
                uiUrl: c.getOptionalString('uiUrl') ?? endpoint,
              },
              logger,
            );
            catalog.addEntityProvider(orders);
            await scheduler.scheduleTask({
              id: `${orders.getProviderName()}:refresh`,
              ...schedule,
              fn: () => orders.refresh(),
            });
            continue;
          }

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
          } else if (type === 'harvester') {
            source = new HarvesterVmSource({
              endpoint: c.getString('endpoint'),
              token: c.getString('token'),
              namespaces: c.getOptionalStringArray('namespaces'),
              uiUrl: c.getOptionalString('uiUrl'),
              caCert: c.getOptionalString('caCert'),
              logger,
            });
          } else {
            throw new Error(
              `${CONFIG_KEY}.${providerId}: type '${type}' is not supported (proxmox, vsphere, harvester, machinery)`,
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

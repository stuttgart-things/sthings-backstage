/**
 * Catalog entity provider for VM inventories (sthings-backstage#120,
 * stuttgart-things/stuttgart-things#3048).
 *
 * @packageDocumentation
 */
export { default } from './module';
export {
  createVmInfoRouter,
  LiveInfoCache,
  liveSourcesFromConfig,
  vmInfoPlugin,
  vmLocatorOf,
} from './vmInfo';
export { VmNotFoundError, usableAddresses } from './live';
export type { LiveVmSource, VmLiveInfo, VmLocator } from './live';
export { SthingsVmEntityProvider, excludeMatcher } from './provider';
export type { ProviderOptions } from './provider';
export { ProxmoxVmSource } from './sources/proxmox';
export { HarvesterVmSource } from './sources/harvester';
export { VsphereVmSource } from './sources/vsphere';
export { createVmSource } from './sources/factory';
export { vmToEntity } from './entity';
export {
  argoDeployment,
  clusterFacts,
  deploymentsSummary,
  fluxDeployment,
  KubernetesClusterSource,
  SthingsClusterProcessor,
  withClusterFacts,
} from './cluster';
export type { ClusterFacts, ClusterTarget, Deployment } from './cluster';
export {
  claimToEntity,
  MachineryClaimSource,
  MachineryOrderEntityProvider,
} from './machinery';
export type { MachineryResource, MachineryOrderDefaults } from './machinery';
export type { EntityDefaults } from './entity';
export type { VmRecord, VmSource } from './types';

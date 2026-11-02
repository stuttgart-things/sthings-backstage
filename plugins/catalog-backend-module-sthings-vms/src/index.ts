/**
 * Catalog entity provider for VM inventories (sthings-backstage#120,
 * stuttgart-things/stuttgart-things#3048).
 *
 * @packageDocumentation
 */
export { default } from './module';
export { SthingsVmEntityProvider, excludeMatcher } from './provider';
export type { ProviderOptions } from './provider';
export { ProxmoxVmSource } from './sources/proxmox';
export { HarvesterVmSource } from './sources/harvester';
export { vmToEntity } from './entity';
export {
  claimToEntity,
  MachineryClaimSource,
  MachineryOrderEntityProvider,
} from './machinery';
export type { MachineryResource, MachineryOrderDefaults } from './machinery';
export type { EntityDefaults } from './entity';
export type { VmRecord, VmSource } from './types';

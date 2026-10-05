/**
 * Catalog entity provider for VM inventories (sthings-backstage#120,
 * stuttgart-things/stuttgart-things#3048).
 *
 * @packageDocumentation
 */
export { default } from './module';
export { SthingsVmEntityProvider } from './provider';
export { ProxmoxVmSource } from './sources/proxmox';
export { vmToEntity } from './entity';
export type { EntityDefaults } from './entity';
export type { VmRecord, VmSource } from './types';

import { LoggerService } from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { LiveVmSource } from '../live';
import { VmSource } from '../types';
import { HarvesterVmSource } from './harvester';
import { ProxmoxVmSource } from './proxmox';
import { VsphereVmSource } from './vsphere';

export const VMS_CONFIG_KEY = 'catalog.providers.sthingsVms';

/** Source types that list VMs (machinery lists orders and is not one). */
export const VM_SOURCE_TYPES = ['proxmox', 'vsphere', 'harvester'] as const;

/**
 * The source for one `catalog.providers.sthingsVms.<providerId>` entry.
 * Shared by the catalog module and the vm-info plugin so both read the same
 * config and credentials.
 */
export function createVmSource(
  providerId: string,
  c: Config,
  logger: LoggerService,
): VmSource & LiveVmSource {
  const type = c.getString('type');
  if (type === 'proxmox') {
    return new ProxmoxVmSource({
      endpoint: c.getString('endpoint'),
      pool: c.getString('pool'),
      tokenId: c.getString('tokenId'),
      tokenSecret: c.getString('tokenSecret'),
      caCert: c.getOptionalString('caCert'),
      logger,
    });
  }
  if (type === 'vsphere') {
    return new VsphereVmSource({
      endpoint: c.getString('endpoint'),
      folder: c.getString('folder'),
      username: c.getString('username'),
      password: c.getString('password'),
      apiVersion: c.getOptionalString('apiVersion'),
      caCert: c.getOptionalString('caCert'),
      logger,
    });
  }
  if (type === 'harvester') {
    return new HarvesterVmSource({
      endpoint: c.getString('endpoint'),
      token: c.getString('token'),
      namespaces: c.getOptionalStringArray('namespaces'),
      uiUrl: c.getOptionalString('uiUrl'),
      caCert: c.getOptionalString('caCert'),
      logger,
    });
  }
  throw new Error(
    `${VMS_CONFIG_KEY}.${providerId}: type '${type}' is not supported (proxmox, vsphere, harvester, machinery)`,
  );
}

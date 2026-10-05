import { LoggerService } from '@backstage/backend-plugin-api';
import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { EntityDefaults, vmToEntity } from './entity';
import { VmSource } from './types';

/**
 * Mirrors one VM inventory into the catalog with full mutations, so a deleted
 * VM disappears and a new one appears without anybody writing a file.
 */
export class SthingsVmEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;

  constructor(
    private readonly source: VmSource,
    private readonly defaults: EntityDefaults,
    private readonly logger: LoggerService,
  ) {}

  getProviderName(): string {
    return `sthings-vms:${this.defaults.providerId}`;
  }

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
  }

  async refresh(): Promise<void> {
    if (!this.connection) {
      throw new Error(`${this.getProviderName()} is not connected yet`);
    }
    // A failing source throws here, before applyMutation, so the previous
    // entities stay in place instead of being wiped by an empty result.
    const vms = await this.source.listVms();
    const locationKey = this.getProviderName();
    await this.connection.applyMutation({
      type: 'full',
      entities: vms.map(vm => ({
        entity: vmToEntity(vm, this.defaults),
        locationKey,
      })),
    });
    this.logger.info(`${locationKey}: synced ${vms.length} VMs`);
  }
}

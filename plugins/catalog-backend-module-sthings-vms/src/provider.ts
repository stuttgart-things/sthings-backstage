import { LoggerService } from '@backstage/backend-plugin-api';
import {
  EntityProvider,
  EntityProviderConnection,
} from '@backstage/plugin-catalog-node';
import { EntityDefaults, vmToEntity } from './entity';
import { VmSource } from './types';

export interface ProviderOptions {
  /**
   * VM names (as the source reports them, not entity names) to leave out.
   * `*` matches any run of characters; everything else is literal.
   */
  exclude?: string[];
}

/**
 * Matcher for `exclude`: whole-name match, `*` as the only wildcard. A name
 * like `ubuntu26-base-*` must not turn `.` or `+` into regex syntax.
 */
export function excludeMatcher(patterns: string[]): (name: string) => boolean {
  const res = patterns.map(
    p =>
      new RegExp(
        `^${p
          .split('*')
          .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*')}$`,
      ),
  );
  return name => res.some(re => re.test(name));
}

/**
 * Mirrors one VM inventory into the catalog with full mutations, so a deleted
 * VM disappears and a new one appears without anybody writing a file.
 */
export class SthingsVmEntityProvider implements EntityProvider {
  private connection?: EntityProviderConnection;
  private readonly excluded: (name: string) => boolean;

  constructor(
    private readonly source: VmSource,
    private readonly defaults: EntityDefaults,
    private readonly logger: LoggerService,
    options: ProviderOptions = {},
  ) {
    this.excluded = excludeMatcher(options.exclude ?? []);
  }

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
    const all = await this.source.listVms();
    const vms = all.filter(vm => !this.excluded(vm.name));
    const locationKey = this.getProviderName();
    await this.connection.applyMutation({
      type: 'full',
      entities: vms.map(vm => ({
        entity: vmToEntity(vm, this.defaults),
        locationKey,
      })),
    });
    const skipped = all.length - vms.length;
    this.logger.info(
      `${locationKey}: synced ${vms.length} VMs${skipped ? `, excluded ${skipped}` : ''}`,
    );
  }
}

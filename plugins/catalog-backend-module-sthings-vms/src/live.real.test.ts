/**
 * Opt-in check against the real hypervisors (#244); skipped unless
 * LIVE_VM_CHECK=1. Reads the sthingsVms provider config from a Backstage
 * config file (e.g. the ConfigMap data of a lab, extracted to YAML) and the
 * credentials it references (${VAR}) from the environment, then asks one
 * running and one stopped VM of every proxmox/vsphere/harvester provider.
 *
 *   LIVE_VM_CHECK=1 LIVE_VM_CONFIG=/path/app-config.vms.yaml \
 *     CI=true node_modules/.bin/backstage-cli repo test \
 *     plugins/catalog-backend-module-sthings-vms/src/live.real.test.ts
 */
import { ConfigReader } from '@backstage/config';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import {
  createVmSource,
  VM_SOURCE_TYPES,
  VMS_CONFIG_KEY,
} from './sources/factory';

const enabled = process.env.LIVE_VM_CHECK === '1';
const configFile = process.env.LIVE_VM_CONFIG;

/** ${VAR} and ${VAR:-default} from the environment, like Backstage does. */
function substitute(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)(?::-([^}]*))?\}/g, (_m, name, def) => {
      const v = process.env[name] ?? def;
      if (v === undefined) throw new Error(`env ${name} is not set`);
      return v;
    });
  }
  if (Array.isArray(value)) return value.map(substitute);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, substitute(v)]),
    );
  }
  return value;
}

const logger = {
  debug: () => {},
  info: () => {},
  warn: (m: string) => process.stdout.write(`warn: ${m}\n`),
  error: (m: string) => process.stdout.write(`error: ${m}\n`),
  child: () => logger,
};

(enabled ? describe : describe.skip)(
  'live VM info against real hypervisors',
  () => {
    jest.setTimeout(120_000);

    it('answers for a running and a stopped VM of every provider', async () => {
      if (!configFile) throw new Error('set LIVE_VM_CONFIG');
      const raw = parse(readFileSync(configFile, 'utf8'));
      const providers = raw?.catalog?.providers?.sthingsVms ?? {};
      const report: string[] = [];
      let asked = 0;

      for (const [id, entry] of Object.entries<any>(providers)) {
        if (!(VM_SOURCE_TYPES as readonly string[]).includes(entry.type)) {
          continue;
        }
        let resolved;
        try {
          resolved = substitute(entry);
        } catch (e) {
          report.push(`${id}: skipped (${(e as Error).message})`);
          continue;
        }
        const c = new ConfigReader(resolved as any, `${VMS_CONFIG_KEY}.${id}`);
        const source = createVmSource(id, c, logger as any);
        const vms = (await source.listVms()).filter(v => !v.template);
        report.push(`${id}: ${vms.length} VMs listed`);

        const picks = [
          vms.find(v => v.status === 'running'),
          vms.find(v => v.status && v.status !== 'running'),
        ].filter(Boolean);
        for (const vm of picks) {
          const a = vm!.annotations;
          const locator =
            entry.type === 'proxmox'
              ? {
                  cloud: 'proxmox' as const,
                  vmid: Number(a['proxmox.stuttgart-things.com/vmid']),
                }
              : entry.type === 'vsphere'
                ? {
                    cloud: 'vsphere' as const,
                    moid: a['vsphere.stuttgart-things.com/moid'],
                  }
                : {
                    cloud: 'harvester' as const,
                    namespace: a['harvester.stuttgart-things.com/namespace'],
                    name: a['harvester.stuttgart-things.com/name'],
                  };
          const t0 = Date.now();
          const info = await source.liveInfo(locator);
          asked++;
          report.push(
            `  ${vm!.name} (catalog: ${vm!.status}) -> ${info.status}, ` +
              `uptime ${info.uptimeSeconds ?? '-'}s, host ${info.host ?? '-'}, ` +
              `cpu ${info.cpu?.usagePercent ?? '-'}% of ${info.cpu?.count ?? '-'}, ` +
              `mem ${info.memory?.usedMiB ?? '-'}/${info.memory?.totalMiB ?? '-'} MiB, ` +
              `${info.ipAddresses.length} address(es), ${Date.now() - t0} ms`,
          );
          expect(info.status).toBe(vm!.status);
          if (info.status === 'running') {
            expect(info.uptimeSeconds).toBeGreaterThan(0);
          }
        }
      }
      process.stdout.write(`\n${report.join('\n')}\n\n`);
      expect(asked).toBeGreaterThan(0);
    });
  },
);

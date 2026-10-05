import { SchedulerServiceTaskScheduleDefinitionConfig } from '@backstage/backend-plugin-api';

export interface Config {
  catalog?: {
    providers?: {
      /**
       * VM inventories to mirror into the catalog, keyed by provider id
       * (e.g. `proxmox-labul`). Each entry becomes one entity provider that
       * owns exactly the VMs its source returns.
       */
      sthingsVms?: {
        [providerId: string]: {
          /** Inventory backend. Only `proxmox` is implemented so far. */
          type: 'proxmox';
          /** Proxmox API base URL, e.g. https://ul-pve01.labul.sva.de:8006 */
          endpoint: string;
          /** Only VMs in this Proxmox pool are ours. */
          pool: string;
          /** API token id, e.g. `backstage@pve!catalog` (PVEAuditor is enough). */
          tokenId: string;
          /** @visibility secret */
          tokenSecret: string;
          /** System entity the VMs belong to, e.g. `labul`. */
          system: string;
          /** Owner entity ref. Defaults to `team-infrastructure`. */
          owner?: string;
          /** Lifecycle. Defaults to `production`. */
          lifecycle?: string;
          /** Defaults to every 10 minutes with a 2 minute timeout. */
          schedule?: SchedulerServiceTaskScheduleDefinitionConfig;
        };
      };
    };
  };
}

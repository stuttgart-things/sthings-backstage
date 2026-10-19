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
          /** Inventory backend. */
          type: 'proxmox' | 'vsphere';
          /**
           * API base URL: Proxmox, e.g. https://ul-pve01.labul.sva.de:8006, or
           * vCenter, e.g. https://10.100.135.50
           */
          endpoint: string;
          /** proxmox: only VMs in this Proxmox pool are ours. */
          pool?: string;
          /** proxmox: API token id, e.g. `backstage@pve!catalog` (PVEAuditor is enough). */
          tokenId?: string;
          /**
           * proxmox: API token secret.
           * @visibility secret
           */
          tokenSecret?: string;
          /**
           * vsphere: inventory path of the VM folder, subfolders included, e.g.
           * `NetApp-HCI-Datacenter/vm/stuttgart-things`.
           */
          folder?: string;
          /** vsphere: vCenter user; the Read-only role on the folder is enough. */
          username?: string;
          /**
           * vsphere: password of `username`.
           * @visibility secret
           */
          password?: string;
          /**
           * vsphere: VI/JSON API release in the URL path. Defaults to `8.0.1.0`,
           * the first one (vCenter 8.0 U1).
           */
          apiRelease?: string;
          /**
           * PEM to trust for this endpoint instead of the Node trust store.
           * Can be the server's own self-signed certificate (pinning), e.g.
           * Proxmox's default node certificate when its CA is not at hand.
           */
          caCert?: string;
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

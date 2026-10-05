# catalog-backend-module-sthings-vms

Catalog entity provider that mirrors VM inventories into the Backstage catalog
as `Resource` entities. A full mutation per run means a deleted VM disappears
and a new one shows up without anybody writing a `catalog-info.yaml`
(stuttgart-things/stuttgart-things#3048).

| Source          | Status      |
| --------------- | ----------- |
| Proxmox (LabUL) | implemented |
| vSphere (LabDA) | planned     |
| Harvester       | planned     |

## Entities

Shaped like the hand-maintained files in stuttgart-things `catalog/vms/`, so
those can be removed without entity refs changing:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: homerun2-test1-proxmox-vm # <vm>-<cloud>-vm
  title: homerun2-test1
  annotations:
    proxmox.stuttgart-things.com/vmid: '254'
    proxmox.stuttgart-things.com/node: ul-pve11
    proxmox.stuttgart-things.com/pool: stuttgart-things
    proxmox.stuttgart-things.com/ipv4: 10.31.102.114 # from the guest agent, if running
    vm.stuttgart-things.com/status: running
    vm.stuttgart-things.com/cpus: '4'
    vm.stuttgart-things.com/memory-mib: '8192'
  tags: [proxmox, labul, vm, <proxmox tags...>]
  links:
    - { url: <endpoint>/#v1:0:=qemu%2F254, title: Proxmox, icon: dashboard }
spec:
  type: vm # vm-template for templates
  lifecycle: production
  owner: team-infrastructure
  system: labul
```

## Configuration

Nothing runs unless `catalog.providers.sthingsVms` is set.

```yaml
catalog:
  providers:
    sthingsVms:
      proxmox-labul:
        type: proxmox
        endpoint: https://ul-pve01.labul.sva.de:8006
        pool: stuttgart-things
        tokenId: ${PROXMOX_TOKEN_ID} # e.g. backstage@pve!catalog
        tokenSecret: ${PROXMOX_TOKEN_SECRET}
        system: labul
        # owner: team-infrastructure          # default
        # lifecycle: production               # default
        # schedule:                           # default: every 10 min, 2 min timeout
        #   frequency: { minutes: 10 }
        #   timeout: { minutes: 2 }
```

The Proxmox token only needs the `PVEAuditor` role. TLS uses the Node trust
store. For a private CA, set `NODE_EXTRA_CA_CERTS`.

## Install

In this repo it is a workspace package and already added in
`packages/backend/src/index.ts`. Other Backstage instances install it from
GitHub Packages (see `plugins/README.md`):

```ts
backend.add(
  import('@stuttgart-things/backstage-plugin-catalog-backend-module-sthings-vms'),
);
```

## Not done yet

- Owner from Proxmox tags (`se-<kürzel>` → user/group) and the optional Git
  intent file per VM from the #3048 design comment. Today every VM gets the
  configured `owner`.
- vSphere and Harvester sources.

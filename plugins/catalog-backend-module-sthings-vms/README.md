# catalog-backend-module-sthings-vms

Catalog entity provider that mirrors VM inventories into the Backstage catalog
as `Resource` entities. A full mutation per run means a deleted VM disappears
and a new one shows up without anybody writing a `catalog-info.yaml`
(stuttgart-things/stuttgart-things#3048).

| Source          | Status      |
| --------------- | ----------- |
| Proxmox (LabUL) | implemented |
| vSphere (LabDA) | implemented |
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
        # caCert: |                           # optional, see below
        #   -----BEGIN CERTIFICATE-----
        # owner: team-infrastructure          # default
        # lifecycle: production               # default
        # schedule:                           # default: every 10 min, 2 min timeout
        #   frequency: { minutes: 10 }
        #   timeout: { minutes: 2 }
```

The Proxmox token only needs the `PVEAuditor` role. TLS uses the Node trust
store. For a private CA, set `NODE_EXTRA_CA_CERTS`.

Proxmox's default node certificate is signed by a per-cluster CA that only
exists on the host (`/etc/pve/pve-root-ca.pem`). Without host access, pin the
node certificate itself via `caCert`; that endpoint then trusts only this PEM:

```bash
openssl s_client -connect ul-pve01.labul.sva.de:8006 </dev/null | openssl x509
```

A pinned certificate has to be updated when Proxmox renews it.

### vSphere

```yaml
catalog:
  providers:
    sthingsVms:
      vsphere-labda:
        type: vsphere
        endpoint: https://10.100.135.50
        folder: NetApp-HCI-Datacenter/vm/stuttgart-things # inventory path, subfolders included
        username: ${VSPHERE_USERNAME}
        password: ${VSPHERE_PASSWORD}
        system: labda
        # apiRelease: 8.0.1.0                 # default
        # caCert: |                           # optional, same as for Proxmox
```

Uses the VI/JSON API (`/sdk/vim25/<release>/...`, vCenter 8.0 U1 and later)
rather than the Automation REST API, because `/api/vcenter/vm` does not return
templates kept in folders. One session per run: login, a recursive container
view over the folder, the property collector, logout. The `Read-only` role on
the folder is enough.

Entities are named `<vm>-vsphere-vm` and carry
`vsphere.stuttgart-things.com/{moid,host,folder,datastore,ipv4}`, like the
hand-maintained files in stuttgart-things `catalog/vms/labda/`. The folder
annotation starts at the configured folder (`stuttgart-things/infra`), the IP
is the guest's primary IPv4 (VMware Tools), the datastore the VM's first one.
vSphere tags are not read.

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
- Harvester source. vSphere tags.

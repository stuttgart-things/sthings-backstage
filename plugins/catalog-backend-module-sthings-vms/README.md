# catalog-backend-module-sthings-vms

Catalog entity provider that mirrors VM inventories into the Backstage catalog
as `Resource` entities. A full mutation per run means a deleted VM disappears
and a new one shows up without anybody writing a `catalog-info.yaml`
(stuttgart-things/stuttgart-things#3048).

| Source          | Status      |
| --------------- | ----------- |
| Proxmox (LabUL) | implemented |
| vSphere (LabDA) | implemented |
| Harvester       | implemented |

## Entities

Shaped like the hand-maintained files in stuttgart-things `catalog/vms/`, so
those can be removed without entity refs changing:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: homerun2-test1-proxmox-vm # <vm>-<cloud>-vm
  title: homerun2-test1
  # for the About card: the source's description, OS, size, IP, status
  description: 4 vCPU · 8 GiB · 10.31.102.114 · running
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

The app shows Resources of type `vm`/`vm-template` on their own entity page
with a **VM** card (`packages/app/src/components/catalog/VmDetailsCard.tsx`)
that lists these annotations: `vm.stuttgart-things.com/*` first, then the
source's own.

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
        # apiVersion: 7.0.3.0                 # default, SOAPAction urn:vim25/<version>
        # caCert: |                           # optional, same as for Proxmox
```

Uses the vSphere Web Services API (SOAP, `/sdk`, vim25) rather than the
Automation REST API, because `/api/vcenter/vm` does not return templates kept
in folders. Not the newer VI/JSON flavour of the same API either: that needs
vCenter 8.0 U1, and LabDA runs 7.0.3. One session per run: login, a
recursive container view over the folder, the property collector, logout.
The `Read-only` role on the folder is enough.

Entities are named `<vm>-vsphere-vm` and carry
`vsphere.stuttgart-things.com/{moid,host,folder,datastore,ipv4}`, like the
hand-maintained files in stuttgart-things `catalog/vms/labda/`. The folder
annotation starts at the configured folder (`stuttgart-things/infra`), the IP
is the guest's primary IPv4 (VMware Tools), the datastore the VM's first one.
vSphere tags are not read.

### Harvester

```yaml
catalog:
  providers:
    sthingsVms:
      harvester-sthings:
        type: harvester
        endpoint: https://harvester.sthings.lab:6443 # Kubernetes API, not the Rancher proxy
        token: ${HARVESTER_TOKEN}
        system: harvester
        # namespaces: [vms]                    # default: every namespace
        # uiUrl: https://harvester.sthings.lab # link to the VM in the Harvester UI
        # caCert: |                            # the cluster CA, see below
```

Reads `kubevirt.io/v1` VirtualMachines and their VirtualMachineInstances from
the Kubernetes API of the Harvester cluster, and the PersistentVolumeClaims for
disk sizes and images. A ServiceAccount token with get/list on these is enough;
without the PVCs, disks come only from `harvesterhci.io/volumeClaimTemplates`
(VMs of Rancher node pools), with one warning:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: backstage-vm-reader
rules:
  - apiGroups: [kubevirt.io]
    resources: [virtualmachines, virtualmachineinstances]
    verbs: [get, list]
  - apiGroups: ['']
    resources: [persistentvolumeclaims]
    verbs: [get, list]
```

The API's certificate is signed by the cluster CA (RKE2), so `caCert` is
usually that CA: `certificate-authority-data` from a kubeconfig, base64-decoded.

Entities are named `<vm>-harvester-vm` and carry
`harvester.stuttgart-things.com/{namespace,uid,node,ipv4}`, plus where known
`network` and `mac` (the VM's first network), `disks` (`disk-0 50Gi, ...`),
`image` (Harvester image of the disks), `guest-cluster` (Rancher guest cluster
of a node-pool VM), `creator`, `run-strategy` and `created`. The guest OS goes
to `vm.stuttgart-things.com/os`, the VM's `field.cattle.io/description` or
`description` annotation to the start of the entity description. Status comes from
`printableStatus` (`Running` → `running`, `Stopped` → `stopped`, others
lowercased), CPUs are cores × sockets × threads, memory is `memory.guest` or
the memory limit/request. The IP and OS need the qemu guest agent in the VM;
the IP is that of the VM's first network, so pod IPs of a guest that is a
Kubernetes node do not win. Harvester
tags (labels `tag.harvesterhci.io/<tag>`) become entity tags. VM images are not
VMs and are not listed. A name that exists in two namespaces becomes
`<namespace>-<vm>` for both, with a warning.

### Kubernetes clusters

Clusters are not mirrored like VMs: their entities stay the hand-maintained
`Resource`s of type `kubernetes-cluster` (stuttgart-things
`catalog/clusters/`), because links and `dependsOn` (which VMs carry the
cluster) are things only a person knows. What the cluster's API knows is added
on top, **opt-in per cluster**, by a catalog processor:

```yaml
catalog:
  providers:
    sthingsClusters:
      machinery-cluster: # entity name of the kubernetes-cluster Resource
        endpoint: https://10.100.136.121:6443
        token: ${MACHINERY_CLUSTER_TOKEN}
        caCert:
          | # cluster CA, certificate-authority-data from a kubeconfig, base64-decoded
          -----BEGIN CERTIFICATE-----
          ...
```

Every 5 minutes it reads `/version` and `/api/v1/nodes`, nothing else. That
needs neither the Backstage Kubernetes plugin (no `kubernetes:` config, no
`backstage.io/kubernetes-id`) nor anything installed in the cluster besides a
read-only ServiceAccount:

```yaml
apiVersion: v1
kind: ServiceAccount
metadata: { name: backstage-cluster-reader, namespace: kube-system }
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata: { name: backstage-cluster-reader }
rules:
  - apiGroups: ['']
    resources: [nodes]
    verbs: [get, list]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata: { name: backstage-cluster-reader }
roleRef:
  {
    apiGroup: rbac.authorization.k8s.io,
    kind: ClusterRole,
    name: backstage-cluster-reader,
  }
subjects:
  [
    {
      kind: ServiceAccount,
      name: backstage-cluster-reader,
      namespace: kube-system,
    },
  ]
---
apiVersion: v1
kind: Secret
type: kubernetes.io/service-account-token
metadata:
  name: backstage-cluster-reader
  namespace: kube-system
  annotations: { kubernetes.io/service-account.name: backstage-cluster-reader }
```

For the **Deployments** list (Flux, Argo CD), add both rules to the ClusterRole,
**even on a cluster without Argo CD or without Flux**. Kubernetes checks RBAC before
it checks whether an API exists. Without the rule, a missing API answers 403
instead of 404, and the processor warns about missing RBAC that nothing needs.
With the rule, it answers 404, which is skipped silently. The rule grants nothing
where the API is not installed.

```yaml
- apiGroups: [kustomize.toolkit.fluxcd.io, helm.toolkit.fluxcd.io]
  resources: [kustomizations, helmreleases]
  verbs: [get, list]
- apiGroups: [argoproj.io]
  resources: [applications]
  verbs: [get, list]
```

Flux is read at its GA versions (`kustomize.toolkit.fluxcd.io/v1`,
`helm.toolkit.fluxcd.io/v2`, Flux 2.3+), Argo CD Applications in every
namespace. An API that is not installed (404) is skipped silently, a forbidden
one (403) with one warning; `deployments: false` on a cluster turns the lists
off.

For **links** to what the cluster serves, add the Gateway API rule as well, for
the same reason, also on clusters without the Gateway API:

```yaml
- apiGroups: [gateway.networking.k8s.io]
  resources: [httproutes]
  verbs: [get, list]
```

Every concrete hostname of an accepted `HTTPRoute` (`gateway.networking.k8s.io/v1`,
all namespaces) becomes a link on the entity, titled with the route's name (the
host when a route has several, `<namespace>/<name>` when two routes share a name)
and `type: httproute`. The URL is `https://<host>`. If no rule matches `/`, the
URL is `https://<host><first path>` instead, so a route serving only `/api` does
not link to a 404. Wildcard hosts and routes no Gateway accepted are left out.
The links follow the ones in the file. A route with the same URL as a hand-written
link adds nothing, so keep a hand-written link where its title (`Flux UI`)
reads better than the route name. `routes: false` on a cluster turns this off.

A configured cluster gets
`cluster.stuttgart-things.com/{status,version,distribution,nodes,nodes-ready,control-planes,cpus,memory-mib,node-names,checked}`,
with Flux or Argo CD also `deployments-summary` (`flux 23/24 ready, argocd
12/12 ready`) and `deployments`: a JSON list with tool, kind, namespace, name,
ready, status (Flux `Ready`/`NotReady`/`Suspended`/`Unknown`, Argo CD
`<sync>/<health>`), source (chart@version or repo path), revision and, when
not ready, the message. Not-ready entries come first.
and its description gains one line for the catalog list:
`rke2 cluster machinery in LabDA (vsphere) -- v1.33.4+rke2r1 · 3 nodes · 24 vCPU · 48 GiB · ready · flux 23/24 ready`.
Status is `ready` (every node Ready), `degraded` or `unreachable`; an
unreachable cluster keeps its last facts plus `error`. Clusters that are not
configured stay exactly as their file says. The app shows them on a cluster
page with a **Cluster** card, a **Deployments** table and the VMs from
`dependsOn`.

### Orders on machinery

`type: machinery` mirrors **ordered claims** instead of VMs: every claim of the
configured kinds on machinery that carries `stuttgart-things.com/source-path`
(i.e. was written into git by a template such as `create-vm`).

```yaml
catalog:
  providers:
    sthingsVms:
      machinery-labda:
        type: machinery
        endpoint: https://machinery.machinery.4sthings.tiab.ssc.sva.de
        system: labda
        # kinds: [NativeVsphereVM, NativeProxmoxVM]   # default
        # owner: team-infrastructure                   # claims without an owner
      # A second instance, in another lab: one entry per machinery.
      machinery-labul:
        type: machinery
        endpoint: https://machinery.machinery-labul.sthings-vsphere.labul.sva.de
        system: labul
        # PEM to trust instead of the Node store, when the instance's
        # certificate comes from a CA the pod does not know (another lab's
        # Vault PKI). Same as the other sources' caCert.
        caCert: |
          -----BEGIN CERTIFICATE-----
          ...
          -----END CERTIFICATE-----
```

Entity names are `<claim>-order` for every instance: two instances with a
claim of the same name would collide, so keep claim names unique across labs
(create-vm checks both orders directories).

Entities are `Resource`s of type `machinery-order`, named `<claim>-order`:

- `spec.owner` is the claim's `stuttgart-things.com/owner` (the user, or one of
  their groups, the order was placed for), else
  `stuttgart-things.com/requested-by`, else `owner`. The catalog's **Owned**
  filter then lists a user's orders and their groups' orders.
- Status from machinery on every refresh:
  `machinery.stuttgart-things.com/{ready,status,status-message,created}`, the
  tags `ready` / `not-ready`, and a one-line description
  (`NativeVsphereVM · Ready · ordered by user:default/doc`).
- `backstage.stuttgart-things.com/requested-by`, links to the order file in git
  and to the claim in the machinery UI.

machinery returns only annotations under `stuttgart-things.com/`, which is why
the claim carries `stuttgart-things.com/owner` and not a `backstage.` key.

### Leaving VMs out

```yaml
vsphere-labda:
  # ...
  exclude:
    - machinery # entity comes from terraform/vsphere/labda/machinery/catalog-info.yaml
    - sthings-u24 # old template, cannot be deleted in vCenter
    - ubuntu26-base-* # `*` matches any run of characters
```

Names as the source reports them (`machinery`), not entity names
(`machinery-vsphere-vm`). Two uses:

- **A VM whose entity is written elsewhere.** The Scaffolder template
  `create-terraform-vm` writes a `catalog-info.yaml` with the same entity name,
  and its tags (`baseos`, `dev`) are what `request-vm-deletion` filters on.
  Without the exclude, the catalog logs a conflict per VM and keeps the file
  version anyway.
- **Templates or VMs nobody wants listed**, e.g. old templates that can no
  longer be deleted.

An excluded VM is simply not part of the provider's full mutation: an entity
the provider created for it before is removed on the next run.

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
- vSphere tags. Harvester VM templates and images.

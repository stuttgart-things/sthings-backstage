# Machinery Claim Picker

Scaffolder field `MachineryClaimPicker`: pick an ordered XR from the live
inventory [stuttgart-things/machinery](https://github.com/stuttgart-things/machinery)
watches on the management cluster. Replaces the `RegistryClaimPicker`, which
read the abandoned `registry.yaml` through machinery-registry-api (archived).

Only XRs with the annotation `stuttgart-things.com/source-path` are offered —
the claims ordered into git (`machinery-xrs`), not the objects their
compositions create.

## Proxy

The field calls `/api/proxy/<proxyPath>/api/v1/resources` (default
`proxyPath`: `machinery`), so `app-config` needs:

```yaml
proxy:
  endpoints:
    '/machinery':
      target: ${MACHINERY_URL}
      changeOrigin: true
      pathRewrite:
        '^/api/proxy/machinery': ''
```

### Several machinery instances

Each lab has its own factory (LabDA `machinery`, LabUL `machinery-labul`), and
each one only knows its own claims. With `proxyPaths` the field reads every
listed endpoint and offers their claims together; it takes precedence over
`proxyPath`. Each entry needs its own proxy endpoint:

```yaml
proxy:
  endpoints:
    '/machinery-labul':
      target: ${MACHINERY_LABUL_URL}
      changeOrigin: true
      pathRewrite:
        '^/api/proxy/machinery-labul': ''
```

```yaml
ui:options:
  proxyPaths: [machinery, machinery-labul]
```

- Without it the field reads `[proxyPath]`, i.e. `[machinery]` -- unchanged.
- A claim is one file: two instances may each have an XR with the same kind
  and name, and both are offered (told apart by their file and, with more than
  one endpoint, by their management cluster in the list).
- An endpoint that does not answer is named under the field, and the claims
  of the others are still offered. Only when none answers is that an error.
- `ownedOnly` applies to the merged list.

## Usage

```yaml
claim:
  title: Claim
  type: object
  ui:field: MachineryClaimPicker
  ui:options:
    # optional; default: every kind machinery watches
    kinds: [NativeVsphereVM, NativeProxmoxVM, ScheduledRun, MinioBucket]
    excludeKinds: [ClusterStack]
    # optional; offer only "my orders" (see below)
    ownedOnly: true
    # optional; several machinery instances (see above). Default: [machinery]
    proxyPaths: [machinery, machinery-labul]
```

### `ownedOnly`: only my and my groups' orders

With `ownedOnly: true` the field offers only claims whose
`stuttgart-things.com/owner` or `stuttgart-things.com/requested-by` is one of
the signed-in user's ownership refs -- the user, or one of their groups
(e.g. a team from the Zitadel role `backstage-team-<team>`). Order templates
write both annotations; [`create-vm`](https://github.com/stuttgart-things/stuttgart-things/tree/main/backstage/templates/create-vm)
fills `owner` from the [Order Owner Picker](order-owner-picker.md).

- Claims ordered before the annotations existed carry neither and are not
  offered.
- A convenience, not access control: the developer templates that use it
  (`request-claim-change`, `request-claim-deletion`) open a pull request a
  platform engineer merges.
- The same annotations drive the catalog: the sthings-vms provider's
  `type: machinery` turns each order into a `machinery-order` entity owned by
  `stuttgart-things.com/owner`, so it shows under **Owned** with its status
  ([plugin README](../plugins/catalog-backend-module-sthings-vms/README.md#orders-on-machinery)).

## Value

With `type: object` the field stores the object below, and steps read it
directly (`${{ parameters.claim.name }}`). The review page shows one row per
key; give the keys titles, or hide one, under `properties`:

```yaml
claim:
  type: object
  ui:field: MachineryClaimPicker
  properties:
    kind: { title: Kind, type: string }
    name: { title: Name, type: string }
    apiVersion:
      type: string
      ui:backstage: { review: { show: false } }
```

With `type: string` it stores the same object as a JSON string instead;
decode it with `roadiehq:utils:jsonata` (`$eval(claim)`). The review page then
shows the raw JSON.

```json
{
  "kind": "NativeProxmoxVM",
  "apiVersion": "resources.stuttgart-things.com/v1alpha1",
  "name": "sbx-labul-vm",
  "namespace": "default",
  "sourcePath": "clusters/labda/vsphere/machinery-xrs/sbx-labul.yaml",
  "managementCluster": "machinery"
}
```

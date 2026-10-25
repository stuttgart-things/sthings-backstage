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
```

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

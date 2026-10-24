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
  type: string
  ui:field: MachineryClaimPicker
  ui:options:
    # optional; default: every kind machinery watches
    kinds: [NativeVsphereVM, NativeProxmoxVM, ScheduledRun, MinioBucket]
    excludeKinds: [ClusterStack]
```

## Value

A JSON string; decode it in the consuming template, e.g. with
`roadiehq:utils:jsonata` (`$eval(claim)`):

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

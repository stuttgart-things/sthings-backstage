# External Access: Scaffolder Service Token

This page documents how to grant an external service (e.g. a Dapr workflow
worker) plugin-scoped access to the Backstage scaffolder + catalog APIs, how
to generate the required token, and **how to verify the setup** with a few
small curl commands.

## Quick test (TL;DR)

If the token is already provisioned and Backstage is running, these three
requests confirm the plumbing end-to-end:

```bash
export TOKEN="$EXTERNAL_ACCESS_TOKEN"          # or paste the raw value
export BACKSTAGE_URL="https://backstage.platform.sthings-vsphere.labul.sva.de"

# 1. Catalog read — should return 200 with the template entity JSON
curl -sS -k -o /tmp/tpl.json -w "catalog:   HTTP %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$BACKSTAGE_URL/api/catalog/entities/by-name/template/default/create-terraform-vm"

# 2. Scaffolder dry-run using the templateRef (needs catalog access)
curl -sS -k -o /tmp/dry.json -w "dry-run:   HTTP %{http_code}\n" \
  -X POST "$BACKSTAGE_URL/api/scaffolder/v2/dry-run" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"template": '"$(cat /tmp/tpl.json)"', "values": {}, "secrets": {}, "directoryContents": []}'

# 3. Plugin that is NOT in accessRestrictions — should return 403
curl -sS -k -o /dev/null -w "permission: HTTP %{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$BACKSTAGE_URL/api/permission/health"
```

Expected output:

```
catalog:   HTTP 200
dry-run:   HTTP 200
permission: HTTP 403
```

If you see HTTP 200 for (1) and (2) and HTTP 403 for (3), the token is live
and correctly restricted.

## 1. Configure `externalAccess` in `app-config.yaml`

Add a static external-access entry under `backend.auth`. The
`accessRestrictions` block limits the token to specific plugins so a leaked
token cannot reach permission, auth, or other backends.

```yaml
backend:
  auth:
    externalAccess:
      - type: static
        options:
          token: ${EXTERNAL_ACCESS_TOKEN}
          subject: dapr-workflow-service
        accessRestrictions:
          - plugin: scaffolder
          - plugin: catalog
```

- `token` — read from the `EXTERNAL_ACCESS_TOKEN` env var so the secret is
  not committed. In the flux deployment this comes from the
  `BACKSTAGE_EXTERNAL_ACCESS_TOKEN` substitution var (see
  [`stuttgart-things/flux/apps/backstage`](https://github.com/stuttgart-things/flux/tree/main/apps/backstage)).
- `subject` — identifier that shows up in audit logs as the caller.
- `accessRestrictions` — when set, the token is rejected by every plugin not
  listed here. Requests to restricted plugins return:
  `NotAllowedError: This token's access is restricted to plugin(s) 'scaffolder', 'catalog'`.

### Why both scaffolder *and* catalog?

The Dapr workflow worker needs **scaffolder** to create/poll template tasks
(`POST /api/scaffolder/v2/tasks`, `GET /api/scaffolder/v2/tasks/{id}`). It
additionally needs **catalog** to fetch the template entity inline for
`/api/scaffolder/v2/dry-run` — that endpoint requires the template body,
not just a `templateRef`. Without catalog access, dry-run returns:
`NotAllowedError: This token's access is restricted to plugin(s) 'scaffolder'`.

## 2. Generate the token

The static external-access handler accepts any high-entropy opaque string.
Pick something unguessable and at least 24 bytes of entropy.

```bash
# 32 random bytes, base64-encoded (recommended)
openssl rand -base64 32

# Alternatives
head -c 32 /dev/urandom | base64
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

### Local dev

Store the value in `.env` (gitignored) next to `app-config.yaml`:

```bash
# .env
EXTERNAL_ACCESS_TOKEN=c2Wc7O/7EAxNhMd9QoLoU1f93qMP8qy3
```

Restart the Backstage backend after changing `.env` — it is read at startup.

### Cluster deployment (flux)

Add the token to the SOPS-encrypted substitution secret:

```bash
sops clusters/labul/vsphere/platform-sthings/apps/backstage-secrets.enc.yaml
# add under stringData:
#   BACKSTAGE_EXTERNAL_ACCESS_TOKEN: <token>
```

Flux will then substitute it into the `backstage-secrets` Kubernetes Secret,
which is mounted into the pod as `EXTERNAL_ACCESS_TOKEN`.

## 3. Verify against a local backend

If you are running Backstage on `localhost:7007`, swap the URL in the Quick
test block above:

```bash
export BACKSTAGE_URL="http://localhost:7007"
# drop the -k flag, drop any -H Host header tricks
```

### Dry-run with a raw template file (no catalog involved)

If you want to test a template that isn't yet in the catalog, pass its body
inline. This is also the only option if the token is scoped to `scaffolder`
only (without `catalog`):

```bash
python3 - <<'PY'
import json, yaml, urllib.request, os

tmpl = yaml.safe_load(open(
    "backstage-resources/templates/flux-bootstrap/template.yaml"))

body = {
    "template": tmpl,
    "values": {
        "action": "check",
        "source_repo": "stuttgart-things/stuttgart-things",
        "kube_config": "secrets/kubeconfigs/sthings-infra.yaml",
    },
    "secrets": {},
    "directoryContents": [],
}

req = urllib.request.Request(
    "http://localhost:7007/api/scaffolder/v2/dry-run",
    data=json.dumps(body).encode(),
    headers={
        "Authorization": f"Bearer {os.environ['EXTERNAL_ACCESS_TOKEN']}",
        "Content-Type": "application/json",
    },
    method="POST",
)
print(urllib.request.urlopen(req).read().decode())
PY
```

### Reading the dry-run result

In the `log` array you will see one entry per step. For actions that do not
support dry-run (e.g. `github:actions:dispatch`) the log shows the resolved
inputs and then a `skipped` status:

```text
Running github:actions:dispatch in dry-run mode with inputs (secrets redacted): {
  "workflowId": "dispatch-flux-check.yaml",
  ...
}
Skipping because github:actions:dispatch does not support dry-run
```

That confirms:

1. The token authenticated against the scaffolder plugin.
2. The template parsed and conditional `if:` routing fired correctly.
3. The action would have been called with the rendered inputs.

## 4. Verify against the cluster

The same three requests work unchanged against the live deployment. The
Ingress uses a self-signed cert from the internal PKI, so pass `-k` to curl
(or import the cluster CA):

```bash
export BACKSTAGE_URL="https://backstage.platform.sthings-vsphere.labul.sva.de"
export TOKEN=$(kubectl get secret backstage-secrets -n backstage \
  -o jsonpath='{.data.EXTERNAL_ACCESS_TOKEN}' | base64 -d)

# Sanity check — the token should match what's in the SOPS secret
echo "Token length: ${#TOKEN}"

# 1. Catalog
curl -sS -k -w "\n%{http_code}\n" \
  -H "Authorization: Bearer $TOKEN" \
  "$BACKSTAGE_URL/api/catalog/entities/by-name/template/default/create-terraform-vm" \
  | tail -20
```

If that returns HTTP 200 with the template entity, the end-to-end chain is
working:

1. Flux substituted `BACKSTAGE_EXTERNAL_ACCESS_TOKEN` into `backstage-secrets`
2. The pod exposes it as `EXTERNAL_ACCESS_TOKEN` env var
3. Backstage loaded it into `backend.auth.externalAccess[].options.token`
4. The Ingress routed the request through to the backend
5. The backend accepted the Bearer token and applied the `catalog` access
   restriction

## 5. Common errors

| Symptom | Cause |
| --- | --- |
| `401 Missing credentials` | `Authorization` header not sent or token mismatch. |
| `403 NotAllowedError: ... restricted to plugin(s) 'scaffolder', 'catalog'` | Token works, but you hit a plugin not in the allow-list (e.g. `/api/permission/...`). Expected when `accessRestrictions` is set. |
| `500 /spec must have required property 'type'` | The `template` body in the dry-run request is missing required fields. Send the full template, including `spec.type` and `spec.owner`. |
| Token changes do not take effect | Restart the backend — `.env` is read at startup. In the cluster, rolling the pod after the Secret changes is required unless you use a reloader. |
| `ERR_JWKS_NO_MATCHING_KEY` in logs | Unrelated to external-access. This is a *user* JWT error from stale browser sessions against the signals plugin websocket — sign out + back in to clear. |

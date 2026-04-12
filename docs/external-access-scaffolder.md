# External Access: Scaffolder Service Token

This page documents how to grant an external service (e.g. a Dapr workflow worker)
plugin-scoped access to the Backstage scaffolder API, how to generate the required
token, and how to verify the setup with a scaffolder dry-run.

## 1. Configure `externalAccess` in `app-config.yaml`

Add a static external-access entry under `backend.auth`. The
`accessRestrictions` block limits the token to a single plugin so a leaked token
cannot reach the catalog or other backends.

```yaml
backend:
  auth:
    externalAccess:
      - type: static
        options:
          token: ${DAPR_SERVICE_TOKEN}
          subject: dapr-workflow-service
        # Optional but recommended: restrict to scaffolder plugin only
        accessRestrictions:
          - plugin: scaffolder
```

- `token` — read from the `DAPR_SERVICE_TOKEN` env var so the secret is not
  committed.
- `subject` — identifier that shows up in audit logs as the caller.
- `accessRestrictions` — when set, the token is rejected by every plugin not
  listed here. Catalog/auth/permission endpoints will return
  `NotAllowedError: This token's access is restricted to plugin(s) 'scaffolder'`.

## 2. Generate the token

The static external-access handler accepts any high-entropy opaque string. Pick
one that is unguessable and at least 24 bytes of entropy.

```bash
# 32 random bytes, base64-encoded (recommended)
openssl rand -base64 32

# Alternatives
head -c 32 /dev/urandom | base64
python3 -c 'import secrets; print(secrets.token_urlsafe(32))'
```

Store the value in `.env` (gitignored) next to `app-config.yaml`:

```bash
# .env
DAPR_SERVICE_TOKEN=c2Wc7O/7EAxNhMd9QoLoU1f93qMP8qy3
```

The same value must be configured on the calling service (the Dapr worker) so
it can send `Authorization: Bearer <token>` on every request.

Restart the Backstage backend after changing `.env` so the new value is loaded.

## 3. Verify with a scaffolder dry-run

The `/api/scaffolder/v2/dry-run` endpoint executes a template end-to-end without
side effects (`github:actions:dispatch` and similar actions are skipped
automatically). It is the safest way to confirm the token works and that a
template renders correctly.

Because the token is scaffolder-scoped, it **cannot** read templates from the
catalog API. Pass the template body inline instead.

### Minimal request

```bash
export TOKEN="$DAPR_SERVICE_TOKEN"

curl -sS -X POST http://localhost:7007/api/scaffolder/v2/dry-run \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @- <<'JSON'
{
  "template": {
    "apiVersion": "scaffolder.backstage.io/v1beta3",
    "kind": "Template",
    "metadata": { "name": "flux-bootstrap" },
    "spec": {
      "owner": "platform-team",
      "type": "service",
      "parameters": [],
      "steps": []
    }
  },
  "values": {},
  "secrets": {},
  "directoryContents": []
}
JSON
```

A successful response is HTTP 200 with a JSON body containing `log`, `steps`,
`output`, and `directoryContents`.

### Dry-running a real template from disk

For an existing template file, load it inline so the catalog is not involved:

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
        "Authorization": f"Bearer {os.environ['DAPR_SERVICE_TOKEN']}",
        "Content-Type": "application/json",
    },
    method="POST",
)
print(urllib.request.urlopen(req).read().decode())
PY
```

### Reading the result

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

## 4. Common errors

| Symptom | Cause |
| --- | --- |
| `401 Missing credentials` | `Authorization` header not sent or token mismatch. |
| `NotAllowedError: ... restricted to plugin(s) 'scaffolder'` | Token works, but you hit a non-scaffolder endpoint (e.g. `/api/catalog/...`). Expected when `accessRestrictions` is set. |
| `500 /spec must have required property 'type'` | The `template` body in the dry-run request is missing required fields. Send the full template, including `spec.type` and `spec.owner`. |
| Token changes do not take effect | Restart the backend — `.env` is read at startup. |

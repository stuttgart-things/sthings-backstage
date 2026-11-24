# AI clients (MCP)

The portal is an MCP server: Claude Code, Cursor, VS Code and other MCP
clients can ask it who owns a component, where it runs, what its docs say and
what a VM is doing right now. Built on
[Backstage MCP Actions](https://backstage.io/docs/ai/mcp-actions)
(`@backstage/plugin-mcp-actions-backend`). Tracking issue: #277.

**Read-only.** Until the portal has per-user login for MCP clients (needs the
New Frontend System, #277 phase 3), clients use a static token, and only
reading actions are offered.

## How it works

Backstage has no AI of its own. The AI is the client (Claude Code); the
portal only answers tool calls:

```text
you --question--> Claude (LLM) --MCP tool calls--> portal --> catalog DB / hypervisor API
                       ^                              |
                       +-------- JSON results --------+
```

1. On start the client asks the portal for its tools (`tools/list`): name,
   description and input schema of each, plus the server's `instructions`
   (`mcpActions` in the config). That is all the model knows about the portal,
   which is why the descriptions are written for a model.
2. For a question like "Which VMs on LabUL are stopped right now?" the model
   plans the calls itself, e.g. `vm-info.list-live-vms` for the provider
   `proxmox-labul` with `status: stopped`: one call, which asks the
   hypervisor for all 18 VMs. (Before that tool existed, the model made a
   catalog query plus one `vm-info.get-live-vm-info` per VM: 19 calls.)
3. The portal runs each call like any API request: checks the token, runs the
   action (a catalog query, or a live request to Proxmox/vSphere/Harvester with
   the portal's own credentials, cached 30 s) and returns JSON.
4. The model filters, combines and explains the results.

The AI does the understanding, the choice and chaining of tools and the
answer; the portal delivers facts. Anything else in an answer (e.g. why a VM
is stopped) comes from the client's own context, not from the portal, and
whatever the client offers to _change_ it does with other tools: the portal is
read-only.

## Tools

Endpoint: `<backend-url>/api/mcp-actions/v1` (Streamable HTTP), server name
`sthings-portal`.

| Tool                                    | What it does                                                  |
| --------------------------------------- | ------------------------------------------------------------- |
| `catalog.query-catalog-entities`        | find entities by kind, type, owner, … (filter + fields)       |
| `catalog.get-catalog-entity`            | one entity by name (kind/namespace optional)                  |
| `catalog.get-catalog-model-description` | what kinds and fields the catalog has                         |
| `catalog.validate-entity`               | check a `catalog-info.yaml` before committing it              |
| `search.query`                          | full-text search over catalog, TechDocs and announcements     |
| `techdocs.get-techdocs-metadata`        | site name and build info of an entity's docs                  |
| `vm-info.get-live-vm-info`              | live state of a VM from the hypervisor (status, uptime, IPs…) |
| `vm-info.list-live-vms`                 | live state of every VM of one provider, optionally by status  |

Where they come from (`app-config.yaml`):

```yaml
backend:
  actions:
    pluginSources: [catalog, search, techdocs, vm-info]
    filter:
      include:
        - attributes:
            readOnly: true
```

`filter` is global: it also applies to the default path
`/api/mcp-actions/v1`, which otherwise serves every registered action.
`catalog.register-entity` and `catalog.unregister-entity` are dropped by it.
`vm-info.get-live-vm-info` and `vm-info.list-live-vms` are our own actions
(`plugins/catalog-backend-module-sthings-vms/src/vmInfo.ts`).
`list-live-vms` takes a provider id (the part after `sthings-vms:` in a VM's
`backstage.io/managed-by-location`, e.g. `proxmox-labul`); its description
lists the providers the instance can ask live. It asks at most 4 VMs at a
time, at most 100 per call, and lists a VM it could not ask with
`found: false` and the reason, also when filtering by status.

## Token

Clients send `Authorization: Bearer <token>`. One static token per instance,
configured next to the Dapr token. The instance's `externalAccess` list
replaces the one of `app-config.yaml`, so it lists both:

```yaml
backend:
  auth:
    externalAccess:
      - type: static # existing Dapr worker token
        options:
          token: ${DAPR_SERVICE_TOKEN}
          subject: dapr-workflow-service
        accessRestrictions:
          - plugin: scaffolder
          - plugin: catalog
      - type: static
        options:
          token: ${MCP_TOKEN} # at least 8 characters
          subject: mcp-clients
        accessRestrictions:
          - plugin: mcp-actions
          - plugin: catalog
          - plugin: search
          - plugin: techdocs
          - plugin: vm-info
```

Generate a token: `node -p 'require("crypto").randomBytes(24).toString("base64")'`.

**What the token can do.** The token makes the client a _service_, and our
permission policy only decides for users. So the token is not limited by
template audience or private orders, only by its `accessRestrictions`:

- It reads what platform-team reads, including private machinery orders
  and platform-only templates. **Hand it to platform-team only.**
- `accessRestrictions` work per plugin. Restricting a plugin further with
  `permission` or `permissionAttribute` makes MCP fail ("restricted and cannot
  be delegated"), because the MCP plugin calls the other plugins on behalf of
  the token.
- So every plugin listed is reachable through its whole REST API, not only
  through the tools. That is why kubernetes (its proxy can write to clusters),
  scaffolder (runs templates) and announcements (publishes) are **not**
  listed. The catalog is: with the token, locations can be registered and
  entities deleted through `/api/catalog`. Provider entities come back on the
  next run, entities from Git on the next refresh of their location.

How the labs got their tokens: [Rolling it out to an
instance](#rolling-it-out-to-an-instance).

## Rolling it out to an instance

The instances load only their mounted config files, never the image's
`app-config.yaml`. An instance therefore needs **all** of the following in its
own config, not only the token. This is how LabDA and LabUL got it
(stuttgart-things#4884, #4886).

### 1. One token per instance, stored twice

The client copy goes to `~/.secrets.d/<lab>/backstage.env` (sops dotenv, read
with `sops exec-env`), the server copy to the instance's
`backstage-secrets.enc.yaml` in the stuttgart-things Flux repo. The plain
token only lives in a shell variable and, for the moment of the encryption, in
a file in `/dev/shm`:

```bash
cd ~/projects/stuttgart-things
LAB=labul
URL=https://<portal-host>/api/mcp-actions/v1
SECRET=clusters/labul/vsphere/platform-sthings/apps/backstage-secrets.enc.yaml
# LabDA: LAB=labda, SECRET=clusters/labda/vsphere/sthings-platform/backstage-secrets.enc.yaml

R=$(grep -h '^sops_age__list_0__map_recipient=' ~/.secrets.d/$LAB/*.env | head -1 | cut -d= -f2)
T=$(node -p 'require("crypto").randomBytes(24).toString("base64")')

umask 077; P=$(mktemp /dev/shm/mcp.XXXX.env)
printf 'BACKSTAGE_MCP_TOKEN=%s\nBACKSTAGE_MCP_URL=%s\n' "$T" "$URL" > "$P"
sops encrypt --age "$R" --input-type dotenv --output-type dotenv "$P" > ~/.secrets.d/$LAB/backstage.env
shred -u "$P"

sops set "$SECRET" '["stringData"]["BACKSTAGE_MCP_TOKEN"]' "\"$T\""
unset T
```

Check without printing the value (expect `token-len=32`):

```bash
sops exec-env ~/.secrets.d/$LAB/backstage.env 'echo "$BACKSTAGE_MCP_URL token-len=${#BACKSTAGE_MCP_TOKEN}"'
```

`BACKSTAGE_MCP_TOKEN` is not set in your shell afterwards (`echo` prints
nothing); it only exists inside `sops exec-env`.

### 2. Config of the instance, in the same Flux PR as the secret

- **Secret into the pod:** `MCP_TOKEN: $${BACKSTAGE_MCP_TOKEN:-}` in the
  `backstage-secrets` `secretKVs` patch of the instance's `apps/platform.yaml`.
- **Token:** the `mcp-clients` entry from [Token](#token) in the instance's
  `externalAccess` list. That list replaces the one of `backstage-app-config`,
  so it restates the Dapr entry. LabUL: `backstage-vms-config` in
  `backstage-prereqs.yaml` (also has the radio token). LabDA: its own ConfigMap
  `backstage-mcp-config`, mounted through `extraAppConfig`.
- **Actions:** `backend.actions` (`pluginSources` and the read-only `filter`)
  and `mcpActions` from `app-config.yaml`, in the same ConfigMap. Without
  `pluginSources` the server starts, accepts the token and answers
  `tools/list` with **no tools**, without any error in the log.

Secret and config belong in **one** PR: Flux substitutes a missing key with
an empty string, and Backstage does not start with an empty token ("Illegal
token").

### 3. Roll out and check

A changed ConfigMap does not restart the pod. After the reconcile:

```bash
kubectl --kubeconfig ~/.kube/<cluster> -n <namespace> rollout restart deploy/backstage-deployment
```

Then check the instance without the token showing up anywhere. Put this in a
script, e.g. `mcp-check.sh`:

```bash
#!/bin/bash
H='Content-Type: application/json'; A='Accept: application/json, text/event-stream'
B='{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
echo "no token: $(curl -sk -o /dev/null -w '%{http_code}' -X POST "$BACKSTAGE_MCP_URL" -H "$H" -H "$A" -d "$B")"
curl -sk -X POST "$BACKSTAGE_MCP_URL" -H "Authorization: Bearer $BACKSTAGE_MCP_TOKEN" -H "$H" -H "$A" -d "$B" \
  | sed -n 's/^data: //p' | jq -r '.result.tools[].name'
```

and run it with the instance's token:

```bash
sops exec-env ~/.secrets.d/$LAB/backstage.env ./mcp-check.sh
```

Expected: `no token: 401` and the eight tools of [Tools](#tools). A tool
missing from the list usually means its plugin is missing from the token's
`accessRestrictions`; the backend then logs
`Failed to fetch actions from <plugin>`.

## Claude Code

Add each instance once, for all projects (`-s user`), with the token from
`~/.secrets.d`:

```bash
sops exec-env ~/.secrets.d/labul/backstage.env 'claude mcp add -s user --transport http sthings-portal-labul "$BACKSTAGE_MCP_URL" --header "Authorization: Bearer $BACKSTAGE_MCP_TOKEN"'
sops exec-env ~/.secrets.d/labda/backstage.env 'claude mcp add -s user --transport http sthings-portal-labda "$BACKSTAGE_MCP_URL" --header "Authorization: Bearer $BACKSTAGE_MCP_TOKEN"'
claude mcp list | grep sthings-portal   # both: ✔ Connected
```

The tools are there in the **next** Claude Code session; `/mcp` lists them.
Then ask, for example: "Which VMs on LabUL are stopped right now?", "Who owns
homerun2-core-catcher and where are its docs?", "Is
machinery-labul-proxmox-vm running, and what is its IP?". With both instances
added, say which lab you mean.

What went wrong on the way:

| Symptom                                     | Cause and fix                                                                                                                                                                            |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `already exists in local config`            | An earlier `claude mcp add` without `-s` added it for that directory only. `claude mcp remove <name> -s local`, then add with `-s user`.                                                 |
| `already exists in user config`             | It is there already; `claude mcp get <name>` shows URL and scope.                                                                                                                        |
| `✘ Failed to connect … 401 … Illegal token` | Wrong header. A `#` glued to the closing quote (`…TOKEN"'#`) is not a comment but part of the argument, so the header ended in `#`. `claude mcp remove <name> -s user` and add it again. |
| connected, but no tools                     | `backend.actions` missing in the instance's config, see [step 2](#2-config-of-the-instance-in-the-same-flux-pr-as-the-secret).                                                           |

`claude mcp add --header` stores the header in plain text in `~/.claude.json`
(the CLI only shows it as `[REDACTED]`). To keep it out of there, use a
`.mcp.json` with a variable and start Claude Code inside `sops exec-env`:

```json
{
  "mcpServers": {
    "sthings-portal-labul": {
      "type": "http",
      "url": "https://<portal-host>/api/mcp-actions/v1",
      "headers": { "Authorization": "Bearer ${BACKSTAGE_MCP_TOKEN}" }
    }
  }
}
```

**Rotating a token:** run step 1 again (new value in both places), merge,
reconcile, `rollout restart`, then `claude mcp remove` and `add` with the new
value. The old token stops working with the restart.

A `portal` plugin for the
[claude-plugins](https://github.com/stuttgart-things/claude-plugins)
marketplace with this server and matching skills is phase 2 of #277.

## Catalog: AI resources

`@backstage/plugin-catalog-backend-module-ai-model` adds the kind
`AiResource` (`spec.type: skill` or `rule`) and the API type `mcp-server`
([AI in the catalog](https://backstage.io/docs/ai/ai-in-the-catalog)).
Locations that should provide them need `AiResource` in their allowed kinds
(`catalog.rules` of the instance).

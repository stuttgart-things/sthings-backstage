# AI clients (MCP)

The portal is an MCP server: Claude Code, Cursor, VS Code and other MCP
clients can ask it who owns a component, where it runs, what its docs say and
what a VM is doing right now. Built on
[Backstage MCP Actions](https://backstage.io/docs/ai/mcp-actions)
(`@backstage/plugin-mcp-actions-backend`). Tracking issue: #277.

**Read-only.** Until the portal has per-user login for MCP clients (needs the
New Frontend System, #277 phase 3), clients use a static token, and only
reading actions are offered.

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
`vm-info.get-live-vm-info` is our own action
(`plugins/catalog-backend-module-sthings-vms/src/vmInfo.ts`).

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

Rotate the token by changing the secret and restarting the instance.

## Claude Code

```bash
claude mcp add --transport http sthings-portal \
  https://<portal-host>/api/mcp-actions/v1 \
  --header "Authorization: Bearer $BACKSTAGE_MCP_TOKEN"
```

or in `.mcp.json`:

```json
{
  "mcpServers": {
    "sthings-portal": {
      "type": "http",
      "url": "https://<portal-host>/api/mcp-actions/v1",
      "headers": { "Authorization": "Bearer ${BACKSTAGE_MCP_TOKEN}" }
    }
  }
}
```

Then ask, for example: "Who owns homerun2-core-catcher and where are its
docs?", "Which VMs on LabUL are stopped?", "Is the k3s-node1 VM running right
now, and what is its IP?".

A `portal` plugin for the
[claude-plugins](https://github.com/stuttgart-things/claude-plugins)
marketplace with this server and matching skills is phase 2 of #277.

## Check by hand

```bash
U=https://<portal-host>/api/mcp-actions/v1
curl -s -X POST $U -H "Authorization: Bearer $BACKSTAGE_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

A tool missing from the list usually means its plugin is missing from the
token's `accessRestrictions`: the backend logs
`Failed to fetch actions from <plugin>`.

## Catalog: AI resources

`@backstage/plugin-catalog-backend-module-ai-model` adds the kind
`AiResource` (`spec.type: skill` or `rule`) and the API type `mcp-server`
([AI in the catalog](https://backstage.io/docs/ai/ai-in-the-catalog)).
Locations that should provide them need `AiResource` in their allowed kinds
(`catalog.rules` of the instance).

# Permissions: who sees which template

The backend replaces the allow-all policy with one rule about **Templates**.
Everything else is allowed, as before.

| Caller | Sees and can run |
|---|---|
| A member of `group:default/platform-team` | every template |
| Anyone else, including guest | only templates annotated `backstage.stuttgart-things.com/audience: developers` |
| A service principal, e.g. the Dapr worker's static token | every template — policies are not consulted for service principals |

Code: [`packages/backend/src/plugins/permission-template-audience`](../packages/backend/src/plugins/permission-template-audience).

## Opening a template to developers

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: request-vm
  annotations:
    backstage.stuttgart-things.com/audience: developers
```

It is an allowlist: a template without the annotation is platform-only. A new
template therefore starts hidden from developers until someone decides it is
meant for them.

## How it works

The policy decides only `catalog.entity.read`:

- platform groups get `ALLOW`
- everyone else gets a conditional decision: *not a Template*, **or** *has the
  audience annotation*

That one permission covers seeing **and** running. The Create page lists
templates through the catalog, and the scaffolder loads a task's template with
the caller's own credentials — a template the caller cannot read is "not
found" when they try to start it, including through the API.

Membership comes from the Backstage token's ownership refs, which the GitHub
sign-in resolver (`usernameMatchingUserEntityName`) derives from the User
entity's group relations in the org catalog. A user who signs in must have a
User entity; to make someone a developer, add a User that is not a member of
`platform-team`.

## Configuration

```yaml
permission:
  enabled: true
  templateAudience:
    # optional, default: [group:default/platform-team]
    platformGroups:
      - group:default/platform-team
```

## Service principals

`backend.auth.externalAccess` tokens (such as `dapr-workflow-service`) are
service principals. `ServerPermissionClient` decides them itself: allowed,
unless the token's `accessRestrictions` limit `permission` or
`permissionAttribute`. The Dapr worker, which runs platform templates like
`create-terraform-vm` on a developer's behalf, is therefore unaffected.

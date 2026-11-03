# Permissions: platform users and developers

The backend replaces the allow-all policy with a policy that separates the
platform groups from everyone else.

| Caller | Gets |
|---|---|
| A member of `group:default/platform-team` | everything |
| Anyone else, including guest | the developer rules below |
| A service principal, e.g. the Dapr worker's static token | everything -- policies are not consulted for service principals |

Code: [`packages/backend/src/plugins/permission-template-audience`](../packages/backend/src/plugins/permission-template-audience).

## Developer rules

| Permission | Developers |
|---|---|
| `catalog.entity.read` | every entity, except Templates without `backstage.stuttgart-things.com/audience: developers` |
| `scaffolder.task.read`, `scaffolder.task.cancel` | only tasks they started themselves |
| `catalog.entity.create`, `catalog.location.create` | denied -- no catalog import, no registering |
| `catalog.entity.delete`, `catalog.location.delete` | denied -- no unregistering |
| `scaffolder.template.management` | denied -- no template editor or dry-run (`/create/edit`) |
| `kubernetes.proxy` | denied |
| everything else (`scaffolder.task.create`, `scaffolder.action.execute`, `catalog.entity.refresh`, `kubernetes.resources.read`, ...) | allowed |

A caller without a user ref (no sign-in) gets no tasks at all.

**`catalog:register` in developer templates:** the scaffolder runs that
action with the caller's credentials, so it needs `catalog.location.create`.
A template opened to developers must therefore not register entities itself;
leave that to a worker step or to catalog discovery.

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

## How template visibility works

`catalog.entity.read` covers seeing **and** running. The Create page lists
templates through the catalog, and the scaffolder loads a task's template with
the caller's own credentials -- a template the caller cannot read is "not
found" when they try to start it, including through the API.

Membership comes from the Backstage token's ownership refs, which the GitHub
sign-in resolver (`usernameMatchingUserEntityName`) derives from the User
entity's group relations in the org catalog. With Zitadel sign-in, the
`zitadelProjectRoles` resolver adds the groups the user's Zitadel project roles
map to ([zitadel.md](zitadel.md)). A user who signs in must have a
User entity; to make someone a developer, add a User that is not a member of
`platform-team`. Group membership is not inherited: a member of only
`team-infrastructure` (a child of `platform-team`) is not a platform user
unless `team-infrastructure` is listed in `platformGroups`.

## Beta tracks

A beta track is one workflow under test, released to a few test users before
it goes to every developer -- e.g. `vm-machinery`: order, resize and delete a
VM on machinery, and see it with its status under Owned.

| Piece | Value |
|---|---|
| Template annotation | `backstage.stuttgart-things.com/beta-track: <track>` |
| Zitadel project role | `backstage-beta-<track>` |
| Group the resolver grants | `group:default/beta-<track>` |

- Members of `beta-<track>` also see the templates of that track.
- A beta tester **without** a developer group (`developerGroups`, default
  `group:default/guests`) sees only the templates of their tracks -- not the
  general `audience: developers` ones. A test user with just the track role
  sees exactly the workflow under test.
- Everything else (own tasks only, no catalog import/unregister, no DevTools)
  is the same as for developers.
- Releasing a track's template to everyone: set
  `backstage.stuttgart-things.com/audience: developers`.

Team roles work the same way: `backstage-team-<team>` grants
`group:default/<team>`, a group that can own ordered resources.

## Orders are private

Orders (`Resource`s of `spec.type: machinery-order`, from the sthings-vms
provider's `type: machinery`) are readable only by their owner -- the user
they were ordered for, or every member of the owning group -- and by
platform-team. Everyone else neither finds them in the catalog nor opens them
by URL. The types are `PRIVATE_RESOURCE_TYPES` in the policy.

The live VM entities (`*-vsphere-vm`, `*-proxmox-vm`) stay readable for all:
they mirror the inventory, not who ordered what.

## Guest sign-in

Guest counts as a developer, so with guest enabled anyone can run developer
templates without a login. It is on by default for local development and
switched off with one env var, which drives both halves:

| `AUTH_GUEST_ENABLED` | Backend | SignInPage |
|---|---|---|
| unset or `true` | loads `auth-backend-module-guest-provider` | shows the guest button (`app.auth.guestEnabled`) |
| `false` | no guest provider | no guest button |

Set `AUTH_GUEST_ENABLED=false` in every deployment that is reachable by more
than the person running it.

## Configuration

```yaml
permission:
  enabled: true
  templateAudience:
    # optional, default: [group:default/platform-team]
    platformGroups:
      - group:default/platform-team
    # optional, default: [group:default/guests] -- the groups that let a beta
    # tester also see the general developer templates
    developerGroups:
      - group:default/guests
```

## Service principals

`backend.auth.externalAccess` tokens (such as `dapr-workflow-service`) are
service principals. `ServerPermissionClient` decides them itself: allowed,
unless the token's `accessRestrictions` limit `permission` or
`permissionAttribute`. The Dapr worker, which runs platform templates like
`create-terraform-vm` on a developer's behalf, is therefore unaffected.

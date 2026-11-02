# Zitadel sign-in: roles decide platform or developer

With `AUTH_OIDC_ENABLED=true`, the backend loads
[`packages/backend/src/plugins/auth-zitadel`](../packages/backend/src/plugins/auth-zitadel):
the upstream OIDC authenticator, registered as provider `oidc`, plus the
sign-in resolver `zitadelProjectRoles`.

The resolver turns the user's Zitadel **project roles** into Backstage groups
and puts them into the token's ownership refs. The
[permission policy](permissions.md) reads exactly those refs, so Zitadel decides
who is platform and who is developer. The membership is not kept a second time
in `org.yaml`.

| Zitadel role (default) | Backstage group | Policy |
|---|---|---|
| `backstage-platform` | `group:default/platform-team` | everything |
| `backstage-developer` | `group:default/guests` | developer rules |
| `backstage-beta-<track>` | `group:default/beta-<track>` | the track's templates ([beta tracks](permissions.md#beta-tracks)) |
| `backstage-team-<team>` | `group:default/<team>` | none by itself; the group can own ordered resources |
| no mapped role | -- | sign-in refused |

## What the resolver does

1. It collects the role names from the ID token and the userinfo response,
   under `urn:zitadel:iam:org:project:roles` and
   `urn:zitadel:iam:org:project:<projectId>:roles`. With `projectId` set, it
   reads only that project's claim.
2. It maps them through `roleGroups`, then by prefix (`backstage-beta-`,
   `backstage-team-`; the rest must be a valid entity name). If no role maps
   and `requireRole` is
   true (the default), the sign-in is refused.
3. The username is `preferred_username` without the login domain
   (`mcfly@sthings.zitadel...` becomes `mcfly`).
4. If there is a User entity with that name, the token gets that entity's ref,
   the groups the catalog gives it, and the role groups.
   Otherwise:
   - with `dangerouslyAllowSignInWithoutUserInCatalog: true`, the token is
     `user:default/<username>` plus the role groups
   - without it, the sign-in is refused

## Configuration

**The instances do not read `app-config.yaml` from the image.** The chart
starts Backstage with the mounted config files only, so this block belongs in
flux `backstage-app-config`, or for LabUL/LabDA, until their flux pin includes
it, in the bridge ConfigMap. The block in `app-config.yaml` applies to local
runs only.

```yaml
app:
  auth:
    oidcEnabled: true           # shows the Zitadel button (frontend)

auth:
  providers:
    oidc:
      development:              # the key matches auth.environment
        metadataUrl: ${ZITADEL_ISSUER}   # https://<zitadel>, discovery is appended
        clientId: ${ZITADEL_CLIENT_ID}
        clientSecret: ${ZITADEL_CLIENT_SECRET}
        prompt: auto
        signIn:
          resolvers:
            - resolver: zitadelProjectRoles
              # optional, default as in the table above
              roleGroups:
                backstage-platform: group:default/platform-team
                backstage-developer: group:default/guests
              # optional: only this project's roles count
              # projectId: "311234567890123456"
              # optional, default true
              # requireRole: true
              dangerouslyAllowSignInWithoutUserInCatalog: true
```

The backend loads the module only with the env var `AUTH_OIDC_ENABLED=true`.
In flux it has to be quoted like `BACKSTAGE_AUTH_GUEST_ENABLED` (`"true"`),
otherwise kustomize turns it into a bool.

## Zitadel requirements

On the Backstage project (Terraform `zitadel-config`, see
stuttgart-things/sthings-backstage#200):

- Roles `backstage-platform` and `backstage-developer`
- `project_role_assertion = true`, so the roles are in the token at all
- `project_role_check = true`, so Zitadel refuses a user without a role
  before the login reaches Backstage
- On the OIDC app: roles and userinfo in the ID token
  (`id_token_role_assertion`, `id_token_userinfo_assertion`)
- Redirect URI `https://<backstage>/api/auth/oidc/handler/frame`
- User grants with one of the two roles

## Checking a sign-in

- With a role, the sign-in works. Under `/settings`, the ownership refs list
  `group:default/platform-team` or `group:default/guests`.
- Without a role, Zitadel refuses (role check). If the check is off, Backstage
  answers "No Backstage role in Zitadel (roles: ...)".
- `backend` logs: a refused sign-in names the roles it found.

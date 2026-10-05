# The Plugins Folder

Our own Backstage plugins and modules live here, one workspace package per
folder (#120). The backend picks them up via `workspace:^` dependencies, so
there is nothing to copy.

| Package                                                                      | What                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------- |
| [`catalog-backend-module-sthings-vms`](./catalog-backend-module-sthings-vms) | Entity provider: VM inventories (Proxmox) → catalog |

The older plugins under `packages/backend/src/plugins/` (claim-machinery,
claim-registry, yaml-utils, template-audience) will move here one by one.

## New plugin

Run `yarn new` in the repo root and follow the prompts. Name the package
`@stuttgart-things/backstage-plugin-<id>` and add a `publishConfig` with
`"registry": "https://npm.pkg.github.com"`, like the existing ones.

## Publishing

`.github/workflows/publish-plugins.yaml` publishes to GitHub Packages
(npm, scope `@stuttgart-things`). Bump `version` in the plugin's
`package.json`, merge, then tag `<folder>@<version>`:

```bash
git tag catalog-backend-module-sthings-vms@0.1.0
git push origin catalog-backend-module-sthings-vms@0.1.0
```

Running the workflow by hand defaults to a dry run (pack only).

## Consuming from another Backstage instance

GitHub Packages needs a token with `read:packages`, even for public packages.
In the consuming repo's `.yarnrc.yml`:

```yaml
npmScopes:
  stuttgart-things:
    npmRegistryServer: https://npm.pkg.github.com
    npmAuthToken: ${GITHUB_PACKAGES_TOKEN}
```

Then `yarn workspace backend add @stuttgart-things/backstage-plugin-<id>` and
pin the version, instead of copying files from a distribution repo.

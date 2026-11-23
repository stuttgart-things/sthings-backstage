# Integration into the portal

How other repositories and teams bring their own content into the portal:
catalog entities, TechDocs, templates, claims, offerings, announcements and,
for data that lives outside Git, an entity provider of their own.

| I want to …                                | Put it in …                                                                   | Section                                                     |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| show my service, API or resource           | a `catalog-info.yaml` in my repo, registered in the catalog index             | [Register entities](#register-entities)                     |
| publish docs for it                        | `mkdocs.yml` + `docs/` in the same repo, one annotation                       | [Contribute TechDocs](#contribute-techdocs)                 |
| offer a form that creates something        | a Scaffolder template, registered like an entity                              | [Templates](#templates)                                     |
| offer infrastructure as a Crossplane claim | a `ClaimTemplate` next to the KCL module, listed in a Claim Machinery profile | [Claims](#claims)                                           |
| appear on `/offerings`                     | a `Resource` of type `offering`                                               | [Offerings and announcements](#offerings-and-announcements) |
| mirror an inventory that is not in Git     | a catalog backend module (entity provider)                                    | [Your own entity provider](#your-own-entity-provider)       |

## Register entities

### catalog-info.yaml

One file at the root of the repository, one or more entities in it:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: homerun2-core-catcher # unique per kind and namespace, see Conventions
  title: homerun2 core catcher # optional, shown instead of the name
  description: Receives events and stores them in Redis
  annotations:
    github.com/project-slug: stuttgart-things/homerun2-core-catcher
    backstage.io/source-location: url:https://github.com/stuttgart-things/homerun2-core-catcher
    backstage.io/techdocs-ref: dir:. # only if the repo has TechDocs
  tags: [homerun2, golang]
  links:
    - url: https://github.com/stuttgart-things/homerun2-core-catcher
      title: GitHub
      icon: github
spec:
  type: service
  lifecycle: production # experimental | production | deprecated
  owner: group:default/platform-team
  system: homerun2 # optional, groups components on the System page
```

**Kinds.** The catalog accepts `Component`, `System`, `API`, `Resource`,
`Location` and `Template` from any registered file. `User` and `Group` come
only from the org file (`backstage-resources/org/sthings-dev/org.yaml`);
`Domain` only from the stuttgart-things monorepo. A kind that is not allowed
for its location is **dropped with nothing but a warning in the backend log**:
if an entity does not show up, check the kind first.

**Types.** `spec.type` is free text, but these have a label and an icon in the
catalog (`packages/app/src/components/catalog/entityTypes.tsx`): `service`,
`website`, `library`, `documentation`, `openapi` (APIs), `database`,
`resource`, `vm`, `vm-template`, `kubernetes-cluster`, `machinery-order`,
`offering`. Reuse one of them before inventing a new type; a new type is
shown as written until someone adds its label there.

**Owner.** A group from the org file, written as a full ref:
`group:default/platform-team`, `group:default/team-infrastructure`,
`group:default/hill-valley`. A `user:` owner works but makes the entity
disappear from "Owned" for the rest of the team.

**Annotations.** None is strictly required. Without
`github.com/project-slug` the CI/CD and Pull Requests tabs are empty, without
`backstage.io/techdocs-ref` there is no Docs tab.

### Making the catalog read it

There is **no GitHub discovery**: the catalog reads exactly the files that are
registered somewhere. Two ways, the first one preferred:

1. **Catalog index (reviewed, survives a database reset).** Add the URL of the
   file to a `Location` in
   [`backstage-resources/services/sthings-dev/catalog-index.yaml`](https://github.com/stuttgart-things/backstage-resources/blob/main/services/sthings-dev/catalog-index.yaml)
   and open a pull request. Both portal instances load that index. Use the
   `blob/main/…` URL of the file:

   ```yaml
   spec:
     type: url
     targets:
       - https://github.com/stuttgart-things/homerun2-core-catcher/blob/main/catalog-info.yaml
   ```

   Files in the stuttgart-things monorepo are registered the same way through
   its root `catalog-info.yaml`, which fans out to child Locations.

2. **Register Existing Component** (`/catalog-import`, platform-team) for a
   quick test. The location lives only in the portal's database.

Not in `app-config.yaml`: the deployed instances load only their mounted
config files, never the image's `app-config.yaml`, so a location added there
never reaches them.

Changes to a registered file show up after the next refresh, usually within a
few minutes. A YAML error or a rejected entity is listed under
**DevTools → Unprocessed Entities** (platform-team).

## Contribute TechDocs

The portal builds TechDocs itself when someone opens the Docs tab (builder
`local`; `mkdocs`, `mkdocs-material` and `mkdocs-techdocs-core` are in the
image). No CI job and no bucket are needed.

1. `mkdocs.yml` at the root of the repository:

   ```yaml
   site_name: homerun2-core-catcher
   nav:
     - Home: index.md
     - Configuration: configuration.md
   plugins:
     - techdocs-core
   ```

2. Markdown under `docs/`, at least `docs/index.md`.
3. The annotation on the entity whose Docs tab shows them:
   `backstage.io/techdocs-ref: dir:.` (relative to the `catalog-info.yaml`).

Only the plugins above are installed; an `mkdocs.yml` that lists another
plugin (e.g. `mermaid2`) fails to build. Docs are cached in the pod and
rebuilt when the source changed.

## Templates

A Scaffolder template is an entity of kind `Template` and is registered like
any other file. The templates of the platform live in
`stuttgart-things/backstage/templates/` (monorepo, listed in
`backstage/templates/catalog-info.yaml`) and
`backstage-resources/templates/` (listed in the catalog index).

- **Who sees it.** Templates are platform-only by default. Add
  `backstage.stuttgart-things.com/audience: developers` to `metadata.annotations`
  to make a template visible to developers and guests
  ([Permissions](permissions.md)).
- **Where it is listed on `/create`.** Grouped from what the template already
  carries (`packages/app/src/scaffolder/templateGroups.ts`): `spec.type:
worker-step` → Worker steps; `audience: developers` → Self-Service; tag
  `golang`/`microservice` → Services; tag `vm`/`packer` → VMs & Images;
  everything else → Clusters & GitOps.
- **Linking to it.** `/create/templates/default/<template-name>` opens the form
  directly, e.g. from an offering button (`portal:/create/templates/default/create-vm`).

## Claims

Crossplane claims are ordered through Claim Machinery
([Claim Machinery Plugin](claim-machinery-plugin.md)). The portal does not know
the claim templates itself; it asks the Claim Machinery API for them. To offer
a new claim:

1. Write a `ClaimTemplate` (`apiVersion: resources.stuttgart-things.com/v1alpha1`)
   next to its KCL module in
   [stuttgart-things/kcl](https://github.com/stuttgart-things/kcl), under
   `<module>/templates/<name>.yaml`.
2. Add its raw URL to the profile of the Claim Machinery instance that should
   offer it, e.g. `claim-machinery-api/profiles/machinery.yaml`.
3. Once that instance runs with the updated profile, the claim appears in the
   Claim Machinery picker of every template that uses one (e.g. `create-xrs-pr`).

## Offerings and announcements

- **Offerings** (`/offerings`) are catalog entities: a `Resource` with
  `spec.type: offering` and three annotations for group, order and icon. Keep
  them in your repository and register the file like any other. Schema and
  examples: [Offerings](offerings.md). Links into the portal are written as
  `portal:/path`, because the catalog accepts only absolute URLs in
  `metadata.links`.
- **Announcements** (platform news, banner on the home page) are written in
  the portal under **Announcements**; publishing is limited to platform-team.
  See [Announcements](announcements.md).

## Your own entity provider

When the source of truth is an API and not a Git file (a hypervisor, a
cluster, an order system), a catalog backend module keeps entities in sync
with it. [`plugins/catalog-backend-module-sthings-vms`](https://github.com/stuttgart-things/sthings-backstage/tree/main/plugins/catalog-backend-module-sthings-vms)
is the worked example: VMs from Proxmox, vSphere and Harvester, orders from
machinery, and live facts for existing cluster entities.

**Shape of a provider** (files in that package):

| Part            | In sthings-vms          | What it does                                                                              |
| --------------- | ----------------------- | ----------------------------------------------------------------------------------------- |
| Source          | `sources/proxmox.ts`, … | Talks to the API, returns plain records (`VmRecord`); no Backstage types.                 |
| Mapping         | `entity.ts`             | Record → entity: stable name, owner/system from config, annotations under its own prefix. |
| Entity provider | `provider.ts`           | `applyMutation({ type: 'full' })` with all entities on every run.                         |
| Module          | `module.ts`             | Reads config, creates one provider per entry, schedules `refresh()`.                      |
| Config schema   | `config.d.ts`           | Documents the keys; secrets marked `@visibility secret`.                                  |

Rules that saved us trouble:

- **Full mutation, and fail before it.** A full mutation replaces everything
  the provider owns, so an entity that disappears from the source disappears
  from the catalog. If the source fails, throw **before** `applyMutation`;
  otherwise an empty result wipes the entities.
- **One provider name per config entry** (`sthings-vms:<providerId>`). It is
  the entity's `backstage.io/managed-by-location`, which is also how other
  code finds the provider of an entity (the live VM card does).
- **Entity names must not change** between runs, or every run deletes and
  recreates entities and breaks relations. Derive them from something stable
  (`<vm>-<cloud>-vm`), not from a display name that people edit.
- **Facts for entities that already exist** (e.g. a `kubernetes-cluster`
  written by hand) are a catalog _processor_ instead of a provider: it adds
  annotations to the entity during processing and owns nothing
  (`SthingsClusterProcessor` in `cluster.ts`).
- **Live data** that must not wait for the next run belongs in a small backend
  plugin that reuses the same config and credentials (`vmInfo.ts`, route
  `/api/vm-info`), not in more frequent refreshes.
- **Log the reason.** The scheduler logs a failed task as `{}`; catch and log
  the error message yourself (`module.ts`).

A module in this repository is a workspace package under `plugins/`, added in
`packages/backend/src/index.ts` with `backend.add(import('…'))`. When adding
`@backstage/*` dependencies, pin them to the versions of `backstage.json`
so yarn does not pull a second set of core packages.

## Conventions

**Entity names.** Lowercase, `-` separated, at most 63 characters, unique per
kind. Suffix generated entities with what they are when the plain name could
clash: `<vm>-<cloud>-vm`, `offering-<topic>`.

**Annotations.** Our own annotations use `<area>.stuttgart-things.com/<key>`,
one area per producer, so it is clear who writes a value:

| Prefix                                                      | Written by                                                                 |
| ----------------------------------------------------------- | -------------------------------------------------------------------------- |
| `backstage.stuttgart-things.com/`                           | the portal and its templates (`audience`, `offering-*`, `requested-by`, …) |
| `vm.stuttgart-things.com/`                                  | sthings-vms, every VM source (`status`, `cpus`, `memory-mib`, `os`)        |
| `proxmox.` / `vsphere.` / `harvester.stuttgart-things.com/` | sthings-vms, one source each (`vmid`, `moid`, `namespace`, …)              |
| `cluster.stuttgart-things.com/`                             | the sthingsClusters processor (`status`, `deployments`, …)                 |

Pick a new area for a new producer instead of writing into another one's.
Values are strings; keep them short, the "VM" card and similar cards show
them as they are.

**Tags.** Lowercase `[a-z0-9:+#]` joined by `-`, at most 63 characters. Tags
are for filtering (`vm`, `golang`, `labul`), not for data that belongs in an
annotation.

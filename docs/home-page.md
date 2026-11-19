# Home page

`/` is the portal's start page (`@backstage/plugin-home`). It used to redirect
to `/catalog`, which is still in the sidebar as **Catalog**.

| Card                   | What                                                                        |
| ---------------------- | --------------------------------------------------------------------------- |
| Announcement banner    | up to three unseen announcements, see [Announcements](announcements.md)     |
| Search bar             | same search as the sidebar, opens `/search`                                 |
| **Platform** (toolkit) | curated entry points: Order (`/create`), Clusters, VMs, Catalog, Docs, News |
| **Platform news**      | the latest three announcements                                              |
| Starred entities       | entities the user starred in the catalog                                    |
| Recently / top visited | pages the user opened, recorded by `VisitListener` in the user's StorageApi |

## Changing the toolkit

The links are the `TOOLS` list in
`packages/app/src/components/home/HomePage.tsx`. Use internal routes only so
the page works on every instance; Clusters and VMs are catalog filters on
Resources of type `kubernetes-cluster` and `vm`.

`@backstage/plugin-home` is pinned to the version of the current Backstage
release (`backstage.json`); bump it with the Backstage monorepo update.

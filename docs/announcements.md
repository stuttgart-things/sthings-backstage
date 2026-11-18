# Announcements

Platform news inside the portal: new claim templates, cluster maintenance
windows and release notes. Built on the community plugin
[`@backstage-community/plugin-announcements`](https://github.com/backstage/community-plugins/tree/main/workspaces/announcements).

## Where they appear

| Place                                         | What                                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/announcements` (sidebar: **Announcements**) | all announcements, filterable by category and tag                                                                |
| Catalog start page (`/` → `/catalog`)         | banner with up to three announcements the user has not seen yet; moves to the home page once there is one (#242) |
| Notifications (bell)                          | optional broadcast when an announcement is published with **Send Notification** checked                          |
| Search                                        | result type **Announcements**                                                                                    |

## Who may publish

Reading needs no permission. Creating, editing and deleting announcements,
categories and tags (`announcement.*`) is limited to `group:default/platform-team`
by the permission policy, see [Permissions](permissions.md). Developers
and guest do not see the admin buttons.

## Publishing

1. Open **Announcements** and choose **Admin Portal** (platform-team only).
2. Create an announcement with title, excerpt, Markdown body, optional
   category (e.g. `maintenance`, `templates`, `release`) and tags, and
   optionally a start date (the announcement stays hidden until then).
3. Check **Send Notification** to broadcast it to every user through the
   notifications plugin. Signals push it to open browsers right away.

Announcements are stored in the backend database (plugin `announcements`),
so with the default in-memory SQLite of local development they are lost on
restart.

## Configuration

Nothing is required. The search collator runs on its default schedule and can
be changed with:

```yaml
search:
  collators:
    announcements:
      schedule:
        frequency: { minutes: 10 }
        timeout: { minutes: 15 }
        initialDelay: { seconds: 3 }
```

Code: backend in `packages/backend/src/index.ts`, page and sidebar entry in
`packages/app/src/App.tsx` and `packages/app/src/components/Root/Root.tsx`,
banner in `packages/app/src/components/catalog/CustomCatalogPage.tsx`, search
in `packages/app/src/components/search/SearchPage.tsx`.

# Announcements

Platform news inside the portal: new claim templates, cluster maintenance
windows and release notes. Built on the community plugin
[`@backstage-community/plugin-announcements`](https://github.com/backstage/community-plugins/tree/main/workspaces/announcements).

## Where they appear

| Place                                         | What                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/announcements` (sidebar: **Announcements**) | all announcements, filterable by category and tag                                                                     |
| Home page (`/`)                               | banner with up to three announcements the user has not seen yet, and the **Platform news** card with the latest three |
| Notifications (bell)                          | optional broadcast when an announcement is published with **Send Notification** checked                               |
| Search                                        | result type **Announcements**                                                                                         |

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

## Release announcements

Every instance announces the portal release it runs, by itself, once that
release is deployed: title `Portal v1.36.0`, category **Release**, the
release notes as body and a link to the GitHub release. Each lab announces in
its own database when Flux has rolled the new image out there, not when the
release is cut.

How it finds the version: the image is built from a main commit before
semantic-release tags it, so it only knows that commit (`build-info.json`,
written by the docker-build workflow). Shortly after startup and then hourly
the backend (`packages/backend/src/plugins/release-announcements`) checks the
ten newest GitHub releases for the one whose `chore(release)` commit sits on
that commit, and creates the announcement unless one with the same title is
already in category Release. The category is created when missing. A failed
lookup (GitHub unreachable) is logged as a warning and retried an hour later.

Images built locally have no `build-info.json` and announce nothing. Delete a
release announcement in the admin portal and it is created again after the
next restart; to stop them, turn the job off.

```yaml
releaseAnnouncements:
  enabled: false # default true (in CI images)
  sendNotification: true # also broadcast to the bell, default false
  publisher: group:default/platform-team # default
  repository: stuttgart-things/sthings-backstage # default
```

GitHub is asked with the token of `integrations.github` (host `github.com`)
when there is one, otherwise anonymously.

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
banner and card in `packages/app/src/components/home/HomePage.tsx`, search
in `packages/app/src/components/search/SearchPage.tsx`.

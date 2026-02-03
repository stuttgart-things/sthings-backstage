# GitHub Actions Plugin

This document describes the integration of the `@backstage-community/plugin-github-actions` plugin for displaying GitHub Actions workflow runs on entity pages.

## Overview

The GitHub Actions plugin adds a CI/CD tab to service and website entity pages that displays:

- Recent workflow runs for the associated GitHub repository
- Workflow run status (success, failure, in progress)
- Links to individual workflow runs on GitHub
- Workflow names and branch information

## Architecture

```
ENTITY PAGE:
┌────────────────────────────────┐
│  EntityPage (CI/CD tab)        │
│  EntitySwitch                  │
│    if: isGithubActionsAvailable│
│    → EntityGithubActionsContent│
└───────────────┬────────────────┘
                │ reads annotation
                v
┌────────────────────────────────┐
│  catalog-info.yaml             │
│  github.com/project-slug:      │
│    org/repo-name               │
└───────────────┬────────────────┘
                │ GitHub API
                v
┌────────────────────────────────┐
│  GitHub Actions API            │
│  GET /repos/{owner}/{repo}/    │
│  actions/runs                  │
└────────────────────────────────┘
```

## Installation

### 1. Install the Package

```bash
yarn --cwd packages/app add @backstage-community/plugin-github-actions
```

### 2. Entity Page Integration

In `packages/app/src/components/catalog/EntityPage.tsx`, import the plugin components:

```typescript
import {
  EntityGithubActionsContent,
  isGithubActionsAvailable,
} from '@backstage-community/plugin-github-actions';
```

Add the `EntitySwitch.Case` to the CI/CD content section:

```typescript
const cicdContent = (
  <EntitySwitch>
    <EntitySwitch.Case if={isGithubActionsAvailable}>
      <EntityGithubActionsContent />
    </EntitySwitch.Case>

    <EntitySwitch.Case>
      <EmptyState
        title="No CI/CD available for this entity"
        missing="info"
        description="You need to add an annotation to your component if you want to enable CI/CD for it."
      />
    </EntitySwitch.Case>
  </EntitySwitch>
);
```

The CI/CD tab is included in both `serviceEntityPage` and `websiteEntityPage` layouts:

```typescript
<EntityLayout.Route path="/ci-cd" title="CI/CD">
  {cicdContent}
</EntityLayout.Route>
```

### 3. Prerequisites

The following must already be configured (these are part of the base sthings-backstage setup):

- **GitHub authentication** via `@backstage/plugin-auth-backend-module-github-provider`
- **GitHub integration** in `app-config.yaml` with a token that has `actions:read` permission

## Configuration

No additional `app-config.yaml` changes are required. The plugin uses the existing GitHub integration configuration:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

The GitHub token (or GitHub App) must have the `actions:read` permission to access workflow run data.

## Required Entity Annotation

For the CI/CD tab to appear on an entity, the entity's `catalog-info.yaml` must include the `github.com/project-slug` annotation:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: my-service
  annotations:
    github.com/project-slug: 'org-name/repo-name'
spec:
  type: service
  owner: team-name
```

### Currently Annotated Entities

The following entities in the catalog already have the annotation set:

| Entity | Type | Slug | Defined In |
|--------|------|------|------------|
| `sthings-backstage` | website | `stuttgart-things/sthings-backstage` | `sthings-backstage/catalog-info.yaml` |
| `backstage-backend` | service | `stuttgart-things/sthings-backstage` | `sthings-backstage/catalog-info.yaml` |
| `backstage-catalog-api` | API | `stuttgart-things/sthings-backstage` | `sthings-backstage/catalog-info.yaml` |

External services referenced via `backstage-resources/services/sthings-dev/catalog-index.yaml` need the annotation in their own repositories:

- `stuttgart-things/claim-machinery-api`
- `stuttgart-things/blueprints`
- `stuttgart-things/tasks`

## Entity Page Behavior

| Scenario | CI/CD Tab Behavior |
|----------|-------------------|
| Entity has `github.com/project-slug` annotation | Shows GitHub Actions workflow runs |
| Entity missing the annotation | Shows "No CI/CD available" with link to Backstage annotations docs |
| Entity kind is not service/website | CI/CD tab is not shown |

## File Structure

```
packages/app/
└── src/
    └── components/
        └── catalog/
            └── EntityPage.tsx    # CI/CD tab with GitHub Actions integration
```

## Troubleshooting

### CI/CD Tab Shows "No CI/CD Available"

1. Verify the entity has the `github.com/project-slug` annotation in its `catalog-info.yaml`
2. Check that the annotation value matches the format `owner/repo` (no `https://` prefix)
3. Refresh the entity in the catalog (Backstage may cache entity data)

### Workflow Runs Not Loading

1. Verify the GitHub token has `actions:read` permission
2. Check that the repository exists and has GitHub Actions workflows
3. Inspect browser network tab for API errors (403 = permission issue, 404 = wrong slug)

### Tab Not Appearing at All

1. Confirm the entity kind is `Component` with type `service` or `website`
2. Other entity types (API, Resource, System) do not include the CI/CD tab

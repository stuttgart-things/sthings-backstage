# Claim Registry Plugin

This document describes the installation and configuration of the `backstage-claim-registry-plugin` for browsing and deleting claims from the Machinery Registry API.

## Overview

The Claim Registry Plugin provides scaffolder extensions that allow users to:

- Browse and select existing claims from the Machinery Registry API
- View claim details (template, category, status, namespace, created by, repository, path)
- Filter claims by status, category, or template via `ui:options`
- Delete claims by creating a GitHub pull request that removes the claim directory and updates `kustomization.yaml`

## Architecture

```
FRONTEND COMPONENT:
┌────────────────────────────────┐
│  RegistryClaimPicker           │ Dropdown for selecting claims
└───────────────┬────────────────┘
                │ fetch via proxy
                v
┌────────────────────────────────┐
│  Backstage Proxy               │
│  /api/proxy/machinery-registry │
└───────────────┬────────────────┘
                │ HTTP
                v
┌────────────────────────────────┐
│  Machinery Registry API        │
│  /api/v1/claims                │
└────────────────────────────────┘

BACKEND ACTION:
┌────────────────────────────────┐
│  Scaffolder Template           │
│  action: claim-registry:delete │
└───────────────┬────────────────┘
                │ GitHub API
                v
┌────────────────────────────────┐
│  GitHub Repository             │
│  - Remove claim directory      │
│  - Update kustomization.yaml   │
│  - Create pull request         │
└────────────────────────────────┘
```

## Installation

### 1. Backend Module

The backend module is located at `packages/backend/src/plugins/scaffolder-claim-registry/` and consists of three files:

**`index.ts`** — Re-exports the module:

```typescript
export { default } from './module';
```

**`module.ts`** — Registers the scaffolder action:

```typescript
import { createBackendModule, coreServices } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node/alpha';
import { claimRegistryDeleteAction } from './action';

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'claim-registry',

  register(env) {
    env.registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ scaffolderActions, config }) {
        scaffolderActions.addActions(
          claimRegistryDeleteAction({ config }),
        );
      },
    });
  },
});
```

**`action.ts`** — Implements the `claim-registry:delete` action that:

1. Parses claim data from the `RegistryClaimPicker` JSON string
2. Fetches the repository tree via GitHub API
3. Removes the claim directory (`claims/{category}/{claimName}/`)
4. Updates the parent `kustomization.yaml` to remove the resource entry
5. Creates a new branch and opens a pull request

Register the module in `packages/backend/src/index.ts`:

```typescript
// claim-registry scaffolder module (delete claims via PR)
backend.add(import('./plugins/scaffolder-claim-registry'));
```

### 2. Frontend Field Extension

The frontend component is located at `packages/app/src/scaffolder/RegistryClaimPickerExtension.tsx`.

Register it in `packages/app/src/scaffolder/index.ts`:

```typescript
import { RegistryClaimPickerExtension } from './RegistryClaimPickerExtension';

export const RegistryClaimPickerFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'RegistryClaimPicker',
    component: RegistryClaimPickerExtension,
  }),
);
```

Register the extension in `packages/app/src/App.tsx`:

```typescript
import {
  RegistryClaimPickerFieldExtension,
} from './scaffolder';

// Inside the routes:
<Route path="/create" element={<ScaffolderPage />}>
  <ScaffolderFieldExtensions>
    <RegistryClaimPickerFieldExtension />
  </ScaffolderFieldExtensions>
</Route>
```

## Configuration

Add the following proxy endpoint to `app-config.yaml`:

```yaml
proxy:
  endpoints:
    '/machinery-registry':
      target: ${CLAIM_MACHINERY_API_URL:-https://claim-api.idp.kubermatic.sva.dev}
      changeOrigin: true
      pathRewrite:
        '^/api/proxy/machinery-registry': ''
      allowedHeaders: ['*']
      credentials: 'dangerously-allow-unauthenticated'
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAIM_MACHINERY_API_URL` | URL of the Machinery Registry API | `https://claim-api.idp.kubermatic.sva.dev` |
| `GITHUB_TOKEN` | GitHub PAT with repo permissions for creating PRs | — |

## Usage in Templates

### Selecting and Deleting a Claim

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: delete-claim
  title: Delete Claim
spec:
  parameters:
    - title: Select Claim to Delete
      properties:
        claimData:
          type: string
          ui:field: RegistryClaimPicker
          ui:options:
            status: applied
            category: infra

  steps:
    - id: delete-claim
      name: Delete Claim via PR
      action: claim-registry:delete
      input:
        claimData: ${{ parameters.claimData }}
        targetBranch: main

  output:
    links:
      - title: Pull Request
        url: ${{ steps['delete-claim'].output.pullRequestUrl }}
```

### RegistryClaimPicker ui:options

The picker supports optional filters via `ui:options`:

| Option | Description | Example |
|--------|-------------|---------|
| `status` | Filter claims by status | `applied`, `pending` |
| `category` | Filter claims by category | `infra`, `apps` |
| `template` | Filter claims by template name | `vsphere-vm` |

### claim-registry:delete Action Inputs

| Input | Type | Required | Description |
|-------|------|----------|-------------|
| `claimData` | string | yes | JSON string from the `RegistryClaimPicker` containing the full claim object |
| `claimName` | string | no | Override: the name of the claim to delete |
| `claimPath` | string | no | Override: the path to the claim file in the repository |
| `claimCategory` | string | no | Override: the category of the claim |
| `repository` | string | no | Override: the GitHub repository in `owner/repo` format |
| `targetBranch` | string | no | The target branch for the PR (default: `main`) |

### claim-registry:delete Action Outputs

| Output | Type | Description |
|--------|------|-------------|
| `pullRequestUrl` | string | The URL of the created pull request |
| `pullRequestNumber` | number | The PR number |

## File Structure

```
packages/
├── app/
│   └── src/
│       ├── App.tsx                                 # Register field extension
│       └── scaffolder/
│           ├── index.ts                            # Export extension
│           └── RegistryClaimPickerExtension.tsx     # Claim picker UI component
└── backend/
    └── src/
        ├── index.ts                                # Register backend module
        └── plugins/
            └── scaffolder-claim-registry/
                ├── index.ts                        # Module re-export
                ├── module.ts                       # Backend module definition
                └── action.ts                       # Delete action implementation
```

## Troubleshooting

### Claims Not Loading

1. Verify the Machinery Registry API is accessible at the configured URL
2. Check the proxy configuration for `/machinery-registry` in `app-config.yaml`
3. Inspect the browser network tab for requests to `/api/proxy/machinery-registry/api/v1/claims`

### Delete Action Fails

1. Verify `GITHUB_TOKEN` is set and has `repo` permissions
2. Check that the repository in the claim data uses `owner/repo` format
3. Review backend logs for GitHub API error details
4. Ensure the target branch exists in the repository

### PR Branch Already Exists

The action handles this gracefully by updating an existing branch with `force: true`. If a PR already exists for the same claim deletion, a new commit will be pushed to the existing branch.

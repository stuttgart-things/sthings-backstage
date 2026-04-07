# Claim Machinery Multi-Claim Plugin

Create multiple resource claims in a single scaffolder workflow and submit them as a GitHub Pull Request.

## Overview

The Multi-Claim extension adds:

- **`ClaimMachineryMultiClaim`** — a frontend field extension that lets users select multiple claim templates, each with its own dynamic parameters
- **`claim-machinery:render-multiple`** — a backend scaffolder action that renders all selected templates via the Claim Machinery API and creates a GitHub PR with the combined manifests

## Architecture

```
FRONTEND:
┌──────────────────────────────────┐
│  ClaimMachineryMultiClaim        │  Repeatable template + params rows
│  (ui:field: ClaimMachineryMultiClaim)
└───────────────┬──────────────────┘
                │ JSON-stringified array of { template, parameters }
                v
BACKEND ACTION:
┌──────────────────────────────────┐
│  claim-machinery:render-multiple │
│                                  │
│  1. Render each template via API │
│  2. Create GitHub PR with:       │
│     - claims/{category}/{name}/  │
│     - Updated kustomization.yaml │
└──────────────────────────────────┘
```

## Usage in Scaffolder Templates

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: create-multiple-claims
  title: Create Multiple Resource Claims
  description: Select one or more claim templates and create a PR with all rendered manifests
spec:
  parameters:
    - title: Select Claims
      properties:
        claims:
          type: string
          ui:field: ClaimMachineryMultiClaim
          title: Resource Claims
          description: Add one or more claims to provision

    - title: Target Repository
      properties:
        repository:
          type: string
          title: GitHub Repository
          description: Target repository in owner/repo format
          default: stuttgart-things/claims-repo
        claimCategory:
          type: string
          title: Claim Category
          description: Category folder under claims/
          default: infra
          enum:
            - infra
            - apps
            - network
        targetBranch:
          type: string
          title: Target Branch
          default: main

  steps:
    - id: render-claims
      name: Render and Create PR
      action: claim-machinery:render-multiple
      input:
        claims: ${{ parameters.claims }}
        repository: ${{ parameters.repository }}
        claimCategory: ${{ parameters.claimCategory }}
        targetBranch: ${{ parameters.targetBranch }}

  output:
    links:
      - title: Pull Request
        url: ${{ steps['render-claims'].output.pullRequestUrl }}
```

## Backend Action: `claim-machinery:render-multiple`

### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `claims` | `string` (JSON) or `array` | Yes | Array of `{ template, parameters, nameOverride? }` entries |
| `repository` | `string` | Yes | GitHub repository in `owner/repo` format |
| `targetBranch` | `string` | No | Target branch for the PR (default: `main`) |
| `claimCategory` | `string` | No | Category folder under `claims/` (default: `infra`) |
| `prTitle` | `string` | No | Custom PR title |

### Output

| Field | Type | Description |
|-------|------|-------------|
| `manifest` | `string` | Combined multi-document YAML of all rendered manifests |
| `pullRequestUrl` | `string` | URL of the created GitHub PR |
| `pullRequestNumber` | `number` | PR number |

### What the action does

1. Iterates over each claim entry and calls `POST /api/v1/claim-templates/{template}/order` on the Claim Machinery API
2. Combines all rendered manifests
3. Creates a file per claim at `claims/{category}/{name}/{name}.yaml`
4. Updates (or creates) `claims/{category}/kustomization.yaml` with new resource entries
5. Creates a GitHub branch and pull request with all changes

## Frontend Field: `ClaimMachineryMultiClaim`

The field extension renders a dynamic list of claim rows. Each row contains:

- A template dropdown (populated from the Claim Machinery API)
- Dynamic parameter fields based on the selected template (text, boolean, enum, multiselect, array)

Users can add or remove rows using the "Add another claim" button and the delete icon on each row.

The field outputs a JSON-stringified array:

```json
[
  { "template": "vsphere-vm", "parameters": { "name": "my-vm", "cpu": "4" } },
  { "template": "ansible-run", "parameters": { "name": "config-run", "playbook": "setup.yaml" } }
]
```

## File Structure

```
packages/
├── app/src/scaffolder/
│   ├── ClaimMachineryMultiClaimExtension.tsx   # Multi-claim UI component
│   └── index.ts                                # Exports ClaimMachineryMultiClaimFieldExtension
└── backend/src/plugins/scaffolder-claim-machinery/
    ├── index.ts                                # Registers both render and render-multiple actions
    └── action-render-multiple.ts               # Multi-claim render + PR action
```

## Configuration

No additional configuration required beyond the existing Claim Machinery setup:

```yaml
claimMachinery:
  apiUrl: ${CLAIM_MACHINERY_API_URL}

integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

The `GITHUB_TOKEN` must have permissions to create branches and pull requests in the target repository.

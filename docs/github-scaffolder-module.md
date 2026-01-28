# GitHub Scaffolder Module

This document covers the installation and usage of the `@backstage/plugin-scaffolder-backend-module-github` plugin in the sthings-backstage instance.

## Overview

The GitHub Scaffolder Module extends the Backstage scaffolder with GitHub-specific actions, enabling software templates to interact with GitHub repositories, issues, workflows, and more.

## Installation

### 1. Install the Package

The package is installed in the backend:

```bash
cd packages/backend
yarn add @backstage/plugin-scaffolder-backend-module-github
```

### 2. Register the Module

Add the module to the backend in `packages/backend/src/index.ts`:

```typescript
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

// ... other plugins

// scaffolder plugin
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend-module-github'));

// ... rest of backend
backend.start();
```

### 3. Configure GitHub Integration

Ensure GitHub integration is configured in `app-config.yaml`:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

The `GITHUB_TOKEN` requires the following scopes:

| Scope | Purpose |
|-------|---------|
| `repo` | Full control of private repositories |
| `workflow` | Update GitHub Action workflows |
| `read:org` | Read org and team membership |
| `admin:repo_hook` | Manage repository webhooks (optional) |

## Available Actions

The module provides the following scaffolder actions:

### github:actions:dispatch

Dispatches a GitHub Actions workflow.

```yaml
steps:
  - id: dispatch-workflow
    name: Trigger GitHub Actions Workflow
    action: github:actions:dispatch
    input:
      repoUrl: github.com?owner=my-org&repo=my-repo
      workflowId: build.yaml
      branchOrTagName: main
      workflowInputs:
        environment: production
        version: ${{ parameters.version }}
```

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoUrl` | string | Yes | Repository URL in Backstage format |
| `workflowId` | string | Yes | Workflow filename or ID |
| `branchOrTagName` | string | Yes | Branch or tag to run workflow on |
| `workflowInputs` | object | No | Input parameters for the workflow |

### github:issues:label

Adds labels to a GitHub issue or pull request.

```yaml
steps:
  - id: add-labels
    name: Add Labels to Issue
    action: github:issues:label
    input:
      repoUrl: github.com?owner=my-org&repo=my-repo
      number: ${{ steps.create-issue.output.number }}
      labels:
        - bug
        - priority-high
```

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoUrl` | string | Yes | Repository URL in Backstage format |
| `number` | number | Yes | Issue or PR number |
| `labels` | string[] | Yes | List of labels to add |

### github:repo:create

Creates a new GitHub repository.

```yaml
steps:
  - id: create-repo
    name: Create GitHub Repository
    action: github:repo:create
    input:
      repoUrl: github.com?owner=my-org&repo=${{ parameters.repoName }}
      description: ${{ parameters.description }}
      private: true
      deleteBranchOnMerge: true
      allowSquashMerge: true
      allowMergeCommit: false
      allowRebaseMerge: true
```

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoUrl` | string | Yes | Repository URL in Backstage format |
| `description` | string | No | Repository description |
| `private` | boolean | No | Create as private repository (default: true) |
| `deleteBranchOnMerge` | boolean | No | Auto-delete head branches |
| `allowSquashMerge` | boolean | No | Allow squash merging |
| `allowMergeCommit` | boolean | No | Allow merge commits |
| `allowRebaseMerge` | boolean | No | Allow rebase merging |

**Output:**

| Property | Type | Description |
|----------|------|-------------|
| `remoteUrl` | string | HTTPS URL of the created repository |
| `repoContentsUrl` | string | URL to repository contents |

### github:repo:push

Pushes content to an existing GitHub repository.

```yaml
steps:
  - id: push-content
    name: Push to Repository
    action: github:repo:push
    input:
      repoUrl: github.com?owner=my-org&repo=my-repo
      branchName: main
      commitMessage: 'Initial commit from Backstage'
      sourcePath: ${{ steps.fetch.output.targetPath }}
```

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoUrl` | string | Yes | Repository URL in Backstage format |
| `branchName` | string | No | Target branch (default: repository default branch) |
| `commitMessage` | string | No | Commit message |
| `sourcePath` | string | No | Path to content to push |
| `defaultBranch` | string | No | Default branch name if creating new |
| `gitCommitMessage` | string | No | Alternative to commitMessage |
| `gitAuthorName` | string | No | Git author name |
| `gitAuthorEmail` | string | No | Git author email |

### github:webhook

Creates or updates a webhook on a GitHub repository.

```yaml
steps:
  - id: create-webhook
    name: Create Webhook
    action: github:webhook
    input:
      repoUrl: github.com?owner=my-org&repo=my-repo
      webhookUrl: https://my-service.example.com/webhook
      webhookSecret: ${{ secrets.WEBHOOK_SECRET }}
      events:
        - push
        - pull_request
```

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoUrl` | string | Yes | Repository URL in Backstage format |
| `webhookUrl` | string | Yes | URL to receive webhook events |
| `webhookSecret` | string | No | Secret for webhook validation |
| `events` | string[] | No | Events to trigger webhook (default: push) |
| `active` | boolean | No | Whether webhook is active (default: true) |
| `contentType` | string | No | Payload content type (default: json) |
| `insecureSsl` | boolean | No | Skip SSL verification (default: false) |

### github:environment:create

Creates a deployment environment in a GitHub repository.

```yaml
steps:
  - id: create-environment
    name: Create Deployment Environment
    action: github:environment:create
    input:
      repoUrl: github.com?owner=my-org&repo=my-repo
      name: production
      deploymentBranchPolicy:
        protectedBranches: true
      reviewers:
        - users:
            - octocat
        - teams:
            - platform-team
```

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoUrl` | string | Yes | Repository URL in Backstage format |
| `name` | string | Yes | Environment name |
| `deploymentBranchPolicy` | object | No | Branch protection settings |
| `reviewers` | array | No | Required reviewers |
| `waitTimer` | number | No | Wait timer in minutes |

### github:deployKey:create

Creates a deploy key for a GitHub repository.

```yaml
steps:
  - id: create-deploy-key
    name: Create Deploy Key
    action: github:deployKey:create
    input:
      repoUrl: github.com?owner=my-org&repo=my-repo
      publicKey: ${{ steps.generate-key.output.publicKey }}
      title: backstage-deploy-key
      readOnly: true
```

**Input Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repoUrl` | string | Yes | Repository URL in Backstage format |
| `publicKey` | string | Yes | SSH public key content |
| `title` | string | Yes | Deploy key title |
| `readOnly` | boolean | No | Read-only access (default: false) |

## Example Template

Here's a complete example template using multiple GitHub actions:

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: create-service-repo
  title: Create Service Repository
  description: Creates a new GitHub repository with CI/CD setup
spec:
  owner: platform-team
  type: service

  parameters:
    - title: Repository Details
      required:
        - repoName
        - description
      properties:
        repoName:
          title: Repository Name
          type: string
          pattern: '^[a-z0-9-]+$'
        description:
          title: Description
          type: string
        owner:
          title: Owner
          type: string
          default: stuttgart-things
          ui:field: OwnerPicker

  steps:
    - id: fetch-template
      name: Fetch Template
      action: fetch:template
      input:
        url: ./skeleton
        values:
          name: ${{ parameters.repoName }}
          description: ${{ parameters.description }}

    - id: create-repo
      name: Create Repository
      action: github:repo:create
      input:
        repoUrl: github.com?owner=${{ parameters.owner }}&repo=${{ parameters.repoName }}
        description: ${{ parameters.description }}
        private: false
        deleteBranchOnMerge: true

    - id: push-content
      name: Push Initial Content
      action: github:repo:push
      input:
        repoUrl: github.com?owner=${{ parameters.owner }}&repo=${{ parameters.repoName }}
        branchName: main
        commitMessage: 'Initial commit from Backstage template'

    - id: dispatch-setup
      name: Run Setup Workflow
      action: github:actions:dispatch
      input:
        repoUrl: github.com?owner=${{ parameters.owner }}&repo=${{ parameters.repoName }}
        workflowId: setup.yaml
        branchOrTagName: main

    - id: register
      name: Register in Catalog
      action: catalog:register
      input:
        repoContentsUrl: ${{ steps['create-repo'].output.repoContentsUrl }}
        catalogInfoPath: /catalog-info.yaml

  output:
    links:
      - title: Repository
        url: ${{ steps['create-repo'].output.remoteUrl }}
      - title: Open in Catalog
        icon: catalog
        entityRef: ${{ steps['register'].output.entityRef }}
```

## Troubleshooting

### Common Issues

**"Resource not accessible by integration"**
- Verify the GitHub token has required scopes
- Check repository visibility and access permissions
- Ensure the token owner has access to the target organization/repository

**"Workflow does not exist"**
- Verify the workflow file exists in the repository
- Check the workflow filename is correct (include `.yaml` or `.yml` extension)
- Ensure the workflow has `workflow_dispatch` trigger enabled

**"Branch protection rules prevent this action"**
- Use a token with admin access or bypass permissions
- Configure branch protection to allow the integration

### Viewing Available Actions

To see all available scaffolder actions in your Backstage instance:

1. Navigate to `/create/actions` in Backstage
2. Or use the API: `GET /api/scaffolder/v2/actions`

## Related Documentation

- [GitHub Integration](github-integration.md) - OAuth and authentication setup
- [Scaffolding](scaffolding.md) - Backstage instance setup
- [Backstage Scaffolder Actions](https://backstage.io/docs/features/software-templates/builtin-actions) - Official documentation

# GitHub Integration

This document covers the GitHub plugin installation, configuration, and OAuth app setup for the sthings-backstage instance.

## Overview

GitHub integration in Backstage provides:

- **Authentication**: Sign in with GitHub OAuth
- **Catalog Integration**: Import entities from GitHub repositories
- **Scaffolder Actions**: Create repositories and pull requests
- **Entity Discovery**: Auto-discover catalog-info.yaml files

## GitHub OAuth App Setup

There are two ways to create a GitHub OAuth App:

1. **Organization-owned** (recommended for teams) - Managed by the org, persists when members leave
2. **User-owned** - Personal account, simpler but tied to individual

### Option A: Organization OAuth App (Recommended)

1. Go to your GitHub organization page
2. Click **Settings** → **Developer settings** → **OAuth Apps**
3. Click **New OAuth App**
4. Fill in the application details:

| Field | Value |
|-------|-------|
| Application name | `sthings-backstage` |
| Homepage URL | `http://localhost:3000` (or production URL) |
| Authorization callback URL | `http://localhost:7007/api/auth/github/handler/frame` |

5. Click **Register application**
6. After creation, click **Generate a new client secret**
7. Copy both the **Client ID** and **Client Secret**

Benefits of organization-owned OAuth apps:

- Centralized management under the organization
- App persists even if creating member leaves
- Org admins can manage access and credentials
- Clearer ownership for production deployments

### Option B: Personal OAuth App

1. Go to GitHub → Settings → Developer settings → OAuth Apps
2. Click **New OAuth App**
3. Fill in the application details:

| Field | Value |
|-------|-------|
| Application name | `sthings-backstage` |
| Homepage URL | `http://localhost:3000` (or production URL) |
| Authorization callback URL | `http://localhost:7007/api/auth/github/handler/frame` |

4. Click **Register application**

### Step 2: Generate Client Secret

1. After creating the app, click **Generate a new client secret**
2. Copy both the **Client ID** and **Client Secret**
3. Store these securely - the secret is only shown once

### Step 3: Configure Environment Variables

Add the OAuth credentials to your `.env` file:

```bash
GITHUB_CLIENT_ID=Iv1.xxxxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Personal Access Token (PAT)

A PAT is required for API operations like catalog imports and scaffolder actions.

### Create a PAT

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click **Generate new token (classic)**
3. Configure the token:

| Setting | Value |
|---------|-------|
| Note | `sthings-backstage` |
| Expiration | As needed (recommend 90 days or custom) |

4. Select scopes:

```
☑ repo (Full control of private repositories)
☑ workflow (Update GitHub Action workflows)
☑ read:org (Read org and team membership)
☑ read:user (Read user profile data)
☑ user:email (Access user email addresses)
```

5. Click **Generate token** and copy the value

### Configure PAT

Add to your `.env` file:

```bash
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx # pragma: allowlist secret
```

## Backend Configuration

### Install Auth Backend Module

The GitHub auth provider is included via the backend module:

```typescript
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-auth-backend'));
backend.add(import('@backstage/plugin-auth-backend-module-github-provider'));
```

### app-config.yaml

Configure GitHub integration in `app-config.yaml`:

```yaml
# GitHub API Integration
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}

# GitHub OAuth Authentication
auth:
  environment: development
  providers:
    guest: {}
    github:
      development:
        clientId: ${GITHUB_CLIENT_ID}
        clientSecret: ${GITHUB_CLIENT_SECRET}
        signIn:
          resolvers:
            - resolver: usernameMatchingUserEntityName
```

## Frontend Configuration

### Sign-In Page

The frontend is configured to use GitHub as a sign-in provider:

```typescript
// packages/app/src/App.tsx
import { githubAuthApiRef } from '@backstage/core-plugin-api';

const app = createApp({
  // ...
  components: {
    SignInPage: props => (
      <SignInPage
        {...props}
        auto
        providers={[
          'guest',
          {
            id: 'github-auth-provider',
            title: 'GitHub',
            message: 'Sign in using GitHub',
            apiRef: githubAuthApiRef,
          },
        ]}
      />
    ),
  },
});
```

## Sign-In Resolvers

The resolver determines how GitHub users map to Backstage user entities:

### usernameMatchingUserEntityName

Maps GitHub username to Backstage user entity name:

```yaml
signIn:
  resolvers:
    - resolver: usernameMatchingUserEntityName
```

This requires a matching User entity in the catalog:

```yaml
# Example user entity
apiVersion: backstage.io/v1alpha1
kind: User
metadata:
  name: octocat  # Must match GitHub username
spec:
  profile:
    displayName: The Octocat
    email: octocat@github.com
  memberOf: [team-a]
```

### Alternative Resolvers

Other available resolvers:

| Resolver | Description |
|----------|-------------|
| `emailMatchingUserEntityProfileEmail` | Match by email address |
| `emailLocalPartMatchingUserEntityName` | Match email prefix to username |

## Catalog Integration

### Import from GitHub

Configure catalog locations to import from GitHub:

```yaml
catalog:
  locations:
    # Import a single file
    - type: url
      target: https://github.com/stuttgart-things/backstage-resources/blob/main/org/sthings-dev/org.yaml
      rules:
        - allow: [User, Group]

    # Import catalog index
    - type: url
      target: https://github.com/stuttgart-things/backstage-resources/blob/main/services/sthings-dev/catalog-index.yaml
      rules:
        - allow: [Component, System, API, Resource, Location, Domain]
```

### Entity Discovery

Enable automatic discovery of catalog-info.yaml files:

```yaml
catalog:
  providers:
    github:
      sthingsOrg:
        organization: 'stuttgart-things'
        catalogPath: '/catalog-info.yaml'
        filters:
          branch: 'main'
          repository: '.*'
        schedule:
          frequency: { minutes: 30 }
          timeout: { minutes: 3 }
```

## Scaffolder Actions

GitHub scaffolder actions allow creating repositories and pull requests:

### Available Actions

| Action | Description |
|--------|-------------|
| `publish:github` | Create a new GitHub repository |
| `publish:github:pull-request` | Create a pull request |
| `github:actions:dispatch` | Trigger a GitHub Action |

### Example Template

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: create-repo
  title: Create GitHub Repository
spec:
  steps:
    - id: publish
      name: Publish to GitHub
      action: publish:github
      input:
        repoUrl: github.com?owner=stuttgart-things&repo=${{ parameters.repoName }}
        description: ${{ parameters.description }}
        defaultBranch: main
        protectDefaultBranch: true
```

## Production Configuration

For production deployments, update the OAuth callback URL:

```yaml
auth:
  providers:
    github:
      production:
        clientId: ${GITHUB_CLIENT_ID}
        clientSecret: ${GITHUB_CLIENT_SECRET}
        callbackUrl: https://your-backstage-domain.com/api/auth/github/handler/frame
        signIn:
          resolvers:
            - resolver: usernameMatchingUserEntityName
```

And update the GitHub OAuth App settings:

| Field | Production Value |
|-------|------------------|
| Homepage URL | `https://your-backstage-domain.com` |
| Authorization callback URL | `https://your-backstage-domain.com/api/auth/github/handler/frame` |

## Troubleshooting

### OAuth Errors

**"redirect_uri_mismatch"**
- Verify the callback URL in GitHub OAuth App settings matches exactly
- Check for trailing slashes or protocol mismatches (http vs https)

**"User not found"**
- Ensure a User entity exists in the catalog matching the GitHub username
- Check the sign-in resolver configuration

### Token Errors

**"Bad credentials"**
- Verify the GITHUB_TOKEN is valid and not expired
- Ensure required scopes are selected

**"Resource not accessible by integration"**
- Check repository visibility settings
- Verify token has the `repo` scope for private repositories

## Environment Variables Summary

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_TOKEN` | Personal Access Token for API access | Yes |
| `GITHUB_CLIENT_ID` | OAuth App Client ID | Yes |
| `GITHUB_CLIENT_SECRET` | OAuth App Client Secret | Yes |

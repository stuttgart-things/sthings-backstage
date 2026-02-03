# Scaffolding the Backstage Instance

This document describes how the sthings-backstage instance was created and configured.

## Prerequisites

Before scaffolding Backstage, ensure you have:

- Node.js 22 or 24
- Yarn (version 4.4.1 recommended)
- Git

## Creating the Backstage App

The instance was created using the official Backstage CLI:

```bash
npx @backstage/create-app@latest
```

When prompted:
- **App name**: `sthings-backstage`

This generates a monorepo structure with:

```
sthings-backstage/
├── packages/
│   ├── app/          # Frontend React application
│   └── backend/      # Backend Node.js API
├── plugins/          # Custom plugins directory
├── app-config.yaml   # Main configuration
├── catalog-info.yaml # Catalog entity definitions
├── package.json      # Root monorepo config
└── backstage.json    # Backstage metadata
```

## Post-Scaffold Configuration

### 1. Update backstage.json

The Backstage version is tracked in `backstage.json`:

```json
{
  "version": "1.47.0"
}
```

### 2. Configure Yarn 4

The project uses Yarn 4 with the following setup:

```bash
corepack enable
yarn set version 4.4.1
```

### 3. Install Dependencies

```bash
yarn install
```

## Project Structure

### Frontend (packages/app)

The frontend is a React application that provides:

- Catalog browsing and search
- TechDocs viewer
- Software Templates UI
- User settings and notifications

Key files:
- `src/App.tsx` - Main application with routes
- `src/components/` - Custom components
- `public/` - Static assets (icons, favicon)

### Backend (packages/backend)

The backend uses the new Backstage backend system:

```typescript
// packages/backend/src/index.ts
import { createBackend } from '@backstage/backend-defaults';

const backend = createBackend();

backend.add(import('@backstage/plugin-app-backend'));
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@backstage/plugin-scaffolder-backend'));
backend.add(import('@backstage/plugin-techdocs-backend'));
// ... additional plugins

backend.start();
```

### Plugins Installed

The following plugins are included:

| Plugin | Purpose |
|--------|---------|
| catalog | Software catalog management |
| techdocs | Documentation as code |
| scaffolder | Software templates |
| search | Unified search |
| kubernetes | Cluster integration |
| notifications | User notifications |
| signals | Real-time updates |
| permission | Authorization framework |
| auth | Authentication providers |
| claim-machinery | Custom action for rendering Kubernetes claim manifests |
| yaml-utils | Custom action for parsing YAML files in scaffolder workflows |

## Running Locally

### Development Mode

```bash
yarn dev
```

This starts both frontend (port 3000) and backend (port 7007).

### Environment Variables

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Required variables:

```bash
APP_BASE_URL=http://localhost:3000
BACKEND_BASE_URL=http://localhost:7007
BACKEND_PORT=7007
CORS_ORIGIN=http://localhost:3000
ORGANIZATION_NAME=Stuttgart Things
BACKEND_SECRET=<random-base64-string>
```

## Building for Production

### Build All Packages

```bash
yarn build:all
```

### Build Backend Only

```bash
yarn build:backend
```

### Docker Image

The backend includes a Dockerfile for containerized deployments:

```bash
docker build -t sthings-backstage -f packages/backend/Dockerfile .
```

## Task Automation

The project uses Taskfile for common operations:

```bash
# Start development
task dev

# Build container image
task image-build
```

## Catalog Configuration

The catalog is configured to load entities from external sources:

```yaml
# app-config.yaml
catalog:
  import:
    entityFilename: catalog-info.yaml
    pullRequestBranchName: backstage-integration
  rules:
    - allow: [Component, System, API, Resource, Location, Domain, User, Group, Template]
  locations:
    - type: url
      target: https://github.com/stuttgart-things/backstage-resources/blob/main/org/sthings-dev/org.yaml
    - type: url
      target: https://github.com/stuttgart-things/backstage-resources/blob/main/services/sthings-dev/catalog-index.yaml
```

## Next Steps

- Configure [GitHub Integration](github-integration.md) for authentication and catalog imports
- Add custom plugins to the `plugins/` directory
- Define software templates for your organization

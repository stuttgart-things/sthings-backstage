# sthings-backstage

An Internal Developer Portal (IDP) built on [Backstage](https://backstage.io) for Stuttgart Things.

## Overview

sthings-backstage provides a centralized platform for managing software development across the organization, featuring:

- **Software Catalog** - Centralized registry for services and components
- **TechDocs** - Technical documentation managed as code
- **Software Templates** - Scaffolding system for creating new projects
- **Kubernetes Integration** - Visibility and management of Kubernetes clusters
- **GitHub Integration** - Authentication, catalog import, and scaffolder actions
- **GitHub Scaffolder Module** - Extended GitHub actions for software templates
- **Claim Machinery Plugin** - Integration with Claim Machinery API for dynamic claim templates
- **Unified Search** - Cross-entity search functionality

## Getting Started

**Prerequisites:** Node.js 22 or 24, Yarn 4.4.1

```sh
yarn install
yarn dev
```

This starts the frontend on port 3000 and backend on port 7007.

## Project Structure

```
sthings-backstage/
├── packages/app/       # Frontend React application
├── packages/backend/   # Backend Node.js API
├── plugins/            # Custom plugins directory
├── app-config.yaml     # Main configuration
└── catalog-info.yaml   # Catalog entity definitions
```

## Tasks

This project uses [Task](https://taskfile.dev) for automation. Run `task --list` to see all available tasks.

| Task | Description |
|------|-------------|
| `task dev` | Start Backstage in development mode with .env loaded |
| `task build-push-scan-image` | Build, push, and scan container image using Dagger |
| `task do` | Interactive task selector (requires gum) |

**Included task modules:**

| Prefix | Source |
|--------|--------|
| `init:` | Backstage initialization tasks |
| `git:` | Git operations |
| `docker:` | Docker build tasks |
| `trivy:` | Container security scanning |

## Documentation

See the [docs](docs/) folder for detailed documentation:

- [Configuration](docs/configuration.md) - Environment variables and secrets
- [GitHub Integration](docs/github-integration.md) - OAuth and API setup
- [GitHub Scaffolder Module](docs/github-scaffolder-module.md) - Extended GitHub actions for templates
- [Scaffolding](docs/scaffolding.md) - Project templates and structure
- [Claim Machinery Plugin](docs/claim-machinery-plugin.md) - Installation and configuration guide

## Claim Machinery Plugin

This instance includes the `backstage-claim-machinery-plugin` which provides custom scaffolder extensions for rendering Kubernetes claim manifests via the Claim Machinery API.

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Backend Action | `packages/backend/src/plugins/scaffolder-claim-machinery/` | `claim-machinery:render` scaffolder action |
| Field Extensions | `packages/app/src/scaffolder/` | `ClaimMachineryPicker` and `ClaimMachineryParameters` UI components |

### Configuration

```yaml
# app-config.yaml
claimMachinery:
  apiUrl: ${CLAIM_MACHINERY_API_URL}

proxy:
  endpoints:
    '/claim-machinery':
      target: ${CLAIM_MACHINERY_API_URL}
      changeOrigin: true
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAIM_MACHINERY_API_URL` | URL of the Claim Machinery API |

For complete installation and usage details, see the [Claim Machinery Plugin documentation](docs/claim-machinery-plugin.md).

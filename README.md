# sthings-backstage


<div align="center">
  <p>
    <img src="https://github.com/stuttgart-things/docs/blob/main/hugo/sthings-backstage.jpg" alt="sthings" width="450" />
  </p>
  <p>
    <strong>[An Internal Developer Portal]</strong> - built on Backstage for stuttgart-things.

  </p>
</div>


## Overview

sthings-backstage provides a centralized platform for managing software development across the organization, featuring:

- **Software Catalog** - Centralized registry for services and components
- **TechDocs** - Technical documentation managed as code
- **Software Templates** - Scaffolding system for creating new projects
- **Kubernetes Integration** - Visibility and management of Kubernetes clusters
- **GitHub Integration** - Authentication, catalog import, and scaffolder actions
- **GitHub Scaffolder Module** - Extended GitHub actions for software templates
- **Claim Machinery Plugin** - Integration with Claim Machinery API for dynamic claim templates
- **Claim Registry Plugin** - Scaffolder extensions for browsing and deleting claims via GitHub PRs
- **YAML Utils Module** - Scaffolder action for parsing workspace YAML files in template workflows
- **GitHub Actions Plugin** - CI/CD visibility for GitHub Actions workflow runs on entity pages
- **Unified Search** - Cross-entity search functionality
- **RAG-AI** - Ask questions on catalog and TechDocs (Roadie RAG-AI, OpenRouter, pgvector; optional)

## Getting Started

**Prerequisites:** Node.js 22 or 24, Yarn 4.13.0

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
- [Claim Registry Plugin](docs/claim-registry-plugin.md) - Claim browsing and deletion via GitHub PRs
- [YAML Utils Module](docs/yaml-utils-module.md) - Scaffolder action for parsing YAML files
- [GitHub Actions Plugin](docs/github-actions-plugin.md) - CI/CD workflow visibility on entity pages

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

## Claim Registry Plugin

This instance includes the `backstage-claim-registry-plugin` which provides a scaffolder field extension for browsing claims from the Machinery Registry API and a backend action for deleting claims via GitHub pull requests.

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Backend Action | `packages/backend/src/plugins/scaffolder-claim-registry/` | `claim-registry:delete` scaffolder action |
| Field Extension | `packages/app/src/scaffolder/` | `RegistryClaimPicker` UI component |

### Configuration

```yaml
# app-config.yaml
proxy:
  endpoints:
    '/machinery-registry':
      target: ${CLAIM_MACHINERY_API_URL}
      changeOrigin: true
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `CLAIM_MACHINERY_API_URL` | URL of the Machinery Registry API |
| `GITHUB_TOKEN` | GitHub PAT for creating deletion PRs |

For complete installation and usage details, see the [Claim Registry Plugin documentation](docs/claim-registry-plugin.md).

## YAML Utils Module

The `utils:yaml:parse` scaffolder action reads and parses YAML files from the scaffolder workspace. This enables append-mode templates that fetch existing configuration from a repository, merge new entries, and create a PR with the combined result.

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Backend Action | `packages/backend/src/plugins/scaffolder-yaml-utils/` | `utils:yaml:parse` scaffolder action |

### Key Features

- Reads YAML files from the scaffolder workspace and outputs parsed content
- Graceful error handling: returns `{}` for missing or invalid files
- Designed for use with `fetch:plain` to enable merge/append workflows

For complete details, see the [YAML Utils Module documentation](docs/yaml-utils-module.md).

## GitHub Actions Plugin

The CI/CD tab on service and website entity pages displays GitHub Actions workflow runs for the associated repository.

### Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Frontend Plugin | `@backstage-community/plugin-github-actions` | `EntityGithubActionsContent` on CI/CD tab |
| Entity Page Integration | `packages/app/src/components/catalog/EntityPage.tsx` | Conditional rendering via `isGithubActionsAvailable` |

### Required Annotation

Catalog entities must have the `github.com/project-slug` annotation to enable the CI/CD tab:

```yaml
metadata:
  annotations:
    github.com/project-slug: 'org/repo-name'
```

For complete details, see the [GitHub Actions Plugin documentation](docs/github-actions-plugin.md).

## RAG-AI

[Roadie RAG-AI](https://github.com/RoadieHQ/roadie-backstage-plugins/tree/main/plugins/backend/rag-ai-backend)
answers questions on catalog entities and TechDocs. Chat and embeddings go to an
OpenAI-compatible endpoint, [OpenRouter](https://openrouter.ai) with free models by
default (same account and model list as homerun2-ai-pitcher). The embeddings live in a
**separate** pgvector Postgres (`rag-postgres`, flux `apps/backstage-rag-postgres`); the
main Backstage database needs no pgvector. **Off by default**: without
`RAG_AI_ENABLED=true` nothing is loaded and nothing changes.

> Roadie marks RAG-AI as a _reference implementation_ with minimal support.

### Components

| Component      | Location                                                                              | Purpose                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Backend plugin | `@roadiehq/rag-ai-backend`                                                            | pluginId **`rag-ai`**, routes under `/api/rag-ai`                                                                              |
| Backend module | `packages/backend/src/plugins/rag-ai/module.ts`                                       | module `llm`: pgvector store, OpenAI-compatible embeddings, default retrieval pipeline, `ChatOpenAI` with OpenRouter fallbacks |
| Feature loader | `packages/backend/src/plugins/rag-ai/index.ts`                                        | loads plugin and module only when `ragAi.enabled` is true                                                                      |
| Frontend       | `@roadiehq/rag-ai` → `SidebarRagModal` in `packages/app/src/components/Root/Root.tsx` | "Ask AI" sidebar entry and `ctrl+,`, shown only when `ragAi.enabled` is true                                                   |

### Environment variables

| Variable                     | Required        | Default                                                                                                    | Meaning                                                                                                                                                                                                                      |
| ---------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RAG_AI_ENABLED`             | yes (to enable) | `false`                                                                                                    | `true` loads the backend plugin and shows the sidebar entry                                                                                                                                                                  |
| `RAG_PG_HOST`                | yes             | –                                                                                                          | rag-postgres host, e.g. `rag-postgres-rw.<ns>.svc`                                                                                                                                                                           |
| `RAG_PG_PORT`                | no              | `5432`                                                                                                     | rag-postgres port                                                                                                                                                                                                            |
| `RAG_PG_DATABASE`            | no              | `backstage_rag`                                                                                            | database (created by CNPG, not by Backstage)                                                                                                                                                                                 |
| `RAG_PG_USER`                | no              | `rag`                                                                                                      | owner of the database (secret `rag-postgres-creds`, key `username`)                                                                                                                                                          |
| `RAG_PG_PASSWORD`            | yes             | –                                                                                                          | secret `rag-postgres-creds`, key `password`                                                                                                                                                                                  |
| `LLM_API_KEY`                | yes             | –                                                                                                          | API key of the endpoint, used for chat **and** embeddings (secret). Must not be empty: endpoints without auth (Ollama) take any value, e.g. `ollama`                                                                         |
| `LLM_BASE_URL`               | no              | `https://openrouter.ai/api/v1`                                                                             | any OpenAI-compatible endpoint (LiteLLM, vLLM, Ollama `/v1`)                                                                                                                                                                 |
| `LLM_MODEL`                  | no              | `nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-ultra-550b-a55b:free` | chat models, comma-separated, most reliable first; the first is used, up to 3 more are OpenRouter fallbacks (non-OpenRouter endpoints: first model only). Avoid `openrouter/free`: it can route to tiny or classifier models |
| `LLM_EMBEDDINGS_MODEL`       | no              | `nvidia/nemotron-3-embed-1b:free`                                                                          | embeddings model (2048 dimensions). Changing it requires re-indexing, see below                                                                                                                                              |
| `LLM_MAX_TOKENS`             | no              | `4000`                                                                                                     | answer token cap, including a reasoning model's thinking                                                                                                                                                                     |
| `RAG_EMBEDDINGS_CONCURRENCY` | no              | `2`                                                                                                        | parallel embeddings requests (free models: 20 requests/minute)                                                                                                                                                               |
| `RAG_CONTEXT_CHUNKS`         | no              | `6`                                                                                                        | document chunks added to each question                                                                                                                                                                                       |

Free OpenRouter models allow 20 requests/minute and **50 requests/day** (1,000/day once
the account bought ≥ 10 credits). A question costs 2 requests (embedding + chat); indexing
costs one request per 128 chunks.

### Data privacy

Every question and every indexing run sends catalog entities and TechDocs pages to
the LLM endpoint, so this content **leaves the cluster**. With the free OpenRouter
models it goes to whichever third-party provider serves the model, and free tiers may
log prompts or use them for training. Fine for public or demo content (e.g. the
`sthings-dev` catalog); for internal documentation either decide this consciously or
point `LLM_BASE_URL` at an endpoint you run yourself (see below).

### Switching the provider

Only configuration changes, no code: the chat model and the embeddings both use the
OpenAI API, which Ollama, vLLM and LiteLLM also serve. Example for Ollama:

```bash
LLM_BASE_URL=http://ollama.<ns>.svc:11434/v1
LLM_API_KEY=ollama                 # any non-empty value
LLM_MODEL=llama3.1:8b              # one model; fallbacks are OpenRouter-only
LLM_EMBEDDINGS_MODEL=nomic-embed-text
```

The vector column has no fixed dimension, so no migration is needed, but a new
embeddings model means `TRUNCATE embeddings;` and indexing everything again.

### app-config

All of it is in `app-config.yaml`, always present and filled from the variables above:

```yaml
backend:
  database:
    plugin:
      rag-ai:
        client: pg
        ensureExists: false # CNPG creates the DB; rag has no CREATEDB
        connection:
          host: ${RAG_PG_HOST:-}
          port: ${RAG_PG_PORT:-5432}
          database: ${RAG_PG_DATABASE:-backstage_rag}
          user: ${RAG_PG_USER:-rag}
          password: ${RAG_PG_PASSWORD:-}
  startup:
    plugins:
      rag-ai:
        onPluginBootFailure: continue
        modules:
          llm:
            onPluginModuleBootFailure: continue

ragAi:
  enabled: ${RAG_AI_ENABLED:-false}
  llm:
    baseUrl: ${LLM_BASE_URL:-https://openrouter.ai/api/v1}
    apiKey: ${LLM_API_KEY:-}
    models: ${LLM_MODEL:-nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-ultra-550b-a55b:free}
    maxTokens: ${LLM_MAX_TOKENS:-4000}
  indexing:
    enabled: ${RAG_INDEX_ENABLED:-true}
    schedule: ${RAG_INDEX_SCHEDULE:-0 3 * * *}

ai:
  supportedSources: ["catalog", "tech-docs"]
  prompts:
    prefix: >-
      You answer questions about the stuttgart-things platform ...
  embeddings:
    chunkSize: 1000
    chunkOverlap: 200
    concurrencyLimit: ${RAG_EMBEDDINGS_CONCURRENCY:-2}
    openai:
      openAiBaseUrl: ${LLM_BASE_URL:-https://openrouter.ai/api/v1}
      openAiApiKey: ${LLM_API_KEY:-}
      modelName: ${LLM_EMBEDDINGS_MODEL:-nvidia/nemotron-3-embed-1b:free}
      batchSize: 128 # nemotron-3-embed-1b:free takes at most 256
  storage:
    pgVector:
      amount: ${RAG_CONTEXT_CHUNKS:-6}
```

Only `ragAi.enabled` reaches the frontend; the key is marked `@visibility secret`.

### Database

- The `rag-ai` plugin gets its own connection through `backend.database.plugin.rag-ai`,
  so the main database (no pgvector) is never touched. Besides the `embeddings` table
  (`id uuid`, `content`, `metadata jsonb`, `vector`), Backstage keeps the plugin's
  signing keys there (`backstage_backend_public_keys__*`).
- The plugin's migration runs `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"` and `"vector"`.
  `vector` must exist already (CNPG `postInitApplicationSQL`); `uuid-ossp` is a trusted
  extension the database owner `rag` creates itself. Tested with a non-superuser owner.

### Indexing

The `llm` module re-indexes catalog and TechDocs on a schedule (Backstage scheduler,
`packages/backend/src/plugins/rag-ai/indexing.ts`). It needs no token and, with several
replicas, runs once per schedule.

| Variable             | Default     | Description                                                       |
| -------------------- | ----------- | ----------------------------------------------------------------- |
| `RAG_INDEX_ENABLED`  | `true`      | `false` turns the scheduled indexing off (RAG-AI itself stays on) |
| `RAG_INDEX_SCHEDULE` | `0 3 * * *` | crontab, pod time zone (usually UTC)                              |

A run:

1. indexes the catalog **per kind**,
2. builds the TechDocs of each entity with a `backstage.io/techdocs-ref` annotation
   (`/api/techdocs/sync/...`; built docs are not persisted across pod restarts) and
   indexes them **per entity**,
3. removes embeddings of entities that are no longer in the catalog.

Each slice (catalog kind, TechDocs entity) is only re-indexed when its content changed
since the last successful run, or when it has no embeddings. The content hashes live in
the table `rag_ai_index_state` next to `embeddings`; the hash includes the embeddings
model and chunking, so changing them re-indexes everything. A normal night therefore
costs only the requests for what changed. A full run (first run, model change, or after
`DELETE FROM rag_ai_index_state;`) costs about one embeddings request per catalog kind
and per TechDocs entity, plus one per 128 chunks — roughly 30 for stuttgart-things.

Roadie deletes the embeddings of the matched entities before creating new ones. The
small slices keep a failed embeddings request (e.g. a rate limit) from wiping more than
one kind or entity; an entity whose docs do not build keeps its old embeddings. Failures
are logged as warnings and retried on the next run. A fresh database is filled at the
first scheduled run.

To index by hand, use the backend API (needs a Backstage user or service token):

```bash
# TechDocs of some components (docs must have been built/published)
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  http://localhost:7007/api/rag-ai/embeddings/tech-docs \
  -d '{"entityFilter":{"kind":"component","metadata.name":["flux","claim-machinery-api"]}}'

# catalog entities
curl -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  http://localhost:7007/api/rag-ai/embeddings/catalog -d '{"entityFilter":{"kind":"component"}}'
```

Re-running a POST replaces the embeddings of the matched entities. After changing
`LLM_EMBEDDINGS_MODEL`, run `TRUNCATE embeddings;` in `backstage_rag`: vectors of
different models cannot be compared. The next scheduled run indexes everything again.

### Switching it off

Leave `RAG_AI_ENABLED` unset (or `false`): plugin and module are not loaded, the sidebar
entry is hidden, the `rag-ai` database config is never used. With RAG enabled but
rag-postgres unreachable or `LLM_API_KEY` missing, the backend still starts;
only `/api/rag-ai` is unavailable and the error is logged.
## Known Upgrade Constraints

### React 19

React 19 upgrade is **blocked** by upstream Backstage dependencies (as of April 2026). Key blockers:

| Dependency | Issue | Status |
|-----------|-------|--------|
| `@material-ui/core` (MUI v4) | Uses `ReactDOM.findDOMNode()`, removed in React 19 | Waiting on Backstage MUI v5 migration |
| `@graphiql/react@0.29.0` | Uses `unmountComponentAtNode`, removed in React 19. Newer versions (0.37+) have breaking API changes incompatible with `@backstage/plugin-api-docs` | Waiting on `@backstage/plugin-api-docs` update |
| `react-markdown@8.0.7` | TypeScript type errors with `@types/react@19` | Fixable via resolution to `^10.1.0`, but moot given the above |

**Action:** Revisit once Backstage officially supports React 19 and completes the MUI v5 migration. Track progress in the [Backstage MUI v5 migration issue](https://github.com/backstage/backstage/issues/20447).

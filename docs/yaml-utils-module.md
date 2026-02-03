# YAML Utils Scaffolder Module

This document describes the `utils:yaml:parse` custom scaffolder action for reading and parsing YAML files within scaffolder template workflows.

## Overview

The YAML Utils module provides a scaffolder action that reads a YAML file from the scaffolder workspace and outputs its parsed content as a step output. This enables templates to fetch existing configuration files, parse them, and merge new entries with the existing data.

## Architecture

```
TEMPLATE WORKFLOW:

1. fetch:plain
   Download existing files from a repository into the workspace

2. utils:yaml:parse
   ┌────────────────────────────────┐
   │  Read YAML file from workspace │
   │  Parse content with js-yaml    │
   │  Output parsed object          │
   └───────────────┬────────────────┘
                   │ output.content
                   v
3. fetch:template
   Render skeleton templates using both existing
   and new data as template values
```

## Installation

### 1. Backend Module

The action is defined at `packages/backend/src/plugins/scaffolder-yaml-utils/index.ts`:

```typescript
import { createBackendModule } from '@backstage/backend-plugin-api';
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node/alpha';
import fs from 'fs-extra';
import yaml from 'js-yaml';
import path from 'path';

const yamlParseAction = () => {
  return createTemplateAction<{
    filePath: string;
  }>({
    id: 'utils:yaml:parse',
    description:
      'Reads a YAML file from the scaffolder workspace and outputs its parsed content',

    async handler(ctx) {
      const filePath = path.resolve(ctx.workspacePath, ctx.input.filePath);

      const exists = await fs.pathExists(filePath);
      if (!exists) {
        ctx.logger.warn(`File not found: ${ctx.input.filePath}, returning empty object`);
        ctx.output('content', {});
        return;
      }

      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = yaml.load(raw);

        if (!parsed || typeof parsed !== 'object') {
          ctx.logger.warn(
            `File ${ctx.input.filePath} did not contain a YAML object, returning empty object`,
          );
          ctx.output('content', {});
          return;
        }

        ctx.output('content', parsed);
      } catch (err) {
        ctx.logger.warn(
          `Failed to parse YAML file ${ctx.input.filePath}: ${err}, returning empty object`,
        );
        ctx.output('content', {});
      }
    },
  });
};

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'yaml-utils',
  register(env) {
    env.registerInit({
      deps: {
        scaffolderActions: scaffolderActionsExtensionPoint,
      },
      async init({ scaffolderActions }) {
        scaffolderActions.addActions(yamlParseAction());
      },
    });
  },
});
```

Register the module in `packages/backend/src/index.ts`:

```typescript
// yaml-utils scaffolder module
backend.add(import('./plugins/scaffolder-yaml-utils'));
```

### 2. Install Dependencies

```bash
cd packages/backend
yarn add js-yaml
```

## Action Reference

### `utils:yaml:parse`

Reads a YAML file from the scaffolder workspace and outputs its parsed content.

#### Input

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `filePath` | string | yes | Path to the YAML file, relative to the workspace root |

#### Output

| Field | Type | Description |
|-------|------|-------------|
| `content` | object | Parsed YAML content. Returns `{}` if the file is missing, invalid, or not a YAML object |

#### Error Handling

The action handles errors gracefully and never fails the template step:

| Scenario | Behavior |
|----------|----------|
| File not found | Logs warning, returns `{}` |
| Invalid YAML syntax | Logs warning, returns `{}` |
| YAML content is not an object (e.g. a string or null) | Logs warning, returns `{}` |
| Valid YAML object | Returns parsed content |

## Usage in Templates

A typical use case is fetching existing configuration from a repository, parsing it, and merging it with new user-provided data.

### Example: Append to Existing Configuration

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: update-config
spec:
  parameters:
    - title: Additional Packages
      properties:
        packages:
          title: Additional Packages
          type: array
          default: []
          items:
            type: string

  steps:
    # Step 1: Fetch existing files from the repository
    - id: fetch-existing
      name: Fetch Existing Configuration
      action: fetch:plain
      input:
        url: https://github.com/org/repo/tree/main/path/to/config
        targetPath: existing

    # Step 2: Parse the existing YAML file
    - id: parse-existing
      name: Parse Existing Config
      action: utils:yaml:parse
      input:
        filePath: existing/packages.yaml

    # Step 3: Render merged configuration
    - id: render
      name: Render Configuration
      action: fetch:template
      input:
        url: ./skeleton
        values:
          existingPackages: ${{ steps['parse-existing'].output.content.packages }}
          newPackages: ${{ parameters.packages }}
```

The skeleton template can then merge both lists:

```yaml
# skeleton/packages.yaml
packages:
{%- if values.existingPackages %}
{%- for pkg in values.existingPackages %}
  - ${{ pkg }}
{%- endfor %}
{%- endif %}
{%- for pkg in values.newPackages %}
  - ${{ pkg }}
{%- endfor %}
```

## File Structure

```
packages/backend/
└── src/
    ├── index.ts                         # Register backend module
    └── plugins/
        └── scaffolder-yaml-utils/
            └── index.ts                 # Module + action implementation
```

## Troubleshooting

### Action Not Found

1. Verify the module is registered in `packages/backend/src/index.ts`
2. Ensure `js-yaml` is installed: `yarn add js-yaml` in `packages/backend`
3. Restart the backend after changes

### Empty Output

1. Check backend logs for warnings from `utils:yaml:parse`
2. Verify the `filePath` is correct relative to the workspace root
3. Ensure the `fetch:plain` step completed before the parse step
4. Confirm the YAML file contains a valid object (not a scalar or array at the root)

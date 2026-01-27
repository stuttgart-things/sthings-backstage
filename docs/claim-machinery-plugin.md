# Claim Machinery Plugin

This document describes the installation and configuration of the `backstage-claim-machinery-plugin` for integrating with the Claim Machinery API.

## Overview

The Claim Machinery Plugin provides scaffolder extensions that allow users to:

- Browse and select claim templates from a remote API
- Configure template parameters through a dynamic form
- Render Kubernetes claim manifests during scaffolder execution

## Architecture

```
FRONTEND COMPONENTS:
┌────────────────────────────────┐
│  ClaimMachineryPicker          │ Dropdown for selecting templates
│  ClaimMachineryParameters      │ Dynamic form for template parameters
└───────────────┬────────────────┘
                │ fetch via proxy
                v
┌────────────────────────────────┐
│  Backstage Proxy               │
│  /api/proxy/claim-machinery    │
└───────────────┬────────────────┘
                │ HTTP
                v
┌────────────────────────────────┐
│  Claim Machinery API           │
│  /api/v1/claim-templates       │
└────────────────────────────────┘

BACKEND ACTION:
┌────────────────────────────────┐
│  Scaffolder Template           │
│  action: claim-machinery:render│
└───────────────┬────────────────┘
                │ direct API call
                v
┌────────────────────────────────┐
│  Claim Machinery API           │
│  POST /api/v1/claim-templates/ │
│  {template}/order              │
└────────────────────────────────┘
```

## Installation

### 1. Backend Module

Create the scaffolder action module at `packages/backend/src/plugins/scaffolder-claim-machinery/index.ts`:

```typescript
import { createBackendModule } from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node/alpha';
import { claimMachineryRenderAction } from './action';
import { coreServices } from '@backstage/backend-plugin-api';

export default createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'claim-machinery',
  register(env) {
    env.registerInit({
      deps: {
        scaffolder: scaffolderActionsExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ scaffolder, config }) {
        scaffolder.addActions(claimMachineryRenderAction(config));
      },
    });
  },
});
```

Create the action implementation at `packages/backend/src/plugins/scaffolder-claim-machinery/action.ts`:

```typescript
import { createTemplateAction } from '@backstage/plugin-scaffolder-node';
import { Config } from '@backstage/config';
import fetch from 'node-fetch';
import fs from 'fs-extra';
import path from 'path';

export const claimMachineryRenderAction = (config: Config) => {
  const apiUrl = config.getString('claimMachinery.apiUrl');

  return createTemplateAction<{
    template: string;
    parameters?: Record<string, unknown>;
    outputPath?: string;
  }>({
    id: 'claim-machinery:render',
    description: 'Renders a claim template using the Claim Machinery API',
    schema: {
      input: {
        type: 'object',
        required: ['template'],
        properties: {
          template: {
            type: 'string',
            title: 'Template Name',
            description: 'The name of the claim template to render',
          },
          parameters: {
            type: 'object',
            title: 'Template Parameters',
            description: 'Parameters to pass to the template',
          },
          outputPath: {
            type: 'string',
            title: 'Output Path',
            description: 'Directory to save the rendered manifest',
          },
        },
      },
      output: {
        type: 'object',
        properties: {
          manifest: {
            type: 'string',
            description: 'The rendered manifest content',
          },
          filePath: {
            type: 'string',
            description: 'Path to the saved manifest file',
          },
        },
      },
    },
    async handler(ctx) {
      const { template, parameters = {}, outputPath = '' } = ctx.input;
      const url = `${apiUrl}/api/v1/claim-templates/${template}/order`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parameters),
        timeout: 60000,
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const manifest = await response.text();
      const outputDir = path.join(ctx.workspacePath, outputPath);
      const filePath = path.join(outputDir, 'claim.yaml');

      await fs.ensureDir(outputDir);
      await fs.writeFile(filePath, manifest);

      ctx.output('manifest', manifest);
      ctx.output('filePath', filePath);
    },
  });
};
```

Register the module in `packages/backend/src/index.ts`:

```typescript
// Claim Machinery custom scaffolder action
backend.add(import('./plugins/scaffolder-claim-machinery'));
```

### 2. Frontend Field Extensions

Create the frontend components in `packages/app/src/scaffolder/`:

**`packages/app/src/scaffolder/index.ts`:**

```typescript
export { ClaimMachineryPickerFieldExtension } from './ClaimMachineryPickerExtension';
export { ClaimMachineryParametersFieldExtension } from './ClaimMachineryParametersExtension';
```

**`packages/app/src/scaffolder/ClaimMachineryPickerExtension.tsx`:**

```typescript
import React, { useEffect, useState } from 'react';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';
import { FormControl, InputLabel, Select, MenuItem, CircularProgress } from '@material-ui/core';

interface Template {
  name: string;
  title: string;
  description: string;
}

const ClaimMachineryPicker = ({ onChange, formData }: FieldExtensionComponentProps<string>) => {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const config = useApi(configApiRef);
  const backendUrl = config.getString('backend.baseUrl');

  useEffect(() => {
    fetch(`${backendUrl}/api/proxy/claim-machinery/api/v1/claim-templates`)
      .then(res => res.json())
      .then(data => {
        setTemplates(data.templates || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [backendUrl]);

  if (loading) return <CircularProgress size={24} />;

  return (
    <FormControl fullWidth>
      <InputLabel>Claim Template</InputLabel>
      <Select value={formData || ''} onChange={e => onChange(e.target.value as string)}>
        {templates.map(t => (
          <MenuItem key={t.name} value={t.name}>{t.title}</MenuItem>
        ))}
      </Select>
    </FormControl>
  );
};

export const ClaimMachineryPickerFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'ClaimMachineryPicker',
    component: ClaimMachineryPicker,
  }),
);
```

**`packages/app/src/scaffolder/ClaimMachineryParametersExtension.tsx`:**

```typescript
import React, { useEffect, useState } from 'react';
import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import { scaffolderPlugin } from '@backstage/plugin-scaffolder';
import { createScaffolderFieldExtension } from '@backstage/plugin-scaffolder-react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';
import { TextField, FormControlLabel, Checkbox, FormControl, InputLabel, Select, MenuItem } from '@material-ui/core';

interface TemplateParameter {
  name: string;
  type: string;
  description?: string;
  default?: unknown;
  enum?: string[];
}

const ClaimMachineryParameters = ({
  onChange,
  formData,
  formContext
}: FieldExtensionComponentProps<Record<string, unknown>>) => {
  const [parameters, setParameters] = useState<TemplateParameter[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>(formData || {});
  const config = useApi(configApiRef);
  const backendUrl = config.getString('backend.baseUrl');
  const templateName = formContext?.formData?.template;

  useEffect(() => {
    if (!templateName) return;
    fetch(`${backendUrl}/api/proxy/claim-machinery/api/v1/claim-templates/${templateName}`)
      .then(res => res.json())
      .then(data => {
        setParameters(data.parameters || []);
        const defaults: Record<string, unknown> = {};
        (data.parameters || []).forEach((p: TemplateParameter) => {
          if (p.default !== undefined) defaults[p.name] = p.default;
        });
        setValues(prev => ({ ...defaults, ...prev }));
        onChange({ ...defaults, ...values });
      });
  }, [templateName, backendUrl]);

  const updateValue = (name: string, value: unknown) => {
    const newValues = { ...values, [name]: value };
    setValues(newValues);
    onChange(newValues);
  };

  return (
    <div>
      {parameters.map(param => {
        if (param.type === 'boolean') {
          return (
            <FormControlLabel
              key={param.name}
              control={<Checkbox checked={!!values[param.name]} onChange={e => updateValue(param.name, e.target.checked)} />}
              label={param.name}
            />
          );
        }
        if (param.enum) {
          return (
            <FormControl key={param.name} fullWidth margin="normal">
              <InputLabel>{param.name}</InputLabel>
              <Select value={values[param.name] || ''} onChange={e => updateValue(param.name, e.target.value)}>
                {param.enum.map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
              </Select>
            </FormControl>
          );
        }
        return (
          <TextField
            key={param.name}
            fullWidth
            margin="normal"
            label={param.name}
            helperText={param.description}
            value={values[param.name] || ''}
            onChange={e => updateValue(param.name, e.target.value)}
          />
        );
      })}
    </div>
  );
};

export const ClaimMachineryParametersFieldExtension = scaffolderPlugin.provide(
  createScaffolderFieldExtension({
    name: 'ClaimMachineryParameters',
    component: ClaimMachineryParameters,
  }),
);
```

Register the extensions in `packages/app/src/App.tsx`:

```typescript
import {
  ClaimMachineryParametersFieldExtension,
  ClaimMachineryPickerFieldExtension,
} from './scaffolder';

// Inside the routes:
<Route path="/create" element={<ScaffolderPage />}>
  <ScaffolderFieldExtensions>
    <ClaimMachineryPickerFieldExtension />
    <ClaimMachineryParametersFieldExtension />
  </ScaffolderFieldExtensions>
</Route>
```

### 3. Install Dependencies

```bash
# Backend dependencies
cd packages/backend
yarn add fs-extra node-fetch@2
yarn add -D @types/fs-extra @types/node-fetch

# Frontend dependencies
cd packages/app
yarn add @backstage/plugin-scaffolder-react
```

## Configuration

Add the following to `app-config.yaml`:

```yaml
# Claim Machinery API configuration
claimMachinery:
  apiUrl: ${CLAIM_MACHINERY_API_URL}

# Proxy for frontend requests
proxy:
  endpoints:
    '/claim-machinery':
      target: ${CLAIM_MACHINERY_API_URL}
      changeOrigin: true
      pathRewrite:
        '^/api/proxy/claim-machinery': ''
      allowedHeaders: ['*']
      credentials: 'dangerously-allow-unauthenticated'
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAIM_MACHINERY_API_URL` | URL of the Claim Machinery API | `https://claim-api.idp.kubermatic.sva.dev` |

## Usage in Templates

Use the plugin in scaffolder templates:

```yaml
apiVersion: scaffolder.backstage.io/v1beta3
kind: Template
metadata:
  name: claim-template
  title: Create Claim
spec:
  parameters:
    - title: Select Claim Template
      properties:
        template:
          type: string
          ui:field: ClaimMachineryPicker
        parameters:
          type: object
          ui:field: ClaimMachineryParameters

  steps:
    - id: render-claim
      name: Render Claim Manifest
      action: claim-machinery:render
      input:
        template: ${{ parameters.template }}
        parameters: ${{ parameters.parameters }}
        outputPath: ./manifests

    - id: show-manifest
      name: Show Rendered Manifest
      action: debug:log
      input:
        message: |
          Rendered manifest:
          ${{ steps['render-claim'].output.manifest }}
```

## File Structure

```
packages/
├── app/
│   └── src/
│       ├── App.tsx                              # Register field extensions
│       └── scaffolder/
│           ├── index.ts                         # Export extensions
│           ├── ClaimMachineryPickerExtension.tsx
│           └── ClaimMachineryParametersExtension.tsx
└── backend/
    └── src/
        ├── index.ts                             # Register backend module
        └── plugins/
            └── scaffolder-claim-machinery/
                ├── index.ts                     # Backend module definition
                └── action.ts                    # Scaffolder action implementation
```

## Troubleshooting

### Templates Not Loading

1. Verify the Claim Machinery API is accessible
2. Check the proxy configuration in `app-config.yaml`
3. Inspect browser network tab for API errors

### Action Execution Fails

1. Verify `claimMachinery.apiUrl` is set correctly
2. Check backend logs for connection errors
3. Ensure the template name exists in the API

### Parameters Not Updating

1. Clear browser cache and reload
2. Verify the template was selected before expecting parameters
3. Check for JavaScript errors in the console

import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  Divider,
  FormControl,
  FormControlLabel,
  FormHelperText,
  IconButton,
  Input,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  TextField,
  Typography,
} from '@material-ui/core';
import AddIcon from '@material-ui/icons/Add';
import DeleteIcon from '@material-ui/icons/Delete';
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';

interface TemplateParameter {
  name: string;
  title?: string;
  type: string;
  required?: boolean;
  description?: string;
  default?: any;
  enum?: string[];
  multiselect?: boolean;
  hidden?: boolean;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
}

interface ClaimTemplate {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    title?: string;
    description?: string;
    tags?: string[];
  };
  spec: {
    type: string;
    source: string;
    tag: string;
    parameters?: TemplateParameter[];
  };
}

interface ClaimEntry {
  template: string;
  parameters: Record<string, any>;
  destPath?: string;
  destFilename?: string;
}

/**
 * Renders a parameter input field based on the parameter type definition.
 */
function ParameterField({
  param,
  value,
  onChange,
}: {
  param: TemplateParameter;
  value: any;
  onChange: (value: any) => void;
}) {
  const isRequired = param.required ?? false;

  if (param.type === 'boolean') {
    return (
      <FormControl fullWidth margin="dense">
        <FormControlLabel
          control={
            <Checkbox
              checked={Boolean(value)}
              onChange={e => onChange(e.target.checked)}
              color="primary"
              size="small"
            />
          }
          label={
            <Typography variant="body2">
              {param.title || param.name}
              {isRequired && <span style={{ color: 'red' }}> *</span>}
            </Typography>
          }
        />
      </FormControl>
    );
  }

  if (param.multiselect && param.enum && param.enum.length > 0) {
    const multiValue = Array.isArray(value) ? value : value ? [value] : [];
    return (
      <FormControl fullWidth margin="dense" required={isRequired}>
        <Typography variant="caption">
          {param.title || param.name}
          {isRequired && <span style={{ color: 'red' }}> *</span>}
        </Typography>
        <Select
          multiple
          value={multiValue}
          onChange={e => onChange(e.target.value as string[])}
          input={<Input />}
          renderValue={selected => (
            <Box display="flex" flexWrap="wrap" style={{ gap: 4 }}>
              {(selected as string[]).map(val => (
                <Chip key={val} label={val} size="small" />
              ))}
            </Box>
          )}
        >
          {param.enum.map(option => (
            <MenuItem key={option} value={option}>
              <Checkbox
                checked={multiValue.indexOf(option) > -1}
                color="primary"
                size="small"
              />
              {option}
            </MenuItem>
          ))}
        </Select>
        {param.description && (
          <FormHelperText>{param.description}</FormHelperText>
        )}
      </FormControl>
    );
  }

  if (param.enum && param.enum.length > 0) {
    return (
      <FormControl fullWidth margin="dense" required={isRequired}>
        <Typography variant="caption">
          {param.title || param.name}
          {isRequired && <span style={{ color: 'red' }}> *</span>}
        </Typography>
        <Select
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          displayEmpty
        >
          <MenuItem value="">
            <em>Select {param.title || param.name}</em>
          </MenuItem>
          {param.enum.map(option => (
            <MenuItem key={option} value={option}>
              {option}
            </MenuItem>
          ))}
        </Select>
        {param.description && (
          <FormHelperText>{param.description}</FormHelperText>
        )}
      </FormControl>
    );
  }

  if (param.type === 'array') {
    return (
      <TextField
        label={param.title || param.name}
        value={Array.isArray(value) ? value.join(', ') : value ?? ''}
        onChange={e => {
          const arrayValue = e.target.value
            .split(',')
            .map(v => v.trim())
            .filter(v => v);
          onChange(arrayValue);
        }}
        required={isRequired}
        helperText={param.description || 'Enter comma-separated values'}
        variant="outlined"
        size="small"
        fullWidth
        margin="dense"
      />
    );
  }

  return (
    <TextField
      label={param.title || param.name}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      required={isRequired}
      helperText={param.description}
      variant="outlined"
      size="small"
      fullWidth
      margin="dense"
      inputProps={{
        pattern: param.pattern,
        minLength: param.minLength,
        maxLength: param.maxLength,
      }}
    />
  );
}

/**
 * A single claim row: template picker + dynamic parameters.
 */
function ClaimRow({
  index,
  entry,
  templates,
  onUpdate,
  onRemove,
  backendUrl,
}: {
  index: number;
  entry: ClaimEntry;
  templates: ClaimTemplate[];
  onUpdate: (index: number, entry: ClaimEntry) => void;
  onRemove: (index: number) => void;
  backendUrl: string;
}) {
  const [templateDetail, setTemplateDetail] = useState<ClaimTemplate | null>(
    null,
  );
  const [loading, setLoading] = useState(false);

  // Fetch template details when template changes
  useEffect(() => {
    if (!entry.template) {
      setTemplateDetail(null);
      return;
    }

    let cancelled = false;
    const fetchDetail = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${backendUrl}/api/proxy/claim-machinery/api/v1/claim-templates/${entry.template}`,
        );
        if (res.ok && !cancelled) {
          const data = await res.json();
          setTemplateDetail(data);

          // Initialize defaults for newly selected template
          const defaults: Record<string, any> = {};
          data.spec.parameters?.forEach((p: TemplateParameter) => {
            if (p.default !== undefined) {
              defaults[p.name] = p.default;
            }
          });
          onUpdate(index, {
            template: entry.template,
            parameters: { ...defaults, ...entry.parameters },
            destPath: entry.destPath,
            destFilename: entry.destFilename,
          });
        }
      } catch {
        // silently fail — user will see empty params
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchDetail();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry.template, backendUrl]);

  const handleTemplateChange = (
    event: React.ChangeEvent<{ value: unknown }>,
  ) => {
    onUpdate(index, {
      template: event.target.value as string,
      parameters: {},
      destPath: entry.destPath,
      destFilename: entry.destFilename,
    });
  };

  const handleParamChange = (paramName: string, value: any) => {
    onUpdate(index, {
      ...entry,
      parameters: { ...entry.parameters, [paramName]: value },
    });
  };

  const visibleParams =
    templateDetail?.spec.parameters?.filter(p => !p.hidden) ?? [];

  return (
    <Paper variant="outlined" style={{ padding: 16, marginBottom: 12 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle2">Claim #{index + 1}</Typography>
        <IconButton size="small" onClick={() => onRemove(index)}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>

      <FormControl fullWidth margin="dense">
        <InputLabel>Template</InputLabel>
        <Select
          value={entry.template || ''}
          onChange={handleTemplateChange}
          label="Template"
        >
          <MenuItem value="">
            <em>Select a template</em>
          </MenuItem>
          {templates.map(t => (
            <MenuItem key={t.metadata.name} value={t.metadata.name}>
              {t.metadata.title || t.metadata.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {loading && (
        <Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
          Loading parameters...
        </Typography>
      )}

      {!loading && visibleParams.length > 0 && (
        <Box marginTop={1}>
          <Divider style={{ marginBottom: 8 }} />
          {visibleParams.map(param => (
            <ParameterField
              key={param.name}
              param={param}
              value={entry.parameters[param.name] ?? param.default ?? ''}
              onChange={val => handleParamChange(param.name, val)}
            />
          ))}
        </Box>
      )}

      {!loading && entry.template && visibleParams.length === 0 && templateDetail && (
        <Typography variant="body2" color="textSecondary" style={{ marginTop: 8 }}>
          No parameters required for this template
        </Typography>
      )}

      {entry.template && (
        <Box marginTop={1}>
          <Divider style={{ marginBottom: 8 }} />
          <Typography variant="caption" color="textSecondary">
            Destination (optional overrides)
          </Typography>
          <Box display="flex" style={{ gap: 8 }}>
            <TextField
              label="Destination Path"
              value={entry.destPath ?? ''}
              onChange={e =>
                onUpdate(index, { ...entry, destPath: e.target.value || undefined })
              }
              helperText="e.g. clusters/prod/manifests"
              variant="outlined"
              size="small"
              fullWidth
              margin="dense"
            />
            <TextField
              label="Filename"
              value={entry.destFilename ?? ''}
              onChange={e =>
                onUpdate(index, { ...entry, destFilename: e.target.value || undefined })
              }
              helperText="e.g. my-vm.yaml"
              variant="outlined"
              size="small"
              fullWidth
              margin="dense"
            />
          </Box>
        </Box>
      )}
    </Paper>
  );
}

/**
 * Multi-claim scaffolder field extension.
 *
 * Outputs a JSON-stringified array of { template, parameters } objects.
 */
export const ClaimMachineryMultiClaimExtension = ({
  onChange,
  rawErrors,
  required,
  formData,
  schema,
}: FieldExtensionComponentProps<string>) => {
  const config = useApi(configApiRef);
  const backendUrl = config.getString('backend.baseUrl');

  const [templates, setTemplates] = useState<ClaimTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Parse existing formData (JSON string) or start with one empty entry
  const [entries, setEntries] = useState<ClaimEntry[]>(() => {
    if (formData) {
      try {
        return JSON.parse(formData);
      } catch {
        // fall through
      }
    }
    return [{ template: '', parameters: {} }];
  });

  // Fetch available templates
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await fetch(
          `${backendUrl}/api/proxy/claim-machinery/api/v1/claim-templates`,
        );
        if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
        const data = await res.json();
        setTemplates(data.items || []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to load templates',
        );
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, [backendUrl]);

  // Emit changes upstream as JSON string
  const emitChange = useCallback(
    (newEntries: ClaimEntry[]) => {
      setEntries(newEntries);
      onChange(JSON.stringify(newEntries));
    },
    [onChange],
  );

  const handleUpdate = useCallback(
    (index: number, entry: ClaimEntry) => {
      const next = [...entries];
      next[index] = entry;
      emitChange(next);
    },
    [entries, emitChange],
  );

  const handleRemove = useCallback(
    (index: number) => {
      const next = entries.filter((_, i) => i !== index);
      if (next.length === 0) next.push({ template: '', parameters: {} });
      emitChange(next);
    },
    [entries, emitChange],
  );

  const handleAdd = useCallback(() => {
    emitChange([...entries, { template: '', parameters: {} }]);
  }, [entries, emitChange]);

  if (loading) {
    return <Typography>Loading Claim Machinery templates...</Typography>;
  }

  if (error) {
    return (
      <FormControl error fullWidth>
        <Typography color="error">Error: {error}</Typography>
        <FormHelperText>
          Make sure the Claim Machinery API is accessible
        </FormHelperText>
      </FormControl>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle1" gutterBottom>
        {schema.title || 'Resource Claims'}
      </Typography>
      {schema.description && (
        <Typography variant="body2" color="textSecondary" paragraph>
          {schema.description}
        </Typography>
      )}

      {entries.map((entry, i) => (
        <ClaimRow
          key={i}
          index={i}
          entry={entry}
          templates={templates}
          onUpdate={handleUpdate}
          onRemove={handleRemove}
          backendUrl={backendUrl}
        />
      ))}

      <Button
        variant="outlined"
        color="primary"
        startIcon={<AddIcon />}
        onClick={handleAdd}
        size="small"
      >
        Add another claim
      </Button>

      {required && rawErrors && rawErrors.length > 0 && (
        <FormHelperText error style={{ marginTop: 8 }}>
          At least one claim with a selected template is required
        </FormHelperText>
      )}
    </Box>
  );
};

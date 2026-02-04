import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
    Box,
    Checkbox,
    Chip,
    FormControl,
    FormControlLabel,
    FormHelperText,
    Input,
    MenuItem,
    Select,
    TextField,
    Typography,
} from '@material-ui/core';
import { useEffect, useState } from 'react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';

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
    parameters?: Array<{
      name: string;
      title?: string;
      type: string;
      required?: boolean;
      description?: string;
      default?: any;
      enum?: string[];
      multiselect?: boolean;
      hidden?: boolean;
      allowRandom?: boolean;
      pattern?: string;
      minLength?: number;
      maxLength?: number;
    }>;
  };
}

export const ClaimMachineryParametersExtension = ({
  onChange,
  formData,
  formContext,
}: FieldExtensionComponentProps<Record<string, any>>) => {
  console.log('ClaimMachineryParametersExtension RENDERED');

  const config = useApi(configApiRef);
  const [template, setTemplate] = useState<ClaimTemplate | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parameters, setParameters] = useState<Record<string, any>>(formData || {});

  // Get the selected template name from form context
  const selectedTemplateName = formContext?.formData?.claimTemplate;

  // Initialize with empty object if undefined
  useEffect(() => {
    if (formData === undefined) {
      onChange({});
    }
  }, []);

  // Debug logging
  useEffect(() => {
    console.log('ClaimMachineryParameters - formContext:', formContext);
    console.log('ClaimMachineryParameters - selectedTemplateName:', selectedTemplateName);
    console.log('ClaimMachineryParameters - formData:', formData);
  }, [formContext, selectedTemplateName, formData]);

  // Fetch template details when template name changes
  useEffect(() => {
    const fetchTemplateDetails = async () => {
      if (!selectedTemplateName) {
        setTemplate(null);
        setError(null);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        console.log('Fetching template details for:', selectedTemplateName);

        // Get backend URL from config and use proxy
        const backendUrl = config.getString('backend.baseUrl');
        const response = await fetch(
          `${backendUrl}/api/proxy/claim-machinery/api/v1/claim-templates/${selectedTemplateName}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch template: ${response.statusText}`);
        }

        const data = await response.json();
        console.log('Template data received:', data);
        setTemplate(data);

        // Initialize parameters with defaults
        const defaultParams: Record<string, any> = {};
        data.spec.parameters?.forEach((param: any) => {
          if (param.default !== undefined) {
            defaultParams[param.name] = param.default;
          }
        });

        const mergedParams = { ...defaultParams, ...parameters };
        setParameters(mergedParams);
        onChange(mergedParams);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to load template';
        console.error('Error fetching template details:', err);
        setError(errorMsg);
      } finally {
        setLoading(false);
      }
    };

    fetchTemplateDetails();
  }, [selectedTemplateName]);

  const handleParameterChange = (paramName: string, value: any) => {
    const newParams = { ...parameters, [paramName]: value };
    setParameters(newParams);
    onChange(newParams);
  };

  if (!selectedTemplateName) {
    return (
      <Box padding={2} bgcolor="#f5f5f5" borderRadius={1}>
        <Typography color="textSecondary">
          Please select a Claim Template first
        </Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box padding={2} bgcolor="#f5f5f5" borderRadius={1}>
        <Typography>Loading template parameters...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box padding={2} bgcolor="#ffebee" borderRadius={1}>
        <Typography color="error">Error: {error}</Typography>
      </Box>
    );
  }

  if (!template || !template.spec.parameters || template.spec.parameters.length === 0) {
    return (
      <Box padding={2} bgcolor="#e8f5e9" borderRadius={1}>
        <Typography color="textSecondary">
          No parameters required for this template
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        {template.metadata.title || template.metadata.name} Parameters
      </Typography>
      {template.metadata.description && (
        <Typography variant="body2" color="textSecondary" paragraph>
          {template.metadata.description}
        </Typography>
      )}

      {template.spec.parameters
        .filter((param) => !param.hidden)
        .map((param) => {
        const value = parameters[param.name] ?? param.default ?? '';
        const isRequired = param.required ?? false;

        // Render based on parameter type
        if (param.type === 'boolean') {
          return (
            <FormControl key={param.name} fullWidth margin="normal">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={Boolean(value)}
                    onChange={(e) => handleParameterChange(param.name, e.target.checked)}
                    color="primary"
                  />
                }
                label={
                  <Box>
                    <Typography component="span">
                      {param.title || param.name}
                      {isRequired && <span style={{ color: 'red' }}> *</span>}
                    </Typography>
                    {param.description && (
                      <Typography variant="caption" display="block" color="textSecondary">
                        {param.description}
                      </Typography>
                    )}
                  </Box>
                }
              />
            </FormControl>
          );
        }

        if (param.multiselect && param.enum && param.enum.length > 0) {
          const multiValue = Array.isArray(value) ? value : (value ? [value] : []);
          return (
            <FormControl key={param.name} fullWidth margin="normal" required={isRequired}>
              <Typography variant="body2" gutterBottom>
                {param.title || param.name}
                {isRequired && <span style={{ color: 'red' }}> *</span>}
              </Typography>
              <Select
                multiple
                value={multiValue}
                onChange={(e) => handleParameterChange(param.name, e.target.value as string[])}
                input={<Input />}
                renderValue={(selected) => (
                  <Box display="flex" flexWrap="wrap" style={{ gap: 4 }}>
                    {(selected as string[]).map((val) => (
                      <Chip key={val} label={val} size="small" />
                    ))}
                  </Box>
                )}
              >
                {param.enum.map((option) => (
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
            <FormControl key={param.name} fullWidth margin="normal" required={isRequired}>
              <Typography variant="body2" gutterBottom>
                {param.title || param.name}
                {isRequired && <span style={{ color: 'red' }}> *</span>}
              </Typography>
              <Select
                value={value}
                onChange={(e) => handleParameterChange(param.name, e.target.value)}
                displayEmpty
              >
                <MenuItem value="">
                  <em>Select {param.title || param.name}</em>
                </MenuItem>
                {param.enum.map((option) => (
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
            <FormControl key={param.name} fullWidth margin="normal" required={isRequired}>
              <TextField
                label={param.title || param.name}
                value={Array.isArray(value) ? value.join(', ') : value}
                onChange={(e) => {
                  const arrayValue = e.target.value.split(',').map(v => v.trim()).filter(v => v);
                  handleParameterChange(param.name, arrayValue);
                }}
                required={isRequired}
                helperText={param.description || 'Enter comma-separated values'}
                variant="outlined"
                fullWidth
              />
            </FormControl>
          );
        }

        // Default: text input
        return (
          <FormControl key={param.name} fullWidth margin="normal" required={isRequired}>
            <TextField
              label={param.title || param.name}
              value={value}
              onChange={(e) => handleParameterChange(param.name, e.target.value)}
              required={isRequired}
              helperText={param.description}
              variant="outlined"
              fullWidth
              inputProps={{
                pattern: param.pattern,
                minLength: param.minLength,
                maxLength: param.maxLength,
              }}
            />
          </FormControl>
        );
      })}
    </Box>
  );
};

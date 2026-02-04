import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
    Box,
    Chip,
    CircularProgress,
    FormControl,
    FormHelperText,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Typography,
} from '@material-ui/core';
import React, { useEffect, useState } from 'react';
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

export const ClaimMachineryPickerExtension = ({
  onChange,
  rawErrors,
  required,
  formData,
  idSchema,
  schema,
}: FieldExtensionComponentProps<string>) => {
  const config = useApi(configApiRef);
  const [templates, setTemplates] = useState<ClaimTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<ClaimTemplate | null>(null);

  // Fetch available templates from Claim Machinery API
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        setLoading(true);
        // Get backend URL from config and use proxy
        const backendUrl = config.getString('backend.baseUrl');
        const response = await fetch(`${backendUrl}/api/proxy/claim-machinery/api/v1/claim-templates`);

        if (!response.ok) {
          throw new Error(`Failed to fetch templates: ${response.statusText}`);
        }

        const data = await response.json();
        setTemplates(data.items || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load templates');
        console.error('Error fetching Claim Machinery templates:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTemplates();
  }, []);

  // Update selected template details when formData changes
  useEffect(() => {
    if (formData) {
      const template = templates.find(t => t.metadata.name === formData);
      setSelectedTemplate(template || null);
    } else {
      setSelectedTemplate(null);
    }
  }, [formData, templates]);

  const handleChange = (event: React.ChangeEvent<{ value: unknown }>) => {
    const value = event.target.value as string;
    onChange(value);
  };

  if (loading) {
    return (
      <Box display="flex" alignItems="center" gap={2}>
        <CircularProgress size={24} />
        <Typography>Loading Claim Machinery templates...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <FormControl error fullWidth>
        <Typography color="error">Error: {error}</Typography>
        <FormHelperText>
          Make sure the Claim Machinery API is accessible and properly configured
        </FormHelperText>
      </FormControl>
    );
  }

  return (
    <FormControl
      fullWidth
      required={required}
      error={rawErrors?.length > 0 && !formData}
    >
      <InputLabel id={idSchema?.$id}>
        {schema.title || 'Claim Machinery Template'}
      </InputLabel>
      <Select
        labelId={idSchema?.$id}
        id={idSchema?.$id}
        value={formData || ''}
        onChange={handleChange}
        label={schema.title || 'Claim Machinery Template'}
      >
        <MenuItem value="">
          <em>Select a template</em>
        </MenuItem>
        {templates.map(template => (
          <MenuItem key={template.metadata.name} value={template.metadata.name}>
            {template.metadata.title || template.metadata.name}
          </MenuItem>
        ))}
      </Select>

      {schema.description && (
        <FormHelperText>{schema.description}</FormHelperText>
      )}

      {rawErrors?.length > 0 && !formData && (
        <FormHelperText error>This field is required</FormHelperText>
      )}

      {/* Show selected template details */}
      {selectedTemplate && (
        <Paper
          variant="outlined"
          style={{ marginTop: '16px', padding: '16px' }}
        >
          <Typography variant="subtitle2" gutterBottom>
            Template Details
          </Typography>

          {selectedTemplate.metadata.description && (
            <Typography variant="body2" color="textSecondary" paragraph>
              {selectedTemplate.metadata.description}
            </Typography>
          )}

          {selectedTemplate.metadata.tags && selectedTemplate.metadata.tags.length > 0 && (
            <Box display="flex" flexWrap="wrap" gap={1} marginBottom={2}>
              {selectedTemplate.metadata.tags.map(tag => (
                <Chip
                  key={tag}
                  label={tag}
                  size="small"
                  variant="outlined"
                />
              ))}
            </Box>
          )}

          {selectedTemplate.spec.parameters && selectedTemplate.spec.parameters.length > 0 && (
            <>
              <Typography variant="body2" gutterBottom style={{ marginTop: '8px' }}>
                Required Parameters:
              </Typography>
              <Box display="flex" flexWrap="wrap" gap={1} marginTop={1}>
                {selectedTemplate.spec.parameters
                  .filter(p => p.required && !p.hidden)
                  .map(param => (
                    <Chip
                      key={param.name}
                      label={param.title || param.name}
                      size="small"
                      color="primary"
                      variant="outlined"
                    />
                  ))}
              </Box>
            </>
          )}
        </Paper>
      )}
    </FormControl>
  );
};

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

interface ClaimEntry {
  name: string;
  template: string;
  category: string;
  namespace: string;
  createdAt: string;
  createdBy: string;
  source: string;
  repository: string;
  path: string;
  status: string;
}

/**
 * RegistryClaimPickerExtension — custom scaffolder field extension for selecting
 * claims from the Machinery Registry API.
 *
 * Stores a JSON-encoded string containing the full claim object so that
 * downstream template steps can access name, path, category, and repository.
 */
export const RegistryClaimPickerExtension = ({
  onChange,
  rawErrors,
  required,
  formData,
  idSchema,
  schema,
  uiSchema,
}: FieldExtensionComponentProps<string>) => {
  const config = useApi(configApiRef);
  const [claims, setClaims] = useState<ClaimEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedClaim, setSelectedClaim] = useState<ClaimEntry | null>(null);

  // Fetch claims from Machinery Registry API via Backstage proxy
  useEffect(() => {
    const fetchClaims = async () => {
      try {
        setLoading(true);
        const backendUrl = config.getString('backend.baseUrl');

        // Build query params from ui:options filters
        const filterParams = new URLSearchParams();
        const options = uiSchema?.['ui:options'] as Record<string, string> | undefined;
        if (options?.status) {
          filterParams.set('status', options.status);
        }
        if (options?.category) {
          filterParams.set('category', options.category);
        }
        if (options?.template) {
          filterParams.set('template', options.template);
        }

        const queryString = filterParams.toString();
        const url = `${backendUrl}/api/proxy/machinery-registry/api/v1/claims${queryString ? `?${queryString}` : ''}`;

        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch claims: ${response.statusText}`);
        }

        const data = await response.json();
        setClaims(data.items || []);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load claims');
        console.error('Error fetching registry claims:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchClaims();
  }, []);

  // Parse selected claim from formData (JSON string)
  useEffect(() => {
    if (formData) {
      try {
        const parsed = JSON.parse(formData) as ClaimEntry;
        const claim = claims.find(c => c.name === parsed.name);
        setSelectedClaim(claim || parsed);
      } catch {
        // Fallback: treat as plain claim name for backwards compatibility
        const claim = claims.find(c => c.name === formData);
        setSelectedClaim(claim || null);
      }
    } else {
      setSelectedClaim(null);
    }
  }, [formData, claims]);

  const handleChange = (event: React.ChangeEvent<{ value: unknown }>) => {
    const claimName = event.target.value as string;
    if (!claimName) {
      onChange('');
      return;
    }

    // Store the full claim object as JSON so downstream steps can access all fields
    const claim = claims.find(c => c.name === claimName);
    if (claim) {
      onChange(JSON.stringify({
        name: claim.name,
        path: claim.path,
        category: claim.category,
        repository: claim.repository,
        template: claim.template,
        namespace: claim.namespace,
        createdBy: claim.createdBy,
        status: claim.status,
      }));
    } else {
      onChange(claimName);
    }
  };

  // Get the display name from formData for the Select value
  const getSelectedName = (): string => {
    if (!formData) return '';
    try {
      const parsed = JSON.parse(formData);
      return parsed.name || '';
    } catch {
      return formData;
    }
  };

  if (loading) {
    return (
      <Box display="flex" alignItems="center" style={{ gap: 16 }}>
        <CircularProgress size={24} />
        <Typography>Loading claims from registry...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <FormControl error fullWidth>
        <Typography color="error">Error: {error}</Typography>
        <FormHelperText>
          Make sure the Machinery Registry API is accessible and properly configured
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
        {schema.title || 'Select Claim to Delete'}
      </InputLabel>
      <Select
        labelId={idSchema?.$id}
        id={idSchema?.$id}
        value={getSelectedName()}
        onChange={handleChange}
        label={schema.title || 'Select Claim to Delete'}
      >
        <MenuItem value="">
          <em>Select a claim</em>
        </MenuItem>
        {claims.map(claim => (
          <MenuItem key={claim.name} value={claim.name}>
            {claim.name} — {claim.template} ({claim.category})
          </MenuItem>
        ))}
      </Select>

      {schema.description && (
        <FormHelperText>{schema.description}</FormHelperText>
      )}

      {rawErrors?.length > 0 && !formData && (
        <FormHelperText error>This field is required</FormHelperText>
      )}

      {/* Show selected claim details */}
      {selectedClaim && (
        <Paper
          variant="outlined"
          style={{ marginTop: '16px', padding: '16px' }}
        >
          <Typography variant="subtitle2" gutterBottom>
            Claim Details
          </Typography>

          <Box display="flex" flexWrap="wrap" style={{ gap: 8 }} marginBottom={1}>
            <Chip label={`Template: ${selectedClaim.template}`} size="small" variant="outlined" />
            <Chip label={`Category: ${selectedClaim.category}`} size="small" variant="outlined" />
            <Chip label={`Status: ${selectedClaim.status}`} size="small" color="primary" variant="outlined" />
          </Box>

          <Typography variant="body2" color="textSecondary">
            <strong>Namespace:</strong> {selectedClaim.namespace}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Created by:</strong> {selectedClaim.createdBy}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Source:</strong> {selectedClaim.source}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Repository:</strong> {selectedClaim.repository}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            <strong>Path:</strong> {selectedClaim.path}
          </Typography>
        </Paper>
      )}
    </FormControl>
  );
};

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
import { ChangeEvent, useEffect, useState } from 'react';
import { useApi, configApiRef } from '@backstage/core-plugin-api';

const SOURCE_PATH = 'stuttgart-things.com/source-path';
const MANAGEMENT_CLUSTER = 'stuttgart-things.com/management-cluster';

/** One XR as machinery's GET /api/v1/resources returns it. */
interface MachineryResource {
  kind: string;
  apiVersion: string;
  name: string;
  namespace?: string;
  ready: boolean;
  statusMessage?: string;
  creationTimestamp?: string;
  annotations?: Record<string, string>;
}

/** What the field stores: everything a deletion step needs, as JSON. */
export interface PickedClaim {
  kind: string;
  apiVersion: string;
  name: string;
  namespace: string;
  sourcePath: string;
  managementCluster: string;
}

interface PickerOptions {
  /** Kinds to offer, e.g. ["NativeVsphereVM", "NativeProxmoxVM"]. Default: all watched. */
  kinds?: string[] | string;
  /** Kinds never offered, e.g. ["ClusterStack"]. */
  excludeKinds?: string[] | string;
  /** Proxy endpoint name under /api/proxy. Default: "machinery". */
  proxyPath?: string;
}

const asList = (v?: string[] | string): string[] =>
  (Array.isArray(v) ? v : (v ?? '').split(','))
    .map(s => s.trim())
    .filter(Boolean);

const keyOf = (r: { kind: string; namespace?: string; name: string }) =>
  `${r.kind}/${r.namespace ?? ''}/${r.name}`;

/**
 * MachineryClaimPicker — picks an ordered XR from the live inventory that
 * stuttgart-things/machinery watches on the management cluster.
 *
 * Only XRs carrying stuttgart-things.com/source-path are offered: those are
 * the claims ordered into git (machinery-xrs), not the objects their
 * compositions create. The stored value is a JSON string of PickedClaim, so a
 * deletion template can remove the file at sourcePath and then the object.
 */
export const MachineryClaimPickerExtension = ({
  onChange,
  rawErrors,
  required,
  formData,
  idSchema,
  schema,
  uiSchema,
}: FieldExtensionComponentProps<string>) => {
  const config = useApi(configApiRef);
  const options = (uiSchema?.['ui:options'] ?? {}) as PickerOptions;
  const [items, setItems] = useState<MachineryResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const backendUrl = config.getString('backend.baseUrl');
        const params = new URLSearchParams({ annotation: SOURCE_PATH });
        const kinds = asList(options.kinds);
        if (kinds.length > 0) {
          params.set('kind', kinds.join(','));
        }
        const proxy = options.proxyPath || 'machinery';
        const response = await fetch(
          `${backendUrl}/api/proxy/${proxy}/api/v1/resources?${params.toString()}`,
        );
        if (!response.ok) {
          throw new Error(`Failed to fetch resources: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        const excluded = new Set(asList(options.excludeKinds));
        setItems(
          ((data.items ?? []) as MachineryResource[]).filter(r => !excluded.has(r.kind)),
        );
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load resources');
      } finally {
        setLoading(false);
      }
    };
    load();
    // ui:options are static for a rendered form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const picked: PickedClaim | null = (() => {
    if (!formData) return null;
    try {
      return JSON.parse(formData) as PickedClaim;
    } catch {
      return null;
    }
  })();
  const selected = picked ? items.find(r => keyOf(r) === keyOf(picked)) : undefined;

  const handleChange = (event: ChangeEvent<{ value: unknown }>) => {
    const key = event.target.value as string;
    const r = items.find(i => keyOf(i) === key);
    if (!r) {
      onChange('');
      return;
    }
    const value: PickedClaim = {
      kind: r.kind,
      apiVersion: r.apiVersion,
      name: r.name,
      namespace: r.namespace ?? '',
      sourcePath: r.annotations?.[SOURCE_PATH] ?? '',
      managementCluster: r.annotations?.[MANAGEMENT_CLUSTER] ?? '',
    };
    onChange(JSON.stringify(value));
  };

  if (loading) {
    return (
      <Box display="flex" alignItems="center" style={{ gap: 16 }}>
        <CircularProgress size={24} />
        <Typography>Loading claims from machinery...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <FormControl error fullWidth>
        <Typography color="error">Error: {error}</Typography>
        <FormHelperText>
          Check that the machinery proxy is configured and machinery is reachable
        </FormHelperText>
      </FormControl>
    );
  }

  const label = schema.title || 'Claim';

  return (
    <FormControl fullWidth required={required} error={rawErrors?.length > 0 && !formData}>
      <InputLabel id={idSchema?.$id}>{label}</InputLabel>
      <Select
        labelId={idSchema?.$id}
        id={idSchema?.$id}
        value={picked ? keyOf(picked) : ''}
        onChange={handleChange}
        label={label}
      >
        <MenuItem value="">
          <em>Select a claim</em>
        </MenuItem>
        {items.map(r => (
          <MenuItem key={keyOf(r)} value={keyOf(r)}>
            {r.kind} / {r.name}
            {r.namespace ? ` (${r.namespace})` : ''}
          </MenuItem>
        ))}
      </Select>

      {schema.description && <FormHelperText>{schema.description}</FormHelperText>}
      {items.length === 0 && (
        <FormHelperText>No ordered claims found for this selection</FormHelperText>
      )}
      {rawErrors?.length > 0 && !formData && (
        <FormHelperText error>This field is required</FormHelperText>
      )}

      {picked && (
        <Paper variant="outlined" style={{ marginTop: '16px', padding: '16px' }}>
          <Typography variant="subtitle2" gutterBottom>
            Claim Details
          </Typography>
          <Box display="flex" flexWrap="wrap" style={{ gap: 8 }} marginBottom={1}>
            <Chip label={picked.kind} size="small" variant="outlined" />
            {picked.managementCluster && (
              <Chip label={`Plane: ${picked.managementCluster}`} size="small" variant="outlined" />
            )}
            {selected && (
              <Chip
                label={selected.ready ? 'Ready' : 'Not ready'}
                size="small"
                color={selected.ready ? 'primary' : 'secondary'}
                variant="outlined"
              />
            )}
          </Box>
          <Typography variant="body2" color="textSecondary">
            <strong>File:</strong> {picked.sourcePath}
          </Typography>
          {selected?.creationTimestamp && (
            <Typography variant="body2" color="textSecondary">
              <strong>Created:</strong> {selected.creationTimestamp}
            </Typography>
          )}
          {selected?.statusMessage && !selected.ready && (
            <Typography variant="body2" color="textSecondary">
              <strong>Status:</strong> {selected.statusMessage}
            </Typography>
          )}
        </Paper>
      )}
    </FormControl>
  );
};

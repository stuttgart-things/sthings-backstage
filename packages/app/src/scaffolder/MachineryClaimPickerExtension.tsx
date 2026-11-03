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
import { useApi, configApiRef, identityApiRef } from '@backstage/core-plugin-api';

const SOURCE_PATH = 'stuttgart-things.com/source-path';
const MANAGEMENT_CLUSTER = 'stuttgart-things.com/management-cluster';
/** Who the claim was ordered for / by (create-vm writes both). */
const OWNER = 'stuttgart-things.com/owner';
const REQUESTED_BY = 'stuttgart-things.com/requested-by';

/** One XR as machinery's GET /api/v1/resources returns it. */
export interface MachineryResource {
  kind: string;
  apiVersion: string;
  name: string;
  namespace?: string;
  ready: boolean;
  statusMessage?: string;
  creationTimestamp?: string;
  annotations?: Record<string, string>;
}

/** What the field stores: everything a deletion step needs. */
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
  /**
   * Several proxy endpoints, one per machinery instance (e.g. ["machinery",
   * "machinery-labul"]): their claims are offered together. Takes precedence
   * over proxyPath. Default: [proxyPath], i.e. ["machinery"].
   */
  proxyPaths?: string[] | string;
  /**
   * Offer only claims the user ordered or that belong to one of their groups
   * (stuttgart-things.com/owner or requested-by in their ownership refs). For
   * developer templates: "my orders", not everybody's. A convenience, not
   * access control -- deleting or resizing stays a pull request a platform
   * engineer merges.
   */
  ownedOnly?: boolean;
}

const asList = (v?: string[] | string): string[] =>
  (Array.isArray(v) ? v : (v ?? '').split(','))
    .map(s => s.trim())
    .filter(Boolean);

/** The proxy endpoints to read: proxyPaths, else proxyPath, else machinery. */
export const proxyPathsOf = (options: {
  proxyPath?: string;
  proxyPaths?: string[] | string;
}): string[] => {
  const paths = asList(options.proxyPaths);
  return [...new Set(paths.length > 0 ? paths : [options.proxyPath || 'machinery'])];
};

/**
 * A claim is one file (source-path), so the key carries it: two machinery
 * instances may each have an XR with the same kind, namespace and name.
 */
const keyOf = (r: { kind: string; namespace?: string; name: string }, sourcePath: string) =>
  `${r.kind}/${r.namespace ?? ''}/${r.name}@${sourcePath}`;
const sourcePathOf = (r: MachineryResource) => r.annotations?.[SOURCE_PATH] ?? '';

/**
 * The ordered claims of every proxy endpoint, merged. An endpoint that fails
 * is reported in `failed` and the others are still offered; only when all of
 * them fail is that an error.
 */
export const loadClaims = async (
  fetchFn: (url: string) => Promise<Pick<Response, 'ok' | 'status' | 'statusText' | 'json'>>,
  backendUrl: string,
  proxyPaths: string[],
  query: string,
): Promise<{ items: MachineryResource[]; failed: string[] }> => {
  const results = await Promise.allSettled(
    proxyPaths.map(async proxy => {
      const response = await fetchFn(`${backendUrl}/api/proxy/${proxy}/api/v1/resources?${query}`);
      if (!response.ok) {
        throw new Error(`${proxy}: ${response.status} ${response.statusText}`);
      }
      const data = (await response.json()) as { items?: MachineryResource[] };
      return data.items ?? [];
    }),
  );
  const failed = results.flatMap((r, i) =>
    r.status === 'rejected'
      ? [r.reason instanceof Error ? r.reason.message : `${proxyPaths[i]}: failed`]
      : [],
  );
  if (failed.length === results.length) {
    throw new Error(`Failed to fetch resources: ${failed.join('; ')}`);
  }
  const seen = new Set<string>();
  const items = results
    .flatMap(r => (r.status === 'fulfilled' ? r.value : []))
    .filter(r => {
      const k = keyOf(r, sourcePathOf(r));
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return { items, failed };
};

/** `biff` -> `user:default/biff`; refs compare case-insensitively. */
const asRef = (v?: string) => {
  const t = (v ?? '').trim().toLowerCase();
  if (!t) return '';
  return t.includes(':') ? t : `user:default/${t}`;
};

/**
 * Whether the signed-in user may pick this claim with `ownedOnly`: its owner
 * (a user or a group) or its requester is one of the user's ownership refs.
 */
export const ownedBy = (r: MachineryResource, ownershipRefs: string[]) => {
  const refs = new Set(ownershipRefs.map(asRef));
  const owner = asRef(r.annotations?.[OWNER]);
  const requester = asRef(r.annotations?.[REQUESTED_BY]);
  return (!!owner && refs.has(owner)) || (!!requester && refs.has(requester));
};

/**
 * MachineryClaimPicker — picks an ordered XR from the live inventory that
 * stuttgart-things/machinery watches on the management cluster.
 *
 * Only XRs carrying stuttgart-things.com/source-path are offered: those are
 * the claims ordered into git (machinery-xrs), not the objects their
 * compositions create. The stored value is a PickedClaim, so a deletion
 * template can remove the file at sourcePath and then the object.
 *
 * With `type: object` the field stores the object itself; the review page
 * then shows one row per key. With `type: string` it stores the same object
 * as a JSON string, for templates that still decode it with $eval.
 */
export const MachineryClaimPickerExtension = ({
  onChange,
  rawErrors,
  required,
  formData,
  idSchema,
  schema,
  uiSchema,
}: FieldExtensionComponentProps<PickedClaim | string>) => {
  const config = useApi(configApiRef);
  const identityApi = useApi(identityApiRef);
  const asObject = schema.type === 'object';
  const options = (uiSchema?.['ui:options'] ?? {}) as PickerOptions;
  const [items, setItems] = useState<MachineryResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);
  const proxyPaths = proxyPathsOf(options);

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
        const loaded = await loadClaims(url => fetch(url), backendUrl, proxyPaths, params.toString());
        setFailed(loaded.failed);
        const excluded = new Set(asList(options.excludeKinds));
        let offered = loaded.items.filter(r => !excluded.has(r.kind));
        if (options.ownedOnly) {
          const { ownershipEntityRefs } = await identityApi.getBackstageIdentity();
          offered = offered.filter(r => ownedBy(r, ownershipEntityRefs));
        }
        setItems(offered);
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
    let v: PickedClaim | null = null;
    if (typeof formData === 'object') {
      v = formData;
    } else {
      try {
        v = JSON.parse(formData) as PickedClaim;
      } catch {
        return null;
      }
    }
    // With `type: object` the form starts the field as {} -- nothing picked
    // yet, not a claim (it rendered as "undefined//undefined").
    return v?.kind && v?.name ? v : null;
  })();
  const pickedKey = picked ? keyOf(picked, picked.sourcePath) : '';
  const selected = picked ? items.find(r => keyOf(r, sourcePathOf(r)) === pickedKey) : undefined;

  const handleChange = (event: ChangeEvent<{ value: unknown }>) => {
    const key = event.target.value as string;
    const r = items.find(i => keyOf(i, sourcePathOf(i)) === key);
    if (!r) {
      onChange(asObject ? undefined : '');
      return;
    }
    const value: PickedClaim = {
      kind: r.kind,
      apiVersion: r.apiVersion,
      name: r.name,
      namespace: r.namespace ?? '',
      sourcePath: sourcePathOf(r),
      managementCluster: r.annotations?.[MANAGEMENT_CLUSTER] ?? '',
    };
    onChange(asObject ? value : JSON.stringify(value));
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
    <FormControl fullWidth required={required} error={rawErrors?.length > 0 && !picked}>
      <InputLabel id={idSchema?.$id}>{label}</InputLabel>
      <Select
        labelId={idSchema?.$id}
        id={idSchema?.$id}
        value={pickedKey}
        onChange={handleChange}
        label={label}
      >
        <MenuItem value="">
          <em>Select a claim</em>
        </MenuItem>
        {items.map(r => (
          <MenuItem key={keyOf(r, sourcePathOf(r))} value={keyOf(r, sourcePathOf(r))}>
            {r.kind} / {r.name}
            {r.namespace ? ` (${r.namespace})` : ''}
            {proxyPaths.length > 1 && r.annotations?.[MANAGEMENT_CLUSTER]
              ? ` -- ${r.annotations[MANAGEMENT_CLUSTER]}`
              : ''}
          </MenuItem>
        ))}
      </Select>

      {schema.description && <FormHelperText>{schema.description}</FormHelperText>}
      {failed.length > 0 && (
        <FormHelperText error>
          Not reachable, its claims are missing here: {failed.join('; ')}
        </FormHelperText>
      )}
      {items.length === 0 && (
        <FormHelperText>
          {options.ownedOnly
            ? 'You have no orders here yet -- only VMs ordered by you or for one of your groups are offered'
            : 'No ordered claims found for this selection'}
        </FormHelperText>
      )}
      {rawErrors?.length > 0 && !picked && (
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

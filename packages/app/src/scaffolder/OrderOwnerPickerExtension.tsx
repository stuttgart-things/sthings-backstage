import { FieldExtensionComponentProps } from '@backstage/plugin-scaffolder-react';
import {
  CircularProgress,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Select,
} from '@material-ui/core';
import { ChangeEvent, useEffect, useState } from 'react';
import { identityApiRef, useApi } from '@backstage/core-plugin-api';

interface OrderOwnerOptions {
  /**
   * Group refs (or prefixes ending in `*`) never offered as owner. Default:
   * the role groups that say what a user may do, not who they work with --
   * beta-* tracks, guests (developers) and platform-team.
   */
  excludeGroups?: string[];
}

export const DEFAULT_EXCLUDED_GROUPS = [
  'group:default/beta-*',
  'group:default/guests',
  'group:default/platform-team',
];

/**
 * The owners a user may order for: themselves first, then their groups,
 * minus the excluded role groups.
 */
export function ownerChoices(
  userEntityRef: string,
  ownershipEntityRefs: string[],
  excludeGroups: string[] = DEFAULT_EXCLUDED_GROUPS,
): string[] {
  const user = userEntityRef.toLowerCase();
  const excluded = (ref: string) =>
    excludeGroups.some(p => {
      const pattern = p.toLowerCase();
      return pattern.endsWith('*')
        ? ref.startsWith(pattern.slice(0, -1))
        : ref === pattern;
    });
  const groups = [
    ...new Set(
      ownershipEntityRefs
        .map(r => r.toLowerCase())
        .filter(r => r.startsWith('group:') && !excluded(r)),
    ),
  ].sort();
  return [user, ...groups];
}

const label = (ref: string, user: string) =>
  ref === user
    ? `Me (${ref.replace(/^user:default\//, '')})`
    : `Group ${ref.replace(/^group:default\//, '')}`;

/**
 * OrderOwnerPicker -- "for whom is this order?": the signed-in user or one of
 * their groups. Stores an entity ref (default: the user). Order templates put
 * it into the claim's stuttgart-things.com/owner annotation, and the catalog
 * then shows the order under Owned for the user or every group member.
 */
export const OrderOwnerPickerExtension = ({
  onChange,
  formData,
  idSchema,
  schema,
  uiSchema,
  rawErrors,
}: FieldExtensionComponentProps<string>) => {
  const identityApi = useApi(identityApiRef);
  const options = (uiSchema?.['ui:options'] ?? {}) as OrderOwnerOptions;
  const [choices, setChoices] = useState<string[]>([]);
  const [user, setUser] = useState('');

  useEffect(() => {
    identityApi.getBackstageIdentity().then(identity => {
      const list = ownerChoices(
        identity.userEntityRef,
        identity.ownershipEntityRefs,
        options.excludeGroups,
      );
      setUser(list[0]);
      setChoices(list);
      if (!formData || !list.includes(formData)) {
        onChange(list[0]);
      }
    });
    // ui:options are static for a rendered form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (choices.length === 0) {
    return <CircularProgress size={24} />;
  }

  return (
    <FormControl fullWidth margin="normal" error={rawErrors?.length > 0}>
      <InputLabel id={`${idSchema?.$id}-label`}>
        {schema.title ?? 'Ordered for'}
      </InputLabel>
      <Select
        labelId={`${idSchema?.$id}-label`}
        id={idSchema?.$id}
        value={formData ?? user}
        onChange={(e: ChangeEvent<{ value: unknown }>) =>
          onChange(e.target.value as string)
        }
      >
        {choices.map(ref => (
          <MenuItem key={ref} value={ref}>
            {label(ref, user)}
          </MenuItem>
        ))}
      </Select>
      {schema.description && (
        <FormHelperText>{schema.description}</FormHelperText>
      )}
    </FormControl>
  );
};

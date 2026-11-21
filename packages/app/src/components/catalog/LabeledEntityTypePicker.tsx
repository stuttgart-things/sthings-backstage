import { useEffect } from 'react';
import Box from '@material-ui/core/Box';
import { Select } from '@backstage/core-components';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { useEntityTypeFilter } from '@backstage/plugin-catalog-react';
import { typeLabel } from './entityTypes';

/**
 * EntityTypePicker with display names (#246): the upstream picker shows the
 * raw spec.type values and has no way to relabel them. Same filter state,
 * so URL query and the other pickers keep working.
 */
export const LabeledEntityTypePicker = () => {
  const alertApi = useApi(alertApiRef);
  const { error, availableTypes, selectedTypes, setSelectedTypes } =
    useEntityTypeFilter();

  useEffect(() => {
    if (error) {
      alertApi.post({
        message: 'Failed to load entity types',
        severity: 'error',
      });
    }
  }, [error, alertApi]);

  if (availableTypes.length === 0 || error) return null;

  const items = [
    { value: 'all', label: 'all' },
    ...availableTypes
      .map(type => ({ value: type, label: typeLabel(type) }))
      .sort((a, b) =>
        a.label
          .toLocaleLowerCase('en-US')
          .localeCompare(b.label.toLocaleLowerCase('en-US')),
      ),
  ];

  return (
    <Box pb={1} pt={1}>
      <Select
        label="Type"
        items={items}
        selected={(items.length > 1 ? selectedTypes[0] : undefined) ?? 'all'}
        onChange={value =>
          setSelectedTypes(value === 'all' ? [] : [String(value)])
        }
      />
    </Box>
  );
};

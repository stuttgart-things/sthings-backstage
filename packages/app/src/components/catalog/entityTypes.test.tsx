import { screen } from '@testing-library/react';
import { renderInTestApp } from '@backstage/test-utils';
import { Entity } from '@backstage/catalog-model';
import { EntityCard } from './EntityCard';
import { typeLabel } from './entityTypes';

describe('typeLabel', () => {
  it.each([
    ['vm', 'Virtual Machine'],
    ['vm-template', 'VM-Template'],
    ['VM', 'Virtual Machine'],
    ['kubernetes-cluster', 'Kubernetes Cluster'],
  ])('maps %s to %s', (type, label) => {
    expect(typeLabel(type)).toBe(label);
  });

  it('keeps unknown types as they are', () => {
    expect(typeLabel('some-new-type')).toBe('some-new-type');
  });
});

describe('EntityCard', () => {
  it('shows the type as a labelled chip (#246)', async () => {
    const entity: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: { name: 'tpl-ubuntu' },
      spec: { type: 'vm-template', owner: 'group:default/platform-team' },
    };
    await renderInTestApp(<EntityCard entity={entity} />);
    const chip = screen.getByText('VM-Template');
    expect(chip).toBeInTheDocument();
    expect(chip.closest('[title]')).toHaveAttribute('title', 'vm-template');
  });
});

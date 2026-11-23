import { screen } from '@testing-library/react';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { catalogApiRef, entityRouteRef } from '@backstage/plugin-catalog-react';
import { OfferingsPage } from './OfferingsPage';
import { GROUP_ANNOTATION, ORDER_ANNOTATION } from './offerings';

const catalogWith = (items: unknown[]) => ({
  getEntities: jest.fn().mockResolvedValue({ items }),
});

const vm = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name: 'order-vm',
    title: 'VM bestellen',
    description: 'Eine VM auf Proxmox, vSphere oder Harvester bestellen.',
    annotations: { [GROUP_ANNOTATION]: 'Bestellen', [ORDER_ANNOTATION]: '10' },
    links: [{ url: 'portal:/create', title: 'Jetzt bestellen' }],
  },
  spec: { type: 'offering', owner: 'group:default/platform-team' },
};

describe('OfferingsPage', () => {
  it('lists offerings under their group with their actions', async () => {
    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, catalogWith([vm])]]}>
        <OfferingsPage />
      </TestApiProvider>,
      { mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef } },
    );
    expect(await screen.findByText('VM bestellen')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Bestellen' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Jetzt bestellen').closest('a')).toHaveAttribute(
      'href',
      '/create',
    );
    expect(screen.getByText('Details').closest('a')).toHaveAttribute(
      'href',
      '/catalog/default/resource/order-vm',
    );
  });

  it('explains how to add offerings when there are none', async () => {
    await renderInTestApp(
      <TestApiProvider apis={[[catalogApiRef, catalogWith([])]]}>
        <OfferingsPage />
      </TestApiProvider>,
      { mountedRoutes: { '/catalog/:namespace/:kind/:name': entityRouteRef } },
    );
    expect(await screen.findByText('No offerings yet')).toBeInTheDocument();
  });
});

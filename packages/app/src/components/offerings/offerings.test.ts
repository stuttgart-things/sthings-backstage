import type { Entity } from '@backstage/catalog-model';
import {
  DEFAULT_GROUP,
  GROUP_ANNOTATION,
  ORDER_ANNOTATION,
  groupOfferings,
  offeringHref,
} from './offerings';

const offering = (
  name: string,
  group?: string,
  order?: number,
  title?: string,
): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name,
    title,
    annotations: {
      ...(group ? { [GROUP_ANNOTATION]: group } : {}),
      ...(order !== undefined ? { [ORDER_ANNOTATION]: String(order) } : {}),
    },
  },
  spec: { type: 'offering', owner: 'group:default/platform-team' },
});

describe('offeringHref', () => {
  it.each([
    ['portal:/create', '/create'],
    ['portal:docs', '/docs'],
    ['https://example.com/x', 'https://example.com/x'],
  ])('maps %s to %s', (url, href) => {
    expect(offeringHref(url)).toBe(href);
  });
});

describe('groupOfferings', () => {
  it('groups by annotation and sorts groups and offerings by order', () => {
    const groups = groupOfferings([
      offering('docs', 'Learn', 30),
      offering('cluster', 'Order', 20),
      offering('vm', 'Order', 10),
      offering('misc'),
    ]);
    expect(groups.map(g => g.name)).toEqual(['Order', 'Learn', DEFAULT_GROUP]);
    expect(groups[0].offerings.map(e => e.metadata.name)).toEqual([
      'vm',
      'cluster',
    ]);
  });

  it('sorts unordered offerings by title, after ordered ones', () => {
    const [group] = groupOfferings([
      offering('b', 'Order', undefined, 'Zeta'),
      offering('a', 'Order', undefined, 'Alpha'),
      offering('c', 'Order', 5),
    ]);
    expect(group.offerings.map(e => e.metadata.name)).toEqual(['c', 'a', 'b']);
  });

  it('returns nothing for no offerings', () => {
    expect(groupOfferings([])).toEqual([]);
  });
});

import type { Entity } from '@backstage/catalog-model';

/**
 * An offering is a catalog Resource with `spec.type: offering` (#243): one
 * curated entry point ("order a VM", "request a cluster", "read the docs").
 * Its links are the actions; the first link is the primary one.
 */
export const OFFERING_TYPE = 'offering';

/** Group (phase or topic) the offering is listed under. */
export const GROUP_ANNOTATION = 'backstage.stuttgart-things.com/offering-group';
/** Position within the group and of the group itself; lower comes first. */
export const ORDER_ANNOTATION = 'backstage.stuttgart-things.com/offering-order';
/** Icon key, see OFFERING_ICONS in OfferingCard. */
export const ICON_ANNOTATION = 'backstage.stuttgart-things.com/offering-icon';

export const DEFAULT_GROUP = 'Other';

/**
 * Prefix for links into the portal itself. The catalog accepts only absolute
 * URLs in metadata.links, and the portal's host differs per environment, so
 * offerings write `portal:/create` and the card links to `/create`.
 */
export const PORTAL_SCHEME = 'portal:';

/** Link target for a metadata.links url: `portal:/x` becomes `/x`. */
export function offeringHref(url: string): string {
  if (!url.startsWith(PORTAL_SCHEME)) return url;
  const path = url.slice(PORTAL_SCHEME.length);
  return path.startsWith('/') ? path : `/${path}`;
}

export type OfferingGroup = { name: string; offerings: Entity[] };

function orderOf(entity: Entity): number {
  const raw = entity.metadata.annotations?.[ORDER_ANNOTATION];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

function titleOf(entity: Entity): string {
  return entity.metadata.title ?? entity.metadata.name;
}

export function groupOf(entity: Entity): string {
  return (
    entity.metadata.annotations?.[GROUP_ANNOTATION]?.trim() || DEFAULT_GROUP
  );
}

const byOrderThenTitle = (a: Entity, b: Entity) =>
  orderOf(a) - orderOf(b) || titleOf(a).localeCompare(titleOf(b));

/**
 * Offerings grouped by {@link GROUP_ANNOTATION}. Offerings sort by
 * {@link ORDER_ANNOTATION}, then title; groups by their first offering's
 * order, then name, with the fallback group last.
 */
export function groupOfferings(entities: Entity[]): OfferingGroup[] {
  const groups = new Map<string, Entity[]>();
  for (const entity of entities) {
    const name = groupOf(entity);
    groups.set(name, [...(groups.get(name) ?? []), entity]);
  }
  return [...groups.entries()]
    .map(([name, offerings]) => ({
      name,
      offerings: [...offerings].sort(byOrderThenTitle),
    }))
    .sort((a, b) => {
      if (a.name === DEFAULT_GROUP) return 1;
      if (b.name === DEFAULT_GROUP) return -1;
      return (
        orderOf(a.offerings[0]) - orderOf(b.offerings[0]) ||
        a.name.localeCompare(b.name)
      );
    });
}

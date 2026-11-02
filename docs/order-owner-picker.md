# Order Owner Picker

Scaffolder field `OrderOwnerPicker` (`packages/app/src/scaffolder/OrderOwnerPickerExtension.tsx`):
"for whom is this order?" -- the signed-in user, or one of their groups. It
stores an entity ref; the default is the user.

Offered are the user first, then the groups in their ownership refs, minus
the role groups that say what a user may do rather than who they work with:
`group:default/beta-*`, `group:default/guests`, `group:default/platform-team`.
Teams come from the Zitadel role `backstage-team-<team>`, which the resolver
maps to `group:default/<team>` ([zitadel.md](zitadel.md)).

## Usage

```yaml
order_for:
  title: Ordered for
  type: string
  ui:field: OrderOwnerPicker
  ui:options:
    # optional; refs or prefixes ending in *, replaces the default list
    excludeGroups: [group:default/beta-*, group:default/guests]
```

Write it into the order, together with the requester:

```yaml
values:
  owner: ${{ parameters.order_for or user.ref }}
  requested_by: ${{ user.ref }}
```

```yaml
# the claim in machinery-xrs
metadata:
  annotations:
    stuttgart-things.com/requested-by: ${{ values.requested_by }}
    stuttgart-things.com/owner: ${{ values.owner or values.requested_by }}
```

The keys start with `stuttgart-things.com/` on purpose: machinery's JSON API
returns only annotations under that prefix.

## What the owner does

- **Catalog:** the sthings-vms provider (`type: machinery`) makes the order a
  `machinery-order` entity with `spec.owner` = the owner annotation, so it
  shows under **Owned** -- for the user, or for every member of the group --
  with its live status.
- **Pickers:** `MachineryClaimPicker` with `ownedOnly: true` offers it to the
  owner and the requester ([machinery-claim-picker.md](machinery-claim-picker.md)).

A convenience, not access control: a caller can send any ref through the API.
The order is a pull request a platform engineer reviews and merges, and the
owner is visible in it.

# Offerings

`/offerings` (sidebar: **Offerings**, home page toolkit) is a curated entry
into the platform: what you can order, operate and learn, grouped by phase or
topic. It is fed by catalog entities, so a team adds an offering with a
YAML file, not a code change.

## Schema

An offering is a `Resource` with `spec.type: offering`:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Resource
metadata:
  name: offering-order-vm
  title: Order a VM # card title
  description: A virtual machine on Proxmox, vSphere or Harvester.
  annotations:
    backstage.stuttgart-things.com/offering-group: Order # section
    backstage.stuttgart-things.com/offering-order: '10' # sort key
    backstage.stuttgart-things.com/offering-icon: vm # icon key
  links: # buttons; the first is the primary one
    - url: portal:/create
      title: Order
    - url: portal:/catalog?filters[kind]=resource&filters[type]=vm
      title: My VMs
spec:
  type: offering
  owner: group:default/platform-team
```

| Field            | Effect                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `offering-group` | Section the card appears in. Without it: **Other**, listed last.                                                              |
| `offering-order` | Lower comes first, within a section and for the sections (by their first card). Without it: after the ordered ones, by title. |
| `offering-icon`  | `vm`, `cluster`, `claim`, `order`, `docs`, `storage`, `tools`, `learn`; anything else shows a star.                           |
| `links`          | Buttons on the card. Internal paths (`/create`, `/docs/...`, `/catalog?...`) and full URLs both work.                         |

Every card also has **Details**, the offering's catalog page.

## Where offerings live

The platform's own offerings are in [`catalog/offerings.yaml`](../catalog/offerings.yaml),
registered as the Location `sthings-backstage-offerings` in the catalog index
([backstage-resources `services/sthings-dev/catalog-index.yaml`](https://github.com/stuttgart-things/backstage-resources/blob/main/services/sthings-dev/catalog-index.yaml)).
Not in `app-config.yaml`: the deployed instances load only their mounted
config files, never the image's `app-config.yaml`. A team can keep its
own offerings in its repository and register that file like any other
catalog file; the owner should be the team's group.

To link straight to one scaffolder template, use
`portal:/create/templates/default/<template-name>`.

The Links card on the offering's own catalog page shows `portal:` links as
they are; use the buttons on `/offerings`.

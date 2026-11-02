import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import type { TemplateGroupFilter } from '@backstage/plugin-scaffolder-react';

/**
 * The groups of the Create page, in display order. Every template lands in
 * exactly one: the first whose rule matches (see {@link templateGroupOf}).
 * A group without templates is not rendered, so a developer -- who can read
 * only the self-service templates (docs/permissions.md) -- sees one group.
 */
export const TEMPLATE_GROUPS = [
  'Self-Service',
  'Services',
  'VMs & Images',
  'Clusters & GitOps',
  'Worker steps (started by the Dapr worker)',
] as const;

export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];

const AUDIENCE_ANNOTATION = 'backstage.stuttgart-things.com/audience';

const hasTag = (template: TemplateEntityV1beta3, ...tags: string[]) =>
  (template.metadata.tags ?? []).some(tag => tags.includes(tag));

/**
 * The group a template belongs to, from what templates already carry -- no
 * new annotation to maintain:
 *
 * 1. `spec.type: worker-step`: started by the Dapr worker
 *    (stuttgart-things#4226), last so a person picks a request first.
 * 2. `audience: developers`: the self-service requests.
 * 3. tag `golang` / `microservice`: new repositories from a skeleton.
 * 4. tag `vm` / `packer`: VMs and their images.
 * 5. everything else: clusters, Flux, Crossplane, Terraform, Ansible.
 */
export function templateGroupOf(
  template: TemplateEntityV1beta3,
): TemplateGroup {
  if (template.spec.type === 'worker-step') {
    return 'Worker steps (started by the Dapr worker)';
  }
  if (template.metadata.annotations?.[AUDIENCE_ANNOTATION] === 'developers') {
    return 'Self-Service';
  }
  if (hasTag(template, 'golang', 'microservice')) {
    return 'Services';
  }
  if (hasTag(template, 'vm', 'packer')) {
    return 'VMs & Images';
  }
  return 'Clusters & GitOps';
}

export const templateGroups: TemplateGroupFilter[] = TEMPLATE_GROUPS.map(
  title => ({
    title,
    filter: (template: TemplateEntityV1beta3) =>
      templateGroupOf(template) === title,
  }),
);

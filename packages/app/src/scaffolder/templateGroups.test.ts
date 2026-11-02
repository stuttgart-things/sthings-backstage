import type { TemplateEntityV1beta3 } from '@backstage/plugin-scaffolder-common';
import {
  TEMPLATE_GROUPS,
  templateGroupOf,
  templateGroups,
} from './templateGroups';

type TemplateOpts = { type?: string; tags?: string[]; audience?: string };

function template(
  name: string,
  opts: TemplateOpts = {},
): TemplateEntityV1beta3 {
  return {
    apiVersion: 'scaffolder.backstage.io/v1beta3',
    kind: 'Template',
    metadata: {
      name,
      tags: opts.tags,
      annotations: opts.audience
        ? { 'backstage.stuttgart-things.com/audience': opts.audience }
        : undefined,
    },
    spec: { type: opts.type ?? 'service', parameters: [], steps: [] },
  } as unknown as TemplateEntityV1beta3;
}

describe('templateGroupOf', () => {
  it.each([
    // real templates of backstage-resources and stuttgart-things
    [
      'create-terraform-vm',
      { type: 'worker-step', tags: ['terraform', 'vm'] },
      'Worker steps (started by the Dapr worker)',
    ],
    [
      'request-vm',
      { tags: ['vm', 'self-service'], audience: 'developers' },
      'Self-Service',
    ],
    [
      'homerun2-service',
      { tags: ['golang', 'redis', 'microservice'] },
      'Services',
    ],
    ['golang-service', { tags: ['golang', 'service'] }, 'Services'],
    [
      'harvester-vm',
      { type: 'infrastructure', tags: ['vm', 'harvester'] },
      'VMs & Images',
    ],
    ['packer-vsphere', { tags: ['packer', 'vsphere'] }, 'VMs & Images'],
    [
      'create-cluster-stack',
      { tags: ['crossplane', 'clusterstack'] },
      'Clusters & GitOps',
    ],
    ['untagged', {}, 'Clusters & GitOps'],
  ] as Array<[string, TemplateOpts, string]>)(
    '%s -> %s',
    (name, opts, group) => {
      expect(templateGroupOf(template(name, opts))).toBe(group);
    },
  );

  it('puts a worker step in its group even when opened to developers', () => {
    expect(
      templateGroupOf(
        template('w', { type: 'worker-step', audience: 'developers' }),
      ),
    ).toBe('Worker steps (started by the Dapr worker)');
  });
});

describe('templateGroups', () => {
  it('has one group per title, in order, and every template matches exactly one', () => {
    expect(templateGroups.map(g => g.title)).toEqual([...TEMPLATE_GROUPS]);
    const t = template('request-vm', { tags: ['vm'], audience: 'developers' });
    expect(templateGroups.filter(g => g.filter(t))).toHaveLength(1);
  });
});

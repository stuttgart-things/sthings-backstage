import {
  AuthorizeResult,
  createPermission,
} from '@backstage/plugin-permission-common';
import { PolicyQueryUser } from '@backstage/plugin-permission-node';
import {
  catalogEntityDeletePermission,
  catalogEntityReadPermission,
} from '@backstage/plugin-catalog-common/alpha';
import {
  AUDIENCE_ANNOTATION,
  AUDIENCE_DEVELOPERS,
  TemplateAudiencePolicy,
} from './policy';

function userOwning(...ownershipEntityRefs: string[]): PolicyQueryUser {
  // Only info.ownershipEntityRefs is read by the policy.
  return {
    info: { userEntityRef: ownershipEntityRefs[0], ownershipEntityRefs },
  } as unknown as PolicyQueryUser;
}

const developerOnlyTemplates = {
  result: AuthorizeResult.CONDITIONAL,
  pluginId: 'catalog',
  resourceType: 'catalog-entity',
  conditions: {
    anyOf: [
      {
        not: {
          rule: 'IS_ENTITY_KIND',
          resourceType: 'catalog-entity',
          params: { kinds: ['Template'] },
        },
      },
      {
        rule: 'HAS_ANNOTATION',
        resourceType: 'catalog-entity',
        params: { annotation: AUDIENCE_ANNOTATION, value: AUDIENCE_DEVELOPERS },
      },
    ],
  },
};

describe('TemplateAudiencePolicy', () => {
  const policy = new TemplateAudiencePolicy();
  const read = { permission: catalogEntityReadPermission };

  it('lets platform-team read every entity', async () => {
    const decision = await policy.handle(
      read,
      userOwning('user:default/patrick-hermann-sva', 'group:default/platform-team'),
    );
    expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
  });

  it('matches the platform group case-insensitively', async () => {
    const decision = await new TemplateAudiencePolicy([
      'group:default/Platform-Team',
    ]).handle(read, userOwning('user:default/x', 'group:default/platform-team'));
    expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
  });

  it('shows everyone else only non-templates and developer templates', async () => {
    const decision = await policy.handle(
      read,
      userOwning('user:default/dev', 'group:default/guests'),
    );
    expect(decision).toEqual(developerOnlyTemplates);
  });

  it('treats a user without ownership refs, e.g. guest, as a developer', async () => {
    expect(
      await policy.handle(read, userOwning('user:development/guest')),
    ).toEqual(developerOnlyTemplates);
    expect(await policy.handle(read, undefined)).toEqual(developerOnlyTemplates);
  });

  it('honours configured platform groups instead of the default', async () => {
    const custom = new TemplateAudiencePolicy(['group:default/team-infrastructure']);
    expect(
      await custom.handle(read, userOwning('user:default/a', 'group:default/team-infrastructure')),
    ).toEqual({ result: AuthorizeResult.ALLOW });
    expect(
      await custom.handle(read, userOwning('user:default/b', 'group:default/platform-team')),
    ).toEqual(developerOnlyTemplates);
  });

  it('leaves every other permission allowed, as under allow-all', async () => {
    const dev = userOwning('user:default/dev');
    expect(
      await policy.handle({ permission: catalogEntityDeletePermission }, dev),
    ).toEqual({ result: AuthorizeResult.ALLOW });
    expect(
      await policy.handle(
        {
          permission: createPermission({
            name: 'scaffolder.task.create',
            attributes: { action: 'create' },
          }),
        },
        dev,
      ),
    ).toEqual({ result: AuthorizeResult.ALLOW });
  });
});

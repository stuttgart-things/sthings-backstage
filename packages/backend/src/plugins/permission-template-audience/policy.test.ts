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
  taskCancelPermission,
  taskReadPermission,
} from '@backstage/plugin-scaffolder-common/alpha';
import {
  AUDIENCE_ANNOTATION,
  AUDIENCE_DEVELOPERS,
  BETA_TRACK_ANNOTATION,
  TemplateAudiencePolicy,
} from './policy';

function userOwning(...ownershipEntityRefs: string[]): PolicyQueryUser {
  // Only info.ownershipEntityRefs is read by the policy.
  return {
    info: { userEntityRef: ownershipEntityRefs[0], ownershipEntityRefs },
  } as unknown as PolicyQueryUser;
}

const notTemplate = {
  not: {
    rule: 'IS_ENTITY_KIND',
    resourceType: 'catalog-entity',
    params: { kinds: ['Template'] },
  },
};
const developerRule = {
  rule: 'HAS_ANNOTATION',
  resourceType: 'catalog-entity',
  params: { annotation: AUDIENCE_ANNOTATION, value: AUDIENCE_DEVELOPERS },
};

/** Orders: readable only when not an order, or owned by one of `refs`. */
const ownOrders = (refs: string[]) => ({
  anyOf: [
    {
      rule: 'IS_ENTITY_OWNER',
      resourceType: 'catalog-entity',
      params: { claims: refs },
    },
    {
      not: {
        rule: 'HAS_SPEC',
        resourceType: 'catalog-entity',
        params: { key: 'type', value: 'machinery-order' },
      },
    },
  ],
});

/** The read decision for a non-platform user: template rules + own orders. */
const allowing = (refs: string[], ...templateRules: object[]) => ({
  result: AuthorizeResult.CONDITIONAL,
  pluginId: 'catalog',
  resourceType: 'catalog-entity',
  conditions: {
    allOf: [{ anyOf: [notTemplate, ...templateRules] }, ownOrders(refs)],
  },
});

describe('TemplateAudiencePolicy', () => {
  const policy = new TemplateAudiencePolicy();
  const read = { permission: catalogEntityReadPermission };

  it('lets platform-team read every entity', async () => {
    const decision = await policy.handle(
      read,
      userOwning(
        'user:default/patrick-hermann-sva',
        'group:default/platform-team',
      ),
    );
    expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
  });

  it('matches the platform group case-insensitively', async () => {
    const decision = await new TemplateAudiencePolicy([
      'group:default/Platform-Team',
    ]).handle(
      read,
      userOwning('user:default/x', 'group:default/platform-team'),
    );
    expect(decision).toEqual({ result: AuthorizeResult.ALLOW });
  });

  it('shows everyone else only non-templates and developer templates', async () => {
    const decision = await policy.handle(
      read,
      userOwning('user:default/dev', 'group:default/guests'),
    );
    expect(decision).toEqual(
      allowing(['user:default/dev', 'group:default/guests'], developerRule),
    );
  });

  it('treats a user without ownership refs, e.g. guest, as a developer', async () => {
    expect(
      await policy.handle(read, userOwning('user:development/guest')),
    ).toEqual(allowing(['user:development/guest'], developerRule));
    expect(await policy.handle(read, undefined)).toEqual(
      allowing([], developerRule),
    );
  });

  describe('beta tracks', () => {
    const track = (value: string) => ({
      rule: 'HAS_ANNOTATION',
      resourceType: 'catalog-entity',
      params: { annotation: BETA_TRACK_ANNOTATION, value },
    });
    it('shows a tester with only the track role just the track (doc)', async () => {
      expect(
        await policy.handle(
          read,
          userOwning('user:default/doc', 'group:default/beta-vm-machinery'),
        ),
      ).toEqual(
        allowing(
          ['user:default/doc', 'group:default/beta-vm-machinery'],
          track('vm-machinery'),
        ),
      );
    });

    it('does not count a team group as a developer group (biff)', async () => {
      expect(
        await policy.handle(
          read,
          userOwning(
            'user:default/biff',
            'group:default/beta-vm-machinery',
            'group:default/hill-valley',
          ),
        ),
      ).toEqual(
        allowing(
          [
            'user:default/biff',
            'group:default/beta-vm-machinery',
            'group:default/hill-valley',
          ],
          track('vm-machinery'),
        ),
      );
    });

    it('gives a developer who also tests both', async () => {
      expect(
        await policy.handle(
          read,
          userOwning(
            'user:default/mcfly',
            'group:default/guests',
            'group:default/Beta-VM-Machinery',
          ),
        ),
      ).toEqual(
        allowing(
          [
            'user:default/mcfly',
            'group:default/guests',
            'group:default/beta-vm-machinery',
          ],
          developerRule,
          track('vm-machinery'),
        ),
      );
    });

    it('honours configured developer groups', async () => {
      const custom = new TemplateAudiencePolicy(undefined, [
        'group:default/devs',
      ]);
      expect(
        await custom.handle(
          read,
          userOwning(
            'user:default/x',
            'group:default/devs',
            'group:default/beta-a',
          ),
        ),
      ).toEqual(
        allowing(
          ['user:default/x', 'group:default/devs', 'group:default/beta-a'],
          developerRule,
          track('a'),
        ),
      );
    });
  });

  it('honours configured platform groups instead of the default', async () => {
    const custom = new TemplateAudiencePolicy([
      'group:default/team-infrastructure',
    ]);
    expect(
      await custom.handle(
        read,
        userOwning('user:default/a', 'group:default/team-infrastructure'),
      ),
    ).toEqual({ result: AuthorizeResult.ALLOW });
    expect(
      await custom.handle(
        read,
        userOwning('user:default/b', 'group:default/platform-team'),
      ),
    ).toEqual(
      allowing(
        ['user:default/b', 'group:default/platform-team'],
        developerRule,
      ),
    );
  });

  describe('platform-only permissions', () => {
    const names = [
      'catalog.entity.create',
      'catalog.entity.delete',
      'catalog.location.create',
      'catalog.location.delete',
      'scaffolder.template.management',
      'kubernetes.proxy',
      'devtools.administer',
      'devtools.config',
      'devtools.scheduler.trigger',
      'catalog.entities.unprocessed.read',
      'catalog.entities.unprocessed.delete',
    ];

    it.each(names)('denies %s to developers and guest', async name => {
      const permission = createPermission({ name, attributes: {} });
      for (const user of [
        userOwning('user:default/dev', 'group:default/guests'),
        userOwning('user:development/guest'),
        undefined,
      ]) {
        expect(await policy.handle({ permission }, user)).toEqual({
          result: AuthorizeResult.DENY,
        });
      }
    });

    it.each(names)('allows %s to platform-team', async name => {
      const permission = createPermission({ name, attributes: {} });
      expect(
        await policy.handle(
          { permission },
          userOwning('user:default/p', 'group:default/platform-team'),
        ),
      ).toEqual({ result: AuthorizeResult.ALLOW });
    });

    it('denies the typed catalog delete permission too', async () => {
      expect(
        await policy.handle(
          { permission: catalogEntityDeletePermission },
          userOwning('user:default/dev'),
        ),
      ).toEqual({ result: AuthorizeResult.DENY });
    });
  });

  describe('scaffolder tasks', () => {
    it.each([taskReadPermission, taskCancelPermission])(
      'limits $name to own tasks for developers',
      async permission => {
        expect(
          await policy.handle(
            { permission },
            userOwning('user:default/dev', 'group:default/guests'),
          ),
        ).toEqual({
          result: AuthorizeResult.CONDITIONAL,
          pluginId: 'scaffolder',
          resourceType: 'scaffolder-task',
          conditions: {
            rule: 'IS_TASK_OWNER',
            resourceType: 'scaffolder-task',
            params: { createdBy: ['user:default/dev'] },
          },
        });
      },
    );

    it('denies tasks to a caller without a user ref', async () => {
      expect(
        await policy.handle({ permission: taskReadPermission }, undefined),
      ).toEqual({ result: AuthorizeResult.DENY });
    });

    it('lets platform-team read and cancel every task', async () => {
      const platform = userOwning(
        'user:default/p',
        'group:default/platform-team',
      );
      for (const permission of [taskReadPermission, taskCancelPermission]) {
        expect(await policy.handle({ permission }, platform)).toEqual({
          result: AuthorizeResult.ALLOW,
        });
      }
    });
  });

  it('leaves every other permission allowed, as under allow-all', async () => {
    const dev = userOwning('user:default/dev');
    for (const name of [
      'scaffolder.task.create',
      'scaffolder.action.execute',
      'catalog.entity.refresh',
      'kubernetes.resources.read',
    ]) {
      expect(
        await policy.handle(
          { permission: createPermission({ name, attributes: {} }) },
          dev,
        ),
      ).toEqual({ result: AuthorizeResult.ALLOW });
    }
  });
});

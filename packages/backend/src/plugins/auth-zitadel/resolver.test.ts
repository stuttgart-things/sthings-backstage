import { Entity } from '@backstage/catalog-model';
import { NotFoundError } from '@backstage/errors';
import { AuthResolverContext } from '@backstage/plugin-auth-node';
import {
  claimSetsOf,
  extractZitadelRoles,
  groupForRole,
  signInWithZitadelRoles,
  usernameFromClaims,
  zitadelProjectRolesResolver,
} from './resolver';

const PROJECT = '311234567890123456';
const roleClaim = (...roles: string[]) =>
  Object.fromEntries(
    roles.map(r => [r, { '300000000000000001': 'zitadel.example' }]),
  );

function context(user?: Entity, ownership: string[] = []) {
  const issueToken = jest.fn(async ({ claims }) => ({
    token: JSON.stringify(claims),
  }));
  const ctx = {
    issueToken,
    findCatalogUser: jest.fn(async () => {
      if (!user) throw new NotFoundError('no such user');
      return { entity: user };
    }),
    resolveOwnershipEntityRefs: jest.fn(async () => ({
      ownershipEntityRefs: ownership,
    })),
    signInWithCatalogUser: jest.fn(),
  } as unknown as AuthResolverContext;
  return { ctx, issueToken };
}

const userEntity = (name: string): Entity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'User',
  metadata: { name, namespace: 'default' },
  spec: { memberOf: ['guests'] },
});

describe('extractZitadelRoles', () => {
  it('reads the generic and the project-specific claim', () => {
    expect(
      extractZitadelRoles([
        {
          'urn:zitadel:iam:org:project:roles': roleClaim('backstage-developer'),
        },
        {
          [`urn:zitadel:iam:org:project:${PROJECT}:roles`]:
            roleClaim('backstage-platform'),
        },
      ]),
    ).toEqual(['backstage-developer', 'backstage-platform']);
  });

  it('reads only the configured project when projectId is set', () => {
    expect(
      extractZitadelRoles(
        [
          {
            'urn:zitadel:iam:org:project:roles': roleClaim('portal-admin'),
            [`urn:zitadel:iam:org:project:${PROJECT}:roles`]: roleClaim(
              'backstage-developer',
            ),
            'urn:zitadel:iam:org:project:999:roles':
              roleClaim('backstage-platform'),
          },
        ],
        PROJECT,
      ),
    ).toEqual(['backstage-developer']);
  });

  it('ignores other claims and malformed values', () => {
    expect(
      extractZitadelRoles([
        {
          groups: ['backstage-platform'],
          'urn:zitadel:iam:org:project:roles': 'x',
        },
      ]),
    ).toEqual([]);
  });
});

describe('usernameFromClaims', () => {
  it('drops the login domain', () => {
    expect(
      usernameFromClaims([
        { preferred_username: 'mcfly@sthings.zitadel.example' },
      ]),
    ).toBe('mcfly');
  });

  it('takes the first claim set that has one', () => {
    expect(usernameFromClaims([{}, { preferred_username: 'indy' }])).toBe(
      'indy',
    );
  });

  it('rejects names that cannot be entity names', () => {
    expect(() =>
      usernameFromClaims([{ preferred_username: 'Henry Jones' }]),
    ).toThrow(/not a valid Backstage entity name/);
    expect(() => usernameFromClaims([{ email: 'a@b.c' }])).toThrow(
      /no preferred_username/,
    );
  });
});

describe('claimSetsOf', () => {
  it('puts ID token claims before userinfo and survives a token set without claims()', () => {
    const idClaims = { preferred_username: 'id' };
    expect(
      claimSetsOf({
        tokenset: { claims: () => idClaims },
        userinfo: { sub: '1', preferred_username: 'ui' },
      } as any),
    ).toEqual([idClaims, { sub: '1', preferred_username: 'ui' }]);
    expect(
      claimSetsOf({
        tokenset: {
          claims: () => {
            throw new Error('id_token not present in TokenSet');
          },
        },
        userinfo: { sub: '1' },
      } as any),
    ).toEqual([{ sub: '1' }]);
  });
});

describe('signInWithZitadelRoles', () => {
  const platform = {
    preferred_username: 'indy',
    'urn:zitadel:iam:org:project:roles': roleClaim('backstage-platform'),
  };
  const developer = {
    preferred_username: 'mcfly',
    'urn:zitadel:iam:org:project:roles': roleClaim('backstage-developer'),
  };

  it('adds the role group to a catalog user', async () => {
    const { ctx, issueToken } = context(userEntity('indy'), [
      'user:default/indy',
      'group:default/guests',
    ]);
    await signInWithZitadelRoles([platform], ctx);
    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:default/indy',
        ent: [
          'user:default/indy',
          'group:default/guests',
          'group:default/platform-team',
        ],
      },
    });
  });

  it('rejects a user without a catalog entity by default', async () => {
    const { ctx } = context();
    await expect(signInWithZitadelRoles([developer], ctx)).rejects.toThrow(
      /No User entity "mcfly"/,
    );
  });

  it('signs in a user without a catalog entity when allowed', async () => {
    const { ctx, issueToken } = context();
    await signInWithZitadelRoles([developer], ctx, {
      dangerouslyAllowSignInWithoutUserInCatalog: true,
    });
    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:default/mcfly',
        ent: ['user:default/mcfly', 'group:default/guests'],
      },
    });
  });

  it('maps beta-track and team roles by prefix (doc, biff)', async () => {
    const { ctx, issueToken } = context();
    const biff = {
      preferred_username: 'biff',
      'urn:zitadel:iam:org:project:roles': roleClaim(
        'backstage-beta-vm-machinery',
        'backstage-team-hill-valley',
      ),
    };
    await signInWithZitadelRoles([biff], ctx, {
      dangerouslyAllowSignInWithoutUserInCatalog: true,
    });
    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:default/biff',
        ent: [
          'user:default/biff',
          'group:default/beta-vm-machinery',
          'group:default/hill-valley',
        ],
      },
    });
  });

  it('rejects a user without a mapped role, before the catalog lookup', async () => {
    const { ctx } = context(userEntity('sthings'));
    await expect(
      signInWithZitadelRoles(
        [
          {
            preferred_username: 'sthings',
            'urn:zitadel:iam:org:project:roles': roleClaim('portal-admin'),
          },
        ],
        ctx,
        { dangerouslyAllowSignInWithoutUserInCatalog: true },
      ),
    ).rejects.toThrow(/No Backstage role in Zitadel \(roles: portal-admin;/);
    expect(ctx.findCatalogUser).not.toHaveBeenCalled();
  });

  it('lets a catalog user without a role in when requireRole is false', async () => {
    const { ctx, issueToken } = context(userEntity('sthings'), [
      'user:default/sthings',
    ]);
    await signInWithZitadelRoles([{ preferred_username: 'sthings' }], ctx, {
      requireRole: false,
    });
    expect(issueToken).toHaveBeenCalledWith({
      claims: { sub: 'user:default/sthings', ent: ['user:default/sthings'] },
    });
  });

  it('uses configured role groups', async () => {
    const { ctx, issueToken } = context();
    await signInWithZitadelRoles([developer], ctx, {
      roleGroups: { 'backstage-developer': 'group:default/developers' },
      dangerouslyAllowSignInWithoutUserInCatalog: true,
    });
    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:default/mcfly',
        ent: ['user:default/mcfly', 'group:default/developers'],
      },
    });
  });

  it('passes on catalog errors other than not-found', async () => {
    const { ctx } = context();
    (ctx.findCatalogUser as jest.Mock).mockRejectedValueOnce(
      new Error('catalog down'),
    );
    await expect(
      signInWithZitadelRoles([developer], ctx, {
        dangerouslyAllowSignInWithoutUserInCatalog: true,
      }),
    ).rejects.toThrow('catalog down');
  });
});

describe('zitadelProjectRolesResolver (factory)', () => {
  it('accepts the options as written in app-config and reads fullProfile', async () => {
    const resolver = zitadelProjectRolesResolver({
      roleGroups: { 'backstage-platform': 'group:default/platform-team' },
      dangerouslyAllowSignInWithoutUserInCatalog: true,
    });
    const { ctx, issueToken } = context();
    await resolver(
      {
        profile: {},
        result: {
          fullProfile: {
            tokenset: {
              claims: () => ({
                preferred_username: 'tommy',
                'urn:zitadel:iam:org:project:roles':
                  roleClaim('backstage-platform'),
              }),
            },
            userinfo: { sub: '1' },
          },
          session: {},
        },
      } as any,
      ctx,
    );
    expect(issueToken).toHaveBeenCalledWith({
      claims: {
        sub: 'user:default/tommy',
        ent: ['user:default/tommy', 'group:default/platform-team'],
      },
    });
  });

  it('rejects unknown option types', () => {
    expect(() =>
      zitadelProjectRolesResolver({ requireRole: 'yes' } as any),
    ).toThrow();
  });
});

describe('groupForRole', () => {
  it('prefers the explicit role groups', () => {
    expect(groupForRole('backstage-platform')).toBe(
      'group:default/platform-team',
    );
    expect(
      groupForRole('backstage-beta-x', {
        'backstage-beta-x': 'group:default/special',
      }),
    ).toBe('group:default/special');
  });

  it('maps backstage-beta-<track> and backstage-team-<team>', () => {
    expect(groupForRole('backstage-beta-vm-machinery')).toBe(
      'group:default/beta-vm-machinery',
    );
    expect(groupForRole('backstage-team-Hill-Valley')).toBe(
      'group:default/hill-valley',
    );
  });

  it('grants nothing for unknown, empty or invalid names', () => {
    expect(groupForRole('some-other-role')).toBeUndefined();
    expect(groupForRole('backstage-beta-')).toBeUndefined();
    expect(groupForRole('backstage-team-')).toBeUndefined();
    expect(groupForRole('backstage-team-a b')).toBeUndefined();
    expect(groupForRole('backstage-team--x')).toBeUndefined();
  });
});

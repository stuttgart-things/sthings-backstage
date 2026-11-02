import { z } from 'zod/v3';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { NotAllowedError } from '@backstage/errors';
import {
  AuthResolverContext,
  BackstageSignInResult,
  OAuthAuthenticatorResult,
  SignInInfo,
  createSignInResolverFactory,
} from '@backstage/plugin-auth-node';
import type { OidcAuthResult } from '@backstage/plugin-auth-backend-module-oidc-provider';

/**
 * Zitadel puts the project roles of a user into the ID token and the userinfo
 * response under one of these claims, as `{ "<role>": { "<orgId>": "<domain>" } }`:
 *
 * - `urn:zitadel:iam:org:project:roles` -- roles of the project the client
 *   belongs to
 * - `urn:zitadel:iam:org:project:<projectId>:roles` -- roles of one project
 */
export const GENERIC_ROLES_CLAIM = 'urn:zitadel:iam:org:project:roles';
export const projectRolesClaim = (projectId: string) =>
  `urn:zitadel:iam:org:project:${projectId}:roles`;

/** Zitadel role -> Backstage group the role grants. */
export const DEFAULT_ROLE_GROUPS: Record<string, string> = {
  'backstage-platform': 'group:default/platform-team',
  'backstage-developer': 'group:default/guests',
};

/**
 * Roles mapped by name, so a new beta track or team needs a Zitadel role and
 * no code change. Checked after the explicit role groups.
 *
 * - `backstage-beta-<track>` -> `group:default/beta-<track>`: a beta tester of
 *   one template track (the permission policy shows that track's templates).
 * - `backstage-team-<team>` -> `group:default/<team>`: a team that can own
 *   ordered resources.
 */
export const ROLE_GROUP_PREFIXES: ReadonlyArray<{
  rolePrefix: string;
  groupPrefix: string;
}> = [
  { rolePrefix: 'backstage-beta-', groupPrefix: 'group:default/beta-' },
  { rolePrefix: 'backstage-team-', groupPrefix: 'group:default/' },
];

// Backstage entity names: letters, digits, '-', '_', '.', at most 63 chars,
// starting and ending with a letter or digit.
const ENTITY_NAME = /^[a-zA-Z0-9]([a-zA-Z0-9._-]{0,61}[a-zA-Z0-9])?$/;

type Claims = Record<string, unknown>;

export const zitadelOptionsSchema = z
  .object({
    /** Zitadel role -> Backstage group ref. Default {@link DEFAULT_ROLE_GROUPS}. */
    roleGroups: z.record(z.string()).optional(),
    /**
     * Read roles only from `urn:zitadel:iam:org:project:<projectId>:roles`.
     * Without it, every roles claim in the token counts.
     */
    projectId: z.string().optional(),
    /** Reject a user none of whose roles maps to a group. Default true. */
    requireRole: z.boolean().optional(),
    /**
     * Sign in users that have no User entity in the catalog, as
     * `user:default/<username>` with only their role groups. Default false.
     */
    dangerouslyAllowSignInWithoutUserInCatalog: z.boolean().optional(),
  })
  .optional();

export type ZitadelResolverOptions = z.output<typeof zitadelOptionsSchema>;

/** Role names from every Zitadel roles claim in the given claim sets. */
export function extractZitadelRoles(
  claimSets: Claims[],
  projectId?: string,
): string[] {
  const roles = new Set<string>();
  for (const claims of claimSets) {
    for (const [key, value] of Object.entries(claims)) {
      const matches = projectId
        ? key === projectRolesClaim(projectId)
        : key === GENERIC_ROLES_CLAIM ||
          /^urn:zitadel:iam:org:project:[^:]+:roles$/.test(key);
      if (matches && value && typeof value === 'object') {
        Object.keys(value as object).forEach(role => roles.add(role));
      }
    }
  }
  return [...roles].sort();
}

/**
 * The catalog entity name for a Zitadel user: `preferred_username`, without
 * the login domain (`mcfly@sthings.zitadel.example` -> `mcfly`).
 */
export function usernameFromClaims(claimSets: Claims[]): string {
  for (const claims of claimSets) {
    const value = claims.preferred_username;
    if (typeof value === 'string' && value) {
      const name = value.split('@')[0];
      if (!ENTITY_NAME.test(name)) {
        throw new NotAllowedError(
          `Zitadel username "${value}" is not a valid Backstage entity name`,
        );
      }
      return name;
    }
  }
  throw new NotAllowedError('Zitadel token has no preferred_username');
}

/** ID token claims and userinfo of an OIDC sign-in, ID token first. */
export function claimSetsOf(result: OidcAuthResult): Claims[] {
  const sets: Claims[] = [];
  const tokenset = result.tokenset as { claims?: () => Claims } | undefined;
  if (typeof tokenset?.claims === 'function') {
    try {
      sets.push(tokenset.claims());
    } catch {
      // no ID token in this token set (e.g. some refresh responses)
    }
  }
  if (result.userinfo) {
    sets.push(result.userinfo as Claims);
  }
  return sets;
}

/**
 * The group a Zitadel role grants: an explicit entry in `roleGroups` first,
 * then {@link ROLE_GROUP_PREFIXES}. A prefixed role whose rest is not a valid
 * entity name grants nothing.
 */
export function groupForRole(
  role: string,
  roleGroups: Record<string, string> = DEFAULT_ROLE_GROUPS,
): string | undefined {
  if (roleGroups[role]) {
    return roleGroups[role];
  }
  for (const { rolePrefix, groupPrefix } of ROLE_GROUP_PREFIXES) {
    if (role.startsWith(rolePrefix)) {
      const rest = role.slice(rolePrefix.length);
      const group = `${groupPrefix}${rest}`;
      const name = group.slice('group:default/'.length);
      return rest && ENTITY_NAME.test(name) ? group.toLowerCase() : undefined;
    }
  }
  return undefined;
}

/**
 * Signs a user in with the groups their Zitadel project roles grant.
 *
 * The groups are added to the ownership refs of the Backstage token, which is
 * what the permission policy reads -- Zitadel decides who is platform and who
 * is developer, without a second copy of the membership in the org catalog.
 * A user that also has a User entity keeps the entity ref and the groups the
 * catalog gives them.
 */
export async function signInWithZitadelRoles(
  claimSets: Claims[],
  ctx: AuthResolverContext,
  options: ZitadelResolverOptions = {},
): Promise<BackstageSignInResult> {
  const roleGroups = options.roleGroups ?? DEFAULT_ROLE_GROUPS;
  const roles = extractZitadelRoles(claimSets, options.projectId);
  const groups = [
    ...new Set(
      roles.flatMap(role => {
        const group = groupForRole(role, roleGroups);
        return group ? [group] : [];
      }),
    ),
  ];

  if ((options.requireRole ?? true) && groups.length === 0) {
    throw new NotAllowedError(
      `No Backstage role in Zitadel (roles: ${roles.join(', ') || 'none'}; ` +
        `expected one of ${Object.keys(roleGroups).join(', ')}, or ` +
        `${ROLE_GROUP_PREFIXES.map(p => `${p.rolePrefix}<name>`).join(', ')})`,
    );
  }

  const name = usernameFromClaims(claimSets);

  let entity;
  try {
    ({ entity } = await ctx.findCatalogUser({ entityRef: { name } }));
  } catch (error) {
    if ((error as Error)?.name !== 'NotFoundError') {
      throw error;
    }
    if (!options.dangerouslyAllowSignInWithoutUserInCatalog) {
      throw new NotAllowedError(
        `No User entity "${name}" in the catalog. Add one, or set ` +
          'dangerouslyAllowSignInWithoutUserInCatalog on the resolver.',
      );
    }
  }

  if (entity) {
    const sub = stringifyEntityRef(entity);
    const { ownershipEntityRefs } =
      await ctx.resolveOwnershipEntityRefs(entity);
    return ctx.issueToken({
      claims: { sub, ent: [...new Set([...ownershipEntityRefs, ...groups])] },
    });
  }

  const sub = stringifyEntityRef({ kind: 'User', namespace: 'default', name });
  return ctx.issueToken({ claims: { sub, ent: [sub, ...groups] } });
}

export const zitadelProjectRolesResolver = createSignInResolverFactory({
  optionsSchema: zitadelOptionsSchema,
  create(options = {}) {
    return async (
      info: SignInInfo<OAuthAuthenticatorResult<OidcAuthResult>>,
      ctx: AuthResolverContext,
    ) =>
      signInWithZitadelRoles(
        claimSetsOf(info.result.fullProfile),
        ctx,
        options,
      );
  },
});

import {
  AuthorizeResult,
  PolicyDecision,
  isPermission,
} from '@backstage/plugin-permission-common';
import {
  PermissionPolicy,
  PolicyQuery,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import { catalogEntityReadPermission } from '@backstage/plugin-catalog-common/alpha';
import {
  catalogConditions,
  createCatalogConditionalDecision,
} from '@backstage/plugin-catalog-backend/alpha';
import {
  taskCancelPermission,
  taskReadPermission,
} from '@backstage/plugin-scaffolder-common/alpha';
import {
  createScaffolderTaskConditionalDecision,
  scaffolderTaskConditions,
} from '@backstage/plugin-scaffolder-backend/alpha';

/**
 * A Template carrying this annotation with value {@link AUDIENCE_DEVELOPERS} is
 * visible to everyone. Every other Template is visible only to the platform
 * groups.
 *
 * An allowlist on purpose: a new template is platform-only until someone
 * decides it is meant for developers, rather than public until someone
 * remembers to hide it.
 */
export const AUDIENCE_ANNOTATION = 'backstage.stuttgart-things.com/audience';
export const AUDIENCE_DEVELOPERS = 'developers';

export const DEFAULT_PLATFORM_GROUPS = ['group:default/platform-team'];

/**
 * Beta tracks: a Template annotated `beta-track: <track>` is also visible to
 * the members of `group:default/beta-<track>` (Zitadel role
 * `backstage-beta-<track>`). A track is one workflow under test -- e.g.
 * vm-machinery: order, resize and delete a VM on machinery.
 *
 * A beta tester sees the general developer templates only when they also hold
 * a developer group, so a test user with just the track role sees exactly
 * the track.
 */
export const BETA_TRACK_ANNOTATION =
  'backstage.stuttgart-things.com/beta-track';
export const BETA_GROUP_PREFIX = 'group:default/beta-';
export const DEFAULT_DEVELOPER_GROUPS = ['group:default/guests'];

/**
 * Permissions only the platform groups hold. Matched by name, so the policy
 * needs no dependency on every plugin that defines one.
 *
 * - catalog.entity.create / catalog.location.create: registering entities,
 *   the catalog-import page included. Note that the scaffolder's
 *   catalog:register action runs with the caller's credentials, so a
 *   developer template must not use it.
 * - catalog.entity.delete / catalog.location.delete: unregistering.
 * - scaffolder.template.management: the template editor and dry-run
 *   (/create/edit).
 * - kubernetes.proxy: raw requests to the clusters through Backstage.
 */
export const PLATFORM_ONLY_PERMISSIONS = new Set([
  'catalog.entity.create',
  'catalog.entity.delete',
  'catalog.location.create',
  'catalog.location.delete',
  'scaffolder.template.management',
  'kubernetes.proxy',
]);

/**
 * Permission name prefixes only the platform groups hold: whole admin plugins.
 *
 * - devtools.*: DevTools (config, versions, external dependencies, scheduled
 *   tasks and triggering them).
 * - catalog.entities.unprocessed.*: the unprocessed-entities view and
 *   deleting entries from it.
 */
export const PLATFORM_ONLY_PREFIXES = [
  'devtools.',
  'catalog.entities.unprocessed.',
];

/**
 * Separates platform users from developers.
 *
 * Platform groups may do everything. Everyone else -- developers, guest, a
 * user without ownership refs -- gets:
 *
 * - `catalog.entity.read`: every entity except Templates without the audience
 *   annotation -- plus the Templates of their beta tracks; a beta tester
 *   without a developer group sees only those (see BETA_TRACK_ANNOTATION). The Create page lists templates through the catalog, and the
 *   scaffolder loads the template for a task with the CALLER's credentials, so
 *   a template a user cannot read is "not found" when they try to start it.
 * - `scaffolder.task.read` / `scaffolder.task.cancel`: only tasks they
 *   started themselves.
 * - {@link PLATFORM_ONLY_PERMISSIONS} and {@link PLATFORM_ONLY_PREFIXES}: denied.
 * - everything else: allowed, as under the allow-all policy.
 *
 * Service principals never reach this policy. The permission client decides
 * them on the spot from their access restrictions, so the Dapr worker's static
 * token keeps reading and running platform templates.
 */
export class TemplateAudiencePolicy implements PermissionPolicy {
  private readonly platformGroups: Set<string>;
  private readonly developerGroups: Set<string>;

  constructor(
    platformGroups: string[] = DEFAULT_PLATFORM_GROUPS,
    developerGroups: string[] = DEFAULT_DEVELOPER_GROUPS,
  ) {
    this.platformGroups = new Set(platformGroups.map(normalize));
    this.developerGroups = new Set(developerGroups.map(normalize));
  }

  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const ownership = user?.info.ownershipEntityRefs ?? [];
    if (ownership.some(ref => this.platformGroups.has(normalize(ref)))) {
      return { result: AuthorizeResult.ALLOW };
    }

    const name = request.permission.name;
    if (
      PLATFORM_ONLY_PERMISSIONS.has(name) ||
      PLATFORM_ONLY_PREFIXES.some(prefix => name.startsWith(prefix))
    ) {
      return { result: AuthorizeResult.DENY };
    }

    if (isPermission(request.permission, catalogEntityReadPermission)) {
      const refs = ownership.map(normalize);
      const tracks = refs
        .filter(ref => ref.startsWith(BETA_GROUP_PREFIX))
        .map(ref => ref.slice(BETA_GROUP_PREFIX.length))
        .filter(Boolean);
      const seesDeveloperTemplates =
        tracks.length === 0 || refs.some(ref => this.developerGroups.has(ref));
      return createCatalogConditionalDecision(request.permission, {
        anyOf: [
          { not: catalogConditions.isEntityKind({ kinds: ['Template'] }) },
          ...(seesDeveloperTemplates
            ? [
                catalogConditions.hasAnnotation({
                  annotation: AUDIENCE_ANNOTATION,
                  value: AUDIENCE_DEVELOPERS,
                }),
              ]
            : []),
          ...tracks.map(track =>
            catalogConditions.hasAnnotation({
              annotation: BETA_TRACK_ANNOTATION,
              value: track,
            }),
          ),
        ],
      });
    }

    if (
      isPermission(request.permission, taskReadPermission) ||
      isPermission(request.permission, taskCancelPermission)
    ) {
      const userRef = user?.info.userEntityRef;
      if (!userRef) {
        return { result: AuthorizeResult.DENY };
      }
      return createScaffolderTaskConditionalDecision(
        request.permission,
        scaffolderTaskConditions.isTaskOwner({ createdBy: [userRef] }),
      );
    }

    return { result: AuthorizeResult.ALLOW };
  }
}

// Entity refs compare case-insensitively; a group written as
// group:default/Platform-Team in config must still match the token.
function normalize(ref: string): string {
  return ref.toLocaleLowerCase('en-US');
}

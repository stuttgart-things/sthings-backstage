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
 * Separates platform users from developers.
 *
 * Platform groups may do everything. Everyone else -- developers, guest, a
 * user without ownership refs -- gets:
 *
 * - `catalog.entity.read`: every entity except Templates without the audience
 *   annotation. The Create page lists templates through the catalog, and the
 *   scaffolder loads the template for a task with the CALLER's credentials, so
 *   a template a user cannot read is "not found" when they try to start it.
 * - `scaffolder.task.read` / `scaffolder.task.cancel`: only tasks they
 *   started themselves.
 * - {@link PLATFORM_ONLY_PERMISSIONS}: denied.
 * - everything else: allowed, as under the allow-all policy.
 *
 * Service principals never reach this policy. The permission client decides
 * them on the spot from their access restrictions, so the Dapr worker's static
 * token keeps reading and running platform templates.
 */
export class TemplateAudiencePolicy implements PermissionPolicy {
  private readonly platformGroups: Set<string>;

  constructor(platformGroups: string[] = DEFAULT_PLATFORM_GROUPS) {
    this.platformGroups = new Set(platformGroups.map(normalize));
  }

  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const ownership = user?.info.ownershipEntityRefs ?? [];
    if (ownership.some(ref => this.platformGroups.has(normalize(ref)))) {
      return { result: AuthorizeResult.ALLOW };
    }

    if (PLATFORM_ONLY_PERMISSIONS.has(request.permission.name)) {
      return { result: AuthorizeResult.DENY };
    }

    if (isPermission(request.permission, catalogEntityReadPermission)) {
      return createCatalogConditionalDecision(request.permission, {
        anyOf: [
          { not: catalogConditions.isEntityKind({ kinds: ['Template'] }) },
          catalogConditions.hasAnnotation({
            annotation: AUDIENCE_ANNOTATION,
            value: AUDIENCE_DEVELOPERS,
          }),
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

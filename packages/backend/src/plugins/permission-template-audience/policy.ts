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
 * Restricts which scaffolder templates a user can see -- and therefore run.
 *
 * Only `catalog.entity.read` is decided here. That one permission covers both
 * halves: the Create page lists templates through the catalog, and the
 * scaffolder loads the template for a task with the CALLER's credentials, so a
 * template a user cannot read is "not found" when they try to start it.
 * Everything else stays allowed, as it was under the allow-all policy.
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
    if (!isPermission(request.permission, catalogEntityReadPermission)) {
      return { result: AuthorizeResult.ALLOW };
    }

    const ownership = user?.info.ownershipEntityRefs ?? [];
    if (ownership.some(ref => this.platformGroups.has(normalize(ref)))) {
      return { result: AuthorizeResult.ALLOW };
    }

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
}

// Entity refs compare case-insensitively; a group written as
// group:default/Platform-Team in config must still match the token.
function normalize(ref: string): string {
  return ref.toLocaleLowerCase('en-US');
}

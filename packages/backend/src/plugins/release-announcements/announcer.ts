import { LoggerService } from '@backstage/backend-plugin-api';

/**
 * Announces the portal release an instance is running, once per instance and
 * version (category `release`).
 *
 * The image does not know its release version: it is built from a main
 * commit before semantic-release tags it, then promoted to `v<version>`. It
 * only knows its build commit (`build-info.json`, written by docker-build).
 * semantic-release puts the release commit (`chore(release): x.y.z`) directly
 * on top of the built commit, and the release workflow promotes only builds of
 * the current main (#271), so the release whose tag commit is the build
 * commit or has it as parent is the one this image was promoted to.
 */

export interface BuildInfo {
  /** Commit the image was built from. */
  sha: string;
}

export interface Release {
  tag: string;
  /** Version without the leading `v`. */
  version: string;
  url: string;
  body: string;
}

/** The GitHub calls the announcer needs (repo-relative API paths). */
export type GitHubGet = (path: string) => Promise<any>;

/** The announcements plugin calls the announcer needs. */
export interface AnnouncementsApi {
  categories(): Promise<{ slug: string }[]>;
  createCategory(title: string): Promise<void>;
  titlesInCategory(category: string): Promise<string[]>;
  create(announcement: NewAnnouncement): Promise<void>;
}

export interface NewAnnouncement {
  title: string;
  excerpt: string;
  body: string;
  publisher: string;
  category: string;
  active: boolean;
  start_at: string;
  tags: string[];
  sendNotification: boolean;
}

export const RELEASE_CATEGORY = 'release';
const RELEASE_CATEGORY_TITLE = 'Release';
/** How many of the newest releases are checked for the build commit. */
const RELEASES_TO_CHECK = 10;

/** The release whose tag commit is, or sits directly on, the build commit. */
export async function findReleaseForBuild(
  build: BuildInfo,
  github: GitHubGet,
): Promise<Release | undefined> {
  const releases: any[] = await github(
    `/releases?per_page=${RELEASES_TO_CHECK}`,
  );
  for (const r of releases) {
    if (r.draft || r.prerelease || !r.tag_name) continue;
    const commit = await github(`/commits/${encodeURIComponent(r.tag_name)}`);
    const parents: string[] = (commit.parents ?? []).map((p: any) => p.sha);
    if (commit.sha === build.sha || parents.includes(build.sha)) {
      return {
        tag: r.tag_name,
        version: String(r.tag_name).replace(/^v/, ''),
        url: r.html_url,
        body: r.body ?? '',
      };
    }
  }
  return undefined;
}

export function announcementTitle(release: Release): string {
  return `Portal v${release.version}`;
}

/**
 * The release notes without semantic-release's version heading (the title
 * already says it), plus a link to the release.
 */
export function announcementBody(release: Release): string {
  const lines = release.body.split('\n');
  const first = lines.findIndex(l => l.trim() !== '');
  if (first >= 0 && /^#{1,3}\s.*\d+\.\d+\.\d+/.test(lines[first])) {
    lines.splice(first, 1);
  }
  const notes = lines.join('\n').trim();
  const link = `[Release ${release.tag} on GitHub](${release.url})`;
  return notes ? `${notes}\n\n${link}` : link;
}

/**
 * One line for the banner and the home card: the first change of the notes
 * without links, scope markup and "closes …", plus how many more there are.
 */
export function announcementExcerpt(release: Release): string {
  const changes = release.body
    .split('\n')
    .map(l => l.trim())
    .filter(l => /^[*-]\s+/.test(l))
    .map(l =>
      l
        .replace(/^[*-]\s+/, '')
        .replace(/,?\s*closes\s.*$/i, '')
        .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '')
        .replace(/\*\*/g, '')
        .trim(),
    )
    .filter(Boolean);
  if (changes.length === 0) {
    return `Version ${release.version} of the portal is live.`;
  }
  const more = changes.length > 1 ? ` (+${changes.length - 1} more)` : '';
  const text = `${changes[0]}${more}`;
  return text.length > 200 ? `${text.slice(0, 197)}...` : text;
}

export interface AnnounceOptions {
  build: BuildInfo;
  github: GitHubGet;
  announcements: AnnouncementsApi;
  publisher: string;
  sendNotification: boolean;
  logger: LoggerService;
  now?: () => Date;
}

export type AnnounceResult =
  | { state: 'announced'; title: string }
  | { state: 'exists'; title: string }
  | { state: 'no-release' };

/**
 * Creates the announcement for the running release unless one with the same
 * title is already in category `release`. Safe to run again and from several
 * replicas one after another (the caller schedules it as a global task).
 */
export async function announceRunningRelease(
  opts: AnnounceOptions,
): Promise<AnnounceResult> {
  const { build, announcements, logger } = opts;
  const release = await findReleaseForBuild(build, opts.github);
  if (!release) {
    logger.info(
      `No release found for build ${build.sha} among the newest ${RELEASES_TO_CHECK}; nothing to announce`,
    );
    return { state: 'no-release' };
  }

  const title = announcementTitle(release);
  const existing = await announcements.titlesInCategory(RELEASE_CATEGORY);
  if (existing.includes(title)) {
    logger.debug(`${title} is already announced`);
    return { state: 'exists', title };
  }

  const categories = await announcements.categories();
  if (!categories.some(c => c.slug === RELEASE_CATEGORY)) {
    await announcements.createCategory(RELEASE_CATEGORY_TITLE);
  }

  await announcements.create({
    title,
    excerpt: announcementExcerpt(release),
    body: announcementBody(release),
    publisher: opts.publisher,
    category: RELEASE_CATEGORY,
    active: true,
    start_at: (opts.now?.() ?? new Date()).toISOString(),
    tags: [],
    sendNotification: opts.sendNotification,
  });
  logger.info(`Announced ${title} (build ${build.sha})`);
  return { state: 'announced', title };
}

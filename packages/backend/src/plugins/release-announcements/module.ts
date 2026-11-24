import {
  AuthService,
  coreServices,
  createBackendModule,
  DiscoveryService,
} from '@backstage/backend-plugin-api';
import { Config } from '@backstage/config';
import { ResponseError } from '@backstage/errors';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AnnouncementsApi,
  announceRunningRelease,
  BuildInfo,
  GitHubGet,
} from './announcer';

const CONFIG_KEY = 'releaseAnnouncements';
const DEFAULT_REPO = 'stuttgart-things/sthings-backstage';
const DEFAULT_PUBLISHER = 'group:default/platform-team';
const DEFAULT_BUILD_INFO = 'build-info.json';

/** The build commit baked into the image by docker-build; absent elsewhere. */
export function readBuildInfo(path: string): BuildInfo | undefined {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  const sha = JSON.parse(raw)?.sha;
  return typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha)
    ? { sha }
    : undefined;
}

function githubClient(config: Config, repo: string): GitHubGet {
  const token = config
    .getOptionalConfigArray('integrations.github')
    ?.find(c => (c.getOptionalString('host') ?? 'github.com') === 'github.com')
    ?.getOptionalString('token');
  return async path => {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) throw await ResponseError.fromResponse(res);
    return res.json();
  };
}

/** The announcements plugin's own API, called as this backend (service). */
function announcementsClient(
  discovery: DiscoveryService,
  auth: AuthService,
): AnnouncementsApi {
  const call = async (path: string, init?: RequestInit) => {
    const base = await discovery.getBaseUrl('announcements');
    const { token } = await auth.getPluginRequestToken({
      onBehalfOf: await auth.getOwnServiceCredentials(),
      targetPluginId: 'announcements',
    });
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) throw await ResponseError.fromResponse(res);
    return res.status === 204 ? undefined : res.json();
  };
  return {
    categories: () => call('/categories'),
    createCategory: async title => {
      await call('/categories', {
        method: 'POST',
        body: JSON.stringify({ title }),
      });
    },
    titlesInCategory: async category => {
      const list = await call(
        `/announcements?category=${encodeURIComponent(category)}&max=100`,
      );
      return (list?.results ?? []).map((a: any) => a.title);
    },
    create: async announcement => {
      await call('/announcements', {
        method: 'POST',
        body: JSON.stringify(announcement),
      });
    },
  };
}

/**
 * Announces the release an instance runs, after it is deployed (announcer.ts).
 * Active in images built by docker-build (they carry build-info.json); off
 * with releaseAnnouncements.enabled: false. Runs shortly after startup and
 * then hourly as a global task, so only one replica does it at a time.
 */
export default createBackendModule({
  pluginId: 'announcements',
  moduleId: 'release-notes',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
        discovery: coreServices.discovery,
        auth: coreServices.auth,
      },
      async init({ config, logger, scheduler, discovery, auth }) {
        const c = config.getOptionalConfig(CONFIG_KEY);
        if (c?.getOptionalBoolean('enabled') === false) {
          logger.info('Release announcements are disabled');
          return;
        }
        const buildInfoFile = resolve(
          c?.getOptionalString('buildInfoFile') ?? DEFAULT_BUILD_INFO,
        );
        const build = readBuildInfo(buildInfoFile);
        if (!build) {
          logger.info(
            `No build info at ${buildInfoFile} (not a CI image); release announcements are off`,
          );
          return;
        }

        const github = githubClient(
          config,
          c?.getOptionalString('repository') ?? DEFAULT_REPO,
        );
        const announcements = announcementsClient(discovery, auth);
        const publisher =
          c?.getOptionalString('publisher') ?? DEFAULT_PUBLISHER;
        const sendNotification =
          c?.getOptionalBoolean('sendNotification') ?? false;
        let done = false;

        await scheduler.scheduleTask({
          // One task per build: a global task keeps its schedule in the
          // database, so with a fixed id a new image inherited the old one's
          // hourly slot and announced up to an hour late; initialDelay only
          // applies when a task id is registered for the first time.
          id: `announce-running-release-${build.sha.slice(0, 12)}`,
          frequency: { hours: 1 },
          timeout: { minutes: 2 },
          initialDelay: { minutes: 2 },
          scope: 'global',
          fn: async () => {
            if (done) return;
            try {
              const result = await announceRunningRelease({
                build,
                github,
                announcements,
                publisher,
                sendNotification,
                logger,
              });
              done = result.state !== 'no-release';
            } catch (e) {
              // Next run tries again; the scheduler would only log `{}`.
              logger.warn(
                `Could not announce the running release: ${(e as Error).message}`,
              );
            }
          },
        });
      },
    });
  },
});

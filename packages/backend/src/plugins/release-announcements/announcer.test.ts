import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AnnouncementsApi,
  announcementBody,
  announcementExcerpt,
  announceRunningRelease,
  findReleaseForBuild,
  NewAnnouncement,
  Release,
} from './announcer';
import { readBuildInfo } from './module';

const BUILD = '0029fd630b01f3e7da40260474ac6ff490f2ba98';
const NOTES = `# [1.36.0](https://github.com/stuttgart-things/sthings-backstage/compare/v1.35.2...v1.36.0) (2026-11-23)


### Features

* **vms:** live VM info card on the entity page ([#272](https://github.com/stuttgart-things/sthings-backstage/issues/272)) ([0029fd6](https://github.com/stuttgart-things/sthings-backstage/commit/0029fd6)), closes [#244](https://github.com/stuttgart-things/sthings-backstage/issues/244)
`;

function fakeGitHub(
  releases: any[],
  commits: Record<string, { sha: string; parents: string[] }>,
) {
  const calls: string[] = [];
  const get = async (path: string) => {
    calls.push(path);
    if (path.startsWith('/releases')) return releases;
    const tag = decodeURIComponent(path.replace('/commits/', ''));
    const c = commits[tag];
    if (!c) throw new Error(`no commit ${tag}`);
    return { sha: c.sha, parents: c.parents.map(sha => ({ sha })) };
  };
  return { get, calls };
}

const releases = [
  {
    tag_name: 'v1.36.0',
    html_url: 'https://github.com/x/r/releases/tag/v1.36.0',
    body: NOTES,
  },
  {
    tag_name: 'v1.35.2',
    html_url: 'https://github.com/x/r/releases/tag/v1.35.2',
    body: '',
  },
];
const commits = {
  'v1.36.0': { sha: '3ee7c60aaaa', parents: [BUILD] },
  'v1.35.2': { sha: 'oldrelease', parents: ['oldbuild'] },
};

function fakeAnnouncements(
  titles: string[] = [],
  slugs: string[] = ['release'],
) {
  const created: NewAnnouncement[] = [];
  const categories: string[] = [];
  const api: AnnouncementsApi = {
    categories: async () => slugs.map(slug => ({ slug })),
    createCategory: async t => {
      categories.push(t);
    },
    titlesInCategory: async () => titles,
    create: async a => {
      created.push(a);
    },
  };
  return { api, created, categories };
}

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
} as any;

describe('findReleaseForBuild', () => {
  it('finds the release whose tag commit sits on the build commit', async () => {
    const gh = fakeGitHub(releases, commits);
    const r = await findReleaseForBuild({ sha: BUILD }, gh.get);
    expect(r?.version).toBe('1.36.0');
    expect(gh.calls).toEqual(['/releases?per_page=10', '/commits/v1.36.0']);
  });

  it('also matches a tag on the build commit itself', async () => {
    const gh = fakeGitHub(releases, {
      ...commits,
      'v1.36.0': { sha: BUILD, parents: ['x'] },
    });
    expect((await findReleaseForBuild({ sha: BUILD }, gh.get))?.tag).toBe(
      'v1.36.0',
    );
  });

  it('skips drafts and returns nothing for an unreleased build', async () => {
    const gh = fakeGitHub(
      [{ ...releases[0], draft: true }, releases[1]],
      commits,
    );
    expect(await findReleaseForBuild({ sha: BUILD }, gh.get)).toBeUndefined();
    expect(gh.calls).not.toContain('/commits/v1.36.0');
  });
});

describe('announcement text', () => {
  const release: Release = {
    tag: 'v1.36.0',
    version: '1.36.0',
    url: 'https://github.com/x/r/releases/tag/v1.36.0',
    body: NOTES,
  };

  it('drops the version heading and links the release', () => {
    const body = announcementBody(release);
    expect(body.startsWith('### Features')).toBe(true);
    expect(body).not.toContain('# [1.36.0]');
    expect(body).toContain(
      '[Release v1.36.0 on GitHub](https://github.com/x/r/releases/tag/v1.36.0)',
    );
  });

  it('excerpts the first change without links and markup', () => {
    expect(announcementExcerpt(release)).toBe(
      'vms: live VM info card on the entity page',
    );
    const two = { ...release, body: `${NOTES}* **app:** second change\n` };
    expect(announcementExcerpt(two)).toBe(
      'vms: live VM info card on the entity page (+1 more)',
    );
  });

  it('falls back when the notes list no change', () => {
    expect(announcementExcerpt({ ...release, body: '' })).toBe(
      'Version 1.36.0 of the portal is live.',
    );
    expect(announcementBody({ ...release, body: '' })).toBe(
      '[Release v1.36.0 on GitHub](https://github.com/x/r/releases/tag/v1.36.0)',
    );
  });
});

describe('announceRunningRelease', () => {
  const base = {
    build: { sha: BUILD },
    publisher: 'group:default/platform-team',
    sendNotification: false,
    logger,
    now: () => new Date('2026-11-23T10:00:00Z'),
  };

  it('announces the running release once', async () => {
    const a = fakeAnnouncements();
    const result = await announceRunningRelease({
      ...base,
      github: fakeGitHub(releases, commits).get,
      announcements: a.api,
    });
    expect(result).toEqual({ state: 'announced', title: 'Portal v1.36.0' });
    expect(a.created).toHaveLength(1);
    expect(a.created[0]).toMatchObject({
      title: 'Portal v1.36.0',
      category: 'release',
      publisher: 'group:default/platform-team',
      active: true,
      start_at: '2026-11-23T10:00:00.000Z',
      sendNotification: false,
    });
    expect(a.categories).toEqual([]);
  });

  it('does nothing when the title is already announced', async () => {
    const a = fakeAnnouncements(['Portal v1.36.0']);
    const result = await announceRunningRelease({
      ...base,
      github: fakeGitHub(releases, commits).get,
      announcements: a.api,
    });
    expect(result.state).toBe('exists');
    expect(a.created).toEqual([]);
  });

  it('creates the release category when it is missing', async () => {
    const a = fakeAnnouncements([], ['maintenance']);
    await announceRunningRelease({
      ...base,
      github: fakeGitHub(releases, commits).get,
      announcements: a.api,
    });
    expect(a.categories).toEqual(['Release']);
    expect(a.created).toHaveLength(1);
  });

  it('announces nothing for a build without release', async () => {
    const a = fakeAnnouncements();
    const result = await announceRunningRelease({
      ...base,
      build: { sha: 'f'.repeat(40) },
      github: fakeGitHub(releases, commits).get,
      announcements: a.api,
    });
    expect(result.state).toBe('no-release');
    expect(a.created).toEqual([]);
  });
});

describe('readBuildInfo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'build-info-'));

  it('reads the commit sha', () => {
    const f = join(dir, 'ok.json');
    writeFileSync(f, JSON.stringify({ sha: BUILD }));
    expect(readBuildInfo(f)).toEqual({ sha: BUILD });
  });

  it('is undefined without a file or with a bad sha', () => {
    expect(readBuildInfo(join(dir, 'missing.json'))).toBeUndefined();
    const f = join(dir, 'bad.json');
    writeFileSync(f, JSON.stringify({ sha: 'main' }));
    expect(readBuildInfo(f)).toBeUndefined();
  });
});

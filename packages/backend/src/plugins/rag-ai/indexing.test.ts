import { LoggerService } from '@backstage/backend-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { ConfigReader } from '@backstage/config';
import { AugmentationIndexer } from '@roadiehq/rag-ai-node';
import {
  DEFAULT_INDEX_SCHEDULE,
  IndexingDeps,
  IndexState,
  readIndexFingerprint,
  readIndexingOptions,
  runIndexing,
} from './indexing';

describe('readIndexingOptions', () => {
  it('is on daily at 03:00 by default', () => {
    expect(readIndexingOptions(new ConfigReader({}))).toEqual({
      enabled: true,
      schedule: DEFAULT_INDEX_SCHEDULE,
    });
  });

  it('reads env strings', () => {
    expect(
      readIndexingOptions(
        new ConfigReader({
          ragAi: { indexing: { enabled: 'false', schedule: ' 0 4 * * 0 ' } },
        }),
      ),
    ).toEqual({ enabled: false, schedule: '0 4 * * 0' });
  });
});

describe('readIndexFingerprint', () => {
  it('changes with the embeddings model', () => {
    const fingerprint = (modelName: string) =>
      readIndexFingerprint(
        new ConfigReader({ ai: { embeddings: { openai: { modelName } } } }),
      );
    expect(fingerprint('a')).not.toEqual(fingerprint('b'));
  });
});

const entity = (kind: string, name: string, etag = '1') => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind,
  metadata: { name, namespace: 'default', etag },
});

function memoryState(): IndexState & { hashes: Map<string, string> } {
  const hashes = new Map<string, string>();
  return {
    hashes,
    load: async () => new Map(hashes),
    save: async (key, hash) => {
      hashes.set(key, hash);
    },
    remove: async key => {
      hashes.delete(key);
    },
  };
}

function setup() {
  const createEmbeddings = jest.fn(
    async (_source: string, _filter: Record<string, any>) => 3,
  );
  const deleteDocuments = jest.fn(async () => {});
  const indexer = {
    createEmbeddings,
    deleteEmbeddings: jest.fn(),
    vectorStore: { deleteDocuments },
  } as unknown as AugmentationIndexer;

  let all = [
    entity('Component', 'flux'),
    entity('Component', 'broken'),
    entity('System', 'platform'),
  ];
  const getEntities = jest.fn(
    async (request?: { filter?: Record<string, unknown> }) => {
      const filter = request?.filter;
      if (filter && 'kind' in filter) {
        return { items: all.filter(e => e.kind === filter.kind) };
      }
      return {
        items: filter ? all.filter(e => e.kind === 'Component') : all,
      };
    },
  );
  const catalog = {
    getEntityFacets: jest.fn(async () => ({
      facets: { kind: [{ value: 'Component' }, { value: 'System' }] },
    })),
    getEntities,
  } as unknown as CatalogApi;

  // What Roadie stored: everything of the last run, plus one orphan.
  let indexed = [
    { source: 'tech-docs', entityRef: 'component:default/gone', kind: 'x' },
  ];
  createEmbeddings.mockImplementation(async (source, filter) => {
    const matched = all.filter(
      e =>
        e.kind === filter.kind &&
        (!filter['metadata.name'] ||
          e.metadata.name === filter['metadata.name']),
    );
    for (const e of matched) {
      indexed.push({
        source,
        entityRef: `${e.kind.toLowerCase()}:default/${e.metadata.name}`,
        kind: e.kind,
      });
    }
    return 3;
  });

  const docs = new Map([['flux', [{ location: 'index.html#a', text: 'A' }]]]);
  const state = memoryState();
  const deps: IndexingDeps = {
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    } as unknown as LoggerService,
    indexer,
    catalog,
    catalogToken: async () => 'token',
    buildTechDocs: async ({ name }) => docs.get(name) ?? [],
    listIndexed: async () => [...indexed],
    state,
    fingerprint: 'model-a',
  };
  return {
    deps,
    state,
    docs,
    createEmbeddings,
    deleteDocuments,
    setEntities: (entities: typeof all) => {
      all = entities;
    },
    clearEmbeddings: () => {
      indexed = [];
    },
  };
}

describe('runIndexing', () => {
  it('indexes the catalog per kind and TechDocs per entity', async () => {
    const { deps, createEmbeddings } = setup();
    const result = await runIndexing(deps);

    expect(createEmbeddings.mock.calls).toEqual([
      ['catalog', { kind: 'Component' }],
      ['catalog', { kind: 'System' }],
      [
        'tech-docs',
        {
          kind: 'Component',
          'metadata.namespace': 'default',
          'metadata.name': 'flux',
        },
      ],
    ]);
    expect(result).toMatchObject({ catalog: 6, techDocs: 3, unchanged: [] });
  });

  it('keeps the embeddings of entities whose docs do not build', async () => {
    const { deps } = setup();
    const result = await runIndexing(deps);
    expect(result.skipped).toEqual(['component:default/broken']);
  });

  it('skips unchanged slices on the next run', async () => {
    const { deps, createEmbeddings } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    const result = await runIndexing(deps);
    expect(createEmbeddings).not.toHaveBeenCalled();
    expect(result.unchanged).toEqual([
      'catalog:Component',
      'catalog:System',
      'tech-docs:component:default/flux',
    ]);
  });

  it('ignores a changed etag', async () => {
    const { deps, createEmbeddings, setEntities } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    setEntities([
      entity('Component', 'flux', '2'),
      entity('Component', 'broken', '2'),
      entity('System', 'platform', '2'),
    ]);
    await runIndexing(deps);
    expect(createEmbeddings).not.toHaveBeenCalled();
  });

  it('re-indexes only what changed', async () => {
    const { deps, createEmbeddings, docs, setEntities } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    docs.set('flux', [{ location: 'index.html#a', text: 'A, edited' }]);
    setEntities([
      entity('Component', 'flux'),
      entity('Component', 'broken'),
      entity('System', 'platform'),
      entity('System', 'new'),
    ]);
    await runIndexing(deps);
    expect(createEmbeddings.mock.calls.map(c => c[0])).toEqual([
      'catalog',
      'tech-docs',
    ]);
    expect(createEmbeddings.mock.calls[0][1]).toEqual({ kind: 'System' });
  });

  it('re-indexes everything after a model change', async () => {
    const { deps, createEmbeddings } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    await runIndexing({ ...deps, fingerprint: 'model-b' });
    expect(createEmbeddings).toHaveBeenCalledTimes(3);
  });

  it('re-indexes slices without embeddings despite a stored hash', async () => {
    const { deps, createEmbeddings, clearEmbeddings } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    clearEmbeddings(); // e.g. TRUNCATE embeddings
    await runIndexing(deps);
    expect(createEmbeddings).toHaveBeenCalledTimes(3);
  });

  it('carries on after a failed slice and retries it next time', async () => {
    const { deps, state, createEmbeddings } = setup();
    createEmbeddings.mockRejectedValueOnce(new Error('429 rate limit'));
    const result = await runIndexing(deps);

    expect(result.failed).toEqual(['catalog:Component']);
    expect(result).toMatchObject({ catalog: 3, techDocs: 3 });
    expect(state.hashes.has('catalog:Component')).toBe(false);
    expect(state.hashes.has('catalog:System')).toBe(true);
  });

  it('removes embeddings of entities gone from the catalog', async () => {
    const { deps, deleteDocuments } = setup();
    const result = await runIndexing(deps);

    expect(deleteDocuments).toHaveBeenCalledTimes(1);
    expect(deleteDocuments).toHaveBeenCalledWith({
      filter: { source: 'tech-docs', entityRef: 'component:default/gone' },
    });
    expect(result.removed).toEqual(['tech-docs:component:default/gone']);
  });

  it('removes nothing when the catalog comes back empty', async () => {
    const { deps, deleteDocuments } = setup();
    (deps.catalog.getEntities as jest.Mock).mockResolvedValue({ items: [] });
    const result = await runIndexing(deps);

    expect(deleteDocuments).not.toHaveBeenCalled();
    expect(result.removed).toEqual([]);
  });
});

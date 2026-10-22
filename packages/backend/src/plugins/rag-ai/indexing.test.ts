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
  catalogFilter,
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

type TestEntity = {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    etag: string;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  relations?: { type: string; targetRef: string }[];
};

const entity = (
  kind: string,
  name: string,
  { etag = '1', docs = false, spec = {} } = {},
): TestEntity => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind,
  metadata: {
    name,
    namespace: 'default',
    etag,
    ...(docs ? { annotations: { 'backstage.io/techdocs-ref': 'dir:.' } } : {}),
  },
  spec,
});

const refOf = (e: TestEntity) =>
  `${e.kind.toLowerCase()}:default/${e.metadata.name}`;

/** Does an entity match a Roadie entityFilter (one clause or a list)? */
const matches = (e: TestEntity, filter: any): boolean =>
  (Array.isArray(filter) ? filter : [filter]).some(
    (clause: Record<string, string | string[]>) =>
      e.kind === clause.kind &&
      (!clause['metadata.name'] ||
        [clause['metadata.name']].flat().includes(e.metadata.name)),
  );

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

const initialEntities = () => [
  entity('Component', 'flux', { docs: true }),
  entity('Component', 'broken', { docs: true }),
  entity('System', 'platform'),
  entity('System', 'core'),
];

function setup() {
  let all = initialEntities();
  // What Roadie stored: one orphan from an earlier run.
  let indexed = [
    { source: 'tech-docs', entityRef: 'component:default/gone', kind: 'x' },
  ];

  const createEmbeddings = jest.fn(async (source: string, filter: any) => {
    const matched = all.filter(e => matches(e, filter));
    for (const e of matched) {
      indexed.push({ source, entityRef: refOf(e), kind: e.kind });
    }
    return matched.length;
  });
  const deleteDocuments = jest.fn(async () => {});
  const indexer = {
    createEmbeddings,
    deleteEmbeddings: jest.fn(),
    vectorStore: { deleteDocuments },
  } as unknown as AugmentationIndexer;

  const catalog = {
    getEntities: jest.fn(async () => ({ items: all })),
  } as unknown as CatalogApi;

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
    setEntities: (entities: TestEntity[]) => {
      all = entities;
    },
    clearEmbeddings: () => {
      indexed = [];
    },
  };
}

const techDocsFilter = (name: string) => ({
  kind: 'Component',
  'metadata.namespace': 'default',
  'metadata.name': name,
});

describe('runIndexing', () => {
  it('indexes the whole catalog in one call, then TechDocs per entity', async () => {
    const { deps, createEmbeddings } = setup();
    const result = await runIndexing(deps);

    expect(createEmbeddings.mock.calls).toEqual([
      [
        'catalog',
        [
          { kind: 'Component', 'metadata.namespace': 'default' },
          { kind: 'System', 'metadata.namespace': 'default' },
        ],
      ],
      ['tech-docs', techDocsFilter('flux')],
    ]);
    expect(result).toMatchObject({ catalog: 4, techDocs: 1, unchanged: 0 });
  });

  it('keeps the embeddings of entities whose docs do not build', async () => {
    const { deps } = setup();
    const result = await runIndexing(deps);
    expect(result.skipped).toEqual(['component:default/broken']);
  });

  it('skips everything unchanged on the next run', async () => {
    const { deps, createEmbeddings } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    const result = await runIndexing(deps);
    expect(createEmbeddings).not.toHaveBeenCalled();
    // 4 catalog entities + TechDocs of flux
    expect(result.unchanged).toBe(5);
  });

  it('ignores a changed etag', async () => {
    const { deps, createEmbeddings, setEntities } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    setEntities(
      initialEntities().map(e => ({
        ...e,
        metadata: { ...e.metadata, etag: '2' },
      })),
    );
    await runIndexing(deps);
    expect(createEmbeddings).not.toHaveBeenCalled();
  });

  it('ignores changed relations', async () => {
    const { deps, createEmbeddings, setEntities } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    setEntities(
      initialEntities().map(e => ({
        ...e,
        relations: [{ type: 'hasPart', targetRef: 'resource:default/vm-2' }],
      })),
    );
    await runIndexing(deps);
    expect(createEmbeddings).not.toHaveBeenCalled();
  });

  it('re-indexes only the changed and new entities', async () => {
    const { deps, createEmbeddings, docs, setEntities } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    docs.set('flux', [{ location: 'index.html#a', text: 'A, edited' }]);
    setEntities([
      ...initialEntities().filter(e => e.metadata.name !== 'platform'),
      entity('System', 'platform', { spec: { status: 'running' } }),
      entity('Resource', 'vm-1'),
    ]);
    const result = await runIndexing(deps);

    expect(createEmbeddings.mock.calls).toEqual([
      [
        'catalog',
        [
          {
            kind: 'System',
            'metadata.namespace': 'default',
            'metadata.name': ['platform'],
          },
          // the only Resource: matched by kind alone
          { kind: 'Resource', 'metadata.namespace': 'default' },
        ],
      ],
      ['tech-docs', techDocsFilter('flux')],
    ]);
    expect(result).toMatchObject({ catalog: 2, techDocs: 1, unchanged: 3 });
  });

  it('re-indexes everything after a model change', async () => {
    const { deps, createEmbeddings } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    await runIndexing({ ...deps, fingerprint: 'model-b' });
    expect(createEmbeddings).toHaveBeenCalledTimes(2);
  });

  it('re-indexes entities without embeddings despite a stored hash', async () => {
    const { deps, createEmbeddings, clearEmbeddings } = setup();
    await runIndexing(deps);
    createEmbeddings.mockClear();

    clearEmbeddings(); // e.g. TRUNCATE embeddings
    const result = await runIndexing(deps);
    expect(result).toMatchObject({ catalog: 4, techDocs: 1, unchanged: 0 });
  });

  it('retries a failed catalog call on the next run', async () => {
    const { deps, state, createEmbeddings } = setup();
    createEmbeddings.mockRejectedValueOnce(new Error('429 rate limit'));
    const result = await runIndexing(deps);

    expect(result.failed).toEqual(['catalog']);
    expect(result.techDocs).toBe(1);
    expect([...state.hashes.keys()]).toEqual([
      'tech-docs:component:default/flux',
    ]);

    createEmbeddings.mockClear();
    expect((await runIndexing(deps)).catalog).toBe(4);
  });

  it('removes embeddings and hashes of entities gone from the catalog', async () => {
    const { deps, state, deleteDocuments, setEntities } = setup();
    await runIndexing(deps);
    expect(state.hashes.has('catalog:system:default/core')).toBe(true);

    state.hashes.set('catalog:Component', 'old per-kind key');
    setEntities(initialEntities().filter(e => e.metadata.name !== 'core'));
    const result = await runIndexing(deps);

    expect(deleteDocuments).toHaveBeenCalledWith({
      filter: { source: 'tech-docs', entityRef: 'component:default/gone' },
    });
    expect(deleteDocuments).toHaveBeenCalledWith({
      filter: { source: 'catalog', entityRef: 'system:default/core' },
    });
    expect(result.removed).toEqual([
      'tech-docs:component:default/gone',
      'catalog:system:default/core',
    ]);
    expect(state.hashes.has('catalog:system:default/core')).toBe(false);
    expect(state.hashes.has('catalog:Component')).toBe(false);
  });

  it('removes nothing when the catalog comes back empty', async () => {
    const { deps, deleteDocuments, setEntities } = setup();
    setEntities([]);
    const result = await runIndexing(deps);

    expect(deleteDocuments).not.toHaveBeenCalled();
    expect(result.removed).toEqual([]);
  });
});

describe('catalogFilter', () => {
  it('lists names only for partly changed groups', () => {
    const all = [
      entity('Component', 'a'),
      entity('Component', 'b'),
      entity('API', 'x'),
    ];
    expect(catalogFilter([all[1], all[2]] as any, all as any)).toEqual([
      {
        kind: 'Component',
        'metadata.namespace': 'default',
        'metadata.name': ['b'],
      },
      { kind: 'API', 'metadata.namespace': 'default' },
    ]);
  });
});

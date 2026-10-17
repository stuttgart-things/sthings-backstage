import { LoggerService } from '@backstage/backend-plugin-api';
import { CatalogApi } from '@backstage/catalog-client';
import { ConfigReader } from '@backstage/config';
import { AugmentationIndexer } from '@roadiehq/rag-ai-node';
import {
  DEFAULT_INDEX_SCHEDULE,
  IndexingDeps,
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

const entity = (kind: string, name: string) => ({
  apiVersion: 'backstage.io/v1alpha1',
  kind,
  metadata: { name, namespace: 'default' },
});

function setup(overrides: Partial<IndexingDeps> = {}) {
  const createEmbeddings = jest.fn(async () => 3);
  const deleteDocuments = jest.fn(async () => {});
  const indexer = {
    createEmbeddings,
    deleteEmbeddings: jest.fn(),
    vectorStore: { deleteDocuments },
  } as unknown as AugmentationIndexer;

  const all = [
    entity('Component', 'flux'),
    entity('Component', 'broken'),
    entity('System', 'platform'),
  ];
  const getEntities = jest.fn(async (request?: { filter?: unknown }) => ({
    items: request?.filter ? all.filter(e => e.kind === 'Component') : all,
  }));
  const catalog = {
    getEntityFacets: jest.fn(async () => ({
      facets: { kind: [{ value: 'Component' }, { value: 'System' }] },
    })),
    getEntities,
  } as unknown as CatalogApi;

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
    buildTechDocs: async ({ name }) => (name === 'broken' ? 0 : 5),
    listIndexed: async () => [
      { source: 'catalog', entityRef: 'component:default/flux' },
      { source: 'tech-docs', entityRef: 'component:default/gone' },
    ],
    ...overrides,
  };
  return { deps, createEmbeddings, deleteDocuments };
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
    expect(result).toMatchObject({ catalog: 6, techDocs: 3 });
  });

  it('keeps the embeddings of entities whose docs do not build', async () => {
    const { deps } = setup();
    const result = await runIndexing(deps);
    expect(result.skipped).toEqual(['component:default/broken']);
  });

  it('carries on after a failed slice', async () => {
    const { deps, createEmbeddings } = setup();
    createEmbeddings.mockRejectedValueOnce(new Error('429 rate limit'));
    const result = await runIndexing(deps);

    expect(result.failed).toEqual(['catalog:Component']);
    expect(result).toMatchObject({ catalog: 3, techDocs: 3 });
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

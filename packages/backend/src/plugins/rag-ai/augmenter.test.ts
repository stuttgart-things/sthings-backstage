import { LoggerService } from '@backstage/backend-plugin-api';
import { Entity } from '@backstage/catalog-model';
import { ConfigReader } from '@backstage/config';
import { EmbeddingDoc, RoadieVectorStore } from '@roadiehq/rag-ai-node';
import { embeddingEntity, SthingsAugmentationIndexer } from './augmenter';

const vm: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name: 'sbx-labul-proxmox-vm',
    uid: 'u-1',
    etag: 'e-1',
    annotations: {
      'vm.stuttgart-things.com/status': 'running',
      'proxmox.stuttgart-things.com/ipv4': '10.0.0.1',
    },
  },
  spec: { type: 'vm', system: 'labda', owner: 'team-infrastructure' },
  relations: [{ type: 'partOf', targetRef: 'system:default/labda' }],
};

const template: Entity = {
  apiVersion: 'scaffolder.backstage.io/v1beta3',
  kind: 'Template',
  metadata: { name: 'request-vm', description: 'Requests a VM' },
  spec: {
    type: 'vm',
    parameters: [{ title: 'VM', properties: { name: { type: 'string' } } }],
    steps: [{ id: 'pr', action: 'publish:github:pull-request' }],
  },
};

describe('embeddingEntity', () => {
  it('drops ids, computed fields and the VM status', () => {
    expect(embeddingEntity({ ...vm, status: { items: [] } } as Entity)).toEqual(
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: {
          name: 'sbx-labul-proxmox-vm',
          annotations: { 'proxmox.stuttgart-things.com/ipv4': '10.0.0.1' },
        },
        spec: { type: 'vm', system: 'labda', owner: 'team-infrastructure' },
      },
    );
  });

  it('drops the steps of templates, keeps their parameters', () => {
    expect(embeddingEntity(template).spec).toEqual({
      type: 'vm',
      parameters: template.spec!.parameters,
    });
  });

  it('keeps spec.steps of other kinds', () => {
    const component = { ...template, kind: 'Component' };
    expect(embeddingEntity(component).spec).toEqual(template.spec);
  });

  it('does not change the entity', () => {
    const copy = JSON.parse(JSON.stringify(vm));
    embeddingEntity(vm);
    expect(vm).toEqual(copy);
  });
});

describe('SthingsAugmentationIndexer', () => {
  it('embeds the reduced entity in chunks of the configured size', async () => {
    const indexer = new SthingsAugmentationIndexer({
      vectorStore: {
        connectEmbeddings: jest.fn(),
      } as unknown as RoadieVectorStore,
      catalogApi: {} as any,
      logger: { child: () => ({}) } as unknown as LoggerService,
      auth: {} as any,
      discovery: {} as any,
      config: new ConfigReader({
        ai: {
          embeddings: {
            chunkSize: 1000,
            chunkOverlap: 0,
            openai: { openAiApiKey: 'k', modelName: 'm', batchSize: 128 },
          },
        },
      }),
    });

    const docs: EmbeddingDoc[] = await (
      indexer as any
    ).constructCatalogEmbeddingDocuments([vm, template], 'catalog');

    expect(docs.map(d => d.metadata)).toEqual([
      {
        splitId: '0',
        source: 'catalog',
        entityRef: 'resource:default/sbx-labul-proxmox-vm',
        kind: 'Resource',
      },
      {
        splitId: '0',
        source: 'catalog',
        entityRef: 'template:default/request-vm',
        kind: 'Template',
      },
    ]);
    expect(docs[0].content).toBe(JSON.stringify(embeddingEntity(vm)));
    expect(docs[1].content).not.toContain('publish:github:pull-request');
  });
});

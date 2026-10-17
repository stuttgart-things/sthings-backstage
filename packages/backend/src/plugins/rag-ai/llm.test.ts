import { ConfigReader } from '@backstage/config';
import {
  createChatModel,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_TOKENS,
  parseModels,
  readLlmOptions,
} from './llm';

describe('parseModels', () => {
  it('splits, trims and dedupes a comma-separated list', () => {
    expect(parseModels(' a:free, b ,,a:free,c ')).toEqual(['a:free', 'b', 'c']);
  });

  it('returns an empty list for undefined', () => {
    expect(parseModels(undefined)).toEqual([]);
  });
});

describe('readLlmOptions', () => {
  it('applies defaults', () => {
    const options = readLlmOptions(
      new ConfigReader({ ragAi: { llm: { apiKey: 'k', models: 'm1,m2' } } }),
    );
    expect(options).toEqual({
      baseUrl: DEFAULT_BASE_URL,
      apiKey: 'k',
      models: ['m1', 'm2'],
      maxTokens: DEFAULT_MAX_TOKENS,
      temperature: undefined,
    });
  });

  it('fails without an API key', () => {
    expect(() =>
      readLlmOptions(new ConfigReader({ ragAi: { llm: { models: 'm' } } })),
    ).toThrow(/OPENROUTER_API_KEY/);
  });

  it('fails without models', () => {
    expect(() =>
      readLlmOptions(
        new ConfigReader({ ragAi: { llm: { apiKey: 'k', models: ' , ' } } }),
      ),
    ).toThrow(/OPENROUTER_MODEL/);
  });
});

describe('createChatModel', () => {
  const base = { apiKey: 'k', maxTokens: 100 };

  it('sends at most 3 fallback models to OpenRouter', () => {
    const model = createChatModel({
      ...base,
      baseUrl: DEFAULT_BASE_URL,
      models: ['a', 'b', 'c', 'd', 'e'],
    });
    expect(model.model).toBe('a');
    expect(model.modelKwargs).toEqual({ models: ['a', 'b', 'c', 'd'] });
  });

  it('sends no fallback list to other endpoints', () => {
    const model = createChatModel({
      ...base,
      baseUrl: 'http://localhost:11434/v1',
      models: ['a', 'b'],
    });
    expect(model.model).toBe('a');
    expect(model.modelKwargs).toEqual({});
  });
});

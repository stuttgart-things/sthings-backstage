import { Config } from '@backstage/config';
import { ChatOpenAI } from '@langchain/openai';

export const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_MAX_TOKENS = 4000;

// OpenRouter's `models` fallback takes the primary model plus at most 3 more
// (same limit homerun2-ai-pitcher works around).
const MAX_FALLBACK_MODELS = 3;

export type RagAiLlmOptions = {
  baseUrl: string;
  apiKey: string;
  models: string[];
  maxTokens: number;
  temperature?: number;
};

/** Splits a comma-separated model list, dropping blanks and duplicates. */
export function parseModels(value: string | undefined): string[] {
  const models = (value ?? '')
    .split(',')
    .map(m => m.trim())
    .filter(Boolean);
  return [...new Set(models)];
}

export function readLlmOptions(config: Config): RagAiLlmOptions {
  const llm = config.getOptionalConfig('ragAi.llm');
  const apiKey = llm?.getOptionalString('apiKey');
  if (!apiKey) {
    throw new Error(
      'ragAi.llm.apiKey is not set (OPENROUTER_API_KEY); RAG-AI stays off',
    );
  }
  const models = parseModels(llm?.getOptionalString('models'));
  if (models.length === 0) {
    throw new Error(
      'ragAi.llm.models is empty (OPENROUTER_MODEL); RAG-AI stays off',
    );
  }
  return {
    baseUrl: llm?.getOptionalString('baseUrl') || DEFAULT_BASE_URL,
    apiKey,
    models,
    maxTokens: llm?.getOptionalNumber('maxTokens') ?? DEFAULT_MAX_TOKENS,
    temperature: llm?.getOptionalNumber('temperature'),
  };
}

/**
 * Chat model for an OpenAI-compatible endpoint (OpenRouter by default). The
 * first model is the primary one; the next ones go to OpenRouter's `models`
 * fallback. Other OpenAI-compatible endpoints get the primary model only.
 */
export function createChatModel(options: RagAiLlmOptions): ChatOpenAI {
  const [model, ...rest] = options.models;
  const fallbacks = rest.slice(0, MAX_FALLBACK_MODELS);
  const isOpenRouter = options.baseUrl.includes('openrouter.ai');

  return new ChatOpenAI({
    model,
    apiKey: options.apiKey,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    streaming: true,
    configuration: {
      baseURL: options.baseUrl,
      defaultHeaders: isOpenRouter ? { 'X-Title': 'sthings-backstage' } : {},
    },
    modelKwargs:
      isOpenRouter && fallbacks.length > 0
        ? { models: [model, ...fallbacks] }
        : {},
  });
}

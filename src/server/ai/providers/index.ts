import { ai as geminiClient, GEMINI_FALLBACK_MODEL, GEMINI_MODEL } from '../../config';
import { GenerateJsonOptions, GenerateResult, ModelProvider } from '../provider';
import { GeminiProvider } from './gemini';
import { OpenAICompatibleProvider } from './openaiCompatible';

// -------------------------------------------------------------
// Provider registry
//
// Different jobs need different models, so the backend keeps a
// provider chain per role rather than one global model.
//
//   app     - report analysis, chat, briefing narrative.
//             Gemini first: its responseSchema guarantees the JSON
//             shape, which matters when the output is a lab report
//             or a medication list. ASI:One is the fallback so the
//             app still works if one provider is down.
//   vision  - prescription and document reading. Gemini first for
//             the same schema reason, and because reading a
//             handwritten prescription is a vision task.
//   agent   - the reasoning inside the uAgent itself. ASI:One first,
//             because a Fetch.ai agent powered by ASI:One is what
//             makes the Agentverse story coherent, and ASI:One can
//             delegate to other agents on the network.
//
// A provider that is not configured is skipped, so the app runs on
// whichever key you actually supplied.
// -------------------------------------------------------------

export type ProviderId = 'gemini' | 'openai-compatible' | 'asi-one';
export type ProviderRole = 'app' | 'vision' | 'agent';

const ASI_ONE_BASE_URL = 'https://api.asi1.ai/v1';

function readProviderId(): ProviderId {
  const raw = (process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (raw === 'openai-compatible' || raw === 'openai' || raw === 'openai_compatible') {
    return 'openai-compatible';
  }
  if (raw === 'asi-one' || raw === 'asi1' || raw === 'asi') return 'asi-one';
  if (raw === 'gemini' || raw === 'google') return 'gemini';
  if (
    (process.env.ASI1_API_KEY || process.env.ASI_ONE_API_KEY) &&
    !process.env.GEMINI_API_KEY
  ) {
    return 'asi-one';
  }
  return 'gemini';
}

function asiOneKey(): string {
  return process.env.ASI1_API_KEY || process.env.ASI_ONE_API_KEY || process.env.AI_API_KEY || '';
}

function buildProvider(id: ProviderId): ModelProvider {
  if (id === 'gemini') {
    return new GeminiProvider(geminiClient);
  }

  if (id === 'asi-one') {
    return new OpenAICompatibleProvider(
      {
        baseUrl: process.env.AI_BASE_URL || ASI_ONE_BASE_URL,
        apiKey: asiOneKey(),
        model: process.env.AI_MODEL || process.env.ASI1_MODEL || 'asi1',
        fallbackModels: (process.env.AI_FALLBACK_MODELS || '')
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean),
        jsonMode: (process.env.AI_JSON_MODE as 'json_schema' | 'json_object') || 'json_schema',
        timeoutMs: Number(process.env.AI_TIMEOUT_MS || 120000),
      },
      'asi-one',
      'ASI:One (Fetch.ai)'
    );
  }

  return new OpenAICompatibleProvider(
    {
      baseUrl: process.env.AI_BASE_URL || 'http://localhost:11434/v1',
      apiKey: process.env.AI_API_KEY || '',
      model: process.env.AI_MODEL || 'llama3.1',
      fallbackModels: (process.env.AI_FALLBACK_MODELS || '')
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
      jsonMode: (process.env.AI_JSON_MODE as 'json_schema' | 'json_object') || 'json_schema',
      timeoutMs: Number(process.env.AI_TIMEOUT_MS || 120000),
    },
    'openai-compatible',
    process.env.AI_LABEL || 'OpenAI-compatible endpoint'
  );
}

/**
 * The chain of providers to try for a role, most preferred first.
 * `AI_PROVIDER` pins the first choice when it is set.
 */
export function providerChain(role: ProviderRole): ProviderId[] {
  const preferred = readProviderId();
  const base: Record<ProviderRole, ProviderId[]> = {
    app: ['gemini', 'asi-one', 'openai-compatible'],
    vision: ['gemini', 'asi-one'],
    agent: ['asi-one', 'gemini'],
  };
  const chain = base[role].filter((id) => id !== preferred);
  return [preferred, ...chain];
}

const providerCache = new Map<string, ModelProvider>();

function providerFor(id: ProviderId): ModelProvider {
  const key = `${id}:${process.env.AI_BASE_URL || ''}:${process.env.AI_MODEL || ''}`;
  let provider = providerCache.get(key);
  if (!provider) {
    provider = buildProvider(id);
    providerCache.set(key, provider);
  }
  return provider;
}

/** The first configured provider for a role. */
export function getProvider(role: ProviderRole = 'app'): ModelProvider {
  const chain = providerChain(role);
  for (const id of chain) {
    const provider = providerFor(id);
    if (provider.isConfigured()) return provider;
  }
  return providerFor(chain[0]);
}

/** Every provider in a role's chain, in order, whether or not it is configured. */
export function getProviderChain(role: ProviderRole = 'app'): ModelProvider[] {
  return providerChain(role).map(providerFor);
}

export function providerStatus() {
  const app = getProvider('app');
  const agent = getProvider('agent');
  return {
    id: app.id,
    label: app.label,
    configured: app.isConfigured(),
    geminiConfigured: Boolean(geminiClient),
    asiOneConfigured: Boolean(asiOneKey()),
    model:
      app.id === 'gemini'
        ? GEMINI_MODEL
        : process.env.AI_MODEL || process.env.ASI1_MODEL || (app.id === 'asi-one' ? 'asi1' : 'llama3.1'),
    fallbackModel:
      app.id === 'gemini' ? GEMINI_FALLBACK_MODEL : process.env.AI_FALLBACK_MODELS || '',
    roles: {
      app: { id: app.id, label: app.label, configured: app.isConfigured() },
      vision: describe(getProvider('vision')),
      agent: { id: agent.id, label: agent.label, configured: agent.isConfigured() },
    },
    chain: providerChain('app').map((id) => describe(providerFor(id))),
  };
}

function describe(provider: ModelProvider) {
  return { id: provider.id, label: provider.label, configured: provider.isConfigured() };
}

export function isAiConfigured(): boolean {
  return getProvider('app').isConfigured();
}

/**
 * Run a JSON generation against a role's provider chain, moving to the
 * next provider when one is unavailable or fails.
 */
export async function generateJson<T>(
  options: GenerateJsonOptions,
  role: ProviderRole = 'app'
): Promise<GenerateResult<T>> {
  const chain = getProviderChain(role);
  let lastError: any = null;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    if (!provider.isConfigured()) continue;
    try {
      const result = await provider.generateJson<T>(options);
      return { ...result, usedFallback: result.usedFallback || i > 0 };
    } catch (error: any) {
      lastError = error;
      console.error(
        `Provider ${provider.id} failed for role ${role}:`,
        error?.message || error
      );
    }
  }

  throw (
    lastError ||
    new Error(
      `No provider is configured for the "${role}" role. Add GEMINI_API_KEY or ASI1_API_KEY to .env.`
    )
  );
}

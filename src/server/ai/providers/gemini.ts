import { GoogleGenAI } from '@google/genai';
import { GEMINI_MODELS } from '../../config';
import {
  GenerateJsonOptions,
  GenerateResult,
  ModelProvider,
  ProviderConversation,
  ProviderTool,
  ToolCall,
} from '../provider';

// -------------------------------------------------------------
// Google Gemini provider
// -------------------------------------------------------------

export class GeminiProvider implements ModelProvider {
  readonly id = 'gemini';
  readonly label = 'Google Gemini';

  constructor(private client: GoogleGenAI | null) {}

  isConfigured(): boolean {
    return Boolean(this.client);
  }

  private assertConfigured(): GoogleGenAI {
    if (!this.client) {
      throw new Error(
        'Gemini is not configured. Add GEMINI_API_KEY to .env, or switch AI_PROVIDER to an OpenAI-compatible endpoint such as ASI:One.'
      );
    }
    return this.client;
  }

  async generateJson<T>(options: GenerateJsonOptions): Promise<GenerateResult<T>> {
    const client = this.assertConfigured();
    // The model list is the fallback chain: each entry is a separate
    // free-tier daily allowance, so an exhausted one is skipped.
    const modelsToTry = options.model
      ? [options.model, ...GEMINI_MODELS]
      : [...GEMINI_MODELS];
    let response: any = null;
    let lastError: any = null;
    let usedFallback = false;
    let usedModel = modelsToTry[0];

    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      if (i > 0) usedFallback = true;
      usedModel = model;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const contents: any =
            options.inlineParts && options.inlineParts.length > 0
              ? {
                  parts: [
                    ...options.inlineParts.map((p) => ({
                      inlineData: { mimeType: p.mimeType, data: p.data },
                    })),
                    { text: options.prompt },
                  ],
                }
              : options.prompt;

          response = await client.models.generateContent({
            model,
            contents,
            config: {
              ...(options.systemInstruction
                ? { systemInstruction: options.systemInstruction }
                : {}),
              ...(options.schema
                ? { responseMimeType: 'application/json', responseSchema: options.schema }
                : {}),
            },
          });
          break;
        } catch (error: any) {
          lastError = error;
          const status = Number(error?.status ?? error?.code ?? 0);
          const retryable =
            status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
          if (!retryable || attempt === 1) break;
          await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
        }
      }
      if (response) break;
    }

    if (!response) {
      console.error('Gemini request failed after retries:', lastError);
      throw new Error('The AI service is temporarily busy. Please try again in a moment.');
    }

    return {
      data: parseJson<T>(response.text || '{}'),
      model: usedModel,
      usedFallback,
    };
  }

  createConversation(input: {
    systemInstruction: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    message: string;
    tools: ProviderTool[];
  }): ProviderConversation {
    const contents: any[] = [];
    for (const item of input.history) {
      contents.push({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.content }],
      });
    }
    contents.push({ role: 'user', parts: [{ text: input.message }] });
    return { state: { contents }, tools: input.tools };
  }

  async nextTurn(
    conversation: ProviderConversation,
    options?: { inlineParts?: Array<{ mimeType: string; data: string }> }
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    const client = this.assertConfigured();
    const contents: any = conversation.state.contents;

    if (options?.inlineParts?.length) {
      contents.push({
        role: 'user',
        parts: [
          ...options.inlineParts.map((p) => ({
            inlineData: { mimeType: p.mimeType, data: p.data },
          })),
        ],
      });
    }

    // Try each model in turn: the free tier allowance is per model, so
    // an exhausted one is skipped rather than failing the turn.
    let response: any = null;
    let lastError: any = null;
    for (const model of GEMINI_MODELS) {
      try {
        response = await client.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction: conversation.state.systemInstruction,
            tools: [
              {
                functionDeclarations: conversation.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            ],
          },
        });
        break;
      } catch (error: any) {
        lastError = error;
      }
    }

    if (!response) {
      console.error('Every Gemini model failed for this turn:', lastError);
      throw lastError;
    }

    const modelParts = response.candidates?.[0]?.content?.parts;
    if (modelParts) contents.push({ role: 'model', parts: modelParts });

    const toolCalls: ToolCall[] = (response.functionCalls || []).map((call: any, index: number) => ({
      id: call.id || `call-${index}`,
      name: call.name,
      args: (call.args || {}) as Record<string, unknown>,
    }));

    return { text: response.text || '', toolCalls };
  }

  submitToolResults(
    conversation: ProviderConversation,
    results: Array<{ id: string; name: string; result: unknown }>
  ): void {
    // Gemini's `functionResponse.response` has to be a JSON object. A tool
    // that returns a list or a bare value would be rejected by the API
    // otherwise, so the result is always carried under the documented
    // `output` key.
    const parts = results.map((r) => ({
      functionResponse: {
        name: r.name,
        response: { output: r.result ?? null },
      },
    }));
    conversation.state.contents.push({ role: 'user', parts });
  }
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('The AI service returned a response that could not be parsed.');
  }
}

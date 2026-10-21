import {
  GenerateJsonOptions,
  GenerateResult,
  ModelProvider,
  ProviderConversation,
  ProviderTool,
  ToolCall,
  schemaToInstruction,
  toJsonSchema,
} from '../provider';

// -------------------------------------------------------------
// OpenAI-compatible provider
//
// Used for ASI:One (Fetch.ai) and anything else that speaks the
// OpenAI chat-completions protocol: OpenRouter, Groq, Together,
// Mistral, Ollama, LM Studio, vLLM, Cloudflare Workers AI, and
// Gemini's own OpenAI-compatible endpoint.
//
// ASI:One in particular is the model Fetch.ai ships for agent
// orchestration, and it can discover and call other agents on
// Agentverse on its own.
// -------------------------------------------------------------

export interface OpenAICompatibleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Optional comma separated fallbacks tried in order. */
  fallbackModels: string[];
  /** 'json_schema' for strict structured output, 'json_object' for loose. */
  jsonMode: 'json_schema' | 'json_object';
  timeoutMs: number;
}

export class OpenAICompatibleProvider implements ModelProvider {
  readonly id: string;
  readonly label: string;

  constructor(private config: OpenAICompatibleConfig, id = 'openai-compatible', label = 'OpenAI-compatible endpoint') {
    this.id = id;
    this.label = label;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  private get modelsToTry(): string[] {
    const models = [this.config.model, ...this.config.fallbackModels].filter(Boolean);
    return models.length ? models : ['asi1'];
  }

  private async request(body: Record<string, unknown>): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        const error: any = new Error(
          `The AI endpoint returned ${response.status}: ${text.slice(0, 300)}`
        );
        error.status = response.status;
        error.body = text;
        throw error;
      }

      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async generateJson<T>(options: GenerateJsonOptions): Promise<GenerateResult<T>> {
    if (!this.isConfigured()) {
      throw new Error(
        `${this.label} is not configured. Add the API key to .env before using AI features.`
      );
    }

    const models = options.model ? [options.model] : this.modelsToTry;
    let lastError: any = null;
    let usedFallback = false;

    for (let m = 0; m < models.length; m++) {
      const model = models[m];
      if (m > 0) usedFallback = true;

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const payload = this.buildJsonRequest(options, model);
          const data = await this.request(payload);
          const text = data?.choices?.[0]?.message?.content ?? '{}';
          return { data: parseJson<T>(text), model, usedFallback };
        } catch (error: any) {
          lastError = error;

          // A strict JSON-schema response format may not be supported by
          // this endpoint. Fall back to loose JSON mode once.
          if (error?.status === 400 && this.config.jsonMode === 'json_schema') {
            this.config.jsonMode = 'json_object';
            continue;
          }

          const status = Number(error?.status ?? 0);
          const retryable = status === 429 || status >= 500;
          if (!retryable || attempt === 1) break;
          await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
        }
      }
    }

    console.error('OpenAI-compatible request failed after retries:', lastError);
    throw new Error(
      lastError?.message || 'The AI service is temporarily busy. Please try again in a moment.'
    );
  }

  private buildJsonRequest(options: GenerateJsonOptions, model: string) {
    const messages: any[] = [];

    if (options.systemInstruction) {
      messages.push({ role: 'system', content: options.systemInstruction });
    }

    const userContent: any[] = [];
    if (options.inlineParts?.length) {
      for (const part of options.inlineParts) {
        userContent.push({
          type: 'image_url',
          image_url: { url: `data:${part.mimeType};base64,${part.data}` },
        });
      }
    }

    let prompt = options.prompt;
    if (options.schema) {
      const jsonSchema = toJsonSchema(options.schema);
      if (this.config.jsonMode === 'json_schema') {
        prompt = `${prompt}\n\nRespond with a single JSON object matching this schema:\n${JSON.stringify(
          jsonSchema
        )}`;
      } else {
        prompt = `${prompt}\n\nRespond with a single JSON object and no other text. Its shape must be:\n${schemaToInstruction(
          options.schema
        )}`;
      }
    }

    userContent.push({ type: 'text', text: prompt });
    messages.push({ role: 'user', content: userContent });

    const payload: Record<string, unknown> = { model, messages };
    if (options.schema && this.config.jsonMode === 'json_schema') {
      payload.response_format = {
        type: 'json_schema',
        json_schema: { name: 'response', schema: toJsonSchema(options.schema) },
      };
    } else if (options.schema) {
      payload.response_format = { type: 'json_object' };
    }
    return payload;
  }

  createConversation(input: {
    systemInstruction: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    message: string;
    tools: ProviderTool[];
  }): ProviderConversation {
    const messages: any[] = [];
    if (input.systemInstruction) {
      messages.push({ role: 'system', content: input.systemInstruction });
    }
    for (const item of input.history) {
      messages.push({ role: item.role, content: item.content });
    }
    messages.push({ role: 'user', content: input.message });

    return {
      state: { messages },
      tools: input.tools,
    };
  }

  async nextTurn(
    conversation: ProviderConversation,
    options?: { inlineParts?: Array<{ mimeType: string; data: string }> }
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    if (!this.isConfigured()) {
      throw new Error(
        `${this.label} is not configured. Add the API key to .env before using AI features.`
      );
    }

    const messages: any[] = conversation.state.messages;

    if (options?.inlineParts?.length) {
      const last = messages[messages.length - 1];
      if (last && last.role === 'user' && typeof last.content === 'string') {
        const content: any[] = [
          { type: 'text', text: last.content },
          ...options.inlineParts.map((p) => ({
            type: 'image_url',
            image_url: { url: `data:${p.mimeType};base64,${p.data}` },
          })),
        ];
        last.content = content;
      }
    }

    const payload: Record<string, unknown> = {
      model: this.config.model,
      messages,
    };

    if (conversation.tools.length > 0) {
      payload.tools = conversation.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: toJsonSchema(t.parameters),
        },
      }));
      payload.tool_choice = 'auto';
    }

    const data = await this.request(payload);
    const message = data?.choices?.[0]?.message;

    const toolCalls: ToolCall[] = (message?.tool_calls || []).map((call: any, index: number) => {
      let args: Record<string, unknown> = {};
      try {
        args = typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function?.arguments || {};
      } catch {
        args = {};
      }
      return { id: call.id || `call-${index}`, name: call.function?.name, args };
    });

    // Keep the assistant turn in the transcript so the next request has
    // the tool-call context.
    messages.push({
      role: 'assistant',
      content: message?.content ?? '',
      ...(toolCalls.length ? { tool_calls: message.tool_calls } : {}),
    });

    return { text: message?.content || '', toolCalls };
  }

  submitToolResults(
    conversation: ProviderConversation,
    results: Array<{ id: string; name: string; result: unknown }>
  ): void {
    const messages: any[] = conversation.state.messages;
    for (const r of results) {
      messages.push({
        role: 'tool',
        tool_call_id: r.id,
        content: JSON.stringify(r.result ?? {}),
      });
    }
  }
}

function parseJson<T>(text: string): T {
  const trimmed = (text || '').trim();
  const candidate = trimmed.startsWith('```')
    ? trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim()
    : trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    throw new Error('The AI service returned a response that could not be parsed.');
  }
}

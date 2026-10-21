// -------------------------------------------------------------
// Model provider abstraction
//
// The app talks to a model through this interface, so the backend
// can run on Gemini, on ASI:One (Fetch.ai) or on any other
// OpenAI-compatible endpoint without touching feature code.
// -------------------------------------------------------------

export interface GenerateJsonOptions {
  prompt: string;
  /** A schema in the Gemini Schema shape. Converted per provider. */
  schema?: Record<string, unknown>;
  systemInstruction?: string;
  /** Inline binary parts (images, PDFs) sent alongside the prompt. */
  inlineParts?: Array<{ mimeType: string; data: string }>;
  model?: string;
}

export interface GenerateResult<T> {
  data: T;
  model: string;
  /** True when the primary model failed and a fallback was used. */
  usedFallback: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ProviderTool {
  name: string;
  description: string;
  /** Gemini Schema shape; converted per provider. */
  parameters: Record<string, unknown>;
}

export interface ProviderConversation {
  /** Opaque to the orchestrator; each provider keeps its own shape. */
  state: any;
  tools: ProviderTool[];
}

export interface ModelProvider {
  id: string;
  label: string;
  /** True when the provider has the credentials it needs. */
  isConfigured(): boolean;
  generateJson<T>(options: GenerateJsonOptions): Promise<GenerateResult<T>>;
  createConversation(input: {
    systemInstruction: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    message: string;
    tools: ProviderTool[];
    inlineParts?: Array<{ mimeType: string; data: string }>;
  }): ProviderConversation;
  /** Run one model turn: returns the text and any tool calls. */
  nextTurn(
    conversation: ProviderConversation,
    options?: { inlineParts?: Array<{ mimeType: string; data: string }> }
  ): Promise<{ text: string; toolCalls: ToolCall[] }>;
  /** Feed tool results back so the next turn can continue the thread. */
  submitToolResults(
    conversation: ProviderConversation,
    results: Array<{ id: string; name: string; result: unknown }>
  ): void;
}

// -------------------------------------------------------------
// Schema conversion
//
// Feature code writes schemas once, in the Gemini Schema shape that
// the existing report and prescription prompts already use. The
// Gemini provider uses them as-is; OpenAI-compatible providers need
// JSON Schema, which is what this produces.
// -------------------------------------------------------------

const GEMINI_TYPE_TO_JSON: Record<string, string> = {
  TYPE_UNSPECIFIED: 'string',
  STRING: 'string',
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
  OBJECT: 'object',
};

export function toJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;

  const out: any = {};
  if (schema.type) {
    out.type = GEMINI_TYPE_TO_JSON[schema.type] || String(schema.type).toLowerCase();
  }
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.format) out.format = schema.format;
  if (schema.nullable === true && out.type) out.type = [out.type, 'null'];
  if (schema.items) out.items = toJsonSchema(schema.items);
  if (schema.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = toJsonSchema(value);
    }
  }
  if (schema.required) out.required = schema.required;
  if (schema.propertyOrdering) out.propertyOrdering = schema.propertyOrdering;

  return out;
}

/**
 * Renders a schema as a readable instruction, for providers that only
 * support loose JSON mode rather than a strict JSON-schema response
 * format.
 */
export function schemaToInstruction(schema: any, depth = 0): string {
  if (!schema || typeof schema !== 'object') return '';
  const indent = '  '.repeat(depth);
  const lines: string[] = [];

  if (schema.type === 'OBJECT' || schema.type === 'object') {
    const properties = schema.properties || {};
    const required: string[] = schema.required || [];
    for (const [key, value] of Object.entries(properties)) {
      const child = value as any;
      const type = String(child.type || 'string')
        .toLowerCase()
        .replace('type_unspecified', 'string');
      const optional = required.includes(key) ? '' : ' (optional)';
      lines.push(`${indent}- "${key}"${optional}: ${type}`);
      if (child.enum) lines.push(`${indent}  allowed values: ${child.enum.join(' | ')}`);
      if (child.description) lines.push(`${indent}  ${child.description}`);
      if (child.type === 'ARRAY' || child.type === 'array') {
        const item = toJsonSchema(child.items);
        if (item && item.properties) {
          lines.push(`${indent}  each item is an object with:`);
          lines.push(schemaToInstruction(child.items, depth + 2));
        } else if (item && item.type) {
          lines.push(`${indent}  each item is a ${item.type}`);
        }
      }
    }
  }

  return lines.join('\n');
}

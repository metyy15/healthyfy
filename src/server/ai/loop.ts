import crypto from 'crypto';
import { getProviderChain } from './providers';
import { findTool, HEALTH_TOOLS, ToolContext, ToolDefinition } from './tools';
import { ProviderTool, ToolCall } from './provider';

// -------------------------------------------------------------
// Agent loop
//
// The model may call tools to read the health record and to raise
// alerts or reminders. Mutating tools are never executed straight
// away: they are queued as pending actions and the user has to
// approve them from the interface. The model is told explicitly
// that a pending action has not run, so it cannot claim that a
// booking or an alert already exists.
//
// The loop is provider agnostic: Gemini, ASI:One or any
// OpenAI-compatible endpoint can drive it.
// -------------------------------------------------------------

export interface ToolTraceEntry {
  step: number;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  ok: boolean;
  error?: string;
  durationMs: number;
  pending: boolean;
}

export interface PendingAction {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  label: string;
  createdAt: string;
  userId: string;
  memberId: string;
}

const pendingActions = new Map<string, PendingAction>();

export function listPendingActions(userId: string): PendingAction[] {
  return [...pendingActions.values()].filter((a) => a.userId === userId);
}

export function getPendingAction(id: string): PendingAction | null {
  return pendingActions.get(id) || null;
}

export function dismissPendingAction(id: string, userId: string): boolean {
  const action = pendingActions.get(id);
  if (!action || action.userId !== userId) return false;
  pendingActions.delete(id);
  return true;
}

export async function approvePendingAction(
  id: string,
  userId: string
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const action = pendingActions.get(id);
  if (!action || action.userId !== userId) {
    return { ok: false, error: 'That action is no longer pending.' };
  }
  const tool = findTool(action.toolName);
  if (!tool) {
    pendingActions.delete(id);
    return { ok: false, error: 'Unknown action.' };
  }
  try {
    const result = await tool.execute(action.args, {
      userId: action.userId,
      memberId: action.memberId,
    });
    pendingActions.delete(id);
    return { ok: true, result };
  } catch (error: any) {
    return { ok: false, error: error?.message || 'The action could not be completed.' };
  }
}

export interface AgentRunResult {
  reply: string;
  trace: ToolTraceEntry[];
  turns: number;
  usedFallbackModel: boolean;
  pendingActionIds: string[];
  error?: string;
}

export const DEFAULT_SYSTEM_INSTRUCTION = `
You are Healthyfy AI, a health monitoring and wellbeing agent for a family.

You have tools that read the family's real health record: medical reports and their lab values, structured medication lists, the medication adherence log, recorded vitals, open health alerts and exercise plans. Use them instead of guessing. Never state a lab value, a medication or a vital sign that you did not read from a tool.

HOW TO WORK:
1. Before answering anything about a specific person, read their record with the relevant tool. A question about "his cholesterol" means calling get_medical_reports for that member.
2. Compare rather than recite. If a lab value and an adherence log or a vital are both available, connect them explicitly, and be honest when the data cannot support a conclusion.
3. Some tools change things (run_safety_check, create_reminder, create_alert). Those are queued for the user to approve, and they have NOT run yet. Say that plainly: "I have prepared this for your approval", never "I have booked it" or "I have raised the alert".
4. When a new medicine comes up, always call run_safety_check and report the findings and their severity, including when there are none.

SAFETY RULES:
1. You do not diagnose and you do not replace a doctor. Explain what the numbers mean and what to ask.
2. Never suggest changing a dose, starting, stopping or substituting a medicine. Point the person to their prescriber.
3. If a question describes emergency symptoms (severe chest pain, sudden weakness, uncontrolled bleeding, severe breathlessness, a fall with loss of consciousness), say plainly that this needs emergency care now and tell them to call local emergency services (112 in India). Do not continue with routine analysis.
4. Always end with the reminder that this is educational information and not a substitute for a qualified clinician.
`;

function toProviderTools(tools: ToolDefinition[]): ProviderTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

export async function runHealthAgent(params: {
  userId: string;
  memberId: string;
  message: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  maxTurns?: number;
  tools?: ToolDefinition[];
  systemInstruction?: string;
}): Promise<AgentRunResult> {
  const { userId, memberId, message } = params;
  const tools = params.tools || HEALTH_TOOLS;
  const maxTurns = params.maxTurns ?? 6;

  const trace: ToolTraceEntry[] = [];
  const pendingActionIds: string[] = [];

  const chain = getProviderChain('app').filter((p) => p.isConfigured());
  if (chain.length === 0) {
    return {
      reply:
        'The AI service is not configured, so I cannot answer this yet. Add GEMINI_API_KEY or ASI1_API_KEY to the .env file and restart the server to enable the assistant.',
      trace,
      turns: 0,
      usedFallbackModel: false,
      pendingActionIds,
    };
  }

  const ctx: ToolContext = { userId, memberId };

  let provider = chain[0];
  let usedFallbackModel = false;
  let turns = 0;

  const startConversation = () =>
    provider.createConversation({
      systemInstruction: params.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION,
      history: params.history || [],
      message,
      tools: toProviderTools(tools),
    });

  let conversation = startConversation();

  for (turns = 1; turns <= maxTurns; turns++) {
    let turn: { text: string; toolCalls: ToolCall[] };
    try {
      turn = await provider.nextTurn(conversation);
    } catch (error: any) {
      console.error('Agent turn failed:', error);

      // Move to the next provider in the chain and start the thread again
      // rather than losing the whole request.
      const nextIndex = chain.indexOf(provider) + 1;
      if (nextIndex < chain.length) {
        provider = chain[nextIndex];
        usedFallbackModel = true;
        conversation = startConversation();
        turns--;
        continue;
      }

      return {
        reply:
          'I am having trouble reaching the AI service right now. Please try again in a moment. If this involves an emergency, contact local emergency services immediately.',
        trace,
        turns,
        usedFallbackModel,
        pendingActionIds,
        error: 'model_unavailable',
      };
    }

    if (!turn.toolCalls || turn.toolCalls.length === 0) {
      return {
        reply: turn.text || 'I am here to help. Could you please rephrase your health question?',
        trace,
        turns,
        usedFallbackModel,
        pendingActionIds,
      };
    }

    const results: Array<{ id: string; name: string; result: unknown }> = [];

    for (const call of turn.toolCalls) {
      const tool = findTool(call.name || '', tools);
      const args = (call.args || {}) as Record<string, unknown>;
      const started = Date.now();

      if (!tool) {
        trace.push({
          step: trace.length + 1,
          name: call.name || 'unknown',
          args,
          ok: false,
          error: 'Unknown tool.',
          durationMs: Date.now() - started,
          pending: false,
        });
        results.push({
          id: call.id,
          name: call.name,
          result: { error: 'Unknown tool.' },
        });
        continue;
      }

      if (tool.mutating) {
        // Queue for approval. The model must not claim it ran.
        const id = `pa-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        pendingActions.set(id, {
          id,
          toolName: tool.name,
          args,
          label: describeAction(tool.name, args),
          createdAt: new Date().toISOString(),
          userId,
          memberId,
        });
        pendingActionIds.push(id);
        trace.push({
          step: trace.length + 1,
          name: tool.name,
          args,
          ok: true,
          result: { pending: true, actionId: id },
          durationMs: Date.now() - started,
          pending: true,
        });
        results.push({
          id: call.id,
          name: tool.name,
          result: {
            status: 'pending_user_approval',
            actionId: id,
            message:
              'This action has been prepared but NOT executed. The user must approve it. Tell the user it is waiting for approval and do not state that it has been done.',
          },
        });
        continue;
      }

      try {
        const result = await tool.execute(args, ctx);
        trace.push({
          step: trace.length + 1,
          name: tool.name,
          args,
          result,
          ok: true,
          durationMs: Date.now() - started,
          pending: false,
        });
        results.push({ id: call.id, name: tool.name, result });
      } catch (error: any) {
        const errorMessage = error?.message || 'The tool failed.';
        trace.push({
          step: trace.length + 1,
          name: tool.name,
          args,
          ok: false,
          error: errorMessage,
          durationMs: Date.now() - started,
          pending: false,
        });
        results.push({
          id: call.id,
          name: tool.name,
          result: { error: errorMessage },
        });
      }
    }

    provider.submitToolResults(conversation, results);
  }

  return {
    reply:
      'I reached the limit of how many steps I can take on this one. Let me know how you would like to continue and I will pick it up from here.',
    trace,
    turns,
    usedFallbackModel,
    pendingActionIds,
  };
}

function describeAction(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'create_reminder') {
    return `Create reminder "${args.title}" (${(args.times as string[])?.join(', ')})`;
  }
  if (toolName === 'create_alert') {
    return `Raise ${args.severity} alert "${args.title}"`;
  }
  if (toolName === 'run_safety_check') {
    const names = (args.medications as any[])?.map((m) => m.name).join(', ');
    return `Safety check for ${names}`;
  }
  return toolName;
}

export { crypto };

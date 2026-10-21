import crypto from 'crypto';
import { Request, Response, Router } from 'express';
import { authenticateToken } from '../auth';
import { DEFAULT_SYSTEM_INSTRUCTION, approvePendingAction, dismissPendingAction, listPendingActions, runHealthAgent } from '../ai/loop';
import { conversations, familyMembers, persistState } from '../store';
import { providerStatus } from '../ai/providers';
import { drugDataStatus } from '../ai/drugData';
import { literatureStatus } from '../ai/literature';
import { Conversation, ConversationMessage } from '../types';

export const agentRouter = Router();
agentRouter.use(authenticateToken);

// -------------------------------------------------------------
// Provider status
//
// Surfaces which model backend is live so the interface can show it
// honestly instead of implying a Gemini-specific setup.
// -------------------------------------------------------------
// -------------------------------------------------------------
// The uAgent's own status
//
// The agent runs as a separate service and is the only thing that
// knows its own configuration, so ask it rather than guess. A failure
// here must not break the page, so it degrades to "not reachable".
// -------------------------------------------------------------
async function fetchAgentStatus(): Promise<{
  reachable: boolean;
  status?: string;
  asi1Configured?: boolean;
  healthyfyBaseUrl?: string;
  mailbox?: boolean;
  address?: string;
}> {
  const url = `${process.env.HEALTHYFY_AGENT_URL || 'http://localhost:8000'}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { reachable: false };
    const data: any = await response.json();
    return {
      reachable: true,
      status: data.status,
      asi1Configured: data.asi1_configured,
      healthyfyBaseUrl: data.healthyfy_base_url,
      mailbox: data.mailbox,
      address: data.address,
    };
  } catch {
    return { reachable: false };
  } finally {
    clearTimeout(timer);
  }
}

agentRouter.get('/ai/provider', async (_req: Request, res: Response) => {
  const status = providerStatus();
  const agent = await fetchAgentStatus();
  res.json({
    ...status,
    agent: {
      name: process.env.HEALTHYFY_AGENT_NAME || 'healthyfy-health-agent',
      address: process.env.HEALTHYFY_AGENT_ADDRESS || '',
      seed: Boolean(process.env.HEALTHYFY_AGENT_SEED),
      registered: Boolean(process.env.HEALTHYFY_AGENT_ADDRESS),
      agentverseUrl: process.env.HEALTHYFY_AGENT_ADDRESS
        ? `https://agentverse.ai/agents/${process.env.HEALTHYFY_AGENT_ADDRESS}`
        : '',
      live: agent,
    },
    asiOne: {
      baseUrl: process.env.AI_BASE_URL || 'https://api.asi1.ai/v1',
      configured: Boolean(process.env.ASI1_API_KEY || process.env.AI_API_KEY),
      docsUrl: 'https://docs.asi1.ai',
      signupUrl: 'https://asi1.ai/developer',
      agentverseUrl: 'https://agentverse.ai',
    },
    freeData: {
      openfda: drugDataStatus().openfda,
      pubmed: literatureStatus().pubmed,
      rxnorm: {
        enabled: process.env.RXNORM_ENABLED !== 'false',
        baseUrl: 'https://rxnav.nlm.nih.gov/REST',
        requiresKey: false,
        note: 'Free NIH RxNorm service used to canonicalise drug names.',
      },
    },
  });
});

// -------------------------------------------------------------
// Health assistant with tool use
//
// The conversation is persisted per member so the assistant keeps its
// memory between turns, and every tool call is returned to the
// interface as a trace so the reasoning is visible rather than
// hidden behind a single blob of text.
// -------------------------------------------------------------

agentRouter.post('/ai/chat', async (req: Request, res: Response) => {
  const { message, memberId, conversationId } = req.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const member = familyMembers.find(
    (f) => f.id === memberId && f.userId === req.user!.id
  );
  if (!member) {
    return res.status(404).json({ error: 'Selected family member was not found.' });
  }

  let conversation = conversationId
    ? conversations.find(
        (c) => c.id === conversationId && c.userId === req.user!.id && c.memberId === member.id
      )
    : undefined;

  if (!conversation) {
    conversation = {
      id: `conv-${crypto.randomUUID()}`,
      userId: req.user!.id,
      memberId: member.id,
      title: message.trim().slice(0, 60),
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } satisfies Conversation;
    conversations.push(conversation);
  }

  const history = conversation.messages.slice(-12).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const systemInstruction = `${DEFAULT_SYSTEM_INSTRUCTION}

Current family member in context:
- Name: ${member.name} (${member.relationship})
- Age: ${member.age}, Gender: ${member.gender}
- Blood group: ${member.bloodGroup}
- Allergies on record: ${member.allergies.join(', ') || 'None reported'}
- Conditions on record: ${member.existingConditions.join(', ') || 'None reported'}
- Emergency contact: ${member.emergencyContact || 'Not recorded'}`;

  const result = await runHealthAgent({
    userId: req.user!.id,
    memberId: member.id,
    message: message.trim(),
    history,
    systemInstruction,
  });

  const now = new Date().toISOString();
  const userMessage: ConversationMessage = {
    role: 'user',
    content: message.trim(),
    at: now,
  };
  const assistantMessage: ConversationMessage = {
    role: 'assistant',
    content: result.reply,
    at: now,
  };
  conversation.messages.push(userMessage, assistantMessage);
  conversation.updatedAt = now;
  await persistState();

  res.json({
    reply: result.reply,
    trace: result.trace,
    conversationId: conversation.id,
    pendingActionIds: result.pendingActionIds,
    turns: result.turns,
    usedFallbackModel: result.usedFallbackModel,
    error: result.error,
  });
});

agentRouter.get('/ai/conversations', (req: Request, res: Response) => {
  const list = conversations
    .filter((c) => c.userId === req.user!.id)
    .map((c) => ({
      id: c.id,
      memberId: c.memberId,
      title: c.title,
      messageCount: c.messages.length,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  res.json(list);
});

agentRouter.get('/ai/conversations/:id', (req: Request, res: Response) => {
  const conversation = conversations.find(
    (c) => c.id === req.params.id && c.userId === req.user!.id
  );
  if (!conversation) return res.status(404).json({ error: 'Conversation not found.' });
  res.json(conversation);
});

agentRouter.delete('/ai/conversations/:id', async (req: Request, res: Response) => {
  const index = conversations.findIndex(
    (c) => c.id === req.params.id && c.userId === req.user!.id
  );
  if (index === -1) return res.status(404).json({ error: 'Conversation not found.' });
  conversations.splice(index, 1);
  await persistState();
  res.json({ success: true });
});

// -------------------------------------------------------------
// Pending actions (human in the loop)
// -------------------------------------------------------------

agentRouter.get('/agent/pending-actions', (req: Request, res: Response) => {
  res.json(listPendingActions(req.user!.id));
});

agentRouter.post('/agent/pending-actions/:id/approve', async (req: Request, res: Response) => {
  const result = await approvePendingAction(req.params.id, req.user!.id);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ success: true, result: result.result });
});

agentRouter.post('/agent/pending-actions/:id/dismiss', async (req: Request, res: Response) => {
  const removed = dismissPendingAction(req.params.id, req.user!.id);
  if (!removed) return res.status(404).json({ error: 'Pending action not found.' });
  res.json({ success: true });
});

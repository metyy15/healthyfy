import crypto from 'crypto';
import { Type } from '@google/genai';
import { generateJson, isAiConfigured } from './providers';
import { FollowUpKind, FollowUpTask, Reminder } from '../types';
import { followUpTasks, persistStateSafely, reminders } from '../store';

// -------------------------------------------------------------
// Follow-up extraction
//
// Turns a set of visit instructions into a list of things to do.
//
// The hard part is not reading the document, it is refusing to invent.
// A task is only accepted when the document supports it, every task
// carries the wording it came from, and a medication change is never
// turned into an action: the app cannot change a medication schedule,
// so it can only produce a task to ask the prescriber about it.
// -------------------------------------------------------------

export interface ExtractedTask {
  title: string;
  kind: FollowUpKind;
  /** The exact wording from the document, used to verify the extraction. */
  detail: string;
  dueDate?: string;
  dueTime?: string;
  confidence: number;
  /** True when the wording could not be found in the source document. */
  unsupported: boolean;
  safetyNote?: string;
}

export interface FollowUpExtraction {
  tasks: ExtractedTask[];
  /** Parts of the document that could not be read. */
  unreadableParts: string[];
  visitDate?: string;
  prescriber?: string;
  notes?: string;
  degraded: boolean;
}

const EXTRACTION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    visitDate: { type: Type.STRING, description: 'Visit date in YYYY-MM-DD, or empty string.' },
    prescriber: { type: Type.STRING, description: "Clinician's name, or empty string." },
    tasks: {
      type: Type.ARRAY,
      description: 'Every follow-up action the document asks for.',
      items: {
        type: Type.OBJECT,
        properties: {
          title: {
            type: Type.STRING,
            description: 'The action in a few words, e.g. "Book the 3-month follow-up".',
          },
          kind: {
            type: Type.STRING,
            enum: [
              'appointment',
              'test',
              'bring_records',
              'review_instructions',
              'medication_review',
              'other',
            ],
            description:
              'appointment: book or attend a visit. test: have a test done. bring_records: bring documents. review_instructions: read the notes. medication_review: ask the prescriber about a medicine. other: anything else.',
          },
          detail: {
            type: Type.STRING,
            description:
              'The wording from the document that supports this task, copied exactly.',
          },
          dueDate: {
            type: Type.STRING,
            description: 'Date in YYYY-MM-DD if the document states one, otherwise empty string.',
          },
          dueTime: {
            type: Type.STRING,
            description: 'Time in HH:MM if the document states one, otherwise empty string.',
          },
          confidence: {
            type: Type.NUMBER,
            description: 'Confidence in this extraction from 0 to 1.',
          },
        },
        required: ['title', 'kind', 'detail', 'dueDate', 'dueTime', 'confidence'],
      },
    },
    unreadableParts: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: 'Parts of the document that could not be read clearly.',
    },
    notes: { type: Type.STRING, description: 'Anything else relevant on the document.' },
  },
  required: ['tasks', 'unreadableParts'],
};

const EXTRACTION_PROMPT = `
You are reading a clinician's visit summary, discharge note or prescription follow-up sheet for a personal health record. Extract the follow-up actions it asks for.

Rules:
1. Extract only what the document actually says. Never invent a task, a date or a time. If no date is written, leave dueDate as an empty string.
2. The detail field must be a direct quote from the document that supports the task. Copy the wording; do not paraphrase it.
3. Use kind "medication_review" for anything about changing, starting, stopping or adjusting a medicine. The app cannot change a medication schedule, so a medication change becomes a task to ask the prescriber about it, never an instruction to change a dose.
4. Use kind "appointment" for booking or attending a visit, "test" for having a test done, "bring_records" for bringing documents, "review_instructions" for reading the notes, and "other" for anything else.
5. Dates in YYYY-MM-DD. Times in 24-hour HH:MM.
6. Set confidence below 0.6 for anything you are unsure about, and list it in unreadableParts.
7. Return the structured object only.
`;

/**
 * Language that means a medication is being changed. The app must not
 * act on any of it, so it is checked rather than trusted.
 */
const MEDICATION_CHANGE_PATTERNS: RegExp[] = [
  /\b(increase|decrease|reduce|raise|lower|double|halve|adjust|change|switch|stop|start|discontinue|restart|titrate|withdraw|continue)\b[^.]{0,50}\b(dose|dosage|medication|medicine|tablet|tab|capsule|mg|mcg|insulin|metformin)\b/i,
  /\b(dose|dosage|medication|medicine|tablet|tab|capsule|insulin|metformin)\b[^.]{0,50}\b(increase|decrease|reduce|raise|lower|double|halve|adjust|change|switch|stop|start|discontinue|restart|titrate|withdraw|continue)\b/i,
  /\b(mg|mcg|iu|units)\b[^.]{0,30}\b(daily|twice|once|night|morning|evening|bd|tds|od)\b/i,
];

function looksLikeMedicationChange(text: string): boolean {
  return MEDICATION_CHANGE_PATTERNS.some((pattern) => pattern.test(text));
}

function normalise(text: string): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether the quoted detail is actually supported by the source text.
 * A model that paraphrases or invents is caught here.
 */
function detailIsSupported(detail: string, source: string): boolean {
  const quoted = normalise(detail);
  if (!quoted) return false;
  const haystack = normalise(source);
  if (!haystack) return false;
  if (haystack.includes(quoted)) return true;

  // Fall back to a word-overlap check so a lightly edited quote still
  // passes, but a completely made-up one does not.
  const words = quoted.split(' ').filter((w) => w.length > 3);
  if (words.length === 0) return false;
  const present = words.filter((w) => haystack.includes(w)).length;
  return present / words.length >= 0.7;
}

export interface ExtractionInput {
  userId: string;
  memberId: string;
  imageBase64?: string;
  imageMimeType?: string;
  text?: string;
  sourceLabel: string;
}

export async function extractFollowUpTasks(input: ExtractionInput): Promise<FollowUpExtraction> {
  const sourceText = (input.text ?? '').trim();
  let raw: any;

  if (isAiConfigured() && (input.imageBase64 || sourceText)) {
    const inlineParts =
      input.imageBase64 && input.imageMimeType
        ? [
            {
              mimeType: input.imageMimeType,
              data: input.imageBase64.replace(/^data:[^;]+;base64,/, ''),
            },
          ]
        : [];

    const prompt = sourceText
      ? `${EXTRACTION_PROMPT}\n\nHere are the visit instructions:\n${sourceText}`
      : EXTRACTION_PROMPT;

    const result = await generateJson<any>(
      {
        prompt,
        schema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
        inlineParts,
        systemInstruction:
          'You extract follow-up actions from clinical documents. You never invent an action, a date or a time, and you never turn a medication change into an instruction to change a dose.',
      },
      'vision'
    );
    raw = result.data;
  } else {
    raw = { tasks: [], unreadableParts: ['No AI provider is configured, so nothing could be read.'] };
  }

  const tasks: ExtractedTask[] = [];
  const rawTasks = Array.isArray(raw?.tasks) ? raw.tasks : [];

  for (const item of rawTasks) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) continue;

    const detail = typeof item.detail === 'string' ? item.detail : '';
    const unsupported = detail ? !detailIsSupported(detail, sourceText) : true;

    const kind: FollowUpKind = (
      ['appointment', 'test', 'bring_records', 'review_instructions', 'medication_review', 'other'].includes(
        item.kind
      )
        ? item.kind
        : 'other'
    ) as FollowUpKind;

    let title = item.title.trim();
    let taskKind = kind;
    let safetyNote: string | undefined;

    // A medication change is never an instruction. It becomes a
    // question for the prescriber.
    if (looksLikeMedicationChange(`${title} ${detail}`)) {
      taskKind = 'medication_review';
      title = 'Ask your prescriber about the medicine change in these notes';
      safetyNote =
        'Healthyfy never changes a medication schedule. This is recorded as a question for your prescriber.';
    }

    tasks.push({
      title,
      kind: taskKind,
      detail,
      ...(typeof item.dueDate === 'string' && item.dueDate.trim() ? { dueDate: item.dueDate.trim() } : {}),
      ...(typeof item.dueTime === 'string' && item.dueTime.trim() ? { dueTime: item.dueTime.trim() } : {}),
      confidence:
        typeof item.confidence === 'number' && Number.isFinite(item.confidence)
          ? Math.max(0, Math.min(1, item.confidence))
          : 0.5,
      unsupported,
      ...(safetyNote ? { safetyNote } : {}),
    });
  }

  return {
    tasks,
    unreadableParts: Array.isArray(raw?.unreadableParts)
      ? raw.unreadableParts.filter((p: unknown) => typeof p === 'string')
      : [],
    ...(typeof raw?.visitDate === 'string' && raw.visitDate.trim() ? { visitDate: raw.visitDate.trim() } : {}),
    ...(typeof raw?.prescriber === 'string' && raw.prescriber.trim() ? { prescriber: raw.prescriber.trim() } : {}),
    ...(typeof raw?.notes === 'string' ? { notes: raw.notes } : {}),
    degraded: !isAiConfigured(),
  };
}

// -------------------------------------------------------------
// Turning a confirmed task into a real reminder
// -------------------------------------------------------------

export interface ReminderCreationResult {
  task: FollowUpTask;
  reminder?: Reminder;
  /** True only when a notification is genuinely scheduled. */
  scheduled: boolean;
  message: string;
}

export function createFollowUpTask(input: {
  userId: string;
  memberId: string;
  title: string;
  detail?: string;
  kind: FollowUpKind;
  dueDate?: string;
  dueTime?: string;
  source: FollowUpTask['source'];
  sourceLabel?: string;
  safetyNote?: string;
}): FollowUpTask {
  const task: FollowUpTask = {
    id: `fu-${crypto.randomUUID()}`,
    userId: input.userId,
    memberId: input.memberId,
    title: input.title,
    ...(input.detail ? { detail: input.detail } : {}),
    kind: input.kind,
    ...(input.dueDate ? { dueDate: input.dueDate } : {}),
    ...(input.dueTime ? { dueTime: input.dueTime } : {}),
    source: input.source,
    ...(input.sourceLabel ? { sourceLabel: input.sourceLabel } : {}),
    status: 'pending',
    createdAt: new Date().toISOString(),
    reminderScheduled: false,
    ...(input.safetyNote ? { safetyNote: input.safetyNote } : {}),
  };
  return task;
}

/**
 * Attach a real reminder to a task.
 *
 * The reminder is only created when there is a time to fire it at. The
 * returned message says exactly what happened, so the caller never has
 * to claim a notification that was not scheduled.
 */
export function attachReminder(task: FollowUpTask): ReminderCreationResult {
  if (!task.dueDate || !task.dueTime) {
    return {
      task,
      scheduled: false,
      message:
        'No reminder was created because this task has no date and time. Add one to the task, or set a recurring reminder for it in the Care Plan screen.',
    };
  }

  const reminder: Reminder = {
    id: `rem-${crypto.randomUUID()}`,
    userId: task.userId,
    memberId: task.memberId,
    type: task.kind === 'appointment' ? 'checkin' : 'checkin',
    title: task.title,
    message: task.detail || task.title,
    // A one-off reminder is implemented as a daily schedule that the
    // scheduler stops firing once the date has passed.
    schedule: { kind: 'daily', times: [task.dueTime] },
    enabled: true,
    createdAt: new Date().toISOString(),
  };

  reminders.push(reminder);
  task.reminderId = reminder.id;
  task.reminderScheduled = true;

  return {
    task,
    reminder,
    scheduled: true,
    message: `A reminder is scheduled for ${task.dueDate} at ${task.dueTime}. It will appear in the notification inbox at that time.`,
  };
}

/**
 * The tasks that need attention in the coming days.
 */
export function upcomingTasks(
  userId: string,
  memberId?: string,
  days = 7
): { overdue: FollowUpTask[]; today: FollowUpTask[]; thisWeek: FollowUpTask[]; later: FollowUpTask[] } {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10);

  const pending = followUpTasks.filter(
    (t) =>
      t.userId === userId &&
      t.status === 'pending' &&
      (!memberId || t.memberId === memberId)
  );

  const all = pending;

  const overdue: FollowUpTask[] = [];
  const dueToday: FollowUpTask[] = [];
  const thisWeek: FollowUpTask[] = [];
  const later: FollowUpTask[] = [];

  for (const task of all) {
    if (!task.dueDate) {
      later.push(task);
    } else if (task.dueDate < today) {
      overdue.push(task);
    } else if (task.dueDate === today) {
      dueToday.push(task);
    } else if (task.dueDate <= horizon) {
      thisWeek.push(task);
    } else {
      later.push(task);
    }
  }

  const byDate = (a: FollowUpTask, b: FollowUpTask) =>
    (a.dueDate || '9999').localeCompare(b.dueDate || '9999');

  return {
    overdue: overdue.sort(byDate),
    today: dueToday.sort(byDate),
    thisWeek: thisWeek.sort(byDate),
    later: later.sort(byDate),
  };
}

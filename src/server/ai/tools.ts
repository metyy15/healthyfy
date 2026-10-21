import { Type } from '@google/genai';
import { buildExercisePlan } from './exercise';
import { compareReports, findReportsToCompare } from './compare';
import { createFollowUpTask, upcomingTasks } from './followUp';
import { runSafetyCheck } from './safety';
import {
  adherence,
  alerts,
  caregivers,
  familyMembers,
  followUpTasks,
  medicalReports,
  medications,
  notifications,
  persistStateSafely,
  reminders,
  vitals,
} from '../store';
import { AlertSeverity, Reminder, VitalType } from '../types';

// -------------------------------------------------------------
// Agent tools
//
// Every tool the model can reach is declared here with a schema and
// an executor. Read tools are free. Write tools are marked so the
// interface can require an explicit confirmation before they run.
// -------------------------------------------------------------

export interface ToolContext {
  userId: string;
  memberId: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Write tools need a human confirmation in the interface. */
  mutating: boolean;
  execute(args: any, ctx: ToolContext): Promise<unknown>;
}

const memberIdProperty = {
  type: Type.STRING,
  description: 'Family member id. Defaults to the member currently in context.',
};

function resolveMemberId(args: any, ctx: ToolContext): string {
  const candidate = args?.memberId;
  if (typeof candidate === 'string' && candidate) {
    const owned = familyMembers.find(
      (f) => f.id === candidate && f.userId === ctx.userId
    );
    if (owned) return owned.id;
  }
  return ctx.memberId;
}

export const HEALTH_TOOLS: ToolDefinition[] = [
  {
    name: 'get_family_profile',
    description:
      'Get the profile of a family member: age, gender, allergies, conditions, current medications and notes.',
    parameters: {
      type: Type.OBJECT,
      properties: { memberId: memberIdProperty },
    },
    mutating: false,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const member = familyMembers.find((f) => f.id === memberId && f.userId === ctx.userId);
      if (!member) return { error: 'Family member not found.' };
      return {
        id: member.id,
        name: member.name,
        relationship: member.relationship,
        age: member.age,
        gender: member.gender,
        bloodGroup: member.bloodGroup,
        allergies: member.allergies,
        existingConditions: member.existingConditions,
        notes: member.notes,
        caregivers: caregivers
          .filter((c) => c.memberId === member.id)
          .map((c) => ({ name: c.caregiverName, relation: c.relation, permission: c.permission })),
      };
    },
  },
  {
    name: 'compare_reports',
    description:
      'Compare two medical reports for a family member and report how each test value changed, with the reference range for each. Use this whenever someone asks what changed, whether a result has improved, or how two reports differ. By default it compares the two most recent reports of the same panel.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memberId: memberIdProperty,
        olderId: {
          type: Type.STRING,
          description: 'Id of the earlier report. Leave empty to use the most recent earlier report of the same panel.',
        },
        latestId: {
          type: Type.STRING,
          description: 'Id of the later report. Leave empty to use the most recent report.',
        },
      },
    },
    mutating: false,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const { older, latest, reason } = findReportsToCompare(
        memberId,
        args?.olderId || undefined,
        args?.latestId || undefined
      );
      if (!older || !latest) {
        return { comparable: false, reason };
      }
      const result = compareReports(memberId, older, latest);
      return {
        comparable: true,
        older: result.older,
        latest: result.latest,
        changes: result.changes.map((c) => ({
          test: c.testName,
          unit: c.unit,
          previous: c.previous.raw,
          latest: c.latest.raw,
          previousInRange: c.previous.inRange,
          latestInRange: c.latest.inRange,
          direction: c.direction,
          change: c.absoluteChange,
          percentChange: c.percentChange,
          significance: c.significance,
          referenceRange: c.latest.rangeText,
          note: c.note,
        })),
        notCompared: result.skipped,
        questions: result.questions,
        summary: result.summary,
        disclaimer: result.disclaimer,
      };
    },
  },
  {
    name: 'list_follow_ups',
    description:
      'List the follow-up tasks that are still outstanding for a family member, grouped by overdue, due today, due this week and later. Use this when someone asks what they need to do, what is pending, or what is coming up.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memberId: memberIdProperty,
        days: { type: Type.INTEGER, description: 'How many days ahead to look. Default 7.' },
      },
    },
    mutating: false,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const days = Number(args?.days) > 0 ? Number(args.days) : 7;
      const grouped = upcomingTasks(ctx.userId, memberId, days);
      const shape = (list: any[]) =>
        list.map((t) => ({
          id: t.id,
          title: t.title,
          kind: t.kind,
          detail: t.detail,
          dueDate: t.dueDate,
          dueTime: t.dueTime,
          reminderScheduled: t.reminderScheduled,
          safetyNote: t.safetyNote,
        }));
      return {
        days,
        overdue: shape(grouped.overdue),
        dueToday: shape(grouped.today),
        dueThisWeek: shape(grouped.thisWeek),
        later: shape(grouped.later),
      };
    },
  },
  {
    name: 'create_follow_up_task',
    description:
      'Create a follow-up task for a family member, such as booking a visit, having a test done, bringing records, or asking the prescriber about a medicine. Requires confirmation. Never use this to change a medication schedule.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memberId: memberIdProperty,
        title: { type: Type.STRING, description: 'What needs doing, in a few words.' },
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
        },
        detail: { type: Type.STRING, description: 'Any supporting detail from the source document.' },
        dueDate: { type: Type.STRING, description: 'YYYY-MM-DD, only if a date was given.' },
        dueTime: { type: Type.STRING, description: 'HH:MM, only if a time was given.' },
      },
      required: ['title', 'kind'],
    },
    mutating: true,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const task = createFollowUpTask({
        userId: ctx.userId,
        memberId,
        title: String(args.title),
        ...(args.detail ? { detail: String(args.detail) } : {}),
        kind: args.kind,
        ...(args.dueDate ? { dueDate: String(args.dueDate) } : {}),
        ...(args.dueTime ? { dueTime: String(args.dueTime) } : {}),
        source: 'agent',
        sourceLabel: 'Created from the Healthyfy assistant',
      });
      followUpTasks.push(task);
      await persistStateSafely();
      return { created: true, id: task.id, title: task.title };
    },
  },
  {
    name: 'complete_follow_up_task',
    description:
      'Mark a follow-up task as done. Requires confirmation. Use this only when the user says they have done the thing.',
    parameters: {
      type: Type.OBJECT,
      properties: { taskId: { type: Type.STRING, description: 'The id of the task.' } },
      required: ['taskId'],
    },
    mutating: true,
    async execute(args, ctx) {
      const task = followUpTasks.find(
        (t) => t.id === String(args.taskId) && t.userId === ctx.userId
      );
      if (!task) return { error: 'Task not found.' };
      task.status = 'done';
      task.completedAt = new Date().toISOString();
      await persistStateSafely();
      return { completed: true, id: task.id, title: task.title };
    },
  },
  {
    name: 'get_medical_reports',
    description:
      'Get stored medical reports with their extracted lab values, most recent first. Use this whenever a question mentions a report, a lab value or a diagnosis.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memberId: memberIdProperty,
        limit: { type: Type.INTEGER, description: 'Maximum reports to return. Default 3.' },
      },
    },
    mutating: false,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const limit = Number(args?.limit) > 0 ? Number(args.limit) : 3;
      return medicalReports
        .filter((r) => r.userId === ctx.userId && r.memberId === memberId)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, limit)
        .map((r) => ({
          id: r.id,
          reportType: r.reportType,
          title: r.title,
          date: r.date,
          laboratory: r.laboratory,
          summary: r.summary,
          isUrgent: r.isUrgent,
          values: r.values,
          nextSteps: r.nextSteps,
          suggestedQuestions: r.suggestedQuestions,
        }));
    },
  },
  {
    name: 'get_medications',
    description:
      'Get the structured medication list for a family member, including dose, frequency, dose times and whether it is currently active.',
    parameters: {
      type: Type.OBJECT,
      properties: { memberId: memberIdProperty },
    },
    mutating: false,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      return medications
        .filter((m) => m.userId === ctx.userId && m.memberId === memberId)
        .map((m) => ({
          id: m.id,
          name: m.name,
          dose: m.dose,
          frequency: m.frequency,
          times: m.times,
          active: m.active,
          startDate: m.startDate,
          source: m.source,
        }));
    },
  },
  {
    name: 'get_adherence_log',
    description:
      'Get the medication adherence log for the last N days: which doses were taken, skipped or late. Use this to spot patterns between missed doses and lab results.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memberId: memberIdProperty,
        days: { type: Type.INTEGER, description: 'How many days to look back. Default 14.' },
      },
    },
    mutating: false,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const days = Number(args?.days) > 0 ? Number(args.days) : 14;
      const since = Date.now() - days * 86400000;
      const entries = adherence.filter(
        (a) => a.memberId === memberId && new Date(a.scheduledAt).getTime() >= since
      );
      const taken = entries.filter((e) => e.status === 'taken').length;
      const skipped = entries.filter((e) => e.status === 'skipped').length;
      const late = entries.filter((e) => e.status === 'late').length;
      return {
        days,
        total: entries.length,
        taken,
        skipped,
        late,
        adherenceRate: entries.length ? Math.round((taken / entries.length) * 100) : null,
        byMedication: Object.entries(
          entries.reduce<Record<string, { taken: number; skipped: number; late: number }>>(
            (acc, e) => {
              acc[e.medicationName] = acc[e.medicationName] || { taken: 0, skipped: 0, late: 0 };
              if (e.status === 'taken') acc[e.medicationName].taken++;
              else if (e.status === 'skipped') acc[e.medicationName].skipped++;
              else if (e.status === 'late') acc[e.medicationName].late++;
              return acc;
            },
            {}
          )
        ).map(([name, counts]) => ({ name, ...counts })),
        recent: entries.slice(0, 20),
      };
    },
  },
  {
    name: 'get_vitals',
    description:
      'Get recorded vitals such as heart rate, steps, oxygen saturation or blood pressure for the last N hours.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memberId: memberIdProperty,
        type: {
          type: Type.STRING,
          enum: ['heart_rate', 'steps', 'spo2', 'blood_pressure', 'sleep_hours', 'weight', 'temperature'],
        },
        hours: { type: Type.INTEGER, description: 'Look-back window in hours. Default 24.' },
      },
    },
    mutating: false,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const hours = Number(args?.hours) > 0 ? Number(args.hours) : 24;
      const since = Date.now() - hours * 3600000;
      let rows = vitals.filter(
        (v) => v.memberId === memberId && new Date(v.measuredAt).getTime() >= since
      );
      if (args?.type) rows = rows.filter((v) => v.type === args.type);
      return rows
        .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime())
        .slice(0, 100);
    },
  },
  {
    name: 'get_open_alerts',
    description:
      'Get health alerts that are still open or acknowledged but unresolved, for example an abnormal heart rate or a detected fall.',
    parameters: {
      type: Type.OBJECT,
      properties: { memberId: memberIdProperty },
    },
    mutating: false,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      return alerts
        .filter(
          (a) => a.userId === ctx.userId && a.memberId === memberId && a.status !== 'resolved'
        )
        .slice(0, 10);
    },
  },
  {
    name: 'build_exercise_plan',
    description:
      'Build a personalised exercise and step plan from the recorded conditions, medications and lab results. Use this when someone asks what they should do for exercise or steps.',
    parameters: {
      type: Type.OBJECT,
      properties: { memberId: memberIdProperty },
    },
    mutating: false,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const plan = await buildExercisePlan(ctx.userId, memberId);
      return plan || { error: 'Family member not found.' };
    },
  },
  {
    name: 'run_safety_check',
    description:
      'Check a list of medications against the member allergy history, existing medications and recorded conditions. Always run this before telling someone a new medicine is safe. Returns findings and their severity.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memberId: memberIdProperty,
        medications: {
          type: Type.ARRAY,
          description: 'Medications to check.',
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING },
              dose: { type: Type.STRING },
            },
            required: ['name'],
          },
        },
      },
      required: ['medications'],
    },
    mutating: true,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const incoming = Array.isArray(args?.medications) ? args.medications : [];
      if (incoming.length === 0) return { error: 'No medications supplied.' };
      const result = await runSafetyCheck({
        userId: ctx.userId,
        memberId,
        incoming: incoming.map((m: any) => ({ name: String(m.name), dose: m.dose })),
        trigger: 'manual',
        sourceLabel: 'Safety check requested from the assistant',
      });
      return {
        highestSeverity: result.check.highestSeverity,
        findings: result.check.findings,
        notes: result.notes,
      };
    },
  },
  {
    name: 'create_reminder',
    description:
      'Create a repeating reminder such as a hydration prompt, a medication reminder or an exercise session. Requires confirmation from the user.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memberId: memberIdProperty,
        type: {
          type: Type.STRING,
          enum: ['medication', 'hydration', 'exercise', 'checkin', 'report_followup'],
        },
        title: { type: Type.STRING },
        message: { type: Type.STRING },
        times: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Times of day in 24h HH:MM.',
        },
      },
      required: ['type', 'title', 'message', 'times'],
    },
    mutating: true,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const times: string[] = Array.isArray(args?.times) ? args.times : [];
      if (times.length === 0) return { error: 'At least one time is required.' };
      const reminder: Reminder = {
        id: `rem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        userId: ctx.userId,
        memberId,
        type: args.type,
        title: String(args.title || 'Reminder'),
        message: String(args.message || ''),
        schedule: { kind: 'daily', times },
        enabled: true,
        createdAt: new Date().toISOString(),
      };
      reminders.push(reminder);
      await persistStateSafely();
      return { created: true, id: reminder.id, schedule: reminder.schedule };
    },
  },
  {
    name: 'create_alert',
    description:
      'Raise a health alert for a family member, for example a concerning symptom or a medication that should be reviewed. Requires confirmation from the user.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        memberId: memberIdProperty,
        type: {
          type: Type.STRING,
          enum: ['heart_rate', 'fall', 'spo2', 'inactivity', 'medication_missed', 'safety', 'manual'],
        },
        severity: { type: Type.STRING, enum: ['info', 'warning', 'critical'] },
        title: { type: Type.STRING },
        message: { type: Type.STRING },
      },
      required: ['type', 'severity', 'title', 'message'],
    },
    mutating: true,
    async execute(args, ctx) {
      const memberId = resolveMemberId(args, ctx);
      const member = familyMembers.find((f) => f.id === memberId && f.userId === ctx.userId);
      const severity: AlertSeverity =
        args.severity === 'critical' ? 'critical' : args.severity === 'warning' ? 'warning' : 'info';
      const alert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        userId: ctx.userId,
        memberId,
        memberName: member?.name || 'Family member',
        type: args.type,
        severity,
        title: String(args.title || 'Health alert'),
        message: String(args.message || ''),
        status: 'open' as const,
        detectedAt: new Date().toISOString(),
        snapshot: { source: 'assistant' },
        escalation: [],
      };
      alerts.unshift(alert);
      notifications.unshift({
        id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        userId: ctx.userId,
        type: 'alert',
        title: alert.title,
        message: alert.message,
        timestamp: new Date().toISOString(),
        read: false,
        priority: severity === 'critical' ? 'high' : 'medium',
      });
      await persistStateSafely();
      return { created: true, id: alert.id };
    },
  },
];

export function toolDeclarations(tools: ToolDefinition[] = HEALTH_TOOLS) {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    },
  ];
}

export function findTool(name: string, tools: ToolDefinition[] = HEALTH_TOOLS): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}

export const VITAL_TYPE_LABELS: Record<VitalType, string> = {
  heart_rate: 'Heart rate',
  steps: 'Steps',
  spo2: 'Oxygen saturation',
  blood_pressure: 'Blood pressure',
  sleep_hours: 'Sleep',
  weight: 'Weight',
  temperature: 'Temperature',
};

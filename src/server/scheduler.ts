import { buildAiBriefing, buildDailyBriefing } from './ai/briefing';
import { processEscalations } from './ai/monitor';
import { pushToUser } from './push';
import {
  adherence,
  familyMembers,
  medications,
  notifications,
  persistStateSafely,
  reminders,
  users,
} from './store';
import { AdherenceEntry, Medication, NotificationType, Reminder, User } from './types';

// -------------------------------------------------------------
// Background scheduler
//
// Runs a single tick loop that:
//   1. opens adherence entries for doses that are due
//   2. fires medication, hydration and exercise reminders
//   3. escalates alerts that have not been acknowledged
//   4. sends the daily briefing once per person per day
//
// The tick is intentionally coarse (30 seconds) and every action is
// idempotent, so a restart or a missed tick does not duplicate work.
// -------------------------------------------------------------

const TICK_MS = Number(process.env.SCHEDULER_TICK_MS || 30_000);

/** Doses still unanswered this long after the scheduled time count as late. */
const LATE_AFTER_MINUTES = 90;

/** How long after the scheduled time a dose is still worth prompting for. */
const PROMPT_WINDOW_MINUTES = 45;

const schedulerEnabled = process.env.SCHEDULER_ENABLED !== 'false';

let timer: NodeJS.Timeout | null = null;
const lastBriefingRun = new Map<string, string>();
let tickCount = 0;

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function scheduledDateTime(date: Date, time: string): Date | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours > 23 || minutes > 59) return null;
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

/**
 * Open an adherence entry for each due dose and prompt for it.
 */
function processMedicationDoses(now: Date): { created: number; prompted: number } {
  let created = 0;
  let prompted = 0;

  const members = familyMembers;
  for (const member of members) {
    const memberMeds = medications.filter(
      (m) => m.memberId === member.id && m.active && m.userId === member.userId
    );

    for (const med of memberMeds) {
      for (const time of med.times) {
        const scheduledAt = scheduledDateTime(now, time);
        if (!scheduledAt) continue;

        const minutesSince = (now.getTime() - scheduledAt.getTime()) / 60000;
        if (minutesSince < -1) continue; // not due yet
        if (minutesSince > 24 * 60) continue; // stale, do not backfill

        const scheduledIso = scheduledAt.toISOString();
        const existing = adherence.find(
          (a) => a.medicationId === med.id && a.scheduledAt === scheduledIso
        );

        if (!existing) {
          const entry: AdherenceEntry = {
            id: `adh-${med.id}-${scheduledAt.getTime()}`,
            userId: med.userId,
            memberId: member.id,
            medicationId: med.id,
            medicationName: med.name,
            scheduledAt: scheduledIso,
            status: 'pending',
          };
          adherence.push(entry);
          created++;
        } else if (existing.status === 'pending' && minutesSince > LATE_AFTER_MINUTES) {
          existing.status = 'late';
          existing.respondedAt = new Date().toISOString();
        }

        const record = adherence.find(
          (a) => a.medicationId === med.id && a.scheduledAt === scheduledIso
        );
        if (record && record.status === 'pending' && minutesSince <= PROMPT_WINDOW_MINUTES) {
          void pushToUser(
            { userId: med.userId },
            {
              title: `Time for ${member.name}'s ${med.name}`,
              body: `${med.name} ${med.dose} is scheduled for ${time}. Mark it as taken once you have had it.`,
              type: 'medication',
              priority: 'high',
              data: { medicationId: med.id, scheduledAt: scheduledIso, memberId: member.id },
            }
          );
          prompted++;
        }
      }
    }
  }

  return { created, prompted };
}

function reminderIsDue(reminder: Reminder, now: Date): string | null {
  if (!reminder.enabled) return null;
  const schedule = reminder.schedule;
  if (!schedule || schedule.times.length === 0) return null;

  const localKey = localDateKey(now);
  if (reminder.lastFiredAt && localDateKey(new Date(reminder.lastFiredAt)) === localKey) {
    // Only one firing per day per reminder, tracked by the last fired time.
    const lastFired = new Date(reminder.lastFiredAt);
    if (now.getTime() - lastFired.getTime() < 60 * 60 * 1000) return null;
  }

  for (const time of schedule.times) {
    const at = scheduledDateTime(now, time);
    if (!at) continue;
    const minutesSince = (now.getTime() - at.getTime()) / 60000;
    if (minutesSince >= 0 && minutesSince <= 5) return time;
  }
  return null;
}

async function processReminders(now: Date): Promise<number> {
  let fired = 0;

  for (const reminder of reminders) {
    const dueTime = reminderIsDue(reminder, now);
    if (!dueTime) continue;

    const user = users.find((u) => u.id === reminder.userId);
    if (!user) continue;

    // Respect the per-user preference switches.
    if (reminder.type === 'hydration' && !user.preferences.hydrationAlerts) continue;
    if (reminder.type === 'medication' && !user.preferences.medicationAlarms) continue;

    const member = familyMembers.find((f) => f.id === reminder.memberId);
    const notificationType: NotificationType =
      reminder.type === 'exercise'
        ? 'exercise'
        : reminder.type === 'checkin' || reminder.type === 'report_followup'
          ? 'health'
          : reminder.type;

    await pushToUser(
      { userId: reminder.userId },
      {
        title: reminder.title,
        body: member ? `${member.name}: ${reminder.message}` : reminder.message,
        type: notificationType,
        priority: reminder.type === 'medication' ? 'high' : 'low',
        data: { reminderId: reminder.id, memberId: reminder.memberId },
      }
    );

    reminder.lastFiredAt = new Date().toISOString();
    fired++;
  }

  return fired;
}

async function processDailyBriefings(now: Date): Promise<number> {
  let sent = 0;
  const hour = now.getHours();
  const todayKey = localDateKey(now);

  for (const user of users) {
    if (!user.preferences.reportReadyAlerts) continue;
    if (lastBriefingRun.get(user.id) === todayKey) continue;
    if (hour < 8) continue; // send in the morning

    // Also check the persisted inbox so a server restart does not
    // send the same briefing twice in one day.
    const alreadySent = notifications.some(
      (n) =>
        n.userId === user.id &&
        n.type === 'health' &&
        n.title === 'Your Healthyfy daily briefing' &&
        localDateKey(new Date(n.timestamp)) === todayKey
    );
    if (alreadySent) {
      lastBriefingRun.set(user.id, todayKey);
      continue;
    }

    const briefing = buildDailyBriefing(user.id);
    if (briefing.insights.length === 0 && briefing.members.length === 0) continue;

    const narrative = await buildAiBriefing(user.id, briefing);
    const top = briefing.insights.filter((i) => i.severity !== 'info').slice(0, 2);
    const body = top.length
      ? `${narrative}\n\nTop item: ${top[0].headline}`
      : narrative;

    await pushToUser(
      { userId: user.id },
      {
        title: 'Your Healthyfy daily briefing',
        body,
        type: 'health',
        priority: top.some((i) => i.severity === 'critical') ? 'high' : 'medium',
        data: { kind: 'briefing' },
      }
    );

    lastBriefingRun.set(user.id, todayKey);
    sent++;
  }

  return sent;
}

export async function runTick(now = new Date()): Promise<{
  dosesOpened: number;
  promptsSent: number;
  remindersFired: number;
  escalations: number;
  briefingsSent: number;
}> {
  const doses = processMedicationDoses(now);
  const remindersFired = await processReminders(now);
  const escalations = await processEscalations();
  const briefingsSent = await processDailyBriefings(now);

  if (doses.created || doses.prompted || remindersFired || escalations) {
    await persistStateSafely();
  }

  return {
    dosesOpened: doses.created,
    promptsSent: doses.prompted,
    remindersFired,
    escalations,
    briefingsSent,
  };
}

export function startScheduler(): void {
  if (!schedulerEnabled) {
    console.log('Scheduler disabled (SCHEDULER_ENABLED=false).');
    return;
  }
  if (timer) return;

  timer = setInterval(() => {
    tickCount++;
    runTick().catch((error) => console.error('Scheduler tick failed:', error));
  }, TICK_MS);

  console.log(`Scheduler running every ${Math.round(TICK_MS / 1000)}s.`);
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function schedulerStatus() {
  return {
    enabled: schedulerEnabled,
    running: Boolean(timer),
    tickMs: TICK_MS,
    ticks: tickCount,
    lateAfterMinutes: LATE_AFTER_MINUTES,
    promptWindowMinutes: PROMPT_WINDOW_MINUTES,
  };
}

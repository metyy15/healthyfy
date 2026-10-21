import {
  adherence,
  alerts,
  familyMembers,
  medicalReports,
  medications,
  vitals,
} from '../store';
import { buildExerciseRecommendation } from './exercise';
import { analyzeHeartRate } from './monitor';
import { generateJson, isAiConfigured } from './providers';
import { Type } from '@google/genai';

// -------------------------------------------------------------
// Daily briefing
//
// The proactive half of the product: rather than waiting for the
// user to ask, this assembles what changed since yesterday and
// surfaces the connections that are easy to miss by hand, such as
// missed doses alongside a rising HbA1c.
// -------------------------------------------------------------

export interface BriefingInsight {
  memberId: string;
  memberName: string;
  kind: 'adherence' | 'labs' | 'vitals' | 'alert' | 'plan' | 'medication';
  severity: 'info' | 'warning' | 'critical';
  headline: string;
  detail: string;
  /** A concrete action the user can take. */
  action?: string;
}

export interface BriefingMember {
  memberId: string;
  memberName: string;
  relationship: string;
  dosesScheduledToday: number;
  dosesDueToday: number;
  dosesTakenToday: number;
  dosesMissedToday: number;
  adherenceRate14d: number | null;
  medicationsNeedingAttention: string[];
  latestAbnormalValues: Array<{ test: string; result: string; date: string; status: string }>;
  openAlerts: number;
  heartRateNote: string | null;
  exerciseTarget: string | null;
}

export interface DailyBriefing {
  userId: string;
  generatedAt: string;
  members: BriefingMember[];
  insights: BriefingInsight[];
  narrative: string;
  questionsForTheDoctor: string[];
  degraded: boolean;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function adherenceFor(memberId: string, since: Date, until?: Date) {
  return adherence.filter((a) => {
    if (a.memberId !== memberId) return false;
    const t = new Date(a.scheduledAt).getTime();
    if (t < since.getTime()) return false;
    if (until && t > until.getTime()) return false;
    return true;
  });
}

function latestAbnormalValues(memberId: string) {
  const reports = medicalReports
    .filter((r) => r.memberId === memberId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const seen = new Set<string>();
  const out: Array<{ test: string; result: string; date: string; status: string }> = [];
  for (const report of reports) {
    for (const value of report.values) {
      if (value.status === 'Within range') continue;
      const key = value.testName.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        test: value.testName,
        result: value.result,
        date: report.date,
        status: value.status,
      });
      if (out.length >= 4) return out;
    }
  }
  return out;
}

function hba1cTrend(memberId: string): { latest: number; previous: number | null; latestDate: string } | null {
  const reports = medicalReports
    .filter((r) => r.memberId === memberId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const found: Array<{ value: number; date: string }> = [];
  for (const report of reports) {
    for (const value of report.values) {
      if (/hba1c|glycated/i.test(value.testName)) {
        const parsed = parseFloat(value.result);
        if (!Number.isNaN(parsed)) found.push({ value: parsed, date: report.date });
      }
    }
  }
  if (found.length === 0) return null;
  return {
    latest: found[0].value,
    previous: found.length > 1 ? found[1].value : null,
    latestDate: found[0].date,
  };
}

export function buildDailyBriefing(userId: string): DailyBriefing {
  const members = familyMembers.filter((f) => f.userId === userId);
  const today = startOfToday();
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);

  const insights: BriefingInsight[] = [];
  const questions: string[] = [];
  const memberSummaries: BriefingMember[] = [];

  for (const member of members) {
    const memberMeds = medications.filter((m) => m.memberId === member.id && m.active);
    const todayEntries = adherenceFor(member.id, today);
    const twoWeekEntries = adherenceFor(member.id, twoWeeksAgo);

    const takenToday = todayEntries.filter((e) => e.status === 'taken').length;
    const missedToday = todayEntries.filter((e) => e.status === 'skipped').length;
    const dueToday = todayEntries.filter((e) => e.status !== 'pending').length;

    const scheduledToday = memberMeds.reduce((sum, m) => sum + m.times.length, 0);
    const answered14 = twoWeekEntries.filter((e) => e.status !== 'pending');
    const taken14 = twoWeekEntries.filter((e) => e.status === 'taken').length;
    const adherenceRate14d = answered14.length
      ? Math.round((taken14 / answered14.length) * 100)
      : null;

    // Per-medication adherence so we can name the offender.
    const perMed = new Map<string, { taken: number; total: number }>();
    for (const entry of twoWeekEntries) {
      const bucket = perMed.get(entry.medicationName) || { taken: 0, total: 0 };
      bucket.total++;
      if (entry.status === 'taken') bucket.taken++;
      perMed.set(entry.medicationName, bucket);
    }
    const medicationsNeedingAttention = [...perMed.entries()]
      .filter(([, v]) => v.total >= 3 && v.taken / v.total < 0.8)
      .map(([name, v]) => `${name} (${v.taken}/${v.total} doses taken)`);

    const abnormal = latestAbnormalValues(member.id);
    const openAlerts = alerts.filter((a) => a.memberId === member.id && a.status !== 'resolved');
    const hr = analyzeHeartRate(member.id, now);
    const plan = buildExerciseRecommendation(userId, member.id);

    memberSummaries.push({
      memberId: member.id,
      memberName: member.name,
      relationship: member.relationship,
      dosesScheduledToday: scheduledToday,
      dosesDueToday: dueToday,
      dosesTakenToday: takenToday,
      dosesMissedToday: missedToday,
      adherenceRate14d,
      medicationsNeedingAttention,
      latestAbnormalValues: abnormal,
      openAlerts: openAlerts.length,
      heartRateNote: hr ? hr.rationale : null,
      exerciseTarget: plan
        ? `${plan.targets.weeklyAerobicMinutes} min aerobic per week, ${plan.targets.strengthSessionsPerWeek} strength sessions, ${plan.targets.dailySteps.toLocaleString()} steps per day`
        : null,
    });

    // ---- Insight: missed doses next to a lab trend --------------------
    const trend = hba1cTrend(member.id);
    if (trend && trend.previous !== null) {
      const rising = trend.latest > trend.previous;
      if (rising && medicationsNeedingAttention.length > 0) {
        const single = medicationsNeedingAttention.length === 1;
        insights.push({
          memberId: member.id,
          memberName: member.name,
          kind: 'adherence',
          severity: 'warning',
          headline: `HbA1c rose from ${trend.previous}% to ${trend.latest}% while doses were being missed`,
          detail: `${medicationsNeedingAttention.join(' and ')} ${single ? 'was' : 'were'} taken less than 80% of the time over the last 14 days. The HbA1c in the ${trend.latestDate} report is higher than the previous reading. The timing lines up, and it is the kind of link that is easy to miss when the two records sit in different places.`,
          action: 'Review the dosing schedule with the prescriber and set a reminder for the missed doses.',
        });
        questions.push(
          `For ${member.name}: given the missed doses and the change in HbA1c from ${trend.previous}% to ${trend.latest}%, would you adjust the regimen or the schedule?`
        );
      } else if (!rising && adherenceRate14d !== null && adherenceRate14d >= 90) {
        insights.push({
          memberId: member.id,
          memberName: member.name,
          kind: 'adherence',
          severity: 'info',
          headline: `Adherence at ${adherenceRate14d}% and HbA1c improved to ${trend.latest}%`,
          detail: `Doses are being taken consistently and the latest HbA1c of ${trend.latest}% is better than the previous ${trend.previous}%.`,
        });
      }
    }

    // ---- Insight: abnormal values -------------------------------------
    for (const value of abnormal.slice(0, 2)) {
      insights.push({
        memberId: member.id,
        memberName: member.name,
        kind: 'labs',
        severity: 'warning',
        headline: `${value.test} was ${value.result} on ${value.date}`,
        detail: `That reading is flagged as "${value.status}" against the reference range in the stored report.`,
        action: 'Ask the doctor what the next step is and when to recheck.',
      });
      questions.push(
        `For ${member.name}: what is the plan for the ${value.test} reading of ${value.result} from ${value.date}?`
      );
    }

    // ---- Insight: open alerts -----------------------------------------
    for (const alert of openAlerts) {
      insights.push({
        memberId: member.id,
        memberName: member.name,
        kind: 'alert',
        severity: alert.severity === 'critical' ? 'critical' : 'warning',
        headline: alert.title,
        detail: alert.message,
        action: 'Acknowledge the alert once you have checked on the person.',
      });
    }

    // ---- Insight: heart rate ------------------------------------------
    if (hr && (hr.classification === 'elevated' || hr.classification === 'critical')) {
      insights.push({
        memberId: member.id,
        memberName: member.name,
        kind: 'vitals',
        severity: hr.classification === 'critical' ? 'critical' : 'warning',
        headline: `Heart rate ${hr.latest} bpm against a baseline of ${hr.baseline} bpm`,
        detail: hr.rationale,
        action: 'Check in with them and repeat the reading after a few minutes of rest.',
      });
    }

    // ---- Insight: exercise plan --------------------------------------
    if (plan) {
      insights.push({
        memberId: member.id,
        memberName: member.name,
        kind: 'plan',
        severity: 'info',
        headline: `Activity target for this week`,
        detail: `${plan.targets.weeklyAerobicMinutes} minutes of aerobic activity, ${plan.targets.strengthSessionsPerWeek} resistance sessions and around ${plan.targets.dailySteps.toLocaleString()} steps a day. ${plan.basis[0] || ''}`.trim(),
        action: plan.safetyNotes[0],
      });
    }
  }

  const narrative = buildNarrative(userId, memberSummaries, insights);
  const sorted = insights.sort((a, b) => {
    const rank = { critical: 0, warning: 1, info: 2 };
    return rank[a.severity] - rank[b.severity];
  });

  return {
    userId,
    generatedAt: new Date().toISOString(),
    members: memberSummaries,
    insights: sorted,
    narrative,
    questionsForTheDoctor: questions.slice(0, 6),
    degraded: !isAiConfigured(),
  };
}

function buildNarrative(
  userId: string,
  members: BriefingMember[],
  insights: BriefingInsight[]
): string {
  const critical = insights.filter((i) => i.severity === 'critical');
  const warnings = insights.filter((i) => i.severity === 'warning');

  const lines: string[] = [];
  lines.push(
    `Here is where things stand today across ${members.length} ${members.length === 1 ? 'person' : 'people'} in your care.`
  );

  if (critical.length > 0) {
    lines.push(
      `${critical.length} ${critical.length === 1 ? 'item needs' : 'items need'} attention right away: ${critical
        .map((i) => i.headline)
        .join('; ')}.`
    );
  }

  if (warnings.length > 0) {
    lines.push(
      `There ${warnings.length === 1 ? 'is' : 'are'} ${warnings.length} thing${
        warnings.length === 1 ? '' : 's'
      } worth keeping an eye on: ${warnings.map((i) => i.headline).join('; ')}.`
    );
  }

  for (const member of members) {
    if (member.dosesScheduledToday > 0) {
      lines.push(
        `${member.memberName}: ${member.dosesTakenToday} of ${member.dosesScheduledToday} scheduled doses marked as taken today${
          member.dosesMissedToday > 0
            ? `, ${member.dosesMissedToday} missed`
            : member.dosesDueToday > member.dosesTakenToday
              ? `, ${member.dosesDueToday - member.dosesTakenToday} still due`
              : ''
        }.`
      );
    }
  }

  if (insights.length === 0) {
    lines.push('Nothing needs flagging today. Records are current and no alerts are open.');
  }

  return lines.join('\n\n');
}

/**
 * Optional AI narrative over the deterministic facts. The facts are
 * fixed; only the wording is generated, and it is told not to add
 * anything that is not in the facts.
 */
export async function buildAiBriefing(
  userId: string,
  briefing: DailyBriefing
): Promise<string> {
  if (!isAiConfigured()) return briefing.narrative;

  const prompt = `
Write a short, warm family health briefing from the structured facts below.

Rules:
- Use only the facts given. Do not add any medical claim, number or recommendation that is not in the facts.
- Do not diagnose. Do not suggest a dose change.
- Lead with anything urgent. Keep it to at most 6 short sentences.
- Plain language, no headings, no bullet characters.

FACTS:
${JSON.stringify({ members: briefing.members, insights: briefing.insights }, null, 2)}
`;

  try {
    const result = await generateJson<{ narrative: string }>({
      prompt,
      schema: {
        type: Type.OBJECT,
        properties: { narrative: { type: Type.STRING } },
        required: ['narrative'],
      },
      systemInstruction:
        'You write brief, factual family health updates. You never add clinical claims beyond the supplied facts.',
    });
    return result.data.narrative?.trim() || briefing.narrative;
  } catch {
    return briefing.narrative;
  }
}

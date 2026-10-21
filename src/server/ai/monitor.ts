import crypto from 'crypto';
import { pushToUser } from '../push';
import {
  alerts,
  caregivers,
  familyMembers,
  persistStateSafely,
  users,
  vitals,
} from '../store';
import { AlertLocation, HealthAlert, Vital, VitalType } from '../types';

// -------------------------------------------------------------
// Monitoring engine
//
// Owns two things:
//   1. Turning raw vitals into an alert when something looks wrong
//   2. Escalating an alert to the right people until someone reacts
//
// The alert lifecycle is deliberately confirmation-first: a detection
// creates an alert that the person can cancel, and only an
// unacknowledged alert escalates to caregivers. This is what keeps
// the feature usable instead of training people to ignore it.
// -------------------------------------------------------------

export const MONITOR_CONFIG = {
  /** Heart rate above this is treated as critical regardless of baseline. */
  criticalHighBpm: 150,
  criticalLowBpm: 40,
  /** Multiple of the personal baseline that counts as abnormal. */
  highRatio: 1.5,
  lowRatio: 0.6,
  /** Minimum absolute resting heart rate that counts as abnormal. */
  minAbnormalBpm: 100,
  /** A reading must be sustained across at least this many samples. */
  sustainedSamples: 2,
  /** Window in which samples are considered part of the same episode. */
  sustainedWindowMinutes: 15,
  /** Baseline window used to compute the personal resting heart rate. */
  baselineDays: 7,
  /** Steps in this window that explain an elevated heart rate. */
  exerciseStepsThreshold: 400,
  exerciseWindowMinutes: 30,
  /** Do not raise a duplicate heart-rate alert within this window. */
  duplicateWindowMinutes: 30,
  /** Escalate to caregivers after this many minutes unacknowledged. */
  escalateToCaregiverMinutes: 1,
  /** Escalate to SMS after this many minutes unacknowledged. */
  escalateToSmsMinutes: 4,
  /** Mark as a failed escalation after this many minutes. */
  failSafeMinutes: 10,
};

export interface AlertCreateInput {
  userId: string;
  memberId: string;
  type: HealthAlert['type'];
  severity: HealthAlert['severity'];
  title: string;
  message: string;
  snapshot?: Record<string, unknown>;
  location?: AlertLocation;
  /** Skip the first caregiver notification (used by the scheduler). */
  skipImmediateEscalation?: boolean;
}

export function caregiversForMember(memberId: string) {
  return caregivers.filter((c) => c.memberId === memberId);
}

export function createAlert(input: AlertCreateInput): HealthAlert {
  const member = familyMembers.find((f) => f.id === input.memberId);
  const alert: HealthAlert = {
    id: `alert-${crypto.randomUUID()}`,
    userId: input.userId,
    memberId: input.memberId,
    memberName: member?.name || 'Family member',
    type: input.type,
    severity: input.severity,
    title: input.title,
    message: input.message,
    status: 'open',
    detectedAt: new Date().toISOString(),
    snapshot: input.snapshot || {},
    escalation: [],
    ...(input.location ? { location: input.location } : {}),
  };

  alerts.unshift(alert);

  // Level 0 always goes to the account owner so the timeline is complete.
  alert.escalation.push({
    level: 0,
    at: new Date().toISOString(),
    channel: 'in_app',
    recipient: 'account owner',
    delivered: true,
    note: 'Alert created and recorded in the notification inbox.',
  });

  if (!input.skipImmediateEscalation) {
    void escalateToCaregivers(alert, 1);
  }

  return alert;
}

/**
 * Notify the caregivers linked to the member. Falls back to the account
 * owner when nobody is linked, so an alert is never silently dropped.
 */
export async function escalateToCaregivers(
  alert: HealthAlert,
  level: number,
  note?: string
): Promise<void> {
  const links = caregiversForMember(alert.memberId);
  const recipients = links.length
    ? links
    : [
        {
          id: 'fallback-owner',
          userId: alert.userId,
          memberId: alert.memberId,
          caregiverName: users.find((u) => u.id === alert.userId)?.name || 'Account owner',
          relation: 'Owner',
          permission: 'manage' as const,
          channels: ['push' as const, 'sms' as const],
          createdAt: new Date().toISOString(),
        },
      ];

  for (const link of recipients) {
    for (const channel of link.channels) {
      if (channel === 'sms') {
        // SMS needs a gateway provider; recorded as an attempted escalation.
        alert.escalation.push({
          level,
          at: new Date().toISOString(),
          channel: 'sms',
          recipient: link.caregiverName,
          delivered: false,
          note: note || 'SMS escalation queued (no SMS gateway configured in this environment).',
        });
        continue;
      }

      const results = await pushToUser(
        { userId: link.userId, phone: link.caregiverPhone, email: link.caregiverEmail },
        {
          title: alert.title,
          body: alert.message,
          type: 'alert',
          priority: alert.severity === 'critical' ? 'high' : 'medium',
          data: { alertId: alert.id, memberId: alert.memberId, type: alert.type },
        }
      );

      alert.escalation.push({
        level,
        at: new Date().toISOString(),
        channel,
        recipient: link.caregiverName,
        delivered: results.some((r) => r.delivered),
        note: note || 'Caregiver notified.',
      });
    }
  }

  await persistStateSafely();
}

// -------------------------------------------------------------
// Heart rate analysis
// -------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export interface HeartRateAnalysis {
  baseline: number;
  latest: number;
  latestAt: string;
  samplesInWindow: number;
  sustained: boolean;
  likelyExercise: boolean;
  stepsLast30Min: number;
  classification: 'normal' | 'elevated' | 'critical' | 'bradycardia';
  rationale: string;
}

export function analyzeHeartRate(memberId: string, now = new Date()): HeartRateAnalysis | null {
  const nowTime = now.getTime();
  // Readings dated in the future are ignored: they cannot inform a
  // decision taken now.
  const memberVitals = vitals.filter(
    (v) =>
      v.memberId === memberId &&
      v.type === 'heart_rate' &&
      new Date(v.measuredAt).getTime() <= nowTime
  );
  if (memberVitals.length === 0) return null;

  const sorted = [...memberVitals].sort(
    (a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime()
  );
  const latest = sorted[sorted.length - 1];
  const latestTime = new Date(latest.measuredAt).getTime();

  // Ignore readings that are stale.
  if (nowTime - latestTime > 6 * 60 * 60 * 1000) return null;

  const baselineStart = nowTime - MONITOR_CONFIG.baselineDays * 86400000;
  const restingForBaseline = memberVitals.filter(
    (v) =>
      new Date(v.measuredAt).getTime() >= baselineStart &&
      new Date(v.measuredAt).getTime() < latestTime &&
      (!v.context || v.context === 'resting' || v.context === 'sleep')
  );
  const baselinePool = (restingForBaseline.length >= 3 ? restingForBaseline : memberVitals).map(
    (v) => v.value
  );
  const baseline = Math.round(median(baselinePool)) || 70;

  // Samples inside the sustained window, ending at the latest reading.
  const windowStart = latestTime - MONITOR_CONFIG.sustainedWindowMinutes * 60000;
  const windowSamples = memberVitals.filter(
    (v) => {
      const t = new Date(v.measuredAt).getTime();
      return t >= windowStart && t <= latestTime;
    }
  );

  const abnormalSamples = windowSamples.filter(
    (v) => v.value > baseline * MONITOR_CONFIG.highRatio && v.value >= MONITOR_CONFIG.minAbnormalBpm
  );
  const lowSamples = windowSamples.filter(
    (v) => v.value < baseline * MONITOR_CONFIG.lowRatio || v.value < MONITOR_CONFIG.criticalLowBpm
  );

  const stepsLast30Min = vitals
    .filter(
      (v) =>
        v.memberId === memberId &&
        v.type === 'steps' &&
        nowTime - new Date(v.measuredAt).getTime() <= MONITOR_CONFIG.exerciseWindowMinutes * 60000
    )
    .reduce((max, v) => Math.max(max, v.value), 0);
  const likelyExercise = stepsLast30Min >= MONITOR_CONFIG.exerciseStepsThreshold;

  const isCritical =
    latest.value >= MONITOR_CONFIG.criticalHighBpm || latest.value <= MONITOR_CONFIG.criticalLowBpm;
  const sustained = isCritical
    ? true
    : abnormalSamples.length >= MONITOR_CONFIG.sustainedSamples ||
      lowSamples.length >= MONITOR_CONFIG.sustainedSamples;

  let classification: HeartRateAnalysis['classification'] = 'normal';
  let rationale = `Heart rate ${latest.value} bpm sits inside the expected range for a personal baseline of ${baseline} bpm.`;

  if (isCritical && latest.value >= MONITOR_CONFIG.criticalHighBpm) {
    classification = 'critical';
    rationale = `Heart rate ${latest.value} bpm is above the critical threshold of ${MONITOR_CONFIG.criticalHighBpm} bpm.`;
  } else if (isCritical) {
    classification = 'bradycardia';
    rationale = `Heart rate ${latest.value} bpm is at or below the critical low threshold of ${MONITOR_CONFIG.criticalLowBpm} bpm.`;
  } else if (abnormalSamples.length >= MONITOR_CONFIG.sustainedSamples) {
    classification = 'elevated';
    rationale = `Heart rate has been ${latest.value} bpm across ${abnormalSamples.length} readings, well above the personal baseline of ${baseline} bpm.`;
  } else if (lowSamples.length >= MONITOR_CONFIG.sustainedSamples) {
    classification = 'bradycardia';
    rationale = `Heart rate ${latest.value} bpm is below the personal baseline of ${baseline} bpm and stayed low across ${lowSamples.length} readings.`;
  } else if (latest.value > baseline * MONITOR_CONFIG.highRatio) {
    classification = 'elevated';
    rationale = `Heart rate ${latest.value} bpm is above the personal baseline of ${baseline} bpm but has not been sustained long enough to raise an alert.`;
  }

  return {
    baseline,
    latest: latest.value,
    latestAt: latest.measuredAt,
    samplesInWindow: windowSamples.length,
    sustained,
    likelyExercise,
    stepsLast30Min,
    classification,
    rationale,
  };
}

/**
 * Evaluate a member after a new vital arrives and raise an alert when
 * the reading warrants it.
 */
export async function evaluateVitalsAndAlert(
  userId: string,
  memberId: string,
  justRecorded: Vital
): Promise<HealthAlert | null> {
  if (justRecorded.type !== 'heart_rate') return null;

  const member = familyMembers.find((f) => f.id === memberId && f.userId === userId);
  if (!member) return null;

  const analysis = analyzeHeartRate(memberId);
  if (!analysis) return null;

  if (analysis.classification === 'normal') return null;
  if (analysis.classification === 'elevated' && !analysis.sustained) return null;

  // Exercise explains most transient elevations; do not raise an alarm.
  if (analysis.likelyExercise && analysis.classification === 'elevated') return null;

  // Deduplicate against a recent open alert of the same type.
  const nowTime = Date.now();
  const recentDuplicate = alerts.find(
    (a) =>
      a.memberId === memberId &&
      a.type === 'heart_rate' &&
      a.status === 'open' &&
      nowTime - new Date(a.detectedAt).getTime() <= MONITOR_CONFIG.duplicateWindowMinutes * 60000
  );
  if (recentDuplicate) {
    recentDuplicate.snapshot = {
      ...recentDuplicate.snapshot,
      latestBpm: analysis.latest,
      baselineBpm: analysis.baseline,
      readingsInWindow: analysis.samplesInWindow,
    };
    recentDuplicate.message = `${member.name}: heart rate is ${analysis.latest} bpm against a baseline of ${analysis.baseline} bpm. ${analysis.rationale}`;
    await persistStateSafely();
    return recentDuplicate;
  }

  const severity: HealthAlert['severity'] =
    analysis.classification === 'critical' || analysis.classification === 'bradycardia'
      ? 'critical'
      : 'warning';

  const alert = createAlert({
    userId,
    memberId,
    type: 'heart_rate',
    severity,
    title:
      severity === 'critical'
        ? `Critical heart rate alert for ${member.name}`
        : `Elevated heart rate for ${member.name}`,
    message: `${member.name}: heart rate is ${analysis.latest} bpm against a baseline of ${analysis.baseline} bpm. ${analysis.rationale} Please check in with them.`,
    snapshot: {
      latestBpm: analysis.latest,
      baselineBpm: analysis.baseline,
      readingsInWindow: analysis.samplesInWindow,
      sustained: analysis.sustained,
      stepsLast30Min: analysis.stepsLast30Min,
      classification: analysis.classification,
      source: justRecorded.source,
    },
  });

  await persistStateSafely();
  return alert;
}

// -------------------------------------------------------------
// Fall events
// -------------------------------------------------------------

export interface FallEventInput {
  userId: string;
  memberId: string;
  location?: { lat: number; lng: number; accuracyM?: number; label?: string };
  /** Raw sensor trace from the watch, kept for context. */
  sensorTrace?: Record<string, unknown>;
  /** True when the device is confident this was a hard fall. */
  confidence?: 'high' | 'medium' | 'low';
  source?: string;
}

/**
 * Register a fall detection event. Falls are always treated as
 * critical and escalate to caregivers immediately.
 */
export async function handleFallEvent(input: FallEventInput): Promise<HealthAlert> {
  const member = familyMembers.find((f) => f.id === input.memberId && f.userId === input.userId);
  const memberName = member?.name || 'Family member';

  const location: AlertLocation | undefined = input.location
    ? {
        lat: input.location.lat,
        lng: input.location.lng,
        accuracyM: input.location.accuracyM,
        label: input.location.label,
        capturedAt: new Date().toISOString(),
      }
    : undefined;

  const message = location
    ? `A possible fall was detected for ${memberName}. Last known location: ${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}${
        location.label ? ` (${location.label})` : ''
      }. Check on them right now.`
    : `A possible fall was detected for ${memberName}. Location sharing is not enabled, so no position is available. Check on them right now.`;

  const alert = createAlert({
    userId: input.userId,
    memberId: input.memberId,
    type: 'fall',
    severity: 'critical',
    title: `Possible fall detected for ${memberName}`,
    message,
    snapshot: {
      confidence: input.confidence || 'medium',
      source: input.source || 'wearable',
      sensorTrace: input.sensorTrace || null,
    },
    ...(location ? { location } : {}),
  });

  await persistStateSafely();
  return alert;
}

// -------------------------------------------------------------
// Escalation sweep (called by the scheduler)
// -------------------------------------------------------------

export async function processEscalations(): Promise<number> {
  let escalated = 0;
  const now = Date.now();

  for (const alert of alerts) {
    if (alert.status !== 'open') continue;
    const openSince = new Date(alert.detectedAt).getTime();
    const openMinutes = (now - openSince) / 60000;
    const levels = new Set(alert.escalation.map((e) => e.level));

    if (
      openMinutes >= MONITOR_CONFIG.escalateToSmsMinutes &&
      !levels.has(2) &&
      alert.severity === 'critical'
    ) {
      await escalateToCaregivers(
        alert,
        2,
        'No acknowledgement after the initial alert. Escalating to SMS.'
      );
      escalated++;
      continue;
    }

    if (
      openMinutes >= MONITOR_CONFIG.escalateToCaregiverMinutes &&
      !levels.has(1)
    ) {
      await escalateToCaregivers(alert, 1, 'Initial caregiver notification.');
      escalated++;
      continue;
    }

    if (openMinutes >= MONITOR_CONFIG.failSafeMinutes && !levels.has(3)) {
      alert.escalation.push({
        level: 3,
        at: new Date().toISOString(),
        channel: 'in_app',
        recipient: 'account owner',
        delivered: true,
        note:
          'No acknowledgement received. If this is a genuine emergency, contact local emergency services now.',
      });
      await pushToUser(
        { userId: alert.userId },
        {
          title: `Unacknowledged ${alert.type} alert for ${alert.memberName}`,
          body: 'This alert has not been acknowledged. If you are unable to reach the person, contact local emergency services.',
          type: 'alert',
          priority: 'high',
          data: { alertId: alert.id },
        }
      );
      escalated++;
    }
  }

  return escalated;
}

export function acknowledgeAlert(
  userId: string,
  alertId: string,
  acknowledgedBy: string
): HealthAlert | null {
  const alert = alerts.find((a) => a.id === alertId && a.userId === userId);
  if (!alert) return null;
  if (alert.status === 'resolved' || alert.status === 'cancelled') return alert;
  alert.status = 'acknowledged';
  alert.acknowledgedAt = new Date().toISOString();
  alert.acknowledgedBy = acknowledgedBy;
  alert.escalation.push({
    level: 0,
    at: new Date().toISOString(),
    channel: 'in_app',
    recipient: acknowledgedBy,
    delivered: true,
    note: 'Alert acknowledged. Escalation stopped.',
  });
  return alert;
}

export function resolveAlert(
  userId: string,
  alertId: string,
  note?: string
): HealthAlert | null {
  const alert = alerts.find((a) => a.id === alertId && a.userId === userId);
  if (!alert) return null;
  alert.status = 'resolved';
  alert.resolvedAt = new Date().toISOString();
  alert.resolutionNote = note || 'Resolved by the account owner.';
  alert.escalation.push({
    level: 0,
    at: new Date().toISOString(),
    channel: 'in_app',
    recipient: 'account owner',
    delivered: true,
    note: alert.resolutionNote,
  });
  return alert;
}

export const VITAL_UNITS: Record<VitalType, string> = {
  heart_rate: 'bpm',
  steps: 'steps',
  spo2: '%',
  blood_pressure: 'mmHg',
  sleep_hours: 'hours',
  weight: 'kg',
  temperature: '°C',
};

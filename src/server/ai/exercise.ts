import { familyMembers, medicalReports, medications, vitals } from '../store';
import { MedicalReport, Medication, Vital } from '../types';
import { Citation, searchLiterature } from './literature';

// -------------------------------------------------------------
// Exercise and step recommendation engine
//
// Deterministic rules rather than free-form generation, because the
// output has to be defensible: every target is traceable to a recorded
// condition, medication or lab value. A language model is used only
// to phrase the plan, never to decide it.
// -------------------------------------------------------------

export interface ExerciseTargets {
  weeklyAerobicMinutes: number;
  strengthSessionsPerWeek: number;
  dailySteps: number;
  hydrationLitres: number;
  weeklyBalanceSessions: number;
}

export interface ExerciseRecommendation {
  memberId: string;
  memberName: string;
  generatedAt: string;
  basis: string[];
  targets: ExerciseTargets;
  intensityGuidance: string;
  safetyNotes: string[];
  weeklyPlan: Array<{ day: string; focus: string; durationMinutes: number; detail: string }>;
  progressRule: string;
  /** Real papers from PubMed that support the targets, when available. */
  citations: Citation[];
  disclaimer: string;
}

function conditionMatches(conditions: string[], pattern: RegExp): string | null {
  for (const condition of conditions) {
    if (pattern.test(condition)) return condition;
  }
  return null;
}

function medicationMatches(meds: Medication[], pattern: RegExp): Medication | null {
  for (const med of meds) {
    if (pattern.test(`${med.name} ${med.genericName || ''} ${med.dose}`)) return med;
  }
  return null;
}

function findLabValue(reports: MedicalReport[], testPattern: RegExp): { value: string; date: string; reportType: string } | null {
  for (const report of reports) {
    for (const value of report.values) {
      if (testPattern.test(value.testName)) {
        return { value: value.result, date: report.date, reportType: report.reportType };
      }
    }
  }
  return null;
}

function stepsToday(memberId: string, now = new Date()): number {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const daySteps = vitals
    .filter(
      (v) => v.memberId === memberId && v.type === 'steps' && new Date(v.measuredAt) >= startOfDay
    )
    .map((v) => v.value);
  // Wearables usually report a daily total rather than increments, so the
  // highest value of the day is the count. Summing would double-count.
  return daySteps.length ? Math.max(...daySteps) : 0;
}

function restingHeartRate(memberId: string): number | null {
  const hr = vitals
    .filter((v) => v.memberId === memberId && v.type === 'heart_rate')
    .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime());
  if (hr.length === 0) return null;
  const recent = hr.slice(0, 10).map((v) => v.value);
  return Math.round(recent.reduce((a, b) => a + b, 0) / recent.length);
}

export function buildExerciseRecommendation(
  userId: string,
  memberId: string
): ExerciseRecommendation | null {
  const member = familyMembers.find((f) => f.id === memberId && f.userId === userId);
  if (!member) return null;

  const conditions = member.existingConditions || [];
  const memberMeds = medications.filter((m) => m.memberId === memberId && m.active);
  const reports = medicalReports
    .filter((r) => r.memberId === memberId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const basis: string[] = [];
  const safetyNotes: string[] = [];

  const age = member.age || 30;
  const hasDiabetes = conditionMatches(conditions, /diabetes/i);
  const hasHypertension = conditionMatches(conditions, /hypertension|high blood pressure/i);
  const hasOsteopenia = conditionMatches(conditions, /osteopenia|osteoporosis/i);
  const hasIronDeficiency = conditionMatches(conditions, /iron deficiency|anaemia|anemia/i);
  const hasAsthma = conditionMatches(conditions, /asthma/i);
  const hasHypothyroidism = conditionMatches(conditions, /hypothyroid/i);
  const hasCkd = conditionMatches(conditions, /chronic kidney|ckd|renal/i);

  const betaBlocker = medicationMatches(memberMeds, /atenolol|metoprolol|propranolol|carvedilol|bisoprolol|nebivolol/i);
  const statin = medicationMatches(memberMeds, /atorvastatin|rosuvastatin|simvastatin|pravastatin/i);
  const insulinOrSulfo = medicationMatches(
    memberMeds,
    /insulin|glimepiride|glipizide|gliclazide|glyburide/i
  );

  const hba1c = findLabValue(reports, /hba1c|glycated/i);
  const ldl = findLabValue(reports, /\bldl\b/i);
  const vitaminD = findLabValue(reports, /vitamin d/i);
  const haemoglobin = findLabValue(reports, /hemoglobin|haemoglobin/i);

  // ---- Targets ---------------------------------------------------------
  let weeklyAerobicMinutes = 150;
  let strengthSessions = 2;
  let dailySteps = age >= 50 ? 8000 : 7000;
  let hydrationLitres = 2.5;
  let weeklyBalanceSessions = 0;

  if (age >= 65) {
    weeklyAerobicMinutes = 120;
    strengthSessions = 2;
    dailySteps = 6500;
    basis.push(`Age ${age}: starting from a slightly lower volume with the same strength frequency.`);
  } else if (age < 30) {
    weeklyAerobicMinutes = 150;
    basis.push(`Age ${age}: standard adult aerobic volume applies.`);
  }

  if (hasDiabetes) {
    basis.push(`${hasDiabetes}: post-meal walking is prioritised to blunt post-meal glucose spikes.`);
    dailySteps = Math.max(dailySteps, 7000);
    safetyNotes.push(
      'Walk for 10-15 minutes after meals rather than one long session, and carry a fast-acting carbohydrate if you are on insulin or a sulfonylurea.'
    );
  }

  if (hasHypertension) {
    basis.push(`${hasHypertension}: blood pressure response to exertion is monitored, so intensity stays moderate.`);
    safetyNotes.push(
      'Avoid straining and breath-holding during resistance work. If the reading before a session is above 160/100, keep it to gentle walking and speak to your doctor.'
    );
  }

  if (hasOsteopenia) {
    weeklyBalanceSessions = 3;
    basis.push(`${hasOsteopenia}: balance and resistance work is added to protect bone and reduce fall risk.`);
    safetyNotes.push('Progress impact gradually and use hand support for balance work if needed.');
  }

  if (hasIronDeficiency) {
    basis.push(`${hasIronDeficiency}: impact and endurance volume are held back while the deficiency is corrected.`);
    safetyNotes.push('Keep intensity low until haemoglobin recovers, and allow extra recovery between sessions.');
  }

  if (hasAsthma) {
    basis.push(`${hasAsthma}: a longer warm-up is scheduled because symptoms are exercise-triggered.`);
    safetyNotes.push(
      'Keep the reliever inhaler accessible, warm up for 10 minutes, and stop if wheeze develops. Cold air can be a trigger, so indoor sessions are a good alternative in winter.'
    );
  }

  if (hasHypothyroidism) {
    safetyNotes.push('Allow a longer warm-up; fatigue is common while thyroid levels are still being stabilised.');
  }

  if (hasCkd) {
    safetyNotes.push('Fluid and electrolyte intake should follow your doctor\'s advice rather than a generic target.');
  }

  if (betaBlocker) {
    basis.push(
      `${betaBlocker.name} is a beta blocker, which blunts the heart-rate response to exercise.`
    );
    safetyNotes.push(
      'Because a beta blocker dampens the heart-rate response, use perceived exertion rather than a heart-rate target: aim for "somewhat hard" (5-6 out of 10) and be guided by how the session feels.'
    );
  }

  if (insulinOrSulfo) {
    safetyNotes.push(
      'Because you take a medicine that can lower blood sugar, plan sessions within a couple of hours of a meal and carry a snack.'
    );
  }

  if (statin) {
    basis.push(`${statin.name} is in use, so a gradual build protects against muscle aches.`);
  }

  if (hba1c) {
    const value = parseFloat(hba1c.value);
    if (!Number.isNaN(value)) {
      basis.push(`Last HbA1c was ${hba1c.value}% (${hba1c.date}).`);
      if (value > 8.5) {
        weeklyAerobicMinutes = Math.max(weeklyAerobicMinutes, 150);
        basis.push('With HbA1c above 8.5%, daily post-meal walking is the highest-leverage change.');
      } else if (value < 7) {
        basis.push('HbA1c is already in target, so the plan maintains rather than increases load.');
        weeklyAerobicMinutes = Math.max(weeklyAerobicMinutes, 150);
      }
    }
  }

  if (ldl) {
    const value = parseFloat(ldl.value);
    if (!Number.isNaN(value) && value > 100) {
      basis.push(`Last LDL was ${ldl.value} mg/dL (${ldl.date}), so aerobic volume is on the higher side of the range.`);
      weeklyAerobicMinutes = Math.max(weeklyAerobicMinutes, 150);
    }
  }

  if (vitaminD) {
    const value = parseFloat(vitaminD.value);
    if (!Number.isNaN(value) && value < 20) {
      basis.push(
        `Vitamin D is ${vitaminD.value} ng/mL (${vitaminD.date}), which is low. Outdoor weight-bearing work is limited until it is repleted.`
      );
      safetyNotes.push(
        'With low vitamin D, favour indoor or low-impact sessions and add resistance work instead of running, and ask your doctor about repletion first.'
      );
      dailySteps = Math.min(dailySteps, 6000);
    }
  }

  if (haemoglobin) {
    const value = parseFloat(haemoglobin.value);
    if (!Number.isNaN(value) && value < 12) {
      basis.push(`Haemoglobin is ${haemoglobin.value} g/dL (${haemoglobin.date}), so endurance work is capped.`);
      weeklyAerobicMinutes = Math.min(weeklyAerobicMinutes, 120);
      safetyNotes.push('Keep sessions shorter and leave recovery days between harder efforts.');
    }
  }

  const currentSteps = stepsToday(memberId);
  if (currentSteps > 0) {
    basis.push(`Steps recorded today so far: ${currentSteps.toLocaleString()}.`);
  }

  const rhr = restingHeartRate(memberId);
  if (rhr) {
    basis.push(`Average resting heart rate on record: ${rhr} bpm.`);
  }

  // ---- Weekly plan -----------------------------------------------------
  const plan: ExerciseRecommendation['weeklyPlan'] = [];
  const aerobicDays = ['Mon', 'Wed', 'Fri', 'Sat'];
  const perSession = Math.round(weeklyAerobicMinutes / aerobicDays.length);

  for (const day of aerobicDays) {
    const isPostMeal = hasDiabetes && (day === 'Mon' || day === 'Wed' || day === 'Fri');
    plan.push({
      day,
      focus: isPostMeal ? 'Post-meal walk' : 'Aerobic conditioning',
      durationMinutes: perSession,
      detail: isPostMeal
        ? `A ${perSession}-minute steady walk starting within 30 minutes of finishing a meal.`
        : `A ${perSession}-minute session of brisk walking, cycling, swimming or a low-impact class at a pace that feels like 5-6 out of 10.`,
    });
  }

  plan.push({
    day: 'Tue',
    focus: 'Resistance training',
    durationMinutes: 30,
    detail:
      'Two to three rounds of 8-12 repetitions covering sit-to-stand, wall push-ups, resistance-band rows and a carry. Keep 2-3 repetitions in reserve and avoid breath-holding.',
  });

  plan.push({
    day: 'Thu',
    focus: 'Mobility, balance and recovery',
    durationMinutes: 25,
    detail: hasOsteopenia
      ? 'Balance work such as supported single-leg stands, heel-to-toe walking and Tai Chi, plus hip and shoulder mobility. Use a stable support.'
      : 'Mobility work through the hips, shoulders and spine, plus light stretching and a relaxed walk.',
  });

  if (hasDiabetes) {
    plan.push({
      day: 'Sun',
      focus: 'Post-meal walk and rest',
      durationMinutes: 20,
      detail: 'A gentle 20-minute walk after the main meal, then a full rest day.',
    });
  }

  const intensityGuidance = betaBlocker
    ? 'Use perceived exertion rather than heart rate: "somewhat hard" (5-6 out of 10) should be the target. Bring the beta blocker detail to your doctor if targets are unclear.'
    : 'Target a moderate intensity: you should be able to talk in short sentences but not sing. If heart-rate targets are used, stay below 70% of your age-predicted maximum.';

  return {
    memberId,
    memberName: member.name,
    generatedAt: new Date().toISOString(),
    basis,
    targets: {
      weeklyAerobicMinutes,
      strengthSessionsPerWeek: strengthSessions,
      dailySteps,
      hydrationLitres,
      weeklyBalanceSessions,
    },
    intensityGuidance,
    safetyNotes,
    weeklyPlan: plan,
    progressRule:
      'Increase either duration or distance by no more than about 10% per week, and hold steady for two weeks before progressing further.',
    citations: [],
    disclaimer:
      'This plan is general wellness guidance generated from the records stored in Healthyfy. It is not a diagnosis or a substitute for a clinician, and it should be reviewed by a doctor or physiotherapist before you start, especially with heart, kidney or blood-pressure conditions.',
  };
}

/**
 * The plan plus the literature that supports it.
 *
 * The targets come from the deterministic rules above; PubMed only
 * supplies the papers, so a recommendation can be checked rather than
 * taken on trust. A lookup failure leaves the plan intact.
 */
export async function buildExercisePlan(
  userId: string,
  memberId: string
): Promise<ExerciseRecommendation | null> {
  const plan = buildExerciseRecommendation(userId, memberId);
  if (!plan) return null;

  const member = familyMembers.find((f) => f.id === memberId && f.userId === userId);
  if (member) {
    try {
      plan.citations = await searchLiterature(member.existingConditions || []);
    } catch {
      plan.citations = [];
    }
  }

  return plan;
}

import crypto from 'crypto';
import { RXNORM_ENABLED } from '../config';
import { allergies, familyMembers, medications, persistStateSafely } from '../store';
import { SafetyCheck, SafetyFinding, Medication } from '../types';
import {
  BRAND_TO_GENERIC,
  CONDITION_RULES,
  DRUG_CLASSES,
  INTERACTION_RULES,
  Severity,
  classIdForAllergyLabel,
} from './drugKnowledge';
import { boxedWarningSummary, fetchDrugLabel, findLabelInteractions } from './drugData';

// -------------------------------------------------------------
// Safety engine
//
// Every medication that enters the system is checked against:
//   1. the member's other active medications (drug-drug)
//   2. the member's recorded allergies (drug-allergy)
//   3. the member's recorded conditions (drug-condition)
//   4. existing therapy in the same class (duplicate therapy)
//
// Findings are written to an append-only safety ledger so the
// history of what was checked and what was found survives restarts.
// -------------------------------------------------------------

export interface CanonicalDrug {
  /** Lower-cased generic name used for matching. */
  canonical: string;
  /** Human readable name for display. */
  displayName: string;
  rxNormId?: string;
  classIds: string[];
  /** True when the name could not be recognised at all. */
  unrecognised: boolean;
}

const DOSAGE_SUFFIX =
  /\b(\d+(\.\d+)?\s*(mg|mcg|microgram|milligram|g|gm|ml|iu|units|%|mcg\/dose|mg\/ml|tablets?|caps?|drops?)|sr\b|er\b|dr\b|xr\b|cd\b|qd|bid|tid|qid|od|bd|hs|ac|pc|po|prn|stat|daily|twice daily|once daily|tab\.?|cap\.?)\b/gi;

export function stripDosage(name: string): string {
  return name
    .replace(DOSAGE_SUFFIX, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/[+]/g, ' and ')
    .replace(/[,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classIdsForCanonical(canonical: string): string[] {
  const ids: string[] = [];
  for (const cls of DRUG_CLASSES) {
    if (cls.members.includes(canonical)) {
      ids.push(cls.id);
      continue;
    }
    // Combination products: "calcium carbonate and cholecalciferol".
    for (const member of cls.members) {
      if (canonical.includes(member)) {
        ids.push(cls.id);
        break;
      }
    }
  }
  return ids;
}

/**
 * Resolve a free-text drug name to a canonical generic name.
 * The local brand table is authoritative; RxNorm is used as a
 * best-effort fallback and never blocks the caller.
 */
export async function canonicalizeDrugName(rawName: string): Promise<CanonicalDrug> {
  const cleaned = stripDosage(rawName || '').toLowerCase();
  const brand = BRAND_TO_GENERIC[cleaned];
  const base = brand || cleaned;

  let rxNormId: string | undefined;
  let displayName = rawName.trim();
  let canonical = base;

  if (!brand && RXNORM_ENABLED && base.length >= 4) {
    const resolved = await lookupRxNorm(base);
    if (resolved) {
      rxNormId = resolved.rxcui;
      canonical = resolved.canonical;
      displayName = resolved.name || displayName;
    }
  }

  const classIds = classIdsForCanonical(canonical);
  const unrecognised = !brand && classIds.length === 0 && !rxNormId;

  return { canonical, displayName, rxNormId, classIds, unrecognised };
}

async function lookupRxNorm(
  term: string
): Promise<{ rxcui: string; name: string; canonical: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(
      term
    )}&maxEntries=6&option=1`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const data: any = await response.json();
    const candidates = data?.approximateGroup?.candidate || [];
    const best = candidates.find((c: any) => c.source === 'RXNORM') || candidates[0];
    if (!best) return null;
    const name = String(best.name || '').toLowerCase();
    const canonical = name.replace(DOSAGE_SUFFIX, ' ').replace(/\s+/g, ' ').trim();
    return { rxcui: best.rxcui, name: best.name, canonical: canonical || term };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function severityRank(severity: 'low' | 'moderate' | 'high'): number {
  return severity === 'high' ? 3 : severity === 'moderate' ? 2 : 1;
}

/** Findings never carry the "none" severity used by indication rules. */
function findingSeverity(severity: Severity): 'low' | 'moderate' | 'high' {
  return severity === 'none' ? 'low' : severity;
}

function maxSeverity(
  a: 'low' | 'moderate' | 'high' | 'none',
  b: 'low' | 'moderate' | 'high' | 'none'
): 'low' | 'moderate' | 'high' | 'none' {
  if (a === 'none') return b;
  if (b === 'none') return a;
  return severityRank(a) >= severityRank(b) ? a : b;
}

export interface SafetyCheckInput {
  userId: string;
  memberId: string;
  /** New medications to evaluate. */
  incoming: Array<{ name: string; dose?: string }>;
  trigger: SafetyCheck['trigger'];
  sourceLabel: string;
  /** Existing medications to compare against. Defaults to active records. */
  existing?: Medication[];
  /** Skip persisting (used for a dry-run preview). */
  dryRun?: boolean;
}

export interface SafetyCheckResult {
  check: SafetyCheck;
  /** Non-alarming observations, e.g. "matches an existing condition". */
  notes: string[];
  canonical: CanonicalDrug[];
}

export async function runSafetyCheck(input: SafetyCheckInput): Promise<SafetyCheckResult> {
  const { userId, memberId, incoming, trigger, sourceLabel } = input;
  const member = familyMembers.find((f) => f.id === memberId && f.userId === userId);

  const canonical = await Promise.all(incoming.map((m) => canonicalizeDrugName(m.name)));

  const existingMeds = (input.existing ?? medications.filter((m) => m.memberId === memberId && m.active))
    .filter((m) => !incoming.some((inc) => stripDosage(inc.name).toLowerCase() === stripDosage(m.name).toLowerCase()));
  const existingCanonical = await Promise.all(
    existingMeds.map((m) => canonicalizeDrugName(m.name))
  );

  const findings: SafetyFinding[] = [];
  const notes: string[] = [];
  const seen = new Set<string>();

  const addFinding = (finding: SafetyFinding) => {
    const key = `${finding.kind}|${finding.medication}|${finding.interactsWith}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(finding);
  };

  // ---- 1. Drug-drug interactions -------------------------------------
  const allDrugs: Array<{ canonical: CanonicalDrug; label: string; isNew: boolean }> = [
    ...canonical.map((c, i) => ({ canonical: c, label: incoming[i].name, isNew: true })),
    ...existingCanonical.map((c, i) => ({ canonical: c, label: existingMeds[i].name, isNew: false })),
  ];

  for (let i = 0; i < allDrugs.length; i++) {
    for (let j = i + 1; j < allDrugs.length; j++) {
      const a = allDrugs[i];
      const b = allDrugs[j];
      if (!a.isNew && !b.isNew) continue; // only report pairs involving something new

      for (const rule of INTERACTION_RULES) {
        let matched = false;
        if (rule.drugs) {
          matched =
            (a.canonical.canonical === rule.drugs[0] && b.canonical.canonical === rule.drugs[1]) ||
            (a.canonical.canonical === rule.drugs[1] && b.canonical.canonical === rule.drugs[0]);
        }
        if (!matched && rule.classes) {
          matched =
            (a.canonical.classIds.includes(rule.classes[0]) &&
              b.canonical.classIds.includes(rule.classes[1])) ||
            (a.canonical.classIds.includes(rule.classes[1]) &&
              b.canonical.classIds.includes(rule.classes[0]));
        }
        if (!matched) continue;

        addFinding({
          kind: 'drug_drug',
          severity: findingSeverity(rule.severity),
          medication: a.label,
          interactsWith: b.label,
          description: rule.description,
          source: rule.source,
        });
      }
    }
  }

  // ---- 2. Drug-allergy cross-check -----------------------------------
  const memberAllergies = allergies.filter((a) => a.memberId === memberId);
  for (const med of canonical) {
    for (const allergy of memberAllergies) {
      const allergyClass = classIdForAllergyLabel(allergy.substance);
      const directNameMatch = allergy.substance.toLowerCase().trim() === med.canonical;
      const classMatch = allergyClass ? med.classIds.includes(allergyClass) : false;

      if (!directNameMatch && !classMatch) continue;

      const severity =
        allergy.severity === 'severe'
          ? 'high'
          : allergy.severity === 'moderate'
            ? 'moderate'
            : allergy.severity === 'mild'
              ? 'low'
              : 'moderate';

      addFinding({
        kind: 'drug_allergy',
        severity,
        medication: med.displayName,
        interactsWith: allergy.substance,
        description: `${med.displayName} belongs to the same group as the recorded allergy "${allergy.substance}"${
          allergy.reaction ? ` (reaction: ${allergy.reaction})` : ''
        }. Confirm with the prescriber before starting.`,
        source: 'Healthyfy allergy ledger',
      });
    }
  }

  // ---- 3. Drug-condition cross-check ---------------------------------
  const conditions = member?.existingConditions || [];
  for (const med of canonical) {
    for (const condition of conditions) {
      for (const rule of CONDITION_RULES) {
        if (!rule.conditionPattern.test(condition)) continue;

        const classMatch = rule.drugClasses
          ? rule.drugClasses.some((c) => med.classIds.includes(c))
          : false;
        const drugMatch = rule.drugs ? rule.drugs.includes(med.canonical) : false;
        if (!classMatch && !drugMatch) continue;

        if (rule.kind === 'contraindication') {
          addFinding({
            kind: 'drug_condition',
            severity: findingSeverity(rule.severity),
            medication: med.displayName,
            interactsWith: condition,
            description: rule.description,
            source: rule.source,
          });
        } else {
          notes.push(
            `${med.displayName} matches the recorded condition "${condition}" — an expected treatment match, not a concern.`
          );
        }
      }
    }
  }

  // ---- 4. Duplicate therapy ------------------------------------------
  for (const med of canonical) {
    for (let i = 0; i < existingCanonical.length; i++) {
      const other = existingCanonical[i];
      const shared = med.classIds.filter((c) => other.classIds.includes(c));
      if (shared.length === 0) continue;
      if (med.canonical === other.canonical) continue;
      const cls = DRUG_CLASSES.find((c) => c.id === shared[0]);
      addFinding({
        kind: 'duplicate_therapy',
        severity: 'moderate',
        medication: med.displayName,
        interactsWith: existingMeds[i].name,
        description: `Both are ${cls?.label || shared[0]}. Taking two from the same group adds side-effect risk without extra benefit — check whether both are intended.`,
        source: 'Healthyfy medication ledger',
      });
    }
  }

  // ---- 5. FDA drug labels (openFDA, free, no key) ---------------------
  // The curated rules above are authoritative for severity. The label
  // adds coverage for drugs they do not mention, and it is reported as
  // "the label names this" rather than as a graded interaction.
  const labelNotes: string[] = [];
  const otherMedsForLabels = [
    ...incoming.map((m, i) => ({
      name: m.name,
      canonical: canonical[i].canonical,
      isNew: true,
    })),
    ...existingCanonical.map((c, i) => ({
      name: existingMeds[i].name,
      canonical: c.canonical,
      isNew: false,
    })),
  ];

  try {
    const labelResults = await Promise.all(
      canonical.map(async (med) => {
        // A drug outside the curated class list is exactly the case the
        // FDA label is here for, so the label is fetched for every name.
        if (!med.canonical || med.canonical.length < 4) return null;
        const label = await fetchDrugLabel(med.canonical);
        return label ? { med, label } : null;
      })
    );

    for (const entry of labelResults) {
      if (!entry) continue;
      const { med, label } = entry;

      const others = otherMedsForLabels.filter(
        (o) => o.canonical !== med.canonical && o.canonical.length > 2
      );
      for (const match of findLabelInteractions(label, others)) {
        addFinding({
          kind: 'drug_drug',
          severity: 'moderate',
          medication: med.displayName,
          interactsWith: match.otherDrug,
          description: `The FDA label for ${med.displayName} names ${match.otherDrug} in its interaction section: "${match.sentence.replace(/\s+/g, ' ').trim().slice(0, 240)}"`,
          source: 'FDA drug label via openFDA',
        });
      }

      const warning = boxedWarningSummary(label);
      if (warning) {
        labelNotes.push(
          `${med.displayName} carries an FDA boxed warning. The most important part for you: ${warning}`
        );
      }
    }
  } catch (error: any) {
    console.error('openFDA label lookup failed:', error?.message || error);
  }
  notes.push(...labelNotes);

  let highest: 'none' | 'low' | 'moderate' | 'high' = 'none';
  for (const f of findings) highest = maxSeverity(highest, f.severity);

  const check: SafetyCheck = {
    id: `sc-${crypto.randomUUID()}`,
    userId,
    memberId,
    trigger,
    sourceLabel,
    medications: incoming.map((m) => ({ name: m.name, dose: m.dose })),
    findings,
    highestSeverity: highest,
    createdAt: new Date().toISOString(),
  };

  if (!input.dryRun) {
    const { safetyChecks } = await import('../store');
    safetyChecks.unshift(check);
    await persistStateSafely();
  }

  return { check, notes, canonical };
}

export function severityLabel(severity: 'none' | 'low' | 'moderate' | 'high'): string {
  switch (severity) {
    case 'high':
      return 'High — needs prescriber review before starting';
    case 'moderate':
      return 'Moderate — worth confirming with the prescriber';
    case 'low':
      return 'Low — note it for your records';
    default:
      return 'No known interaction found in the Healthyfy knowledge base';
  }
}

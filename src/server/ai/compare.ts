import { medicalReports } from '../store';
import { MedicalReport, ReportValueItem } from '../types';

// -------------------------------------------------------------
// Report comparison
//
// Compares two stored reports value by value.
//
// The rules that matter:
//   * a test is only compared when the two values are numeric and
//     carry the same unit
//   * a reference range that changed between the reports is flagged,
//     because "within range" then means two different things
//   * the output describes movement and never explains what a movement
//     means. It produces questions for the doctor, not a conclusion
// -------------------------------------------------------------

export type Direction = 'increased' | 'decreased' | 'unchanged' | 'not_comparable';

export type Significance =
  | 'moved_out_of_range'
  | 'moved_into_range'
  | 'notable_change'
  | 'minor_change'
  | 'stable'
  | 'not_comparable';

export interface ParsedValue {
  raw: string;
  numeric: boolean;
  value: number | null;
  unit?: string;
  /** A value the lab could only bound, e.g. "> 400". */
  qualifier?: 'greater_than' | 'less_than' | 'about';
}

export interface ParsedRange {
  raw: string;
  unit?: string;
  lower?: number;
  upper?: number;
  kind: 'range' | 'upper_only' | 'lower_only';
}

export interface ValueSide {
  raw: string;
  value: number | null;
  unit?: string;
  date: string;
  inRange?: boolean;
  rangeText?: string;
  range?: ParsedRange;
}

export interface ValueChange {
  testName: string;
  unit?: string;
  previous: ValueSide;
  latest: ValueSide;
  direction: Direction;
  absoluteChange?: number;
  percentChange?: number;
  significance: Significance;
  rangeChanged: boolean;
  note?: string;
}

export interface SkippedComparison {
  testName: string;
  reason: string;
}

export interface ComparisonResult {
  memberId: string;
  memberName: string;
  older: ReportSummary;
  latest: ReportSummary;
  changes: ValueChange[];
  skipped: SkippedComparison[];
  questions: string[];
  summary: string;
  disclaimer: string;
}

export interface ReportSummary {
  id: string;
  title: string;
  reportType: string;
  date: string;
  laboratory: string;
}

// -------------------------------------------------------------
// Units
// -------------------------------------------------------------

const KNOWN_UNITS = [
  'mg/dL',
  'g/dL',
  'mg/L',
  'g/L',
  'ng/mL',
  'pg/mL',
  'pg/mL',
  'µg/dL',
  'mcg/dL',
  'µg/mL',
  'mcg/mL',
  'mIU/mL',
  'uIU/mL',
  'mIU/L',
  'IU/L',
  'IU/dL',
  'IU/mL',
  'U/L',
  'mmol/L',
  'mEq/L',
  'umol/L',
  'µmol/L',
  'mmol/mmol',
  'mmol/mol',
  'cells/µL',
  'cells/uL',
  '/µL',
  '/uL',
  'x10^3/uL',
  'mmHg',
  'bpm',
  'beats/min',
  'mL',
  'L',
  'dL',
  'kg',
  'g',
  'mg',
  'mcg',
  'µg',
  'ng',
  'pg',
  'cm',
  'mm',
  'sec',
  'ms',
  'min',
  'hrs',
  'hour',
  'days',
  'years',
  '%',
  'percent',
  'ratio',
  'index',
  'times',
  'units',
  'copies/mL',
  'log',
];

const UNIT_LOOKUP = new Map(KNOWN_UNITS.map((u) => [u.toLowerCase(), u]));

/**
 * Pull a unit out of the tail of a string, preferring a known unit.
 */
function extractUnit(text: string): string | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/[()[\]]/g, ' ').trim();
  if (!cleaned) return undefined;

  const lower = cleaned.toLowerCase();

  // A known unit at the start of the tail, longest first.
  for (const unit of [...KNOWN_UNITS].sort((a, b) => b.length - a.length)) {
    if (lower.startsWith(unit.toLowerCase())) {
      const rest = cleaned.slice(unit.length).trim();
      // Only accept it if what follows is punctuation or prose, not more unit.
      if (!rest || /^[.,;)\]]/.test(rest) || /^\s/.test(cleaned.slice(unit.length))) {
        return UNIT_LOOKUP.get(unit.toLowerCase()) || unit;
      }
    }
  }

  // Generic fallback: a short token, optionally with one slash segment.
  const generic = cleaned.match(/^([a-zA-Zµ%]{1,5}(?:\/[a-zA-Zµ%]{1,5})?)\b/);
  if (generic) {
    const candidate = generic[1];
    if (candidate.length >= 2) {
      const rest = cleaned.slice(candidate.length).trim();
      if (!rest || !/^\d/.test(rest)) return candidate;
    }
  }

  return undefined;
}

// -------------------------------------------------------------
// Value and range parsing
// -------------------------------------------------------------

const NUMBER = String.raw`-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?`;

/**
 * Parse a lab result. Handles plain numbers, thousands separators,
 * comparison qualifiers and a trailing unit.
 */
export function parseLabValue(result: string, referenceRange?: string): ParsedValue {
  const raw = (result ?? '').trim();
  if (!raw) return { raw, numeric: false, value: null };

  const qualifiers: Array<{ pattern: RegExp; qualifier: ParsedValue['qualifier'] }> = [
    { pattern: /^>=/, qualifier: 'greater_than' },
    { pattern: /^<=/, qualifier: 'less_than' },
    { pattern: /^>/, qualifier: 'greater_than' },
    { pattern: /^</, qualifier: 'less_than' },
    { pattern: /^~/, qualifier: 'about' },
    { pattern: /^≈/, qualifier: 'about' },
  ];

  let body = raw;
  let qualifier: ParsedValue['qualifier'];
  for (const entry of qualifiers) {
    if (entry.pattern.test(body)) {
      qualifier = entry.qualifier;
      body = body.replace(entry.pattern, '').trim();
      break;
    }
  }

  const match = body.match(new RegExp(`^(${NUMBER})`));
  if (!match) {
    return { raw, numeric: false, value: null, ...(qualifier ? { qualifier } : {}) };
  }

  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) {
    return { raw, numeric: false, value: null, ...(qualifier ? { qualifier } : {}) };
  }

  const tail = body.slice(match[0].length).trim();
  // The unit usually sits at the end of the reference range rather than
  // after the result itself, so read it from whichever has one.
  const unit =
    extractUnit(tail) ||
    (referenceRange ? parseReferenceRange(referenceRange)?.unit : undefined) ||
    extractUnit(referenceRange || '');

  return {
    raw,
    numeric: true,
    value,
    ...(unit ? { unit } : {}),
    ...(qualifier ? { qualifier } : {}),
  };
}

/**
 * Parse a reference range. Handles "70 - 100 mg/dL", "< 200 mg/dL",
 * "> 40" and a unit appended to either form.
 */
export function parseReferenceRange(range: string): ParsedRange | null {
  const raw = (range ?? '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/\([^)]*\)/g, ' ').trim();

  // "lower - upper"
  const both = cleaned.match(
    new RegExp(`^(${NUMBER})\\s*(?:-|–|—|to)\\s*(${NUMBER})(.*)$`, 'i')
  );
  if (both) {
    const lower = Number(both[1].replace(/,/g, ''));
    const upper = Number(both[2].replace(/,/g, ''));
    const unit = extractUnit(both[3]);
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
      return {
        raw,
        ...(unit ? { unit } : {}),
        lower,
        upper,
        kind: 'range',
      };
    }
  }

  const upperOnly = cleaned.match(new RegExp(`^<=?\\s*(${NUMBER})(.*)$`, 'i'));
  if (upperOnly) {
    const upper = Number(upperOnly[1].replace(/,/g, ''));
    const unit = extractUnit(upperOnly[2]);
    if (Number.isFinite(upper)) {
      return { raw, ...(unit ? { unit } : {}), upper, kind: 'upper_only' };
    }
  }

  const lowerOnly = cleaned.match(new RegExp(`^>=?\\s*(${NUMBER})(.*)$`, 'i'));
  if (lowerOnly) {
    const lower = Number(lowerOnly[1].replace(/,/g, ''));
    const unit = extractUnit(lowerOnly[2]);
    if (Number.isFinite(lower)) {
      return { raw, ...(unit ? { unit } : {}), lower, kind: 'lower_only' };
    }
  }

  return null;
}

export function isInRange(value: number, range: ParsedRange | null): boolean | undefined {
  if (!range) return undefined;
  if (range.kind === 'range') {
    if (range.lower !== undefined && value < range.lower) return false;
    if (range.upper !== undefined && value > range.upper) return false;
    return true;
  }
  if (range.kind === 'upper_only') {
    return range.upper === undefined ? undefined : value <= range.upper;
  }
  if (range.kind === 'lower_only') {
    return range.lower === undefined ? undefined : value >= range.lower;
  }
  return undefined;
}

// -------------------------------------------------------------
// Test name matching
// -------------------------------------------------------------

/** "LDL (Bad Cholesterol)" and "LDL Cholesterol" both normalise to "ldl". */
export function normalizeTestName(name: string): string {
  return (name ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*%?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(name: string): string[] {
  return normalizeTestName(name).split(' ').filter(Boolean);
}

/** Similarity of two normalised names, 0 to 1. */
export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;

  const setA = new Set(ta);
  const setB = new Set(tb);
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared++;
  const union = new Set([...setA, ...setB]).size;
  const jaccard = union ? shared / union : 0;

  // A short name fully contained in a longer one is a strong signal.
  const contains =
    normalizeTestName(a).includes(normalizeTestName(b)) ||
    normalizeTestName(b).includes(normalizeTestName(a));

  return contains ? Math.max(jaccard, 0.85) : jaccard;
}

export interface TestMatch {
  older: ReportValueItem;
  latest: ReportValueItem;
  similarity: number;
}

export function matchTests(
  older: ReportValueItem[],
  latest: ReportValueItem[]
): { matched: TestMatch[]; skipped: SkippedComparison[] } {
  const matched: TestMatch[] = [];
  const skipped: SkippedComparison[] = [];
  const usedLatest = new Set<number>();

  // Exact normalised matches first.
  const byName = new Map<string, ReportValueItem[]>();
  for (const item of latest) {
    const key = normalizeTestName(item.testName);
    if (!key) continue;
    const list = byName.get(key) || [];
    list.push(item);
    byName.set(key, list);
  }

  const remainingOlder: Array<{ item: ReportValueItem; index: number }> = [];

  older.forEach((item, index) => {
    const key = normalizeTestName(item.testName);
    const bucket = byName.get(key);
    if (bucket && bucket.length) {
      const pick = bucket.shift() as ReportValueItem;
      usedLatest.add(latest.indexOf(pick));
      matched.push({ older: item, latest: pick, similarity: 1 });
    } else {
      remainingOlder.push({ item, index });
    }
  });

  // Then fuzzy matches, strongest first.
  const candidates: Array<{ olderIndex: number; latestIndex: number; similarity: number }> = [];
  for (const { index: oi } of remainingOlder) {
    for (let li = 0; li < latest.length; li++) {
      if (usedLatest.has(li)) continue;
      const similarity = nameSimilarity(older[oi].testName, latest[li].testName);
      if (similarity >= 0.6) {
        candidates.push({ olderIndex: oi, latestIndex: li, similarity });
      }
    }
  }
  candidates.sort((a, b) => b.similarity - a.similarity);

  const usedOlder = new Set<number>();
  for (const candidate of candidates) {
    if (usedOlder.has(candidate.olderIndex) || usedLatest.has(candidate.latestIndex)) continue;
    usedOlder.add(candidate.olderIndex);
    usedLatest.add(candidate.latestIndex);
    matched.push({
      older: older[candidate.olderIndex],
      latest: latest[candidate.latestIndex],
      similarity: candidate.similarity,
    });
  }

  // Anything left over only exists in one report.
  for (const { item } of remainingOlder) {
    if (usedOlder.has(older.indexOf(item))) continue;
    skipped.push({
      testName: item.testName,
      reason: 'This test does not appear in the later report.',
    });
  }
  for (let li = 0; li < latest.length; li++) {
    if (usedLatest.has(li)) continue;
    skipped.push({
      testName: latest[li].testName,
      reason: 'This test does not appear in the earlier report.',
    });
  }

  return { matched, skipped };
}

// -------------------------------------------------------------
// The comparison
// -------------------------------------------------------------


function summarise(report: MedicalReport): ReportSummary {
  return {
    id: report.id,
    title: report.title,
    reportType: report.reportType,
    date: report.date,
    laboratory: report.laboratory,
  };
}

export function compareReports(
  memberId: string,
  older: MedicalReport,
  latest: MedicalReport
): ComparisonResult {
  const changes: ValueChange[] = [];
  const skipped: SkippedComparison[] = [];

  const { matched, skipped: unmatched } = matchTests(older.values || [], latest.values || []);
  skipped.push(...unmatched);

  for (const match of matched) {
    const olderRange = parseReferenceRange(match.older.referenceRange);
    const latestRange = parseReferenceRange(match.latest.referenceRange);
    const olderValue = parseLabValue(match.older.result, match.older.referenceRange);
    const latestValue = parseLabValue(match.latest.result, match.latest.referenceRange);

    const olderInRange = olderValue.numeric && olderValue.value !== null
      ? isInRange(olderValue.value, olderRange)
      : undefined;
    const latestInRange = latestValue.numeric && latestValue.value !== null
      ? isInRange(latestValue.value, latestRange)
      : undefined;

    const olderSide: ValueSide = {
      raw: match.older.result,
      value: olderValue.value,
      ...(olderValue.unit ? { unit: olderValue.unit } : {}),
      date: older.date,
      ...(olderInRange !== undefined ? { inRange: olderInRange } : {}),
      rangeText: match.older.referenceRange,
      ...(olderRange ? { range: olderRange } : {}),
    };
    const latestSide: ValueSide = {
      raw: match.latest.result,
      value: latestValue.value,
      ...(latestValue.unit ? { unit: latestValue.unit } : {}),
      date: latest.date,
      ...(latestInRange !== undefined ? { inRange: latestInRange } : {}),
      rangeText: match.latest.referenceRange,
      ...(latestRange ? { range: latestRange } : {}),
    };

    // Units that disagree mean the two numbers are not comparable.
    const olderUnit = olderValue.unit;
    const latestUnit = latestValue.unit;
    if (olderUnit && latestUnit && olderUnit.toLowerCase() !== latestUnit.toLowerCase()) {
      skipped.push({
        testName: match.older.testName,
        reason: `Not compared: the units differ between the two reports (${olderUnit} and ${latestUnit}).`,
      });
      continue;
    }

    if (!olderValue.numeric || !latestValue.numeric) {
      skipped.push({
        testName: match.older.testName,
        reason: `Not compared: one of the results is not a number ("${match.older.result}" and "${match.latest.result}").`,
      });
      continue;
    }

    if (olderValue.value === null || latestValue.value === null) {
      skipped.push({
        testName: match.older.testName,
        reason: 'Not compared: one of the results could not be read as a number.',
      });
      continue;
    }

    const previous = olderValue.value;
    const current = latestValue.value;
    const absoluteChange = round(current - previous);
    const percentChange = previous !== 0 ? round(((current - previous) / Math.abs(previous)) * 100) : undefined;

    let direction: Direction;
    if (Math.abs(absoluteChange) < 1e-9) {
      direction = 'unchanged';
    } else if (absoluteChange > 0) {
      direction = 'increased';
    } else {
      direction = 'decreased';
    }

    // A range that moved between the reports changes what "in range" means.
    const rangeChanged = !sameRange(olderRange, latestRange);

    let significance: Significance;
    let note: string | undefined;

    if (rangeChanged) {
      significance = 'minor_change';
      note =
        'The reference range for this test is different in the two reports, so in-range and out-of-range are not directly comparable.';
    } else if (
      olderInRange === true &&
      latestInRange === false
    ) {
      significance = 'moved_out_of_range';
    } else if (
      olderInRange === false &&
      latestInRange === true
    ) {
      significance = 'moved_into_range';
    } else if (direction === 'unchanged') {
      significance = 'stable';
    } else {
      // How big is the change for this particular test? A ratio of the
      // reference range is the general rule, but well-known tests carry
      // their own meaningful change.
      const absoluteScale = absoluteScaleFor(match.older.testName);
      const rangeWidth = referenceRangeWidth(olderRange, previous);
      const scale = absoluteScale ?? rangeWidth;
      const fractionOfScale = scale ? Math.abs(absoluteChange) / scale : undefined;

      if (absoluteScale !== undefined) {
        significance =
          Math.abs(absoluteChange) >= absoluteScale ? 'notable_change' : 'minor_change';
      } else if (fractionOfScale !== undefined && fractionOfScale >= 0.25) {
        significance = 'notable_change';
      } else if (
        percentChange !== undefined &&
        Math.abs(percentChange) >= 20
      ) {
        significance = 'notable_change';
      } else if (
        percentChange !== undefined &&
        Math.abs(percentChange) >= 10
      ) {
        significance = 'minor_change';
      } else {
        significance = 'stable';
      }
    }

    if (olderValue.qualifier || latestValue.qualifier) {
      note = note ? `${note} One of the values was reported as a bound rather than a number.` : 'One of the values was reported as a bound rather than a number.';
    }

    changes.push({
      testName: match.older.testName,
      ...(olderUnit || latestUnit ? { unit: olderUnit || latestUnit } : {}),
      previous: olderSide,
      latest: latestSide,
      direction,
      absoluteChange,
      ...(percentChange !== undefined ? { percentChange } : {}),
      significance,
      rangeChanged,
      ...(note ? { note } : {}),
    });
  }

  // Most interesting first: leaving the range, then entering it, then by size.
  const rank: Record<Significance, number> = {
    moved_out_of_range: 0,
    moved_into_range: 1,
    notable_change: 2,
    minor_change: 3,
    stable: 4,
    not_comparable: 5,
  };
  changes.sort((a, b) => {
    if (rank[a.significance] !== rank[b.significance]) {
      return rank[a.significance] - rank[b.significance];
    }
    return Math.abs(b.absoluteChange ?? 0) - Math.abs(a.absoluteChange ?? 0);
  });

  const questions = buildQuestions(changes, older, latest);
  const summary = buildSummary(changes, older, latest);

  return {
    memberId,
    memberName: latest.memberName,
    older: summarise(older),
    latest: summarise(latest),
    changes,
    skipped,
    questions,
    summary,
    disclaimer:
      'This is a description of how two stored results differ. It is not a diagnosis, and a change on its own does not mean anything is wrong. Please take the reports to your doctor.',
  };
}

function sameRange(a: ParsedRange | null, b: ParsedRange | null): boolean {
  if (!a || !b) return true;
  if (a.kind !== b.kind) return false;
  if (a.lower !== b.lower || a.upper !== b.upper) return false;
  return (a.unit || '').toLowerCase() === (b.unit || '').toLowerCase();
}

/**
 * Tests where a meaningful change is an absolute amount rather than a
 * proportion.
 *
 * A percentage threshold is wrong for these. HbA1c moving from 7.1% to
 * 8.4% is an 18% change, which any ratio would call small, yet it is
 * one of the most significant movements in a diabetes record. Lab
 * systems handle this with per-test reference changes, and this is a
 * small version of the same idea.
 */
const ABSOLUTE_SCALE_TESTS: Array<{ pattern: RegExp; meaningfulChange: number }> = [
  { pattern: /hba1c|glycated/i, meaningfulChange: 0.5 },
  { pattern: /^tsh\b/i, meaningfulChange: 0.5 },
  { pattern: /^free t4/i, meaningfulChange: 0.2 },
  { pattern: /^hdl\b/i, meaningfulChange: 5 },
  { pattern: /^ldl\b/i, meaningfulChange: 10 },
  { pattern: /cholesterol/i, meaningfulChange: 20 },
  { pattern: /triglyceride/i, meaningfulChange: 20 },
  { pattern: /vitamin d/i, meaningfulChange: 5 },
  { pattern: /creatinine/i, meaningfulChange: 0.3 },
  { pattern: /hemoglobin|haemoglobin/i, meaningfulChange: 1 },
  { pattern: /platelet/i, meaningfulChange: 50 },
  { pattern: /fasting blood glucose|^glucose$/i, meaningfulChange: 20 },
  { pattern: /estimated average glucose/i, meaningfulChange: 20 },
  { pattern: /^vldl/i, meaningfulChange: 8 },
  { pattern: /potassium|^na$|sodium/i, meaningfulChange: 0.5 },
  { pattern: /^bun\b|urea/i, meaningfulChange: 5 },
];

function absoluteScaleFor(testName: string): number | undefined {
  for (const entry of ABSOLUTE_SCALE_TESTS) {
    if (entry.pattern.test(testName)) return entry.meaningfulChange;
  }
  return undefined;
}

/**
 * The scale of a test, used to judge how large a change is.
 *
 * A two-sided range gives its width directly. A one-sided range
 * ("< 200") has no width, so the bound itself is used, which keeps a
 * wide-range test like VLDL from looking dramatic over a couple of
 * units. Well-known tests override this entirely through the table
 * above.
 */
function referenceRangeWidth(range: ParsedRange | null, value: number): number | undefined {
  if (!range) return undefined;
  if (range.kind === 'range' && range.lower !== undefined && range.upper !== undefined) {
    const width = range.upper - range.lower;
    return width > 0 ? width : undefined;
  }
  if (range.kind === 'upper_only' && range.upper !== undefined && range.upper > 0) {
    return range.upper;
  }
  if (range.kind === 'lower_only' && range.lower !== undefined && range.lower > 0) {
    return range.lower;
  }
  return undefined;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function buildQuestions(
  changes: ValueChange[],
  older: MedicalReport,
  latest: MedicalReport
): string[] {
  const questions: string[] = [];

  for (const change of changes) {
    if (change.significance === 'moved_out_of_range') {
      questions.push(
        `${change.testName} was ${change.previous.raw}${
          change.unit ? ` ${change.unit}` : ''
        } on ${change.previous.date} and is ${change.latest.raw}${
          change.unit ? ` ${change.unit}` : ''
        } on ${change.latest.date}, which is outside the reference range of ${
          change.latest.rangeText || 'the latest report'
        }. What does that mean for us?`
      );
    } else if (change.significance === 'moved_into_range') {
      questions.push(
        `${change.testName} has come back into the reference range (${change.previous.raw} on ${change.previous.date}, ${change.latest.raw} on ${change.latest.date}). Does that confirm the current plan is working?`
      );
    } else if (change.significance === 'notable_change') {
      questions.push(
        `${change.testName} moved from ${change.previous.raw} to ${change.latest.raw}${
          change.percentChange !== undefined ? ` (${change.percentChange > 0 ? '+' : ''}${change.percentChange}%)` : ''
        }. Is that a change worth acting on, or does it need repeating?`
      );
    }
  }

  if (questions.length === 0 && changes.length > 0) {
    questions.push(
      `Comparing the ${older.reportType} from ${older.date} with the ${latest.reportType} from ${latest.date}, the values are broadly stable. Is there anything you would still like to recheck?`
    );
  }

  if (older.reportType !== latest.reportType) {
    questions.push(
      `These are two different test panels (${older.reportType} and ${latest.reportType}). Are there tests I should have had that were not done?`
    );
  }

  return questions.slice(0, 6);
}

function buildSummary(
  changes: ValueChange[],
  older: MedicalReport,
  latest: MedicalReport
): string {
  const movedOut = changes.filter((c) => c.significance === 'moved_out_of_range');
  const movedIn = changes.filter((c) => c.significance === 'moved_into_range');
  const notable = changes.filter((c) => c.significance === 'notable_change');
  const stable = changes.filter((c) => c.significance === 'stable');

  const parts: string[] = [];
  parts.push(
    `Compared ${changes.length} test${changes.length === 1 ? '' : 's'} between the ${older.reportType} of ${older.date} and the ${latest.reportType} of ${latest.date}.`
  );

  if (movedOut.length) {
    parts.push(
      `${movedOut.length} moved outside the reference range: ${movedOut
        .map((c) => c.testName)
        .join(', ')}.`
    );
  }
  if (movedIn.length) {
    parts.push(
      `${movedIn.length} came back into range: ${movedIn.map((c) => c.testName).join(', ')}.`
    );
  }
  if (notable.length) {
    parts.push(
      `${notable.length} changed noticeably: ${notable.map((c) => c.testName).join(', ')}.`
    );
  }
  if (stable.length) {
    parts.push(`${stable.length} stayed essentially the same.`);
  }

  return parts.join(' ');
}

/**
 * Find the two reports to compare.
 *
 * The default is the most recent report and the most recent *earlier*
 * report of the same panel. Comparing a lipid profile with an HbA1c
 * panel is not useful, so the same-panel pairing is preferred and the
 * caller can override either side.
 */
export function findReportsToCompare(
  memberId: string,
  olderId?: string,
  latestId?: string
): { older?: MedicalReport; latest?: MedicalReport; reason?: string } {
  const reports = medicalReports
    .filter((r) => r.memberId === memberId)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (reports.length === 0) return { reason: 'There are no reports stored for this person yet.' };
  if (reports.length === 1) {
    return { reason: 'Only one report is stored, so there is nothing to compare it against yet.' };
  }

  if (olderId && latestId) {
    const older = reports.find((r) => r.id === olderId);
    const latest = reports.find((r) => r.id === latestId);
    if (!older || !latest) return { reason: 'One of the reports was not found for this person.' };
    if (new Date(older.date).getTime() > new Date(latest.date).getTime()) {
      return { reason: 'The earlier report has to be the older one.' };
    }
    return { older, latest };
  }

  if (latestId) {
    const latest = reports.find((r) => r.id === latestId);
    if (!latest) return { reason: 'That report was not found for this person.' };
    const earlier = reports.find(
      (r) => new Date(r.date).getTime() < new Date(latest.date).getTime()
    );
    if (!earlier) return { reason: 'There is no earlier report to compare against.' };
    return { older: earlier, latest };
  }

  const latest = reports[0];

  // Prefer the most recent earlier report of the same panel.
  const samePanel = reports.find(
    (r) =>
      new Date(r.date).getTime() < new Date(latest.date).getTime() &&
      normalizePanel(r.reportType) === normalizePanel(latest.reportType)
  );
  if (samePanel) return { older: samePanel, latest };

  const anyEarlier = reports.find(
    (r) => new Date(r.date).getTime() < new Date(latest.date).getTime()
  );
  if (anyEarlier) return { older: anyEarlier, latest };

  return { reason: 'There is no earlier report to compare against.' };
}

/** "Lipid Profile" and "lipid profile (fasting)" are different panels. */
function normalizePanel(reportType: string): string {
  return (reportType ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

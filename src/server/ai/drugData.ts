import { BRAND_TO_GENERIC } from './drugKnowledge';

// -------------------------------------------------------------
// Free drug data from openFDA
//
// The curated knowledge base in drugKnowledge.ts covers the common
// and important interactions, but it is finite. openFDA publishes the
// actual FDA drug labels, which include the interaction section for
// every approved medicine, and it needs no API key for this usage.
//
// The label text is unstructured, so findings derived from it are
// reported as "the label mentions this" rather than as a graded
// interaction. The curated rules stay authoritative for severity.
// -------------------------------------------------------------

const OPENFDA_URL = 'https://api.fda.gov/drug/label.json';
const TIMEOUT_MS = 8000;

export interface DrugLabel {
  genericName: string;
  brandNames: string[];
  interactionText?: string;
  boxedWarning?: string;
  warningsText?: string;
  contraindicationsText?: string;
  indicationsText?: string;
  fetchedAt: string;
  source: 'openfda';
}

const labelCache = new Map<string, DrugLabel | null>();

/** Reverse index so a brand name can be matched in label text. */
const GENERIC_TO_BRANDS: Record<string, string[]> = {};
for (const [brand, generic] of Object.entries(BRAND_TO_GENERIC)) {
  const list = GENERIC_TO_BRANDS[generic] || [];
  list.push(brand);
  GENERIC_TO_BRANDS[generic] = list;
}

/**
 * Words that suggest a sentence is actually describing an interaction
 * rather than general advice.
 */
const INTERACTION_CUES = [
  'interaction',
  'interact',
  'concomitant',
  'co-administ',
  'coadmin',
  'increase',
  'decrease',
  'potentiate',
  'antagoni',
  'inhibit',
  'induce',
  'avoid',
  'risk of',
  'concentration',
  'toxicity',
  'bleeding',
  'hypoglyc',
  'hypotens',
];

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstOf(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const text = value.find((v) => typeof v === 'string' && v.trim().length > 20);
    return typeof text === 'string' ? text : undefined;
  }
  return typeof value === 'string' && value.trim().length > 20 ? value : undefined;
}

export async function fetchDrugLabel(drugName: string): Promise<DrugLabel | null> {
  const generic = BRAND_TO_GENERIC[drugName.toLowerCase()] || drugName.toLowerCase();
  if (labelCache.has(generic)) return labelCache.get(generic) || null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let label: DrugLabel | null = null;

  try {
    const query = encodeURIComponent(`openfda.generic_name:"${generic}"`);
    // A generic name matches many labels: the single-ingredient one,
    // combination products, and different manufacturers' versions. They
    // do not all carry the same sections, so the results are ranked by
    // how much interaction content they actually have.
    const response = await fetch(`${OPENFDA_URL}?search=${query}&limit=10`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    if (response.ok) {
      const data: any = await response.json();
      const results: any[] = data?.results || [];

      const exact = results.filter((r) => {
        const names = (r.openfda?.generic_name || []).map((n: string) =>
          String(n).toLowerCase().trim()
        );
        return names.includes(generic);
      });
      const pool = exact.length ? exact : results;

      const contentScore = (r: any) =>
        (r.drug_interactions?.[0]?.length || 0) +
        (r.boxed_warning?.[0]?.length || 0) +
        (r.warnings?.[0]?.length || 0) / 4;
      const ranked = [...pool].sort((a, b) => contentScore(b) - contentScore(a));
      const best = ranked[0];

      if (best) {
        const openfda = best.openfda || {};

        // Merge the interaction sections from the other matching labels,
        // because manufacturers list different drugs. Duplicates are
        // dropped and the total is capped.
        const interactionParts: string[] = [];
        let interactionLength = 0;
        for (const r of ranked) {
          const text = r.drug_interactions?.[0];
          if (typeof text !== 'string' || text.trim().length < 20) continue;
          const trimmed = text.trim();
          if (interactionParts.some((p) => p.slice(0, 120) === trimmed.slice(0, 120))) {
            continue;
          }
          interactionParts.push(trimmed);
          interactionLength += trimmed.length;
          if (interactionLength > 8000) break;
        }

        const boxed = ranked.find((r) => (r.boxed_warning?.[0] || '').length > 40);

        label = {
          genericName: (openfda.generic_name?.[0] || generic).toLowerCase(),
          brandNames: (openfda.brand_name || []).map((b: string) => String(b).toLowerCase()),
          interactionText: interactionParts.length ? interactionParts.join('\n\n') : undefined,
          boxedWarning: boxed?.boxed_warning?.[0],
          warningsText: firstOf(best.warnings),
          contraindicationsText: firstOf(best.contraindications),
          indicationsText: firstOf(best.indications_and_usage),
          fetchedAt: new Date().toISOString(),
          source: 'openfda',
        };
      }
    }
  } catch {
    // A timeout or a network error just means no extra information.
    label = null;
  } finally {
    clearTimeout(timer);
  }

  labelCache.set(generic, label);
  return label;
}

export interface LabelInteraction {
  /** The other drug the label names. */
  otherDrug: string;
  /** The sentence from the label that names it. */
  sentence: string;
}

/**
 * Find the sentences in a drug's interaction section that name another
 * drug the person is already taking.
 */
export function findLabelInteractions(
  label: DrugLabel,
  otherDrugs: Array<{ name: string; canonical: string }>
): LabelInteraction[] {
  if (!label.interactionText) return [];

  const text = normalise(label.interactionText);
  const sentences = label.interactionText
    .split(/(?<=[.;])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20);

  const found: LabelInteraction[] = [];

  for (const other of otherDrugs) {
    const names = new Set<string>();
    if (other.canonical) names.add(normalise(other.canonical));
    for (const brand of GENERIC_TO_BRANDS[other.canonical] || []) {
      names.add(normalise(brand));
    }
    if (other.name) names.add(normalise(other.name));

    for (const name of names) {
      if (!name || name.length < 4) continue;
      if (!new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(text)) {
        continue;
      }
      const sentence = sentences.find((s) => {
        const lowered = normalise(s);
        if (!lowered.includes(name)) return false;
        return INTERACTION_CUES.some((cue) => lowered.includes(cue));
      });
      if (sentence) {
        found.push({ otherDrug: other.name, sentence });
        break;
      }
    }
  }

  return found;
}

/**
 * The boxed warning is the FDA's highest-severity label section. It is
 * worth surfacing even when nothing else matches.
 */
export function boxedWarningSummary(label: DrugLabel | null): string | null {
  if (!label?.boxedWarning) return null;
  const cleaned = label.boxedWarning.replace(/\s+/g, ' ').trim();
  if (cleaned.length < 40) return null;
  return cleaned.length > 420 ? `${cleaned.slice(0, 420)}...` : cleaned;
}

export function drugDataStatus() {
  return {
    openfda: {
      enabled: true,
      baseUrl: OPENFDA_URL,
      requiresKey: false,
      note: 'Free FDA drug label data. No API key is needed at this volume.',
    },
    cachedLabels: labelCache.size,
  };
}

// -------------------------------------------------------------
// Free literature lookup from PubMed
//
// The exercise plan is generated from a deterministic rules engine, so
// the targets are traceable. PubMed adds the evidence behind them:
// the actual papers, with links, so the recommendation can be checked
// rather than taken on trust.
//
// E-utilities is free, needs no API key at this volume, and is the
// same interface NCBI uses for its own tools.
// -------------------------------------------------------------

const ESEARCH = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi';
const ESUMMARY = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
const TIMEOUT_MS = 8000;

export interface Citation {
  pmid: string;
  title: string;
  journal: string;
  year: string;
  url: string;
}

/**
 * Search terms per condition.
 *
 * `condition` is the population and `intervention` is the thing the
 * plan is about. Both are field-tagged so the results are about the
 * right people doing the right thing, rather than papers that merely
 * mention diabetes in the abstract.
 */
const CONDITION_TERMS: Array<{ pattern: RegExp; condition: string; intervention: string }> = [
  {
    pattern: /diabetes/i,
    condition: '"type 2 diabetes"',
    intervention:
      '("aerobic exercise"[tiab] OR "combined exercise"[tiab] OR "exercise training"[tiab] OR "exercise intervention"[tiab])',
  },
  {
    pattern: /hypertension|high blood pressure/i,
    condition: '"hypertension"',
    intervention: '("aerobic exercise"[tiab] OR "physical activity"[tiab])',
  },
  {
    pattern: /osteopenia|osteoporosis/i,
    condition: '("osteoporosis"[tiab] OR "osteopenia"[tiab])',
    intervention:
      '("weight-bearing"[tiab] OR "resistance training"[tiab] OR "balance training"[tiab] OR "exercise"[tiab])',
  },
  {
    pattern: /iron deficiency|anaemia|anemia/i,
    condition: '("iron deficiency anaemia"[tiab] OR "iron deficiency anemia"[tiab])',
    intervention: '("exercise"[tiab] OR "physical activity"[tiab])',
  },
  {
    pattern: /asthma|bronchospasm/i,
    condition: '("exercise-induced bronchoconstriction"[tiab] OR "asthma"[tiab])',
    intervention: '("exercise"[tiab] OR "training"[tiab])',
  },
  {
    pattern: /hypothyroid/i,
    condition: '"hypothyroidism"',
    intervention: '("exercise"[tiab] OR "physical activity"[tiab])',
  },
  {
    pattern: /chronic kidney|ckd|renal/i,
    condition: '"chronic kidney disease"',
    intervention: '("physical activity"[tiab] OR "exercise"[tiab])',
  },
  {
    pattern: /cardiovascular|coronary|heart failure/i,
    condition: '("cardiac rehabilitation"[tiab] OR "heart failure"[tiab] OR "coronary artery disease"[tiab])',
    intervention: '("exercise training"[tiab] OR "exercise-based"[tiab])',
  },
];

export function buildSearchQuery(conditions: string[]): string | null {
  for (const condition of conditions) {
    for (const entry of CONDITION_TERMS) {
      if (entry.pattern.test(condition)) {
        return `${entry.condition} AND ${entry.intervention} AND ("systematic review"[pt] OR "meta-analysis"[pt] OR "randomized controlled trial"[pt])`;
      }
    }
  }
  return null;
}

const citationCache = new Map<string, Citation[]>();

export async function searchLiterature(
  conditions: string[],
  limit = 3
): Promise<Citation[]> {
  const query = buildSearchQuery(conditions);
  if (!query) return [];

  const cacheKey = `${query}|${limit}`;
  const cached = citationCache.get(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let citations: Citation[] = [];

  try {
    const searchUrl = `${ESEARCH}?db=pubmed&retmax=${limit}&retmode=json&sort=relevance&term=${encodeURIComponent(
      query
    )}`;
    const searchResponse = await fetch(searchUrl, { signal: controller.signal });
    if (!searchResponse.ok) throw new Error(`esearch returned ${searchResponse.status}`);

    const searchData: any = await searchResponse.json();
    const ids: string[] = searchData?.esearchresult?.idlist || [];
    if (ids.length === 0) {
      citationCache.set(cacheKey, []);
      return [];
    }

    const summaryUrl = `${ESUMMARY}?db=pubmed&id=${ids.join(',')}&retmode=json`;
    const summaryResponse = await fetch(summaryUrl, { signal: controller.signal });
    if (!summaryResponse.ok) throw new Error(`esummary returned ${summaryResponse.status}`);

    const summaryData: any = await summaryResponse.json();
    const results = summaryData?.result || {};

    citations = ids
      .map((id) => {
        const item = results[id];
        if (!item) return null;
        return {
          pmid: id,
          title: String(item.title || '').replace(/\.$/, ''),
          journal: String(item.source || ''),
          year: String(item.pubdate || '').slice(0, 4),
          url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
        } satisfies Citation;
      })
      .filter((c): c is Citation => Boolean(c && c.title));
  } catch (error: any) {
    // A literature lookup failure must never break a recommendation.
    console.error('PubMed lookup failed:', error?.message || error);
    citations = [];
  } finally {
    clearTimeout(timer);
  }

  citationCache.set(cacheKey, citations);
  return citations;
}

export function literatureStatus() {
  return {
    pubmed: {
      enabled: true,
      baseUrl: ESEARCH,
      requiresKey: false,
      note: 'Free NCBI E-utilities. No API key is needed at this volume.',
    },
    cachedQueries: citationCache.size,
  };
}

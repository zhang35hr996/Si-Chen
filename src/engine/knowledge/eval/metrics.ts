/**
 * Evaluation metrics for knowledge retrieval quality.
 *
 * All metrics operate on the result of running a single eval case:
 * an ordered list of chunk IDs returned by the retriever.
 */
import type { KnowledgeEvalCase } from "./schema";

export interface CaseResult {
  caseId: string;
  category: KnowledgeEvalCase["category"];
  query: string;
  expectedAnyOf: string[];
  expectedAll: string[];
  forbiddenIds: string[];
  expectedZeroHits: boolean;

  /** Ordered chunk IDs from the retriever (top-limit). */
  actualIds: string[];

  /** First rank (1-based) at which an expected ID appeared. null = not found. */
  firstHitRank: number | null;

  /** Whether at least one expectedAnyOf was found in the results. */
  anyOfMet: boolean;
  /** Whether all expectedAll were found in the results. */
  allMet: boolean;
  /** Forbidden IDs that appeared in the results (should be empty). */
  forbiddenHits: string[];
  /** Whether zero-hits expectation was satisfied. */
  zeroHitsMet: boolean;
  /** Whether the intent classifier routed this query away from static retrieval. */
  retrievalSkipped: boolean;
  /** Whether expectedRetrievalSkipped matched actual retrievalSkipped. */
  intentMet: boolean;

  /** Retrieval-specific details per result position. */
  details: ResultDetail[];
}

export interface ResultDetail {
  rank: number;
  id: string;
  keywordRank: number | null;
  keywordScore: number | null;
  vectorRank: number | null;
  cosineScore: number | null;
  hybridScore: number | null;
}

export interface AggregateMetrics {
  totalCases: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  mrr: number;
  requiredMisses: number;
  forbiddenHitCount: number;
  unexpectedZeroHits: number;
  /** Cases where expectedAll was specified but at least one required ID was missing. */
  expectedAllViolationCount: number;
  /** Cases where expectedRetrievalSkipped: true but the intent classifier returned static_lore. */
  intentMismatchCount: number;
  duplicateHits: number;
  visibilityLeakage: number;
  temporalLeakage: number;

  byCategory: Record<string, CategoryMetrics>;
  failedCases: CaseResult[];
}

export interface CategoryMetrics {
  total: number;
  hitAt5: number;
  forbiddenHitCount: number;
}

export function computeCaseResult(
  evalCase: KnowledgeEvalCase,
  actualIds: string[],
  details: ResultDetail[],
  retrievalSkipped = false,
): CaseResult {
  const expectedAnyOf = evalCase.expectedAnyOf ?? [];
  const expectedAll = evalCase.expectedAll ?? [];
  const forbiddenIds = evalCase.forbiddenIds ?? [];
  const expectedZeroHits = evalCase.expectedZeroHits ?? false;

  const allExpected = new Set([...expectedAnyOf, ...expectedAll]);

  let firstHitRank: number | null = null;
  for (let i = 0; i < actualIds.length; i++) {
    if (allExpected.has(actualIds[i]!)) {
      firstHitRank = i + 1;
      break;
    }
  }
  if (expectedAnyOf.length === 0 && expectedAll.length === 0) {
    firstHitRank = null;
  }

  const actualSet = new Set(actualIds);

  const anyOfMet =
    expectedAnyOf.length === 0 || expectedAnyOf.some((id) => actualSet.has(id));

  const allMet = expectedAll.every((id) => actualSet.has(id));

  const forbiddenHits = forbiddenIds.filter((id) => actualSet.has(id));

  const zeroHitsMet = expectedZeroHits ? actualIds.length === 0 : true;

  const expectedSkip = evalCase.expectedRetrievalSkipped === true;
  const intentMet = !expectedSkip || retrievalSkipped;

  return {
    caseId: evalCase.id,
    category: evalCase.category,
    query: evalCase.query,
    expectedAnyOf,
    expectedAll,
    forbiddenIds,
    expectedZeroHits,
    actualIds,
    firstHitRank,
    anyOfMet,
    allMet,
    forbiddenHits,
    zeroHitsMet,
    retrievalSkipped,
    intentMet,
    details,
  };
}

export function computeAggregateMetrics(
  results: CaseResult[],
  visibilityLeakCount: number,
  temporalLeakCount: number,
): AggregateMetrics {
  const totalCases = results.length;
  let hitAt1 = 0;
  let hitAt3 = 0;
  let hitAt5 = 0;
  let reciprocalRankSum = 0;
  let requiredMisses = 0;
  let forbiddenHitCount = 0;
  let unexpectedZeroHits = 0;
  let expectedAllViolationCount = 0;
  let intentMismatchCount = 0;
  let duplicateHits = 0;

  const byCat: Record<string, { total: number; hitAt5: number; forbidden: number }> = {};
  const failedCases: CaseResult[] = [];

  for (const r of results) {
    const cat = r.category;
    if (!byCat[cat]) byCat[cat] = { total: 0, hitAt5: 0, forbidden: 0 };
    byCat[cat]!.total++;

    // Duplicate detection within this result set
    const seen = new Set<string>();
    for (const id of r.actualIds) {
      if (seen.has(id)) duplicateHits++;
      seen.add(id);
    }

    // Forbidden hits
    forbiddenHitCount += r.forbiddenHits.length;
    byCat[cat]!.forbidden += r.forbiddenHits.length;

    // Zero-hits
    if (r.expectedZeroHits && !r.zeroHitsMet) unexpectedZeroHits++;

    // expectedAll violations
    if (r.expectedAll.length > 0 && !r.allMet) expectedAllViolationCount++;

    // Intent classification mismatches
    if (!r.intentMet) intentMismatchCount++;

    // Hit@k and MRR (only for cases with expectedAnyOf or expectedAll)
    const hasPositiveExpectation =
      r.expectedAnyOf.length > 0 || r.expectedAll.length > 0;

    if (hasPositiveExpectation) {
      if (r.firstHitRank !== null) {
        if (r.firstHitRank <= 1) hitAt1++;
        if (r.firstHitRank <= 3) hitAt3++;
        if (r.firstHitRank <= 5) hitAt5++;
        byCat[cat]!.hitAt5 = (byCat[cat]!.hitAt5 ?? 0) + (r.firstHitRank <= 5 ? 1 : 0);
        reciprocalRankSum += 1 / r.firstHitRank;
      } else {
        requiredMisses++;
      }
    }

    // Failed case detection
    const passed =
      r.anyOfMet &&
      r.allMet &&
      r.forbiddenHits.length === 0 &&
      r.zeroHitsMet &&
      r.intentMet;

    if (!passed) failedCases.push(r);
  }

  const casesWithPositive = results.filter(
    (r) => r.expectedAnyOf.length > 0 || r.expectedAll.length > 0,
  ).length;
  const denom = casesWithPositive || 1;

  return {
    totalCases,
    hitAt1: hitAt1 / denom,
    hitAt3: hitAt3 / denom,
    hitAt5: hitAt5 / denom,
    mrr: reciprocalRankSum / denom,
    requiredMisses,
    forbiddenHitCount,
    unexpectedZeroHits,
    expectedAllViolationCount,
    intentMismatchCount,
    duplicateHits,
    visibilityLeakage: visibilityLeakCount,
    temporalLeakage: temporalLeakCount,
    byCategory: Object.fromEntries(
      Object.entries(byCat).map(([k, v]) => [
        k,
        { total: v.total, hitAt5: v.hitAt5 / (v.total || 1), forbiddenHitCount: v.forbidden },
      ]),
    ),
    failedCases,
  };
}

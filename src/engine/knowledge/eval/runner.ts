/**
 * Eval runner for knowledge retrieval quality.
 *
 * Keyword mode: fully deterministic, no network, suitable for CI.
 * Hybrid mode: requires an embedding provider, used for local benchmarking only.
 *
 * The runner validates that all expected IDs exist in the corpus before
 * running queries, so a stale cases.jsonl is caught immediately.
 */
import type { KnowledgeChunk, KnowledgeSourceType, KnowledgeVisibility } from "../model";
import type { KnowledgeKeywordIndex, KnowledgeKeywordQuery } from "../index/keyword-index";
import type { KnowledgeEvalCase } from "./schema";
import { computeCaseResult, type CaseResult, type ResultDetail } from "./metrics";

export interface EvalRunnerOptions {
  /** All chunks in the corpus (used for ID existence validation). */
  chunks: readonly KnowledgeChunk[];
  keywordIndex: KnowledgeKeywordIndex;
}

export interface EvalRunResult {
  results: CaseResult[];
  /** Chunk IDs found in forbidden results that were in restricted/imperial visibility chunks. */
  visibilityLeakCount: number;
  /** Chunk IDs returned that should have been filtered by currentTime. */
  temporalLeakCount: number;
  /** Cases where an expected chunk ID did not exist in the corpus at all. */
  missingExpectedIds: Array<{ caseId: string; missingId: string }>;
}

export function runKeywordEval(
  cases: KnowledgeEvalCase[],
  opts: EvalRunnerOptions,
): EvalRunResult {
  const allChunkIds = new Set(opts.chunks.map((c) => c.id));
  const chunkById = new Map(opts.chunks.map((c) => [c.id, c]));

  const missingExpectedIds: EvalRunResult["missingExpectedIds"] = [];

  for (const c of cases) {
    for (const id of [...(c.expectedAnyOf ?? []), ...(c.expectedAll ?? [])]) {
      if (!allChunkIds.has(id)) {
        missingExpectedIds.push({ caseId: c.id, missingId: id });
      }
    }
  }

  let visibilityLeakCount = 0;
  let temporalLeakCount = 0;
  const results: CaseResult[] = [];

  for (const c of cases) {
    const query: KnowledgeKeywordQuery = {
      text: c.query,
      limit: c.limit,
      sourceTypes: c.sourceTypes as KnowledgeSourceType[] | undefined,
      visibilityCeiling: (c.visibilityCeiling as KnowledgeVisibility | undefined) ?? "public",
      currentTime: c.currentTime,
    };

    const hits = opts.keywordIndex.search(query);

    const actualIds = hits.map((h) => h.chunk.id);
    const details: ResultDetail[] = hits.map((h, i) => ({
      rank: i + 1,
      id: h.chunk.id,
      keywordRank: i + 1,
      keywordScore: h.bm25Score,
      vectorRank: null,
      cosineScore: null,
      hybridScore: null,
    }));

    // Visibility leak: a chunk appeared in results with visibility above ceiling
    const ceiling = query.visibilityCeiling ?? "public";
    for (const h of hits) {
      const chunkVis = h.chunk.visibility;
      if (
        (ceiling === "public" && (chunkVis === "restricted" || chunkVis === "imperial")) ||
        (ceiling === "restricted" && chunkVis === "imperial")
      ) {
        visibilityLeakCount++;
      }
    }

    // Temporal leak: a chunk appeared in results that should be excluded by currentTime
    if (c.currentTime) {
      for (const h of hits) {
        const chunk = chunkById.get(h.chunk.id);
        if (!chunk) continue;
        const t = c.currentTime;
        const currentDay = t.year * 10000 + t.month * 100 + (t.period === "early" ? 0 : t.period === "mid" ? 1 : 2);
        if (chunk.validFrom) {
          const vf = chunk.validFrom;
          const fromDay = vf.year * 10000 + vf.month * 100 + (vf.period === "early" ? 0 : vf.period === "mid" ? 1 : 2);
          if (currentDay < fromDay) temporalLeakCount++;
        }
        if (chunk.validUntil) {
          const vu = chunk.validUntil;
          const untilDay = vu.year * 10000 + vu.month * 100 + (vu.period === "early" ? 0 : vu.period === "mid" ? 1 : 2);
          if (currentDay > untilDay) temporalLeakCount++;
        }
      }
    }

    results.push(computeCaseResult(c, actualIds, details));
  }

  return { results, visibilityLeakCount, temporalLeakCount, missingExpectedIds };
}

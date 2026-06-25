/**
 * Eval runner for knowledge retrieval quality.
 *
 * Keyword mode: fully deterministic, no network, suitable for CI.
 * Hybrid mode: requires an embedding provider, used for local benchmarking only.
 *
 * The runner validates that all referenced IDs (expected AND forbidden) exist in the corpus
 * before running queries, so a stale cases.jsonl is caught immediately.
 */
import type { KnowledgeChunk, KnowledgeSourceType, KnowledgeVisibility } from "../model";
import type { KnowledgeKeywordIndex, KnowledgeKeywordQuery } from "../index/keyword-index";
import type { KnowledgeEvalCase } from "./schema";
import { computeCaseResult, type CaseResult, type ResultDetail } from "./metrics";
import { classifyQueryIntent } from "../intent";

export interface EvalRunnerOptions {
  /** All chunks in the corpus (used for ID existence validation). */
  chunks: readonly KnowledgeChunk[];
  keywordIndex: KnowledgeKeywordIndex;
}

export interface EvalRunResult {
  results: CaseResult[];
  /** Chunks returned that had visibility above the requested ceiling. */
  visibilityLeakCount: number;
  /** Chunks returned that should have been filtered by currentTime. */
  temporalLeakCount: number;
  /**
   * IDs referenced in cases (expected OR forbidden) that do not exist in the corpus.
   * A non-empty list means cases.jsonl is stale and must be updated.
   */
  missingReferencedIds: Array<{ caseId: string; missingId: string; role: "expected" | "forbidden" }>;
}

export function runKeywordEval(
  cases: KnowledgeEvalCase[],
  opts: EvalRunnerOptions,
): EvalRunResult {
  const allChunkIds = new Set(opts.chunks.map((c) => c.id));
  const chunkById = new Map(opts.chunks.map((c) => [c.id, c]));

  const missingReferencedIds: EvalRunResult["missingReferencedIds"] = [];

  for (const c of cases) {
    for (const id of [...(c.expectedAnyOf ?? []), ...(c.expectedAll ?? [])]) {
      if (!allChunkIds.has(id)) {
        missingReferencedIds.push({ caseId: c.id, missingId: id, role: "expected" });
      }
    }
    for (const id of c.forbiddenIds ?? []) {
      if (!allChunkIds.has(id)) {
        missingReferencedIds.push({ caseId: c.id, missingId: id, role: "forbidden" });
      }
    }
  }

  let visibilityLeakCount = 0;
  let temporalLeakCount = 0;
  const results: CaseResult[] = [];

  for (const c of cases) {
    // Always classify intent: static_lore cases must not be skipped (false positives
    // would silently suppress retrieval for legitimate lore questions).
    const intent = classifyQueryIntent(c.query);
    const retrievalSkipped = intent === "runtime_state";
    let actualIds: string[];
    let details: ResultDetail[];

    if (retrievalSkipped) {
      actualIds = [];
      details = [];
      results.push(computeCaseResult(c, actualIds, details, retrievalSkipped));
      continue;
    }

    const query: KnowledgeKeywordQuery = {
      text: c.query,
      limit: c.limit,
      sourceTypes: c.sourceTypes as KnowledgeSourceType[] | undefined,
      visibilityCeiling: (c.visibilityCeiling as KnowledgeVisibility | undefined) ?? "public",
      currentTime: c.currentTime,
    };

    const hits = opts.keywordIndex.search(query);

    actualIds = hits.map((h) => h.chunk.id);
    details = hits.map((h, i) => ({
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

    // Temporal leak: a chunk appeared in results that should be excluded by currentTime.
    // Use dayIndex directly — the authoritative field for temporal comparison.
    if (c.currentTime) {
      const currentDay = c.currentTime.dayIndex;
      for (const h of hits) {
        const chunk = chunkById.get(h.chunk.id);
        if (!chunk) continue;
        if (chunk.validFrom !== undefined && currentDay < chunk.validFrom.dayIndex) {
          temporalLeakCount++;
        }
        if (chunk.validUntil !== undefined && currentDay > chunk.validUntil.dayIndex) {
          temporalLeakCount++;
        }
      }
    }

    results.push(computeCaseResult(c, actualIds, details, retrievalSkipped));
  }

  return { results, visibilityLeakCount, temporalLeakCount, missingReferencedIds };
}

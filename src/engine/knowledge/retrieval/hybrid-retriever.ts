/**
 * KnowledgeHybridRetriever — fuses keyword (FTS5) and vector (cosine) results
 * via weighted Reciprocal Rank Fusion.
 *
 * The retriever owns the full vector channel, including:
 *  1. Embedding the query via the EmbeddingProvider.
 *  2. Searching the vector index with the resulting vector.
 *
 * Any failure in either step is subject to `vectorFailureMode`:
 *  "fail"         — propagate the original error (default).
 *  "keyword_only" — swallow and return keyword hits plus a VectorDegradation
 *                   record describing the failure.
 *
 * RRF parameter validation:
 *  k, keywordWeight, vectorWeight must be finite numbers.
 *  k > 0; weights >= 0; at least one weight > 0.
 *  limit must be a positive integer.
 */
import type { KnowledgeKeywordIndex } from "../index/keyword-index";
import type { KnowledgeVectorIndex } from "../vector/vector-index";
import { NoEmbeddingsForModelError } from "../vector/vector-index";
import { EmbeddingValidationError, validateEmbeddingResult } from "../embedding/validation";
import type { EmbeddingProvider } from "../embedding/provider";
import { reciprocalRankFusion } from "./reciprocal-rank-fusion";
import type { RrfInput } from "./reciprocal-rank-fusion";
import type {
  KnowledgeHybridHit,
  KnowledgeHybridQuery,
  KnowledgeHybridResult,
  VectorDegradation,
} from "./types";
import type { KnowledgeChunk } from "../model";

export class KnowledgeHybridRetriever {
  constructor(
    private readonly keywordIndex: KnowledgeKeywordIndex,
    private readonly vectorIndex: KnowledgeVectorIndex,
    private readonly provider: EmbeddingProvider,
  ) {}

  async retrieve(query: KnowledgeHybridQuery): Promise<KnowledgeHybridResult> {
    const { limit, vectorFailureMode = "fail", signal } = query;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`[hybrid-retriever] limit must be a positive integer, got ${limit}`);
    }

    const rrfK = query.rrfK ?? 60;
    const kwWeight = query.keywordWeight ?? 1;
    const vecWeight = query.vectorWeight ?? 1;
    validateRrfParams(rrfK, kwWeight, vecWeight);

    // Search both channels with at least 2× limit so fusion can promote
    // cross-channel results that neither channel would surface individually.
    const channelLimit = Math.max(limit * 2, 20);
    const modelKey = this.provider.modelKey;

    // ── Keyword search (synchronous, cannot fail from vector channel) ─────────
    const kwHits = this.keywordIndex.search({
      text: query.text,
      limit: channelLimit,
      sourceTypes: query.sourceTypes ? [...query.sourceTypes] : undefined,
      tagFilter: query.tagFilter
        ? { values: [...query.tagFilter.values], mode: query.tagFilter.mode }
        : undefined,
      entityFilter: query.entityFilter
        ? { values: [...query.entityFilter.values], mode: query.entityFilter.mode }
        : undefined,
      locationFilter: query.locationFilter
        ? { values: [...query.locationFilter.values], mode: query.locationFilter.mode }
        : undefined,
      visibilityCeiling: query.visibilityCeiling,
      currentTime: query.currentTime,
    });

    // ── Vector channel — embed query then search ───────────────────────────────
    let vecHits: ReturnType<KnowledgeVectorIndex["search"]> = [];
    let vectorDegradation: VectorDegradation | undefined;

    try {
      // Step 1: embed the query
      const embedResult = await this.provider.embed({
        texts: [query.text],
        purpose: "query",
        signal,
      });

      // Validate query embedding before searching
      validateEmbeddingResult(embedResult, 1);
      const queryVector = embedResult.vectors[0]!;

      // Step 2: search the vector index
      vecHits = this.vectorIndex.search({
        vector: queryVector,
        modelKey,
        limit: channelLimit,
        sourceTypes: query.sourceTypes,
        tagFilter: query.tagFilter,
        entityFilter: query.entityFilter,
        locationFilter: query.locationFilter,
        visibilityCeiling: query.visibilityCeiling,
        currentTime: query.currentTime,
      });
    } catch (err) {
      if (vectorFailureMode === "fail") throw err;
      vectorDegradation = classifyVectorError(err);
    }

    // ── Build merged hit map ──────────────────────────────────────────────────
    type HitEntry = RrfInput & { chunk: KnowledgeChunk };
    const hitMap = new Map<string, HitEntry>();

    for (let i = 0; i < kwHits.length; i++) {
      const h = kwHits[i]!;
      hitMap.set(h.chunk.id, {
        chunkId: h.chunk.id,
        chunk: h.chunk,
        keywordRank: i + 1,
        keywordScore: h.bm25Score,
        vectorRank: null,
        cosineScore: null,
      });
    }

    if (!vectorDegradation) {
      for (let i = 0; i < vecHits.length; i++) {
        const h = vecHits[i]!;
        const existing = hitMap.get(h.chunk.id);
        if (existing) {
          hitMap.set(h.chunk.id, {
            ...existing,
            vectorRank: i + 1,
            cosineScore: h.cosineScore,
          });
        } else {
          hitMap.set(h.chunk.id, {
            chunkId: h.chunk.id,
            chunk: h.chunk,
            keywordRank: null,
            keywordScore: null,
            vectorRank: i + 1,
            cosineScore: h.cosineScore,
          });
        }
      }
    }

    if (hitMap.size === 0) {
      return { hits: [], vectorDegradation };
    }

    // ── Fuse ──────────────────────────────────────────────────────────────────
    const inputs: HitEntry[] = [...hitMap.values()];
    const fused = reciprocalRankFusion(inputs, {
      k: rrfK,
      keywordWeight: kwWeight,
      vectorWeight: vecWeight,
    });

    const hits: KnowledgeHybridHit[] = fused.slice(0, limit).map((f) => {
      const src = hitMap.get(f.chunkId)!;
      return {
        chunk: src.chunk,
        hybridScore: f.hybridScore,
        rank: f.fusedRank,
        keywordRank: f.keywordRank,
        keywordScore: f.keywordScore,
        vectorRank: f.vectorRank,
        cosineScore: f.cosineScore,
      };
    });

    return { hits, vectorDegradation };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function classifyVectorError(err: unknown): VectorDegradation {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof NoEmbeddingsForModelError) {
    return { reason: "no_embeddings", message };
  }
  if (err instanceof EmbeddingValidationError) {
    return { reason: "invalid_embedding", message };
  }
  // Heuristic: provider errors from network/auth tend to include common words
  if (message.includes("API") || message.includes("key") || message.includes("fetch") ||
      message.includes("network") || message.includes("timeout") || message.includes("401") ||
      message.includes("403") || message.includes("429")) {
    return { reason: "provider_error", message };
  }
  return { reason: "search_error", message };
}

function validateRrfParams(k: number, kwWeight: number, vecWeight: number): void {
  if (!isFinite(k) || k <= 0) {
    throw new RangeError(`[hybrid-retriever] rrfK must be finite and > 0, got ${k}`);
  }
  if (!isFinite(kwWeight) || kwWeight < 0) {
    throw new RangeError(`[hybrid-retriever] keywordWeight must be finite and ≥ 0, got ${kwWeight}`);
  }
  if (!isFinite(vecWeight) || vecWeight < 0) {
    throw new RangeError(`[hybrid-retriever] vectorWeight must be finite and ≥ 0, got ${vecWeight}`);
  }
  if (kwWeight === 0 && vecWeight === 0) {
    throw new RangeError(`[hybrid-retriever] at least one of keywordWeight or vectorWeight must be > 0`);
  }
}

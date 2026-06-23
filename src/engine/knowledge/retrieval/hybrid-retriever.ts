/**
 * KnowledgeHybridRetriever — fuses keyword (FTS5) and vector (cosine) results
 * into a single ranked list via weighted Reciprocal Rank Fusion.
 *
 * Caller responsibilities:
 *  1. Build query vector before calling retrieve() (use your EmbeddingProvider).
 *  2. Supply both a KnowledgeKeywordIndex and a KnowledgeVectorIndex that point
 *     to the same underlying SQLite database.
 *
 * Error semantics:
 *  - vectorFailureMode="fail" (default): if vector search throws, propagate.
 *  - vectorFailureMode="keyword_only": swallow vector errors; return keyword hits.
 */
import type { KnowledgeKeywordIndex } from "../index/keyword-index";
import type { KnowledgeVectorIndex } from "../vector/vector-index";
import { reciprocalRankFusion } from "./reciprocal-rank-fusion";
import type { RrfInput } from "./reciprocal-rank-fusion";
import type { KnowledgeHybridHit, KnowledgeHybridQuery } from "./types";

export class KnowledgeHybridRetriever {
  constructor(
    private readonly keywordIndex: KnowledgeKeywordIndex,
    private readonly vectorIndex: KnowledgeVectorIndex,
  ) {}

  retrieve(query: KnowledgeHybridQuery): KnowledgeHybridHit[] {
    const limit = Math.max(1, query.limit);
    // Search both channels with at least 2× limit to allow fusion to promote
    // cross-channel results that neither channel would surface individually.
    const channelLimit = Math.max(limit * 2, 20);
    const failMode = query.vectorFailureMode ?? "fail";

    const rrfK = query.rrfK ?? 60;
    const kwWeight = query.keywordWeight ?? 1;
    const vecWeight = query.vectorWeight ?? 1;

    // ── Keyword search ────────────────────────────────────────────────────────
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

    // ── Vector search ─────────────────────────────────────────────────────────
    let vecHits: ReturnType<KnowledgeVectorIndex["search"]> = [];
    let vectorFailed = false;

    try {
      vecHits = this.vectorIndex.search({
        vector: query.queryVector,
        modelKey: query.modelKey,
        limit: channelLimit,
        sourceTypes: query.sourceTypes,
        tagFilter: query.tagFilter,
        entityFilter: query.entityFilter,
        locationFilter: query.locationFilter,
        visibilityCeiling: query.visibilityCeiling,
        currentTime: query.currentTime,
      });
    } catch (err) {
      if (failMode === "fail") throw err;
      vectorFailed = true; // "keyword_only" — continue below
    }

    // ── Build merged hit map ──────────────────────────────────────────────────
    // Key: chunk ID → RrfInput accumulator
    const hitMap = new Map<string, RrfInput & { chunk: import("../model").KnowledgeChunk }>();

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

    if (!vectorFailed) {
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

    if (hitMap.size === 0) return [];

    // ── Fuse ──────────────────────────────────────────────────────────────────
    const inputs: Array<RrfInput & { chunk: import("../model").KnowledgeChunk }> = [...hitMap.values()];
    const fused = reciprocalRankFusion(inputs, { k: rrfK, keywordWeight: kwWeight, vectorWeight: vecWeight });

    return fused.slice(0, limit).map((f) => {
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
  }
}

/**
 * Shared types for the hybrid (keyword + vector) retrieval layer.
 */
import type { GameTime } from "../../calendar/time";
import type { KnowledgeChunk, KnowledgeMetadataFilter, KnowledgeSourceType, KnowledgeVisibility } from "../model";

/**
 * Input to the hybrid retriever.  Metadata filter semantics are identical to
 * KnowledgeKeywordQuery / KnowledgeVectorQuery so all three channels apply the
 * same access-control checks independently.
 */
export interface KnowledgeHybridQuery {
  /** Natural-language query string.  Used for both keyword tokenisation and embedding. */
  readonly text: string;
  /** Model/cache key for the pre-embedded query vector. */
  readonly modelKey: string;
  /** Pre-embedded query vector (caller embeds before calling retrieve). */
  readonly queryVector: readonly number[];
  /** Maximum number of results to return after fusion. */
  readonly limit: number;

  readonly sourceTypes?: readonly KnowledgeSourceType[];
  readonly tagFilter?: KnowledgeMetadataFilter;
  readonly entityFilter?: KnowledgeMetadataFilter;
  readonly locationFilter?: KnowledgeMetadataFilter;
  readonly visibilityCeiling?: KnowledgeVisibility;
  readonly currentTime?: GameTime;

  /**
   * Behaviour when the vector index is unavailable or has no embeddings for
   * this modelKey:
   *  "fail"         — throw an error (default)
   *  "keyword_only" — silently return keyword results only
   */
  readonly vectorFailureMode?: "fail" | "keyword_only";

  /** RRF constant k.  Higher values reduce the influence of rank gaps. Default 60. */
  readonly rrfK?: number;
  /** Weight applied to the keyword rank term.  Default 1. */
  readonly keywordWeight?: number;
  /** Weight applied to the vector rank term.  Default 1. */
  readonly vectorWeight?: number;
}

export interface KnowledgeHybridHit {
  readonly chunk: KnowledgeChunk;
  /** Fused score: kw/(k+kwRank) + vec/(k+vecRank), weighted. */
  readonly hybridScore: number;
  /** 1-based rank in the fused result list. */
  readonly rank: number;
  /** 1-based keyword rank, or null if not in keyword results. */
  readonly keywordRank: number | null;
  /** BM25 score from keyword search (negated, so higher = more relevant), or null. */
  readonly keywordScore: number | null;
  /** 1-based vector rank, or null if not in vector results. */
  readonly vectorRank: number | null;
  /** Cosine similarity score, or null if not in vector results. */
  readonly cosineScore: number | null;
}

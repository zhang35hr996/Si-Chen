/**
 * Shared types for the hybrid (keyword + vector) retrieval layer.
 */
import type { GameTime } from "../../calendar/time";
import type { KnowledgeChunk, KnowledgeMetadataFilter, KnowledgeSourceType, KnowledgeVisibility } from "../model";

/**
 * Input to the hybrid retriever.
 *
 * The retriever owns query embedding — callers provide only the text.
 * The model key is derived from the EmbeddingProvider supplied to the
 * retriever constructor.
 */
export interface KnowledgeHybridQuery {
  /** Natural-language query string. Used for both keyword tokenisation and embedding. */
  readonly text: string;
  /** Maximum number of results to return after fusion. */
  readonly limit: number;

  readonly sourceTypes?: readonly KnowledgeSourceType[];
  readonly tagFilter?: KnowledgeMetadataFilter;
  readonly entityFilter?: KnowledgeMetadataFilter;
  readonly locationFilter?: KnowledgeMetadataFilter;
  readonly visibilityCeiling?: KnowledgeVisibility;
  readonly currentTime?: GameTime;

  /**
   * AbortSignal forwarded to the embedding provider call.
   * Has no effect on the (synchronous) keyword and vector index searches.
   */
  readonly signal?: AbortSignal;

  /**
   * Behaviour when the vector channel fails for ANY reason — including provider
   * errors, query-embedding failures, invalid cardinality/dimensions, and
   * missing model embeddings:
   *  "fail"         — propagate the original error (default)
   *  "keyword_only" — return keyword-only hits plus a VectorDegradation record
   */
  readonly vectorFailureMode?: "fail" | "keyword_only";

  /** RRF constant k.  Must be finite and > 0.  Default 60. */
  readonly rrfK?: number;
  /** Weight applied to the keyword rank term.  Must be finite and ≥ 0.  Default 1. */
  readonly keywordWeight?: number;
  /** Weight applied to the vector rank term.  Must be finite and ≥ 0.  Default 1. */
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
  /** BM25 score from keyword search (normalised, higher = more relevant), or null. */
  readonly keywordScore: number | null;
  /** 1-based vector rank, or null if not in vector results. */
  readonly vectorRank: number | null;
  /** Cosine similarity score, or null if not in vector results. */
  readonly cosineScore: number | null;
}

/** Describes why the vector channel was degraded in keyword_only mode. */
export interface VectorDegradation {
  /** Machine-readable reason category. */
  readonly reason:
    | "provider_error"      // embedding provider threw
    | "no_embeddings"       // modelKey not yet indexed
    | "invalid_embedding"   // cardinality / dimension / value error
    | "search_error";       // vector index search threw for another reason
  /** Human-readable description of the error. */
  readonly message: string;
}

/** Return value of KnowledgeHybridRetriever.retrieve(). */
export interface KnowledgeHybridResult {
  readonly hits: KnowledgeHybridHit[];
  /**
   * Present when `vectorFailureMode="keyword_only"` and the vector channel
   * failed.  Absent in `fail` mode (the error is re-thrown instead) and when
   * the vector channel succeeded.
   */
  readonly vectorDegradation?: VectorDegradation;
}

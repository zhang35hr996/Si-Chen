/**
 * KnowledgeKeywordIndex — synchronous interface for FTS5-backed keyword search.
 *
 * Implementations must not leak SQLite types into this interface.
 *
 * Score semantics:
 *   bm25Score is normalized so that HIGHER = MORE RELEVANT.
 *   This is the inverse of SQLite's raw bm25() output, which returns negative
 *   values where more-negative = better match.
 */
import type { GameTime } from "../../calendar/time";
import type { KnowledgeChunk, KnowledgeSourceType, KnowledgeVisibility } from "../model";

export interface KnowledgeKeywordQuery {
  /** Raw search text.  May contain Chinese characters. */
  text: string;
  /** Maximum number of results to return.  Must be ≥ 1. */
  limit: number;

  /** If provided, only these source types are returned (OR semantics). */
  sourceTypes?: KnowledgeSourceType[];

  /** Tag filter.  Default mode is "any". */
  tagFilter?: {
    values: string[];
    mode: "any" | "all";
  };

  /** Entity ID filter. Default mode is "any". */
  entityFilter?: {
    values: string[];
    mode: "any" | "all";
  };

  /** Location ID filter. Default mode is "any". */
  locationFilter?: {
    values: string[];
    mode: "any" | "all";
  };

  /**
   * Maximum visibility level the caller is permitted to see.
   * Defaults to "public" when omitted (safe default for unauthenticated queries).
   * Runtime query builders must always supply this explicitly.
   */
  visibilityCeiling?: KnowledgeVisibility;

  /**
   * Current in-game time for temporal filtering.
   * When absent: no temporal filtering is applied (useful for authoring/debug).
   * When present: only chunks valid at this time are returned.
   */
  currentTime?: GameTime;
}

export interface KnowledgeKeywordHit {
  chunk: KnowledgeChunk;
  /** Normalized BM25 score: higher = more relevant. */
  bm25Score: number;
}

/** Synchronous keyword search index backed by SQLite FTS5. */
export interface KnowledgeKeywordIndex {
  /**
   * Rebuild the entire index from the provided chunk set.
   * Uses a single transaction: either all chunks are indexed or none are.
   * Any existing data is replaced.
   */
  rebuild(chunks: readonly KnowledgeChunk[]): void;

  /**
   * Execute a keyword search.  Returns an empty array for empty queries.
   * Malformed FTS syntax is sanitized before reaching SQLite.
   */
  search(query: KnowledgeKeywordQuery): KnowledgeKeywordHit[];

  /** Release the database connection. */
  close(): void;
}

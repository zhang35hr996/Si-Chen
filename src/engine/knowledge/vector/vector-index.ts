/**
 * KnowledgeVectorIndex — interface for embedding-backed vector search.
 *
 * Metadata filter semantics (visibility, temporal, tag/entity/location) are
 * identical to KnowledgeKeywordQuery so the two retrieval channels can be used
 * interchangeably in the hybrid retriever.
 */
import type { GameTime } from "../../calendar/time";
import type {
  KnowledgeChunk,
  KnowledgeMetadataFilter,
  KnowledgeSourceType,
  KnowledgeVisibility,
} from "../model";

export class NoEmbeddingsForModelError extends Error {
  constructor(modelKey: string) {
    super(`[vector-index] no embeddings found for modelKey="${modelKey}" — run knowledge:embed first`);
    this.name = "NoEmbeddingsForModelError";
  }
}

export interface KnowledgeVectorQuery {
  /** Pre-computed query embedding vector. */
  readonly vector: readonly number[];
  /** Cache/model key, e.g. "openai:text-embedding-3-small". */
  readonly modelKey: string;
  /** Maximum number of results. */
  readonly limit: number;

  /** If provided, only these source types are returned. */
  readonly sourceTypes?: readonly KnowledgeSourceType[];

  readonly tagFilter?: KnowledgeMetadataFilter;
  readonly entityFilter?: KnowledgeMetadataFilter;
  readonly locationFilter?: KnowledgeMetadataFilter;

  /** Defaults to "public" when omitted. */
  readonly visibilityCeiling?: KnowledgeVisibility;

  /**
   * When absent: no temporal filtering (authoring / debug).
   * When present: only chunks valid at this time are returned.
   */
  readonly currentTime?: GameTime;
}

export interface KnowledgeVectorHit {
  readonly chunk: KnowledgeChunk;
  /** Cosine similarity in [-1, 1]; higher = more similar. */
  readonly cosineScore: number;
  /** 1-based rank in the result list. */
  readonly rank: number;
}

/** Sync statistics returned by syncEmbeddings. */
export interface EmbeddingSyncStats {
  readonly totalChunks: number;
  readonly cacheHits: number;
  readonly embeddedChunks: number;
  readonly batches: number;
  readonly modelKey: string;
  readonly dimensions: number;
}

/** Cache metadata returned when an entry exists; null when absent. */
export interface EmbeddingCacheMeta {
  readonly dimensions: number;
}

/** Vector search and embedding persistence interface. */
export interface KnowledgeVectorIndex {
  /**
   * Returns cache metadata (at minimum: dimensions) for the given
   * (modelKey, contentHash) pair, or null if no entry exists.
   */
  getCachedEmbeddingMeta(modelKey: string, contentHash: string): EmbeddingCacheMeta | null;

  /**
   * Returns true when the embedding cache contains an entry for (modelKey, contentHash).
   * Convenience wrapper around getCachedEmbeddingMeta.
   */
  hasCachedEmbedding(modelKey: string, contentHash: string): boolean;

  /**
   * Persists embeddings and chunk mappings in a single atomic transaction:
   *
   * - Entries with `vector` defined: write cache + mapping (new embeddings).
   * - Entries with `vector` undefined: write mapping only (cache hit — vector
   *   already stored from a previous sync under the same content hash).
   * - After writing, stale mappings (chunk IDs in DB but not in currentChunkIds)
   *   are removed.
   *
   * All three operations happen in one transaction — no partial state possible.
   *
   * Invariant: every `entry.chunkId` MUST be a member of `currentChunkIds`.
   * Violating this causes the freshly-inserted mapping to be pruned in the same
   * transaction (the SELECT inside the transaction sees its own writes).
   */
  persistEmbeddings(
    modelKey: string,
    dimensions: number,
    currentChunkIds: ReadonlySet<string>,
    entries: ReadonlyArray<{
      readonly chunkId: string;
      readonly contentHash: string;
      /** Present for newly embedded chunks; absent for cache hits. */
      readonly vector?: readonly number[];
    }>,
  ): void;

  /**
   * Brute-force cosine search.
   *
   * Loads all candidates that match the metadata filters and have embeddings
   * for the requested modelKey, then computes cosine similarity in Node and
   * returns the top-k sorted by score descending.
   *
   * Throws `NoEmbeddingsForModelError` when the modelKey has no embeddings at
   * all (not indexed yet).  Returns `[]` (empty, not an error) when embeddings
   * exist but no chunks survive the metadata filters.
   *
   * Throws on query vector dimension mismatch with stored vectors.
   */
  search(query: KnowledgeVectorQuery): KnowledgeVectorHit[];

  /** Release the database connection. */
  close(): void;
}

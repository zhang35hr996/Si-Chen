/**
 * SQLite-backed vector index.
 *
 * Uses the same .knowledge.db file as SqliteKeywordIndex to keep chunk data
 * and embeddings in a single consistent database.
 *
 * Schema (two tables added alongside the FTS5 tables):
 *
 *   knowledge_embedding_cache
 *     PRIMARY KEY (model_key, content_hash)
 *     Stores Float32 BLOB vectors keyed by content hash.  A chunk whose
 *     source path changes but whose embedding text is unchanged gets a cache
 *     hit — no provider round-trip is needed.
 *
 *   knowledge_chunk_embeddings
 *     PRIMARY KEY (chunk_id, model_key)
 *     Maps current chunk IDs to cache entries.  Stale mappings for removed
 *     chunks are pruned during each sync.
 *
 * Vector search:
 *   JOIN knowledge_chunk_embeddings → knowledge_embedding_cache → knowledge_chunks.
 *   Applies all metadata filters in SQL; loads candidate vectors into Node for
 *   brute-force cosine computation.  Adequate for a small static lore corpus.
 *
 * syncEmbeddings (exported alongside this class):
 *   Orchestrates provider batching without holding a SQLite transaction during
 *   network calls.  Writes all results in a single atomic transaction only
 *   after every batch completes and its results are validated.  A batch failure
 *   leaves the existing index unmodified.
 */
import Database from "better-sqlite3";
import type { KnowledgeChunk, KnowledgeSourceType } from "../model";
import { visibilitiesAtOrBelow } from "../model";
import type { EmbeddingProvider } from "../embedding/provider";
import { validateEmbeddingResult, EmbeddingValidationError } from "../embedding/validation";
import { contentHash, compileKnowledgeEmbeddingText } from "../embedding/document-text";
import { cosineSimilarity } from "./cosine";
import { decodeVector, encodeVector } from "./vector-codec";
import type {
  EmbeddingCacheMeta,
  EmbeddingSyncStats,
  KnowledgeVectorHit,
  KnowledgeVectorIndex,
  KnowledgeVectorQuery,
} from "./vector-index";
import { NoEmbeddingsForModelError } from "./vector-index";
import { fromTurnIndex } from "../../calendar/time";

// ── Database row type ─────────────────────────────────────────────────────────

interface CandidateRow {
  chunk_id: string;
  vector_blob: Buffer;
  dimensions: number;
  source_type: string;
  title: string;
  text: string;
  visibility: string;
  valid_from_day: number | null;
  valid_until_day: number | null;
  source_path: string;
  tags_json: string;
  entity_ids_json: string;
  location_ids_json: string;
}

// ── SqliteVectorIndex ─────────────────────────────────────────────────────────

export class SqliteVectorIndex implements KnowledgeVectorIndex {
  readonly db: Database.Database; // readonly; package-internal access for syncEmbeddings

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_embedding_cache (
        model_key    TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        dimensions   INTEGER NOT NULL,
        vector_blob  BLOB NOT NULL,
        PRIMARY KEY (model_key, content_hash)
      );

      CREATE TABLE IF NOT EXISTS knowledge_chunk_embeddings (
        chunk_id     TEXT NOT NULL,
        model_key    TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        PRIMARY KEY (chunk_id, model_key)
      );
      CREATE INDEX IF NOT EXISTS idx_kce_mk
        ON knowledge_chunk_embeddings(model_key);
    `);
  }

  getCachedEmbeddingMeta(modelKey: string, hash: string): EmbeddingCacheMeta | null {
    const row = this.db
      .prepare(
        "SELECT dimensions FROM knowledge_embedding_cache WHERE model_key = ? AND content_hash = ?",
      )
      .get(modelKey, hash) as { dimensions: number } | undefined;
    return row ? { dimensions: row.dimensions } : null;
  }

  hasCachedEmbedding(modelKey: string, hash: string): boolean {
    return this.getCachedEmbeddingMeta(modelKey, hash) !== null;
  }

  persistEmbeddings(
    modelKey: string,
    dimensions: number,
    currentChunkIds: ReadonlySet<string>,
    entries: ReadonlyArray<{
      readonly chunkId: string;
      readonly contentHash: string;
      readonly vector?: readonly number[];
    }>,
  ): void {
    const upsertCache = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_embedding_cache
        (model_key, content_hash, dimensions, vector_blob)
      VALUES (?, ?, ?, ?)
    `);
    const upsertMapping = this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_chunk_embeddings
        (chunk_id, model_key, content_hash)
      VALUES (?, ?, ?)
    `);
    const deleteStale = this.db.prepare(
      "DELETE FROM knowledge_chunk_embeddings WHERE model_key = ? AND chunk_id = ?",
    );

    const tx = this.db.transaction(() => {
      for (const entry of entries) {
        if (entry.vector !== undefined) {
          upsertCache.run(
            modelKey,
            entry.contentHash,
            dimensions,
            encodeVector(entry.vector),
          );
        }
        upsertMapping.run(entry.chunkId, modelKey, entry.contentHash);
      }

      // Prune stale mappings for this modelKey
      const existing = this.db
        .prepare(
          "SELECT chunk_id FROM knowledge_chunk_embeddings WHERE model_key = ?",
        )
        .all(modelKey) as Array<{ chunk_id: string }>;

      for (const row of existing) {
        if (!currentChunkIds.has(row.chunk_id)) {
          deleteStale.run(modelKey, row.chunk_id);
        }
      }
    });

    tx();
  }

  search(query: KnowledgeVectorQuery): KnowledgeVectorHit[] {
    // Throw when the model has no embeddings at all (not just filtered-out).
    const modelCount = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM knowledge_chunk_embeddings WHERE model_key = ?")
      .get(query.modelKey) as { cnt: number };
    if (modelCount.cnt === 0) {
      throw new NoEmbeddingsForModelError(query.modelKey);
    }

    const limit = Math.max(1, Math.min(query.limit, 10000));
    const ceiling = query.visibilityCeiling ?? "public";
    const allowedVisibilities = visibilitiesAtOrBelow(ceiling);

    // ── Dynamic WHERE conditions (mirrors sqlite-fts5.ts filter semantics) ───
    const conditions: string[] = [];
    const params: (string | number | null)[] = [];

    if (query.tagFilter && query.tagFilter.values.length > 0) {
      if (query.tagFilter.mode === "all") {
        for (const tag of query.tagFilter.values) {
          conditions.push(
            "c.id IN (SELECT chunk_id FROM knowledge_chunk_tags WHERE tag = ?)",
          );
          params.push(tag);
        }
      } else {
        const ph = query.tagFilter.values.map(() => "?").join(",");
        conditions.push(
          `c.id IN (SELECT chunk_id FROM knowledge_chunk_tags WHERE tag IN (${ph}))`,
        );
        params.push(...query.tagFilter.values);
      }
    }

    if (query.entityFilter && query.entityFilter.values.length > 0) {
      if (query.entityFilter.mode === "all") {
        for (const eid of query.entityFilter.values) {
          conditions.push(
            "c.id IN (SELECT chunk_id FROM knowledge_chunk_ents WHERE entity_id = ?)",
          );
          params.push(eid);
        }
      } else {
        const ph = query.entityFilter.values.map(() => "?").join(",");
        conditions.push(
          `c.id IN (SELECT chunk_id FROM knowledge_chunk_ents WHERE entity_id IN (${ph}))`,
        );
        params.push(...query.entityFilter.values);
      }
    }

    if (query.locationFilter && query.locationFilter.values.length > 0) {
      if (query.locationFilter.mode === "all") {
        for (const lid of query.locationFilter.values) {
          conditions.push(
            "c.id IN (SELECT chunk_id FROM knowledge_chunk_locs WHERE location_id = ?)",
          );
          params.push(lid);
        }
      } else {
        const ph = query.locationFilter.values.map(() => "?").join(",");
        conditions.push(
          `c.id IN (SELECT chunk_id FROM knowledge_chunk_locs WHERE location_id IN (${ph}))`,
        );
        params.push(...query.locationFilter.values);
      }
    }

    if (query.sourceTypes && query.sourceTypes.length > 0) {
      const ph = query.sourceTypes.map(() => "?").join(",");
      conditions.push(`c.source_type IN (${ph})`);
      params.push(...query.sourceTypes);
    }

    const visPh = allowedVisibilities.map(() => "?").join(",");
    conditions.push(`c.visibility IN (${visPh})`);
    params.push(...allowedVisibilities);

    if (query.currentTime !== undefined) {
      const day = query.currentTime.dayIndex;
      conditions.push("(c.valid_from_day IS NULL OR c.valid_from_day <= ?)");
      params.push(day);
      conditions.push("(c.valid_until_day IS NULL OR c.valid_until_day >= ?)");
      params.push(day);
    }

    const whereExtra = conditions.length > 0 ? "AND " + conditions.join(" AND ") : "";

    const sql = `
      SELECT
        kce.chunk_id,
        kec.vector_blob,
        kec.dimensions,
        c.source_type,
        c.title,
        c.text,
        c.visibility,
        c.valid_from_day,
        c.valid_until_day,
        c.source_path,
        c.tags_json,
        c.entity_ids_json,
        c.location_ids_json
      FROM knowledge_chunk_embeddings kce
      JOIN knowledge_embedding_cache kec
        ON kec.model_key = kce.model_key AND kec.content_hash = kce.content_hash
      JOIN knowledge_chunks c ON c.id = kce.chunk_id
      WHERE kce.model_key = ?
        ${whereExtra}
    `;

    const allParams: (string | number | null)[] = [query.modelKey, ...params];
    const rows = this.db.prepare(sql).all(...allParams) as CandidateRow[];

    // Empty result after filtering is valid (not an error).
    if (rows.length === 0) return [];

    const firstRow = rows[0]!;
    if (firstRow.dimensions !== query.vector.length) {
      throw new Error(
        `[vector-index] dimension mismatch: stored=${firstRow.dimensions}, ` +
          `query=${query.vector.length} for modelKey="${query.modelKey}"`,
      );
    }

    // Brute-force cosine in Node
    const scored: Array<{ chunk: KnowledgeChunk; cosineScore: number }> = [];
    for (const row of rows) {
      const stored = decodeVector(row.vector_blob, row.dimensions);
      const score = cosineSimilarity(stored, query.vector as number[]);
      scored.push({ chunk: rowToChunk(row), cosineScore: score });
    }

    // Deterministic sort: cosine desc → chunk ID code-point asc
    scored.sort((a, b) => {
      if (b.cosineScore !== a.cosineScore) return b.cosineScore - a.cosineScore;
      return a.chunk.id < b.chunk.id ? -1 : a.chunk.id > b.chunk.id ? 1 : 0;
    });

    return scored.slice(0, limit).map((h, i) => ({ ...h, rank: i + 1 }));
  }

  close(): void {
    this.db.close();
  }
}

// ── Row → KnowledgeChunk reconstruction ──────────────────────────────────────

function rowToChunk(row: CandidateRow): KnowledgeChunk {
  const chunk: KnowledgeChunk = {
    id: row.chunk_id,
    sourceType: row.source_type as KnowledgeSourceType,
    title: row.title,
    text: row.text,
    tags: JSON.parse(row.tags_json) as string[],
    entityIds: JSON.parse(row.entity_ids_json) as string[],
    locationIds: JSON.parse(row.location_ids_json) as string[],
    visibility: row.visibility as KnowledgeChunk["visibility"],
    sourcePath: row.source_path,
  };
  if (row.valid_from_day !== null) {
    (chunk as { validFrom?: unknown }).validFrom = fromTurnIndex(row.valid_from_day);
  }
  if (row.valid_until_day !== null) {
    (chunk as { validUntil?: unknown }).validUntil = fromTurnIndex(row.valid_until_day);
  }
  return chunk;
}

// ── syncEmbeddings ────────────────────────────────────────────────────────────

export interface SyncEmbeddingsOptions {
  chunks: readonly KnowledgeChunk[];
  provider: EmbeddingProvider;
  vectorIndex: SqliteVectorIndex;
  /**
   * Number of chunks per provider batch call.
   * Must be an integer in [1, 2048].  Default 100.
   */
  batchSize?: number;
  signal?: AbortSignal;
}

/**
 * Syncs embeddings for all supplied chunks against the provider's model.
 *
 * Contract:
 *  1. `batchSize` must be an integer in [1, 2048]; throws immediately otherwise.
 *  2. Compiles deterministic embedding text + SHA-256 hash per chunk.
 *  3. Cache-checks (model_key, content_hash) without a held transaction.
 *     Deduplicates by hash: identical chunks count as one miss.
 *  4. Provider is called ONLY for cache misses; calls are batched.
 *  5. Dimensions are validated to be CONSISTENT ACROSS ALL BATCHES.
 *     A second batch returning a different dimension count is a hard error;
 *     the DB is not written (no partial state committed).
 *  6. All batch results are validated before any DB write.
 *  7. All cache writes, mapping writes, and stale-mapping pruning happen in a
 *     SINGLE atomic transaction.  A batch failure leaves existing state intact.
 */
export async function syncEmbeddings(opts: SyncEmbeddingsOptions): Promise<EmbeddingSyncStats> {
  const { chunks, provider, vectorIndex, signal } = opts;
  const modelKey = provider.modelKey;

  // 0. Validate batchSize before doing any work.
  const bs = opts.batchSize ?? 100;
  if (!Number.isInteger(bs) || bs < 1 || bs > 2048) {
    throw new RangeError(
      `[syncEmbeddings] batchSize must be an integer in [1, 2048], got ${bs}`,
    );
  }
  const batchSize = bs;

  if (chunks.length === 0) {
    return { totalChunks: 0, cacheHits: 0, embeddedChunks: 0, batches: 0, modelKey, dimensions: 0 };
  }

  // 1. Compile embedding texts and content hashes
  const items = chunks.map((chunk) => {
    const text = compileKnowledgeEmbeddingText(chunk);
    const hash = contentHash(text);
    return { chunk, text, hash };
  });

  // 2. Separate cache hits from misses (no DB transaction held).
  //    Dedup by content hash: identical-content chunks count as one miss.
  const seenHashes = new Set<string>();
  const misses: typeof items = [];
  let cacheHits = 0;
  for (const item of items) {
    if (vectorIndex.hasCachedEmbedding(modelKey, item.hash)) {
      cacheHits++;
    } else if (seenHashes.has(item.hash)) {
      cacheHits++; // same content, covered by the first occurrence
    } else {
      seenHashes.add(item.hash);
      misses.push(item);
    }
  }

  // 3. Batch-call provider for misses; accumulate results before writing.
  //    Track a single expected dimension across all batches — any deviation
  //    is a hard error (prevents silently committing a corrupted cache).
  const newVectors = new Map<string, { vector: readonly number[]; dimensions: number }>();
  const batchCount = Math.ceil(misses.length / batchSize);
  let expectedDimensions: number | undefined;

  for (let b = 0; b < batchCount; b++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const batch = misses.slice(b * batchSize, (b + 1) * batchSize);
    const result = await provider.embed({
      texts: batch.map((x) => x.text),
      purpose: "document",
      signal,
    });

    // 4a. Per-result validation (cardinality, dims, finite, non-zero)
    validateEmbeddingResult(result, batch.length);

    // 4b. Cross-batch dimension consistency
    if (expectedDimensions === undefined) {
      expectedDimensions = result.dimensions;
    } else if (result.dimensions !== expectedDimensions) {
      throw new EmbeddingValidationError(
        `[syncEmbeddings] cross-batch dimension mismatch: batch ${b} returned ` +
          `${result.dimensions} dims but prior batches returned ${expectedDimensions}`,
      );
    }

    for (let i = 0; i < batch.length; i++) {
      const item = batch[i]!;
      newVectors.set(item.hash, { vector: result.vectors[i]!, dimensions: result.dimensions });
    }
  }

  // Determine final dimensions.
  // When newVectors.size > 0, use the validated expectedDimensions.
  // When all items were DB cache hits, look up dimensions from the cache.
  // (DB cache hits + in-batch dedup: items[0].hash is guaranteed to be in
  // the cache because hasCachedEmbedding(items[0].hash) returned true.)
  let dimensions = 0;
  if (expectedDimensions !== undefined) {
    dimensions = expectedDimensions;

    // Also validate that cache-hit entries share the same dimension.
    // This protects against mixing models where a wrong modelKey was reused.
    if (cacheHits > 0) {
      const firstCacheHit = items.find((it) => !seenHashes.has(it.hash) || vectorIndex.hasCachedEmbedding(modelKey, it.hash));
      if (firstCacheHit) {
        const meta = vectorIndex.getCachedEmbeddingMeta(modelKey, firstCacheHit.hash);
        if (meta && meta.dimensions !== dimensions) {
          throw new EmbeddingValidationError(
            `[syncEmbeddings] dimension mismatch between cached entries (${meta.dimensions}) ` +
              `and new embeddings (${dimensions}) for modelKey="${modelKey}"`,
          );
        }
      }
    }
  } else if (cacheHits > 0) {
    // All items are DB cache hits or in-batch duplicates of DB cache hits.
    const meta = vectorIndex.getCachedEmbeddingMeta(modelKey, items[0]!.hash);
    dimensions = meta?.dimensions ?? 0;
  }

  // 5. Build the full entries list and write in ONE transaction.
  const allEntries = items.map((item) => {
    const newEntry = newVectors.get(item.hash);
    return {
      chunkId: item.chunk.id,
      contentHash: item.hash,
      vector: newEntry?.vector, // undefined for cache hits
    };
  });

  const currentChunkIds = new Set(chunks.map((c) => c.id));
  vectorIndex.persistEmbeddings(modelKey, dimensions, currentChunkIds, allEntries);

  return {
    totalChunks: chunks.length,
    cacheHits,
    embeddedChunks: misses.length,
    batches: batchCount,
    modelKey,
    dimensions,
  };
}

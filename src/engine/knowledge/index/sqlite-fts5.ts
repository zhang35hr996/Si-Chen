/**
 * SQLite FTS5 implementation of KnowledgeKeywordIndex.
 *
 * Schema overview:
 *   knowledge_chunks       — canonical chunk data + numeric visibility_rank +
 *                            dayIndex columns for temporal filtering
 *   knowledge_chunk_tags   — one row per (chunk, tag) for efficient tag filtering
 *   knowledge_chunk_ents   — one row per (chunk, entityId)
 *   knowledge_chunk_locs   — one row per (chunk, locationId)
 *   knowledge_fts          — FTS5 virtual table: title | body | bigrams
 *                            (unicode61 tokenizer)
 *
 * Chinese search strategy:
 *   SQLite's default unicode61 tokenizer splits on word boundaries.  For
 *   Chinese text without spaces it treats contiguous CJK characters as a
 *   single token, making substring queries fail.
 *
 *   To fix this, we generate character BIGRAMS from all CJK runs and store
 *   them (space-separated) in the `bigrams` FTS column.  A query for "承养"
 *   is also decomposed into bigrams before being issued; since "承养" IS a
 *   bigram, it appears as a distinct FTS token and matches correctly.
 *
 *   Non-Chinese queries use the `title` and `body` columns normally.
 *
 * BM25 direction:
 *   SQLite's bm25() returns negative values (more negative = better).
 *   We negate the raw rank so that the public bm25Score is positive and
 *   "higher = more relevant".
 *
 * Temporal filtering:
 *   validFrom is INCLUSIVE — chunk is valid at times >= validFrom.dayIndex.
 *   validUntil is INCLUSIVE — chunk is valid at times <= validUntil.dayIndex.
 *   NULL bounds = no limit.
 *
 * Visibility defaults:
 *   When visibilityCeiling is omitted, only "public" chunks are returned.
 */
import Database from "better-sqlite3";
import type { KnowledgeChunk } from "../model";
import { VISIBILITY_RANK, visibilitiesAtOrBelow } from "../model";
import type { KnowledgeKeywordHit, KnowledgeKeywordIndex, KnowledgeKeywordQuery } from "./keyword-index";
import { makeGameTime } from "../../calendar/time";
import type { MonthPeriod } from "../../calendar/time";

// ── Chinese bigram generation ─────────────────────────────────────────────────

const CJK_RE = /[一-鿿㐀-䶿豈-﫿぀-ヿ가-힯]/;

/**
 * Generate overlapping character bigrams from all CJK runs in `text`.
 * Non-CJK characters are preserved as space-separated tokens.
 * Result is a space-separated string suitable for FTS5 indexing.
 *
 * Example: "禁足期间" → "禁足 足期 期间"
 */
export function chineseBigrams(text: string): string {
  const chars = [...text];
  const tokens: string[] = [];
  let cjkRun: string[] = [];
  let nonCjkRun: string[] = [];

  const flushCjk = (): void => {
    for (let i = 0; i < cjkRun.length - 1; i++) {
      tokens.push(cjkRun[i]! + cjkRun[i + 1]!);
    }
    if (cjkRun.length === 1) tokens.push(cjkRun[0]!); // single CJK char
    cjkRun = [];
  };

  const flushNonCjk = (): void => {
    if (nonCjkRun.length === 0) return;
    // Preserve whole words — split on whitespace, emit each word as one token
    for (const w of nonCjkRun.join("").split(/\s+/)) {
      if (w.length > 0) tokens.push(w);
    }
    nonCjkRun = [];
  };

  for (const ch of chars) {
    if (CJK_RE.test(ch)) {
      flushNonCjk();
      cjkRun.push(ch);
    } else {
      flushCjk();
      nonCjkRun.push(ch);
    }
  }
  flushCjk();
  flushNonCjk();

  return tokens.join(" ");
}

// ── FTS query normalization ───────────────────────────────────────────────────

/**
 * Normalize a user query string for safe use in FTS5 MATCH.
 *
 * Steps:
 *  1. Strip FTS5 special characters that could cause syntax errors.
 *  2. Split into whitespace-delimited terms.
 *  3. For each term that contains CJK characters, also emit its bigrams so
 *     that multi-character Chinese queries are token-decomposed correctly.
 *  4. Join with a space so FTS5 AND-matches all tokens.
 *
 * Returns null for empty or whitespace-only input.
 */
export function normalizeFtsQuery(raw: string): string | null {
  // Strip FTS5 special chars to prevent syntax errors
  const safe = raw.replace(/["""''*\-()^:]/g, " ").trim();
  if (!safe) return null;

  const terms = safe.split(/\s+/).filter((t) => t.length > 0);
  if (terms.length === 0) return null;

  const ftsTokens: string[] = [];
  for (const term of terms) {
    const hasCjk = [...term].some((ch) => CJK_RE.test(ch));
    if (hasCjk) {
      // Decompose into bigrams for proper Chinese token matching
      const bigrams = chineseBigrams(term);
      if (bigrams.trim()) ftsTokens.push(...bigrams.split(" ").filter((t) => t.length > 0));
    } else {
      ftsTokens.push(term);
    }
  }

  if (ftsTokens.length === 0) return null;
  // Deduplicate tokens while preserving order
  const seen = new Set<string>();
  const unique = ftsTokens.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
  return unique.join(" ");
}

// ── Database row type ─────────────────────────────────────────────────────────

interface SearchRow {
  id: string;           // aliased from f.chunk_id
  raw_rank: number;
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

// ── SqliteKeywordIndex ────────────────────────────────────────────────────────

export class SqliteKeywordIndex implements KnowledgeKeywordIndex {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY NOT NULL,
        source_type TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        visibility TEXT NOT NULL,
        visibility_rank INTEGER NOT NULL,
        valid_from_day INTEGER,
        valid_until_day INTEGER,
        source_path TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        entity_ids_json TEXT NOT NULL,
        location_ids_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS knowledge_chunk_tags (
        chunk_id TEXT NOT NULL,
        tag TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kct ON knowledge_chunk_tags(tag, chunk_id);

      CREATE TABLE IF NOT EXISTS knowledge_chunk_ents (
        chunk_id TEXT NOT NULL,
        entity_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kce ON knowledge_chunk_ents(entity_id, chunk_id);

      CREATE TABLE IF NOT EXISTS knowledge_chunk_locs (
        chunk_id TEXT NOT NULL,
        location_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kcl ON knowledge_chunk_locs(location_id, chunk_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        chunk_id UNINDEXED,
        title,
        body,
        bigrams,
        tokenize = 'unicode61 remove_diacritics 1'
      );
    `);
  }

  rebuild(chunks: readonly KnowledgeChunk[]): void {
    const rebuildTx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM knowledge_chunks;
        DELETE FROM knowledge_chunk_tags;
        DELETE FROM knowledge_chunk_ents;
        DELETE FROM knowledge_chunk_locs;
        DELETE FROM knowledge_fts;
      `);

      const insertChunk = this.db.prepare(`
        INSERT INTO knowledge_chunks
          (id, source_type, title, text, visibility, visibility_rank,
           valid_from_day, valid_until_day, source_path,
           tags_json, entity_ids_json, location_ids_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertTag = this.db.prepare(
        "INSERT INTO knowledge_chunk_tags (chunk_id, tag) VALUES (?, ?)",
      );
      const insertEnt = this.db.prepare(
        "INSERT INTO knowledge_chunk_ents (chunk_id, entity_id) VALUES (?, ?)",
      );
      const insertLoc = this.db.prepare(
        "INSERT INTO knowledge_chunk_locs (chunk_id, location_id) VALUES (?, ?)",
      );
      const insertFts = this.db.prepare(
        "INSERT INTO knowledge_fts (chunk_id, title, body, bigrams) VALUES (?, ?, ?, ?)",
      );

      for (const chunk of chunks) {
        insertChunk.run(
          chunk.id,
          chunk.sourceType,
          chunk.title,
          chunk.text,
          chunk.visibility,
          VISIBILITY_RANK[chunk.visibility],
          chunk.validFrom?.dayIndex ?? null,
          chunk.validUntil?.dayIndex ?? null,
          chunk.sourcePath,
          JSON.stringify(chunk.tags),
          JSON.stringify(chunk.entityIds),
          JSON.stringify(chunk.locationIds),
        );

        for (const tag of chunk.tags) insertTag.run(chunk.id, tag);
        for (const eid of chunk.entityIds) insertEnt.run(chunk.id, eid);
        for (const lid of chunk.locationIds) insertLoc.run(chunk.id, lid);

        const bigramsText = chineseBigrams(`${chunk.title} ${chunk.text} ${chunk.tags.join(" ")}`);
        insertFts.run(chunk.id, chunk.title, chunk.text, bigramsText);
      }
    });

    rebuildTx();
  }

  search(query: KnowledgeKeywordQuery): KnowledgeKeywordHit[] {
    const ftsQuery = normalizeFtsQuery(query.text);
    if (ftsQuery === null) return [];

    const limit = Math.max(1, Math.min(query.limit, 1000));
    const ceiling = query.visibilityCeiling ?? "public";
    const allowedVisibilities = visibilitiesAtOrBelow(ceiling);

    // ── Build WHERE conditions dynamically ────────────────────────────
    const conditions: string[] = [];
    const params: (string | number | null)[] = [];

    // Tag filter
    if (query.tagFilter?.values.length) {
      if (query.tagFilter.mode === "all") {
        for (const tag of query.tagFilter.values) {
          conditions.push(
            "f.chunk_id IN (SELECT chunk_id FROM knowledge_chunk_tags WHERE tag = ?)",
          );
          params.push(tag);
        }
      } else {
        const ph = query.tagFilter.values.map(() => "?").join(",");
        conditions.push(
          `f.chunk_id IN (SELECT chunk_id FROM knowledge_chunk_tags WHERE tag IN (${ph}))`,
        );
        params.push(...query.tagFilter.values);
      }
    }

    // Entity filter
    if (query.entityFilter?.values.length) {
      if (query.entityFilter.mode === "all") {
        for (const eid of query.entityFilter.values) {
          conditions.push(
            "f.chunk_id IN (SELECT chunk_id FROM knowledge_chunk_ents WHERE entity_id = ?)",
          );
          params.push(eid);
        }
      } else {
        const ph = query.entityFilter.values.map(() => "?").join(",");
        conditions.push(
          `f.chunk_id IN (SELECT chunk_id FROM knowledge_chunk_ents WHERE entity_id IN (${ph}))`,
        );
        params.push(...query.entityFilter.values);
      }
    }

    // Location filter
    if (query.locationFilter?.values.length) {
      if (query.locationFilter.mode === "all") {
        for (const lid of query.locationFilter.values) {
          conditions.push(
            "f.chunk_id IN (SELECT chunk_id FROM knowledge_chunk_locs WHERE location_id = ?)",
          );
          params.push(lid);
        }
      } else {
        const ph = query.locationFilter.values.map(() => "?").join(",");
        conditions.push(
          `f.chunk_id IN (SELECT chunk_id FROM knowledge_chunk_locs WHERE location_id IN (${ph}))`,
        );
        params.push(...query.locationFilter.values);
      }
    }

    // Source type filter
    if (query.sourceTypes?.length) {
      const ph = query.sourceTypes.map(() => "?").join(",");
      conditions.push(`c.source_type IN (${ph})`);
      params.push(...query.sourceTypes);
    }

    // Visibility ceiling
    const visPh = allowedVisibilities.map(() => "?").join(",");
    conditions.push(`c.visibility IN (${visPh})`);
    params.push(...allowedVisibilities);

    // Temporal filter (only when currentTime is provided)
    if (query.currentTime !== undefined) {
      const day = query.currentTime.dayIndex;
      conditions.push("(c.valid_from_day IS NULL OR c.valid_from_day <= ?)");
      params.push(day);
      conditions.push("(c.valid_until_day IS NULL OR c.valid_until_day >= ?)");
      params.push(day);
    }

    const whereClause = conditions.length > 0
      ? "AND " + conditions.join(" AND ")
      : "";

    // FTS5 column weights: title=2.0, body=1.0, bigrams=0.5
    // f.chunk_id is aliased to 'id' so rowToChunk can read it by name.
    const sql = `
      SELECT f.chunk_id AS id, bm25(knowledge_fts, 2.0, 1.0, 0.5) AS raw_rank,
             c.source_type, c.title, c.text, c.visibility,
             c.valid_from_day, c.valid_until_day, c.source_path,
             c.tags_json, c.entity_ids_json, c.location_ids_json
      FROM knowledge_fts f
      JOIN knowledge_chunks c ON f.chunk_id = c.id
      WHERE knowledge_fts MATCH ?
        ${whereClause}
      ORDER BY raw_rank ASC, f.chunk_id ASC
      LIMIT ?
    `;

    // FTS query param goes first; metadata params follow; limit last
    const allParams: (string | number | null)[] = [ftsQuery, ...params, limit];

    let rows: SearchRow[];
    try {
      rows = this.db.prepare(sql).all(...allParams) as SearchRow[];
    } catch {
      // Malformed FTS query → return empty results, do not throw
      return [];
    }

    return rows.map((row) => ({
      chunk: rowToChunk(row),
      bm25Score: -row.raw_rank, // negate: higher = more relevant
    }));
  }

  close(): void {
    this.db.close();
  }
}

// ── Row → KnowledgeChunk reconstruction ──────────────────────────────────────

function rowToChunk(row: SearchRow): KnowledgeChunk {
  const tags = (JSON.parse(row.tags_json) as string[]);
  const entityIds = (JSON.parse(row.entity_ids_json) as string[]);
  const locationIds = (JSON.parse(row.location_ids_json) as string[]);

  const chunk: KnowledgeChunk = {
    id: row.id,
    sourceType: row.source_type as KnowledgeChunk["sourceType"],
    title: row.title,
    text: row.text,
    tags,
    entityIds,
    locationIds,
    visibility: row.visibility as KnowledgeChunk["visibility"],
    sourcePath: row.source_path,
  };

  if (row.valid_from_day !== null) {
    (chunk as { validFrom?: unknown }).validFrom = gameTimeFromDay(row.valid_from_day);
  }
  if (row.valid_until_day !== null) {
    (chunk as { validUntil?: unknown }).validUntil = gameTimeFromDay(row.valid_until_day);
  }

  return chunk;
}

/** Reconstruct GameTime from dayIndex.  Inverse of makeGameTime's formula. */
function gameTimeFromDay(dayIndex: number) {
  const PERIODS: MonthPeriod[] = ["early", "mid", "late"];
  const period = PERIODS[dayIndex % 3]!;
  const totalMonths = Math.floor(dayIndex / 3);
  const month = (totalMonths % 12) + 1;
  const year = Math.floor(totalMonths / 12) + 1;
  return makeGameTime(year, month, period);
}

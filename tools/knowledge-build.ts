#!/usr/bin/env tsx
/**
 * knowledge:build — ingest all Markdown lore documents and location JSON files
 * into the SQLite FTS5 knowledge index.
 *
 * Usage:
 *   npm run knowledge:build
 *   npm run knowledge:build -- --db ./custom-path.db
 *
 * The output database is written to .knowledge.db in the project root by
 * default.  It is gitignored and must be rebuilt after any source change.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ingestSources, type KnowledgeSource } from "../src/engine/knowledge/ingestion/pipeline";
import { SqliteKeywordIndex } from "../src/engine/knowledge/index/sqlite-fts5";

const args = process.argv.slice(2);
const dbFlagIdx = args.indexOf("--db");
const dbPath = dbFlagIdx !== -1 ? args[dbFlagIdx + 1]! : resolve(".knowledge.db");

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

const LORE_DIRS: string[] = [
  join(PROJECT_ROOT, "content", "knowledge"),
];
const LOCATION_DIR = join(PROJECT_ROOT, "content", "locations");

const sources: KnowledgeSource[] = [];

// ── Markdown lore documents ───────────────────────────────────────────────────
for (const dir of LORE_DIRS) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory may not exist in early stages
    continue;
  }
  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  for (const file of mdFiles) {
    const fullPath = join(dir, file);
    const relPath = `content/knowledge/${file}`;
    sources.push({
      kind: "markdown",
      content: readFileSync(fullPath, "utf-8"),
      sourcePath: relPath,
    });
  }
}

// ── Location JSON files ───────────────────────────────────────────────────────
let locationFiles: string[];
try {
  locationFiles = readdirSync(LOCATION_DIR).filter((f) => f.endsWith(".json")).sort();
} catch {
  locationFiles = [];
}
for (const file of locationFiles) {
  const fullPath = join(LOCATION_DIR, file);
  const relPath = `content/locations/${file}`;
  try {
    const data = JSON.parse(readFileSync(fullPath, "utf-8")) as unknown;
    sources.push({ kind: "json", data, sourcePath: relPath });
  } catch (e) {
    console.error(`[knowledge:build] Failed to parse ${relPath}:`, e);
  }
}

// ── Ingest ────────────────────────────────────────────────────────────────────
const errors: Parameters<typeof ingestSources>[1] = [];
const chunks = ingestSources(sources, errors);

if (errors.length > 0) {
  console.error(`[knowledge:build] ${errors.length} ingestion error(s):`);
  for (const e of errors) {
    console.error(`  ${e.code}: ${e.message}`);
  }
}

// ── Index ─────────────────────────────────────────────────────────────────────
const index = new SqliteKeywordIndex(dbPath);
try {
  index.rebuild(chunks);
  console.log(
    `[knowledge:build] Indexed ${chunks.length} chunks → ${dbPath}`,
  );
  if (errors.length > 0) {
    console.warn(`[knowledge:build] ${errors.length} source(s) had errors and were skipped.`);
    process.exit(1);
  }
} finally {
  index.close();
}

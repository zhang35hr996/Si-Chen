#!/usr/bin/env tsx
/**
 * knowledge:build — ingest all Markdown lore documents and location JSON files
 * into the SQLite FTS5 knowledge index.
 *
 * Fail-closed: if any source file cannot be read, parsed, or validated,
 * the build exits 1 WITHOUT opening or modifying the target database.
 * An existing valid database is always preserved when the build fails.
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
import { ingestSourcesStrict, type KnowledgeSource } from "../src/engine/knowledge/ingestion/pipeline";
import { SqliteKeywordIndex } from "../src/engine/knowledge/index/sqlite-fts5";

const args = process.argv.slice(2);
const dbFlagIdx = args.indexOf("--db");
const dbPath = dbFlagIdx !== -1 ? args[dbFlagIdx + 1]! : resolve(".knowledge.db");

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

const LORE_DIRS: string[] = [
  join(PROJECT_ROOT, "content", "knowledge"),
];
const LOCATION_DIR = join(PROJECT_ROOT, "content", "locations");

// ── Collect sources ───────────────────────────────────────────────────────────

const sources: KnowledgeSource[] = [];
const collectionErrors: string[] = [];

for (const dir of LORE_DIRS) {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // Directory does not yet exist — skip silently
    continue;
  }
  const mdFiles = entries.filter((f) => f.endsWith(".md")).sort();
  for (const file of mdFiles) {
    const fullPath = join(dir, file);
    const relPath = `content/knowledge/${file}`;
    try {
      sources.push({
        kind: "markdown",
        content: readFileSync(fullPath, "utf-8"),
        sourcePath: relPath,
      });
    } catch (e) {
      collectionErrors.push(`${relPath}: cannot read file: ${String(e)}`);
    }
  }
}

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
    sources.push({ kind: "location_json", data, sourcePath: relPath });
  } catch (e) {
    collectionErrors.push(`${relPath}: cannot parse JSON: ${String(e)}`);
  }
}

// Fail before opening the database if any source is unreadable/unparseable.
if (collectionErrors.length > 0) {
  console.error(`[knowledge:build] ${collectionErrors.length} source collection error(s):`);
  for (const msg of collectionErrors) {
    console.error(`  ${msg}`);
  }
  process.exit(1);
}

// ── Strict ingestion ──────────────────────────────────────────────────────────
// ingestSourcesStrict fails if any source has a validation or schema error.
// The database is NOT opened until ingestion succeeds.

const result = ingestSourcesStrict(sources);
if (!result.ok) {
  console.error(`[knowledge:build] ${result.error.length} ingestion error(s):`);
  for (const e of result.error) {
    console.error(`  ${e.code}: ${e.message}`);
  }
  process.exit(1);
}

// ── Index ─────────────────────────────────────────────────────────────────────
const index = new SqliteKeywordIndex(dbPath);
try {
  index.rebuild(result.value);
  console.log(
    `[knowledge:build] Indexed ${result.value.length} chunks → ${dbPath}`,
  );
} finally {
  index.close();
}

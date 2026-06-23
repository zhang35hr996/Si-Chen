#!/usr/bin/env tsx
/**
 * knowledge:inspect — search the knowledge index and display results.
 *
 * Usage:
 *   npm run knowledge:inspect -- "承养"
 *   npm run knowledge:inspect -- "禁足 请安" --limit 5
 *   npm run knowledge:inspect -- "宣政殿" --db ./custom.db --visibility imperial
 */
import { resolve } from "node:path";
import { SqliteKeywordIndex } from "../src/engine/knowledge/index/sqlite-fts5";
import type { KnowledgeVisibility } from "../src/engine/knowledge/model";

const VALID_VISIBILITIES = new Set<string>(["public", "restricted", "imperial"]);
const KNOWN_FLAGS = new Set(["--db", "--limit", "--visibility"]);

export interface InspectArgs {
  query: string;
  db: string;
  limit: number;
  visibility: KnowledgeVisibility;
}

/**
 * Parse CLI arguments for knowledge:inspect.
 *
 * Returns a parsed InspectArgs on success.
 * Returns null and prints an error message on invalid input (caller should exit 1).
 */
export function parseInspectArgs(rawArgs: string[], defaultDb: string): InspectArgs | null {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < rawArgs.length) {
    const a = rawArgs[i]!;
    if (KNOWN_FLAGS.has(a)) {
      const val = rawArgs[i + 1];
      if (val === undefined || val.startsWith("--")) {
        console.error(`[knowledge:inspect] ${a} requires a value`);
        return null;
      }
      flags[a.slice(2)] = val;
      i += 2;
    } else if (a.startsWith("--")) {
      console.error(`[knowledge:inspect] unknown flag: ${a}`);
      return null;
    } else {
      positional.push(a);
      i++;
    }
  }

  const query = positional.join(" ").trim();
  if (!query) {
    console.error(
      "Usage: npm run knowledge:inspect -- <query> [--limit N] [--db PATH] [--visibility public|restricted|imperial]",
    );
    return null;
  }

  const limitRaw = flags["limit"] ?? "10";
  const limit = parseInt(limitRaw, 10);
  if (isNaN(limit) || limit < 1) {
    console.error(`[knowledge:inspect] --limit must be a positive integer, got "${limitRaw}"`);
    return null;
  }

  const visibilityRaw = flags["visibility"] ?? "public";
  if (!VALID_VISIBILITIES.has(visibilityRaw)) {
    console.error(
      `[knowledge:inspect] --visibility must be public|restricted|imperial, got "${visibilityRaw}"`,
    );
    return null;
  }

  return {
    query,
    db: flags["db"] ?? defaultDb,
    limit,
    visibility: visibilityRaw as KnowledgeVisibility,
  };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────
// Guard prevents CLI execution when this module is imported (e.g. in tests).

import { fileURLToPath } from "node:url";

const isMain = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === fileURLToPath(new URL(process.argv[1], "file:"));

if (!isMain) {
  // Imported as a module — do not run CLI code
} else {

const parsed = parseInspectArgs(process.argv.slice(2), resolve(".knowledge.db"));
if (!parsed) process.exit(1);

const { query, db: dbPath, limit, visibility } = parsed;

const index = new SqliteKeywordIndex(dbPath);
try {
  const hits = index.search({ text: query, limit, visibilityCeiling: visibility });

  if (hits.length === 0) {
    console.log(`No results for "${query}".`);
  } else {
    console.log(`\n${hits.length} result(s) for "${query}":\n`);
    for (const hit of hits) {
      const c = hit.chunk;
      console.log(`  ─────────────────────────────────────────`);
      console.log(`  id:          ${c.id}`);
      console.log(`  title:       ${c.title}`);
      console.log(`  sourceType:  ${c.sourceType}`);
      console.log(`  visibility:  ${c.visibility}`);
      console.log(`  sourcePath:  ${c.sourcePath}`);
      console.log(`  bm25Score:   ${hit.bm25Score.toFixed(4)}`);
      console.log(`  text:        ${c.text.slice(0, 120)}${c.text.length > 120 ? "…" : ""}`);
    }
    console.log();
  }
} finally {
  index.close();
}

} // end isMain

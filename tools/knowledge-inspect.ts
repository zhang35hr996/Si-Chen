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

const args = process.argv.slice(2);

function getFlag(name: string, defaultVal: string): string {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] ?? defaultVal : defaultVal;
}

const query = args.filter((a) => !a.startsWith("--") && args.indexOf(a) - 1 !== args.findIndex((x) => x === "--db") && args.indexOf(a) - 1 !== args.findIndex((x) => x === "--limit") && args.indexOf(a) - 1 !== args.findIndex((x) => x === "--visibility")).join(" ").trim();

if (!query) {
  console.error("Usage: npm run knowledge:inspect -- <query> [--limit N] [--db PATH] [--visibility public|restricted|imperial]");
  process.exit(1);
}

const dbPath = getFlag("--db", resolve(".knowledge.db"));
const limit = parseInt(getFlag("--limit", "10"), 10);
const visibility = getFlag("--visibility", "public") as KnowledgeVisibility;

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

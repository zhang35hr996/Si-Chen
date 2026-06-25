#!/usr/bin/env tsx
/**
 * knowledge:eval — deterministic retrieval quality evaluation.
 *
 * Keyword mode (default / CI): fully deterministic, no network required.
 * Uses a temporary in-memory SQLite index rebuilt from the production corpus.
 *
 * Usage:
 *   npm run knowledge:eval                           # keyword mode (CI)
 *   npm run knowledge:eval -- --mode hybrid          # local benchmark (requires API key)
 *   npm run knowledge:eval -- --cases path/to/cases.jsonl
 *   npm run knowledge:eval -- --out artifacts/knowledge-eval
 *
 * Exit codes:
 *   0 — all hard gates passed
 *   1 — one or more hard gate violations (see output for details)
 *   2 — configuration or corpus error
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ingestSources, type KnowledgeSource } from "../src/engine/knowledge/ingestion/pipeline";
import { SqliteKeywordIndex } from "../src/engine/knowledge/index/sqlite-fts5";
import { parseEvalCases } from "../src/engine/knowledge/eval/schema";
import { runKeywordEval } from "../src/engine/knowledge/eval/runner";
import { computeAggregateMetrics } from "../src/engine/knowledge/eval/metrics";
import { buildReport, renderMarkdownReport } from "../src/engine/knowledge/eval/report";
import { contentError } from "../src/engine/infra/errors";
import type { GameError } from "../src/engine/infra/errors";

const args = process.argv.slice(2);
const getArg = (flag: string): string | undefined => {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
};

const mode = (getArg("--mode") ?? "keyword") as "keyword" | "hybrid";
const casesPath = getArg("--cases") ?? resolve(import.meta.dirname, "../tests/knowledge/golden/cases.jsonl");
const outDir = getArg("--out") ?? resolve(import.meta.dirname, "../artifacts/knowledge-eval");

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const LORE_DIR = join(PROJECT_ROOT, "content", "knowledge");
const LOCATION_DIR = join(PROJECT_ROOT, "content", "locations");

// ── Load corpus ───────────────────────────────────────────────────────────────

const sources: KnowledgeSource[] = [];
const collectionErrors: GameError[] = [];

// Lore markdown
try {
  const entries = readdirSync(LORE_DIR).filter((f) => f.endsWith(".md")).sort();
  for (const file of entries) {
    const fullPath = join(LORE_DIR, file);
    const relPath = `content/knowledge/${file}`;
    try {
      sources.push({ kind: "markdown", content: readFileSync(fullPath, "utf8"), sourcePath: relPath });
    } catch {
      collectionErrors.push(contentError("CORPUS_READ_ERROR", `Cannot read ${relPath}`));
    }
  }
} catch {
  // lore dir doesn't exist yet — ok
}

// Location JSON
try {
  const entries = readdirSync(LOCATION_DIR).filter((f) => f.endsWith(".json")).sort();
  for (const file of entries) {
    const fullPath = join(LOCATION_DIR, file);
    const relPath = `content/locations/${file}`;
    try {
      const data: unknown = JSON.parse(readFileSync(fullPath, "utf8"));
      sources.push({ kind: "location_json", data, sourcePath: relPath });
    } catch {
      collectionErrors.push(contentError("CORPUS_READ_ERROR", `Cannot read ${relPath}`));
    }
  }
} catch {
  // location dir doesn't exist yet — ok
}

if (collectionErrors.length > 0) {
  for (const e of collectionErrors) process.stderr.write(`[eval] corpus error: ${e.message}\n`);
  process.exit(2);
}

const ingestErrors: GameError[] = [];
const chunks = ingestSources(sources, ingestErrors);

if (ingestErrors.length > 0) {
  for (const e of ingestErrors) process.stderr.write(`[eval] ingest error: ${e.message}\n`);
  process.exit(2);
}

console.log(`[knowledge:eval] corpus: ${chunks.length} chunks`);

// ── Load golden cases ─────────────────────────────────────────────────────────

const casesContent = readFileSync(casesPath, "utf8");
const cases = parseEvalCases(casesContent);
console.log(`[knowledge:eval] cases:  ${cases.length} (${casesPath})`);

// ── Run eval ──────────────────────────────────────────────────────────────────

if (mode !== "keyword") {
  console.error(`[knowledge:eval] hybrid mode not yet implemented in this PR. Use --mode keyword.`);
  process.exit(2);
}

// Build an in-memory keyword index (":memory:" SQLite)
const index = new SqliteKeywordIndex(":memory:");
index.rebuild(chunks);

const { results, visibilityLeakCount, temporalLeakCount, missingReferencedIds } = runKeywordEval(cases, {
  chunks,
  keywordIndex: index,
});

index.close();

const metrics = computeAggregateMetrics(results, visibilityLeakCount, temporalLeakCount);
const report = buildReport("keyword", metrics, missingReferencedIds);
const md = renderMarkdownReport(report);

// ── Print summary ─────────────────────────────────────────────────────────────

console.log(`\n[knowledge:eval] ── Results ──────────────────────────────`);
console.log(`  cases            : ${metrics.totalCases}`);
console.log(`  Hit@1            : ${(metrics.hitAt1 * 100).toFixed(1)}%`);
console.log(`  Hit@3            : ${(metrics.hitAt3 * 100).toFixed(1)}%`);
console.log(`  Hit@5            : ${(metrics.hitAt5 * 100).toFixed(1)}%`);
console.log(`  MRR              : ${metrics.mrr.toFixed(3)}`);
console.log(`  required misses  : ${metrics.requiredMisses}`);
console.log(`  forbidden hits   : ${metrics.forbiddenHitCount}`);
console.log(`  unexpected 0hits : ${metrics.unexpectedZeroHits}`);
console.log(`  expectedAll viol : ${metrics.expectedAllViolationCount}`);
console.log(`  intent mismatch  : ${metrics.intentMismatchCount}`);
console.log(`  visibility leak  : ${metrics.visibilityLeakage}`);
console.log(`  temporal leak    : ${metrics.temporalLeakage}`);
console.log(`  duplicate hits   : ${metrics.duplicateHits}`);
console.log(`  missing IDs      : ${missingReferencedIds.length}`);

if (metrics.failedCases.length > 0) {
  console.log(`\n  Failed cases (${metrics.failedCases.length}):`);
  for (const c of metrics.failedCases) {
    const forbStr = c.forbiddenHits.length > 0 ? ` | FORBIDDEN: ${c.forbiddenHits.join(",")}` : "";
    const hitStr = c.firstHitRank !== null ? ` hit@${c.firstHitRank}` : ` MISS`;
    console.log(`    ✗  ${c.caseId} [${c.category}]${hitStr}${forbStr}`);
  }
}

// ── Write artifacts ───────────────────────────────────────────────────────────

mkdirSync(outDir, { recursive: true });
const jsonPath = join(outDir, "keyword-report.json");
const mdPath = join(outDir, "keyword-report.md");
writeFileSync(jsonPath, JSON.stringify(report, null, 2));
writeFileSync(mdPath, md);
console.log(`\n[knowledge:eval] reports written to ${outDir}/`);

// ── Hard gates ────────────────────────────────────────────────────────────────

const violations: string[] = [];

if (missingReferencedIds.length > 0) {
  violations.push(`${missingReferencedIds.length} referenced chunk ID(s) not found in corpus`);
  for (const { caseId, missingId, role } of missingReferencedIds) {
    violations.push(`  case '${caseId}' [${role}]: missing '${missingId}'`);
  }
}

if (metrics.unexpectedZeroHits > 0) {
  violations.push(`unexpected zero hits: ${metrics.unexpectedZeroHits} case(s) required empty results but got hits`);
}

// Gate on expectedAll assertion violations — allMet=false means a required chunk wasn't found.
const allMetViolations = metrics.failedCases.filter(
  (c) => c.expectedAll.length > 0 && !c.allMet,
);
if (allMetViolations.length > 0) {
  violations.push(
    `expectedAll violations: ${allMetViolations.length} case(s) missing required chunk(s)`,
  );
  for (const c of allMetViolations) {
    violations.push(`  case '${c.caseId}': not all expectedAll found`);
  }
}

if (metrics.visibilityLeakage > 0) {
  violations.push(`visibility leakage: ${metrics.visibilityLeakage} (must be 0)`);
}
if (metrics.temporalLeakage > 0) {
  violations.push(`temporal leakage: ${metrics.temporalLeakage} (must be 0)`);
}
if (metrics.forbiddenHitCount > 0) {
  violations.push(`forbidden hits: ${metrics.forbiddenHitCount} (must be 0)`);
}
if (metrics.intentMismatchCount > 0) {
  violations.push(`intent mismatches: ${metrics.intentMismatchCount} (must be 0)`);
  for (const c of metrics.failedCases.filter((r) => !r.intentMet)) {
    violations.push(`  case '${c.caseId}': expectedRetrievalSkipped but classifier returned static_lore`);
  }
}
if (metrics.duplicateHits > 0) {
  violations.push(`duplicate result IDs: ${metrics.duplicateHits} (must be 0)`);
}

// Direct category must hit@5 = 100%
const directCat = metrics.byCategory["direct"];
if (directCat && directCat.hitAt5 < 1.0) {
  violations.push(`direct Hit@5: ${(directCat.hitAt5 * 100).toFixed(1)}% (must be 100%)`);
}

// Overall Hit@5 >= 95% (only for cases with positive expectations)
if (metrics.hitAt5 < 0.95) {
  violations.push(`overall Hit@5: ${(metrics.hitAt5 * 100).toFixed(1)}% (must be ≥95%)`);
}

if (violations.length > 0) {
  console.log(`\n[knowledge:eval] ✗ HARD GATE VIOLATIONS:`);
  for (const v of violations) console.log(`  • ${v}`);
  process.exit(1);
} else {
  console.log(`\n[knowledge:eval] ✓ All hard gates passed`);
  process.exit(0);
}

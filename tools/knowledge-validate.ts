#!/usr/bin/env tsx
/**
 * knowledge:validate — canonical consistency validator CLI.
 *
 * Reads world.json and content/knowledge/*.md, runs the production validation
 * functions from src/engine/knowledge/authoring/validate.ts, and reports
 * findings to stdout/stderr.
 *
 * Exit 0 = valid.  Exit 1 = validation error(s) found.
 *
 * Security invariants:
 *  - No API keys, secrets, or full file paths in output.
 *  - All validation logic lives in the importable module; this file only does I/O.
 *
 * Usage:
 *   npm run knowledge:validate
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseMarkdownLore } from "../src/engine/knowledge/ingestion/markdown";
import {
  validateCanonicalRanks,
  validateLoreDocument,
  validateLoreBodyForDeprecatedTerms,
  collectDeprecatedTerms,
  type ValidationFinding,
} from "../src/engine/knowledge/authoring/validate";
import type { CharacterRank } from "../src/engine/content/schemas";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const LORE_DIR = join(PROJECT_ROOT, "content", "knowledge");
const WORLD_JSON = join(PROJECT_ROOT, "content", "world.json");

// ── Load world.json ───────────────────────────────────────────────────────────

let worldRaw: unknown;
try {
  worldRaw = JSON.parse(readFileSync(WORLD_JSON, "utf-8"));
} catch (e) {
  console.error(`[knowledge:validate] Cannot read world.json: ${String(e)}`);
  process.exit(1);
}

const world = worldRaw as { ranks?: unknown[] };
const rawRanks = Array.isArray(world.ranks) ? world.ranks : [];
const ranks: CharacterRank[] = rawRanks.map((r: unknown) => {
  const rank = r as Record<string, unknown>;
  return {
    id: String(rank["id"] ?? ""),
    name: String(rank["name"] ?? ""),
    aliases: Array.isArray(rank["aliases"]) ? rank["aliases"].map(String) : [],
    deprecatedAliases: Array.isArray(rank["deprecatedAliases"])
      ? rank["deprecatedAliases"].map(String)
      : [],
    deprecated: Boolean(rank["deprecated"] ?? false),
    order: Number(rank["order"] ?? 0),
    domain: (rank["domain"] as "harem" | "official") ?? "harem",
    grade: String(rank["grade"] ?? ""),
    selfRefs: (rank["selfRefs"] ?? { toPlayer: [], formal: [] }) as { toPlayer: string[]; formal: string[] },
    favorTerm: String(rank["favorTerm"] ?? ""),
  };
});

// ── Validate ranks ────────────────────────────────────────────────────────────

const allFindings: ValidationFinding[] = [];
allFindings.push(...validateCanonicalRanks(ranks));

const deprecatedTerms = collectDeprecatedTerms(ranks);
const canonicalTermCount = ranks.filter((r) => !r.deprecated).length;
const deprecatedRankCount = ranks.filter((r) => r.deprecated).length;
const deprecatedAliasCount = ranks.reduce((n, r) => n + r.deprecatedAliases.length, 0);

// ── Collect knowledge Markdown files ─────────────────────────────────────────

let mdFiles: string[];
try {
  mdFiles = readdirSync(LORE_DIR).filter((f) => f.endsWith(".md")).sort();
} catch {
  mdFiles = [];
}

// ── Per-file validation ───────────────────────────────────────────────────────

const seenDocIds = new Set<string>();
const seenChunkIds = new Set<string>();
let totalChunks = 0;
let totalDocuments = 0;
const sourceTypeCounts = new Map<string, number>();
const visibilityCounts = new Map<string, number>();

for (const file of mdFiles) {
  const fullPath = join(LORE_DIR, file);
  const label = file; // just filename, not full path — no paths in output
  let content: string;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch (e) {
    allFindings.push({ kind: "error", code: "FILE_READ_ERROR", message: `${label}: cannot read file` });
    continue;
  }

  totalDocuments++;

  // Structural heading/anchor/keyword checks via shared module
  allFindings.push(
    ...validateLoreDocument({ content, label, requireAnchors: true }),
  );

  // Deprecated terms in body text
  allFindings.push(
    ...validateLoreBodyForDeprecatedTerms(content, label, deprecatedTerms),
  );

  // Parse via production pipeline for chunk-level checks
  const parseResult = parseMarkdownLore(content, label);
  if (!parseResult.ok) {
    for (const e of parseResult.error) {
      allFindings.push({ kind: "error", code: e.code, message: `${label}: ${e.message}` });
    }
    continue;
  }

  const chunks = parseResult.value;
  if (chunks.length === 0) {
    allFindings.push({ kind: "error", code: "EMPTY_DOCUMENT", message: `${label}: no chunks produced` });
    continue;
  }

  const docId = chunks[0]!.id.split("#")[0]!;
  if (seenDocIds.has(docId)) {
    allFindings.push({ kind: "error", code: "DUPLICATE_DOC_ID", message: `${label}: duplicate document id "${docId}"` });
  }
  seenDocIds.add(docId);

  for (const chunk of chunks) {
    totalChunks++;
    if (seenChunkIds.has(chunk.id)) {
      allFindings.push({ kind: "error", code: "DUPLICATE_CHUNK_ID", message: `${label}: duplicate chunk id "${chunk.id}"` });
    }
    seenChunkIds.add(chunk.id);
    sourceTypeCounts.set(chunk.sourceType, (sourceTypeCounts.get(chunk.sourceType) ?? 0) + 1);
    visibilityCounts.set(chunk.visibility, (visibilityCounts.get(chunk.visibility) ?? 0) + 1);
    for (const tag of chunk.tags) {
      if (tag !== tag.trim() || tag === "") {
        allFindings.push({ kind: "error", code: "INVALID_TAG", message: `${chunk.id}: tag is empty or not trimmed` });
      }
    }
  }
}

// ── Print summary ─────────────────────────────────────────────────────────────

console.log("\n[knowledge:validate] ── Summary ───────────────────────────────");
console.log(`  documents        : ${totalDocuments}`);
console.log(`  chunks           : ${totalChunks}`);
console.log(`  canonical terms  : ${canonicalTermCount} ranks (${deprecatedRankCount} deprecated)`);
console.log(`  deprecated aliases: ${deprecatedAliasCount}`);

if (sourceTypeCounts.size > 0) {
  console.log(`  sourceTypes      :`);
  for (const [k, v] of [...sourceTypeCounts.entries()].sort()) {
    console.log(`    ${k}: ${v}`);
  }
}
if (visibilityCounts.size > 0) {
  console.log(`  visibility       :`);
  for (const [k, v] of [...visibilityCounts.entries()].sort()) {
    console.log(`    ${k}: ${v}`);
  }
}

const errors = allFindings.filter((f) => f.kind === "error");
const warnings = allFindings.filter((f) => f.kind === "warning");

if (warnings.length > 0) {
  console.log(`\n  warnings (${warnings.length}):`);
  for (const w of warnings) {
    console.warn(`  ⚠  ${w.message}`);
  }
}

if (errors.length > 0) {
  console.error(`\n[knowledge:validate] ${errors.length} validation error(s):\n`);
  for (const e of errors) {
    console.error(`  ✗  ${e.message}`);
  }
  process.exit(1);
}

console.log(`\n[knowledge:validate] OK — ${totalDocuments} documents, ${totalChunks} chunks, 0 errors\n`);

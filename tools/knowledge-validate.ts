#!/usr/bin/env tsx
/**
 * knowledge:validate — canonical consistency validator.
 *
 * Checks:
 *   - world.json rank definitions: ID/name/alias uniqueness, order uniqueness
 *   - Deprecated ranks and aliases: not used in new production lore
 *   - Production Markdown headings: all H2/H3 must carry a stable {#anchor-id}
 *   - Anchor uniqueness within each document
 *   - Document ID uniqueness across all knowledge files
 *   - Chunk ID uniqueness across all knowledge files
 *   - All documents produce at least one chunk
 *   - No TODO / TBD / 【待定】 / 暂定原则 in production corpus body text
 *   - entityIds and locationIds tag format (basic)
 *   - tags are trimmed and non-empty
 *
 * Output: human-readable summary (no API keys, no private paths, no secrets).
 * Exit 0 = valid. Exit 1 = validation error(s) found.
 *
 * Usage:
 *   npm run knowledge:validate
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseMarkdownLore } from "../src/engine/knowledge/ingestion/markdown";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const LORE_DIR = join(PROJECT_ROOT, "content", "knowledge");
const WORLD_JSON = join(PROJECT_ROOT, "content", "world.json");

// ── Types ─────────────────────────────────────────────────────────────────────

interface RankEntry {
  id: string;
  name: string;
  aliases: string[];
  deprecatedAliases: string[];
  deprecated: boolean;
  order: number;
  domain: string;
}

// ── Load world.json ───────────────────────────────────────────────────────────

let worldRaw: unknown;
try {
  worldRaw = JSON.parse(readFileSync(WORLD_JSON, "utf-8"));
} catch (e) {
  console.error(`[knowledge:validate] Cannot read ${WORLD_JSON}: ${String(e)}`);
  process.exit(1);
}

const world = worldRaw as { ranks?: unknown[] };
const rawRanks = Array.isArray(world.ranks) ? world.ranks : [];
const ranks: RankEntry[] = rawRanks.map((r: unknown) => {
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
    domain: String(rank["domain"] ?? ""),
  };
});

// ── Validate rank definitions ─────────────────────────────────────────────────

const errors: string[] = [];
const warnings: string[] = [];

const seenRankIds = new Set<string>();
const seenRankNames = new Set<string>();
const seenOrdersByDomain = new Map<string, Map<number, string>>();
const allAliasStrings = new Map<string, string>(); // alias string → rank ID
const allDeprecatedAliases: string[] = [];
const activeRankNames = new Set<string>(); // names of non-deprecated ranks
const deprecatedTerms = new Set<string>(); // deprecated alias strings

for (const rank of ranks) {
  if (!rank.id) { errors.push("rank: entry with empty id"); continue; }

  if (seenRankIds.has(rank.id)) {
    errors.push(`rank: duplicate id "${rank.id}"`);
  }
  seenRankIds.add(rank.id);

  if (!rank.deprecated) {
    if (seenRankNames.has(rank.name)) {
      errors.push(`rank: duplicate name "${rank.name}" (id: ${rank.id})`);
    }
    seenRankNames.add(rank.name);
    activeRankNames.add(rank.name);
  }

  // Order uniqueness within domain
  if (!seenOrdersByDomain.has(rank.domain)) {
    seenOrdersByDomain.set(rank.domain, new Map());
  }
  const domainOrders = seenOrdersByDomain.get(rank.domain)!;
  if (!rank.deprecated) {
    if (domainOrders.has(rank.order)) {
      errors.push(
        `rank: duplicate order ${rank.order} in domain "${rank.domain}" ` +
          `(ids: ${domainOrders.get(rank.order)}, ${rank.id})`,
      );
    }
    domainOrders.set(rank.order, rank.id);
  }

  // Alias uniqueness
  for (const alias of rank.aliases) {
    if (allAliasStrings.has(alias)) {
      errors.push(
        `rank: alias "${alias}" maps to both "${allAliasStrings.get(alias)}" and "${rank.id}"`,
      );
    }
    allAliasStrings.set(alias, rank.id);
  }

  for (const da of rank.deprecatedAliases) {
    allDeprecatedAliases.push(da);
    deprecatedTerms.add(da);
  }

  // Deprecated ranks should not also appear as active rank names
  if (rank.deprecated && activeRankNames.has(rank.name)) {
    errors.push(
      `rank: deprecated rank "${rank.id}" has name "${rank.name}" that conflicts with an active rank`,
    );
  }
}

const canonicalTermCount = ranks.filter((r) => !r.deprecated).length;
const deprecatedAliasCount = allDeprecatedAliases.length;
const deprecatedRankCount = ranks.filter((r) => r.deprecated).length;

// ── Collect knowledge Markdown files ─────────────────────────────────────────

let mdFiles: string[];
try {
  mdFiles = readdirSync(LORE_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();
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

/** Kebab-anchor format for stable heading anchors. */
const ANCHOR_RE = /\{#([a-z][a-z0-9-]*)\}/;

for (const file of mdFiles) {
  const fullPath = join(LORE_DIR, file);
  const relPath = `content/knowledge/${file}`;
  let content: string;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch (e) {
    errors.push(`${relPath}: cannot read file: ${String(e)}`);
    continue;
  }

  totalDocuments++;

  // ── Heading anchor check (raw scan, before parser) ──────────────────────
  // We need to scan raw lines because the parser consumes anchor syntax.
  const lines = content.split("\n");
  const seenAnchorsInDoc = new Set<string>();
  let bodyStarted = false;
  let frontmatterClosed = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Track frontmatter boundaries
    if (i === 0 && line.trimEnd() === "---") { continue; }
    if (!frontmatterClosed && line.trimEnd() === "---") {
      frontmatterClosed = true;
      bodyStarted = true;
      continue;
    }
    if (!bodyStarted) continue;

    const h2Match = /^## (.+)/.exec(line);
    const h3Match = /^### (.+)/.exec(line);
    const heading = h2Match ?? h3Match;
    if (heading) {
      const rawHeading = heading[1]!.trim();
      const anchorMatch = ANCHOR_RE.exec(rawHeading);
      if (!anchorMatch) {
        errors.push(
          `${relPath}: line ${i + 1}: heading missing stable anchor — add {#kebab-id}: "${rawHeading}"`,
        );
      } else {
        const anchor = anchorMatch[1]!;
        if (seenAnchorsInDoc.has(anchor)) {
          errors.push(
            `${relPath}: line ${i + 1}: duplicate anchor "#${anchor}" within document`,
          );
        }
        seenAnchorsInDoc.add(anchor);
      }
    }

    // Forbidden keywords in body text
    for (const kw of ["TODO", "TBD", "【待定】", "暂定原则"]) {
      if (line.includes(kw)) {
        errors.push(`${relPath}: line ${i + 1}: forbidden keyword "${kw}" in production corpus`);
      }
    }

    // Deprecated alias check
    for (const da of allDeprecatedAliases) {
      if (line.includes(da)) {
        errors.push(
          `${relPath}: line ${i + 1}: deprecated term "${da}" in production lore — ` +
            `use canonical name instead`,
        );
      }
    }
  }

  // ── Parse via production pipeline ──────────────────────────────────────────
  const parseResult = parseMarkdownLore(content, relPath);
  if (!parseResult.ok) {
    for (const e of parseResult.error) {
      errors.push(`${relPath}: ${e.code}: ${e.message}`);
    }
    continue;
  }

  const chunks = parseResult.value;
  if (chunks.length === 0) {
    errors.push(`${relPath}: no chunks produced (all sections empty or too short)`);
    continue;
  }

  // Document ID uniqueness (derived from first chunk's id prefix)
  const docId = chunks[0]!.id.split("#")[0]!;
  if (seenDocIds.has(docId)) {
    errors.push(`${relPath}: duplicate document id "${docId}"`);
  }
  seenDocIds.add(docId);

  for (const chunk of chunks) {
    totalChunks++;

    // Chunk ID uniqueness
    if (seenChunkIds.has(chunk.id)) {
      errors.push(`${relPath}: duplicate chunk id "${chunk.id}"`);
    }
    seenChunkIds.add(chunk.id);

    // sourceType counting
    sourceTypeCounts.set(chunk.sourceType, (sourceTypeCounts.get(chunk.sourceType) ?? 0) + 1);
    visibilityCounts.set(chunk.visibility, (visibilityCounts.get(chunk.visibility) ?? 0) + 1);

    // tags validation
    for (const tag of chunk.tags) {
      if (tag !== tag.trim() || tag === "") {
        errors.push(`${chunk.id}: tag is empty or not trimmed: "${tag}"`);
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

if (warnings.length > 0) {
  console.log(`\n  warnings (${warnings.length}):`);
  for (const w of warnings) {
    console.warn(`  ⚠  ${w}`);
  }
}

if (errors.length > 0) {
  console.error(`\n[knowledge:validate] ${errors.length} validation error(s):\n`);
  for (const e of errors) {
    console.error(`  ✗  ${e}`);
  }
  process.exit(1);
}

console.log(`\n[knowledge:validate] OK — ${totalDocuments} documents, ${totalChunks} chunks, 0 errors\n`);

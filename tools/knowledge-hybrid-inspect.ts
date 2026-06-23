#!/usr/bin/env tsx
/**
 * knowledge:hybrid-inspect — run a hybrid keyword + vector search and display
 * fused results with per-hit score breakdown.
 *
 * Requires embeddings to have been synced first (npm run knowledge:embed).
 * The retriever embeds the query inline using the configured provider.
 *
 * API keys are read from environment variables.  This tool NEVER prints them.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npm run knowledge:hybrid-inspect -- "宫廷礼仪" --provider openai --model text-embedding-3-small
 *   GEMINI_API_KEY=...    npm run knowledge:hybrid-inspect -- "请安规矩" --provider gemini --model gemini-embedding-2
 *   npm run knowledge:hybrid-inspect -- "禁足" --provider openai --model text-embedding-3-small --limit 5 --visibility imperial
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmbeddingProvider } from "../src/engine/knowledge/embedding/provider-factory";
import type { SupportedEmbeddingProvider } from "../src/engine/knowledge/embedding/provider-factory";
import { SqliteKeywordIndex } from "../src/engine/knowledge/index/sqlite-fts5";
import { SqliteVectorIndex } from "../src/engine/knowledge/vector/sqlite-vector-index";
import { KnowledgeHybridRetriever } from "../src/engine/knowledge/retrieval/hybrid-retriever";
import type { KnowledgeVisibility } from "../src/engine/knowledge/model";

const VALID_PROVIDERS = new Set<string>(["openai", "gemini"]);
const VALID_VISIBILITIES = new Set<string>(["public", "restricted", "imperial"]);
const KNOWN_FLAGS = new Set(["--provider", "--model", "--db", "--limit", "--visibility", "--vector-failure"]);

function parseArgs(rawArgs: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < rawArgs.length) {
    const a = rawArgs[i]!;
    if (KNOWN_FLAGS.has(a)) {
      const val = rawArgs[i + 1];
      if (val === undefined || val.startsWith("--")) {
        console.error(`[knowledge:hybrid-inspect] ${a} requires a value`);
        return null;
      }
      flags[a.slice(2)] = val;
      i += 2;
    } else if (a.startsWith("--")) {
      console.error(`[knowledge:hybrid-inspect] unknown flag: ${a}`);
      return null;
    } else {
      positional.push(a);
      i++;
    }
  }

  const query = positional.join(" ").trim();
  if (!query) {
    console.error(
      "Usage: npm run knowledge:hybrid-inspect -- <query> --provider openai|gemini --model <model> [--limit N] [--db PATH] [--visibility public|restricted|imperial] [--vector-failure fail|keyword_only]",
    );
    return null;
  }

  const providerRaw = flags["provider"];
  if (!providerRaw) {
    console.error("[knowledge:hybrid-inspect] --provider is required (openai|gemini)");
    return null;
  }
  if (!VALID_PROVIDERS.has(providerRaw)) {
    console.error(`[knowledge:hybrid-inspect] unknown provider "${providerRaw}"`);
    return null;
  }

  const model = flags["model"];
  if (!model) {
    console.error("[knowledge:hybrid-inspect] --model is required");
    return null;
  }

  const limitRaw = flags["limit"] ?? "10";
  const limit = parseInt(limitRaw, 10);
  if (isNaN(limit) || limit < 1) {
    console.error(`[knowledge:hybrid-inspect] --limit must be a positive integer, got "${limitRaw}"`);
    return null;
  }

  const visibilityRaw = flags["visibility"] ?? "public";
  if (!VALID_VISIBILITIES.has(visibilityRaw)) {
    console.error(`[knowledge:hybrid-inspect] --visibility must be public|restricted|imperial, got "${visibilityRaw}"`);
    return null;
  }

  const vectorFailure = flags["vector-failure"] ?? "keyword_only";
  if (vectorFailure !== "fail" && vectorFailure !== "keyword_only") {
    console.error(`[knowledge:hybrid-inspect] --vector-failure must be fail|keyword_only, got "${vectorFailure}"`);
    return null;
  }

  return {
    query,
    provider: providerRaw as SupportedEmbeddingProvider,
    model,
    db: flags["db"] ?? resolve(".knowledge.db"),
    limit,
    visibility: visibilityRaw as KnowledgeVisibility,
    vectorFailure: vectorFailure as "fail" | "keyword_only",
  };
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) process.exit(1);

  const { query, provider: providerId, model, db: dbPath, limit, visibility, vectorFailure } = parsed;

  let embeddingProvider;
  try {
    embeddingProvider = createEmbeddingProvider({ provider: providerId, model });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const kwIndex = new SqliteKeywordIndex(dbPath);
  const vecIndex = new SqliteVectorIndex(dbPath);
  const retriever = new KnowledgeHybridRetriever(kwIndex, vecIndex, embeddingProvider);

  try {
    const result = await retriever.retrieve({
      text: query,
      limit,
      visibilityCeiling: visibility,
      vectorFailureMode: vectorFailure,
    });

    if (result.vectorDegradation) {
      console.warn(
        `[warning] vector channel degraded (${result.vectorDegradation.reason}): ${result.vectorDegradation.message}`,
      );
    }

    const { hits } = result;
    if (hits.length === 0) {
      console.log(`No results for "${query}".`);
    } else {
      console.log(`\n${hits.length} result(s) for "${query}" [model: ${embeddingProvider.modelKey}]:\n`);
      for (const hit of hits) {
        const c = hit.chunk;
        const kwRank = hit.keywordRank !== null ? `#${hit.keywordRank}` : "—";
        const vecRank = hit.vectorRank !== null ? `#${hit.vectorRank}` : "—";
        const cos = hit.cosineScore !== null ? hit.cosineScore.toFixed(4) : "—";
        const bm25 = hit.keywordScore !== null ? hit.keywordScore.toFixed(4) : "—";
        console.log(`  ─────────────────────────────────────────`);
        console.log(`  rank:        #${hit.rank}  hybrid=${hit.hybridScore.toFixed(6)}`);
        console.log(`  kw_rank:     ${kwRank}  bm25=${bm25}`);
        console.log(`  vec_rank:    ${vecRank}  cosine=${cos}`);
        console.log(`  id:          ${c.id}`);
        console.log(`  title:       ${c.title}`);
        console.log(`  sourceType:  ${c.sourceType}`);
        console.log(`  visibility:  ${c.visibility}`);
        console.log(`  sourcePath:  ${c.sourcePath}`);
        console.log(`  text:        ${c.text.slice(0, 120)}${c.text.length > 120 ? "…" : ""}`);
      }
      console.log();
    }
  } catch (err) {
    console.error("[knowledge:hybrid-inspect] Error:", (err as Error).message);
    process.exit(1);
  } finally {
    vecIndex.close();
    kwIndex.close();
  }
}

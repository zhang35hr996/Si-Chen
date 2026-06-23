#!/usr/bin/env tsx
/**
 * knowledge:embed — sync embeddings for all knowledge chunks into the SQLite
 * vector index.
 *
 * Reads all chunks from an existing .knowledge.db (built by knowledge:build),
 * calls the embedding provider for any chunk whose content hash is not already
 * cached, and writes the results in a single atomic transaction.
 *
 * API keys are read from environment variables.  This tool NEVER prints them.
 * Exits 1 if a required key is absent.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... npm run knowledge:embed -- --provider openai --model text-embedding-3-small
 *   GEMINI_API_KEY=...    npm run knowledge:embed -- --provider gemini --model text-embedding-004
 *   npm run knowledge:embed -- --provider openai --model text-embedding-3-small --db ./custom.db --batch-size 50
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmbeddingProvider } from "../src/engine/knowledge/embedding/provider-factory";
import type { SupportedEmbeddingProvider } from "../src/engine/knowledge/embedding/provider-factory";
import { SqliteVectorIndex, syncEmbeddings } from "../src/engine/knowledge/vector/sqlite-vector-index";
import type { KnowledgeChunk, KnowledgeSourceType, KnowledgeVisibility } from "../src/engine/knowledge/model";
import { fromTurnIndex } from "../src/engine/calendar/time";

const VALID_PROVIDERS = new Set<string>(["openai", "gemini"]);
const KNOWN_FLAGS = new Set(["--provider", "--model", "--db", "--batch-size"]);

function parseArgs(rawArgs: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];

  let i = 0;
  while (i < rawArgs.length) {
    const a = rawArgs[i]!;
    if (KNOWN_FLAGS.has(a)) {
      const val = rawArgs[i + 1];
      if (val === undefined || val.startsWith("--")) {
        console.error(`[knowledge:embed] ${a} requires a value`);
        return null;
      }
      flags[a.slice(2)] = val;
      i += 2;
    } else if (a.startsWith("--")) {
      console.error(`[knowledge:embed] unknown flag: ${a}`);
      return null;
    } else {
      positional.push(a);
      i++;
    }
  }

  const providerRaw = flags["provider"];
  if (!providerRaw) {
    console.error("[knowledge:embed] --provider is required (openai|gemini)");
    return null;
  }
  if (!VALID_PROVIDERS.has(providerRaw)) {
    console.error(`[knowledge:embed] unknown provider "${providerRaw}" — must be openai or gemini`);
    return null;
  }

  const model = flags["model"];
  if (!model) {
    console.error("[knowledge:embed] --model is required");
    return null;
  }

  const batchSizeRaw = flags["batch-size"] ?? "100";
  const batchSize = parseInt(batchSizeRaw, 10);
  if (isNaN(batchSize) || batchSize < 1) {
    console.error(`[knowledge:embed] --batch-size must be a positive integer, got "${batchSizeRaw}"`);
    return null;
  }

  if (positional.length > 0) {
    console.error(`[knowledge:embed] unexpected positional arguments: ${positional.join(" ")}`);
    return null;
  }

  return {
    provider: providerRaw as SupportedEmbeddingProvider,
    model,
    db: flags["db"] ?? resolve(".knowledge.db"),
    batchSize,
  };
}

// ── Chunk loader (bypasses FTS5; reads knowledge_chunks table directly) ───────

interface ChunkRow {
  id: string;
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

function loadAllChunks(vecIndex: SqliteVectorIndex): KnowledgeChunk[] {
  const rows = vecIndex.db
    .prepare("SELECT * FROM knowledge_chunks")
    .all() as ChunkRow[];

  return rows.map((row) => {
    const chunk: KnowledgeChunk = {
      id: row.id,
      sourceType: row.source_type as KnowledgeSourceType,
      title: row.title,
      text: row.text,
      tags: JSON.parse(row.tags_json) as string[],
      entityIds: JSON.parse(row.entity_ids_json) as string[],
      locationIds: JSON.parse(row.location_ids_json) as string[],
      visibility: row.visibility as KnowledgeVisibility,
      sourcePath: row.source_path,
    };
    if (row.valid_from_day !== null) {
      (chunk as { validFrom?: unknown }).validFrom = fromTurnIndex(row.valid_from_day);
    }
    if (row.valid_until_day !== null) {
      (chunk as { validUntil?: unknown }).validUntil = fromTurnIndex(row.valid_until_day);
    }
    return chunk;
  });
}

// ── CLI entrypoint ────────────────────────────────────────────────────────────

const isMain =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) process.exit(1);

  const { provider: providerId, model, db: dbPath, batchSize } = parsed;

  let embeddingProvider;
  try {
    embeddingProvider = createEmbeddingProvider({ provider: providerId, model });
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  const vecIndex = new SqliteVectorIndex(dbPath);

  try {
    // Load all chunks directly from the DB (FTS5 search on empty query returns nothing)
    const allChunks = loadAllChunks(vecIndex);

    if (allChunks.length === 0) {
      console.log("[knowledge:embed] No chunks found in the index — run knowledge:build first.");
      process.exit(0);
    }

    console.log(
      `[knowledge:embed] Syncing ${allChunks.length} chunks with ${embeddingProvider.modelKey} …`,
    );

    const stats = await syncEmbeddings({
      chunks: allChunks,
      provider: embeddingProvider,
      vectorIndex: vecIndex,
      batchSize,
    });

    console.log(`[knowledge:embed] Done.`);
    console.log(`  model:     ${stats.modelKey}`);
    console.log(`  total:     ${stats.totalChunks}`);
    console.log(`  cached:    ${stats.cacheHits}`);
    console.log(`  embedded:  ${stats.embeddedChunks}`);
    console.log(`  batches:   ${stats.batches}`);
    console.log(`  dims:      ${stats.dimensions}`);
  } catch (err) {
    console.error("[knowledge:embed] Error:", (err as Error).message);
    process.exit(1);
  } finally {
    vecIndex.close();
  }
}

import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { KnowledgeChunk } from "../../../src/engine/knowledge/model";
import { SqliteKeywordIndex } from "../../../src/engine/knowledge/index/sqlite-fts5";
import { SqliteVectorIndex, syncEmbeddings } from "../../../src/engine/knowledge/vector/sqlite-vector-index";
import { FakeEmbeddingProvider, sequentialVectorFactory } from "../embedding/fake-provider";
import type { EmbeddingProvider } from "../../../src/engine/knowledge/embedding/provider";
import { makeGameTime } from "../../../src/engine/calendar/time";

const DIMS = 4;

function makeChunk(overrides: Partial<KnowledgeChunk> & { id: string; text: string }): KnowledgeChunk {
  return {
    sourceType: "etiquette",
    title: overrides.title ?? overrides.id,
    tags: [],
    entityIds: [],
    locationIds: [],
    visibility: "public",
    sourcePath: "test.md",
    ...overrides,
  };
}

let dbPath: string;
let kwIndex: SqliteKeywordIndex;
let vecIndex: SqliteVectorIndex;

beforeEach(() => {
  dbPath = join(tmpdir(), `vec-test-${Date.now()}-${Math.random()}.db`);
  // Keyword index creates the knowledge_chunks table
  kwIndex = new SqliteKeywordIndex(dbPath);
  vecIndex = new SqliteVectorIndex(dbPath);
});

afterEach(() => {
  vecIndex.close();
  kwIndex.close();
  try { rmSync(dbPath); } catch { /* ignore */ }
  try { rmSync(dbPath + "-shm"); } catch { /* ignore */ }
  try { rmSync(dbPath + "-wal"); } catch { /* ignore */ }
});

function makeProvider(): FakeEmbeddingProvider {
  return new FakeEmbeddingProvider({
    dimensions: DIMS,
    vectorFactory: sequentialVectorFactory(DIMS),
  });
}

// ── hasCachedEmbedding ────────────────────────────────────────────────────────

describe("hasCachedEmbedding", () => {
  it("returns false when no embeddings exist", () => {
    expect(vecIndex.hasCachedEmbedding("openai:m", "abc123")).toBe(false);
  });

  it("returns true after embedding is persisted", async () => {
    const chunk = makeChunk({ id: "c1", text: "hello" });
    kwIndex.rebuild([chunk]);
    const provider = makeProvider();
    const stats = await syncEmbeddings({ chunks: [chunk], provider, vectorIndex: vecIndex });
    expect(stats.embeddedChunks).toBe(1);

    // Find the hash from stats is not exposed, but we can verify via search
    expect(stats.cacheHits).toBe(0);

    // Re-sync should hit cache
    const stats2 = await syncEmbeddings({ chunks: [chunk], provider, vectorIndex: vecIndex });
    expect(stats2.cacheHits).toBe(1);
    expect(stats2.embeddedChunks).toBe(0);
  });
});

// ── syncEmbeddings ────────────────────────────────────────────────────────────

describe("syncEmbeddings", () => {
  it("returns correct stats for fresh sync", async () => {
    const chunks = [
      makeChunk({ id: "c1", text: "alpha" }),
      makeChunk({ id: "c2", text: "beta" }),
    ];
    kwIndex.rebuild(chunks);
    const provider = makeProvider();
    const stats = await syncEmbeddings({ chunks, provider, vectorIndex: vecIndex });

    expect(stats.totalChunks).toBe(2);
    expect(stats.cacheHits).toBe(0);
    expect(stats.embeddedChunks).toBe(2);
    expect(stats.batches).toBe(1);
    expect(stats.modelKey).toBe(provider.modelKey);
    expect(stats.dimensions).toBe(DIMS);
  });

  it("re-sync returns all cache hits and calls provider 0 times", async () => {
    const chunks = [makeChunk({ id: "c1", text: "alpha" })];
    kwIndex.rebuild(chunks);
    const provider = makeProvider();

    await syncEmbeddings({ chunks, provider, vectorIndex: vecIndex });
    provider.resetCalls();

    const stats = await syncEmbeddings({ chunks, provider, vectorIndex: vecIndex });
    expect(stats.cacheHits).toBe(1);
    expect(stats.embeddedChunks).toBe(0);
    expect(stats.batches).toBe(0);
    expect(provider.calls).toHaveLength(0);
  });

  it("cache hit reuses stored vector even for different chunk id (same content)", async () => {
    // Same title + text → same embedding text → same content hash
    const chunkA = makeChunk({ id: "c1", title: "shared", text: "identical content" });
    const chunkB = makeChunk({ id: "c2", title: "shared", text: "identical content" });
    kwIndex.rebuild([chunkA, chunkB]);
    const provider = makeProvider();

    const stats = await syncEmbeddings({
      chunks: [chunkA, chunkB],
      provider,
      vectorIndex: vecIndex,
    });
    // Both have the same embedding text → 1 provider call for the first; 2nd is cache hit
    expect(stats.embeddedChunks).toBe(1);
    expect(stats.cacheHits).toBe(1);
  });

  it("prunes stale mappings when a chunk is removed", async () => {
    const c1 = makeChunk({ id: "c1", text: "alpha" });
    const c2 = makeChunk({ id: "c2", text: "beta" });
    kwIndex.rebuild([c1, c2]);
    const provider = makeProvider();

    await syncEmbeddings({ chunks: [c1, c2], provider, vectorIndex: vecIndex });

    // Remove c2 from corpus
    kwIndex.rebuild([c1]);
    await syncEmbeddings({ chunks: [c1], provider, vectorIndex: vecIndex });

    // Only c1 should be searchable
    const hits = vecIndex.search({
      vector: [1, 0, 0, 0],
      modelKey: provider.modelKey,
      limit: 10,
      visibilityCeiling: "imperial",
    });
    expect(hits.map((h) => h.chunk.id)).toContain("c1");
    expect(hits.map((h) => h.chunk.id)).not.toContain("c2");
  });

  it("returns zero stats for empty chunk array", async () => {
    const provider = makeProvider();
    const stats = await syncEmbeddings({ chunks: [], provider, vectorIndex: vecIndex });
    expect(stats.totalChunks).toBe(0);
    expect(stats.embeddedChunks).toBe(0);
  });

  it("batches correctly when batchSize is smaller than chunk count", async () => {
    const chunks = Array.from({ length: 5 }, (_, i) =>
      makeChunk({ id: `c${i}`, text: `text ${i}` }),
    );
    kwIndex.rebuild(chunks);
    const provider = makeProvider();

    const stats = await syncEmbeddings({ chunks, provider, vectorIndex: vecIndex, batchSize: 2 });
    expect(stats.batches).toBe(3); // 2+2+1
    expect(stats.embeddedChunks).toBe(5);
  });

  // ── batchSize validation ───────────────────────────────────────────────────

  it("throws RangeError for batchSize = 0", async () => {
    const chunk = makeChunk({ id: "c1", text: "text" });
    kwIndex.rebuild([chunk]);
    await expect(
      syncEmbeddings({ chunks: [chunk], provider: makeProvider(), vectorIndex: vecIndex, batchSize: 0 }),
    ).rejects.toThrow(/batchSize/i);
  });

  it("throws RangeError for negative batchSize", async () => {
    const chunk = makeChunk({ id: "c1", text: "text" });
    kwIndex.rebuild([chunk]);
    await expect(
      syncEmbeddings({ chunks: [chunk], provider: makeProvider(), vectorIndex: vecIndex, batchSize: -5 }),
    ).rejects.toThrow(/batchSize/i);
  });

  it("throws RangeError for fractional batchSize", async () => {
    const chunk = makeChunk({ id: "c1", text: "text" });
    kwIndex.rebuild([chunk]);
    await expect(
      syncEmbeddings({ chunks: [chunk], provider: makeProvider(), vectorIndex: vecIndex, batchSize: 1.5 }),
    ).rejects.toThrow(/batchSize/i);
  });

  it("throws RangeError for batchSize > 2048", async () => {
    const chunk = makeChunk({ id: "c1", text: "text" });
    kwIndex.rebuild([chunk]);
    await expect(
      syncEmbeddings({ chunks: [chunk], provider: makeProvider(), vectorIndex: vecIndex, batchSize: 2049 }),
    ).rejects.toThrow(/batchSize/i);
  });

  it("accepts batchSize = 1", async () => {
    const chunk = makeChunk({ id: "c1", text: "text" });
    kwIndex.rebuild([chunk]);
    const stats = await syncEmbeddings({
      chunks: [chunk], provider: makeProvider(), vectorIndex: vecIndex, batchSize: 1,
    });
    expect(stats.batches).toBe(1);
  });

  it("accepts batchSize = 2048", async () => {
    const chunk = makeChunk({ id: "c1", text: "text" });
    kwIndex.rebuild([chunk]);
    const stats = await syncEmbeddings({
      chunks: [chunk], provider: makeProvider(), vectorIndex: vecIndex, batchSize: 2048,
    });
    expect(stats.batches).toBe(1);
  });

  // ── cross-batch dimension consistency ────────────────────────────────────────

  it("throws EmbeddingValidationError when second batch returns different dimensions", async () => {
    // Provider alternates between 4-dim and 2-dim responses across batches.
    let batchCalls = 0;
    const fakeDimShift: EmbeddingProvider = {
      providerId: "openai",
      model: "dim-shift",
      modelKey: "openai:dim-shift",
      async embed(req) {
        const dims = batchCalls++ === 0 ? 4 : 2; // first batch=4, second batch=2
        return {
          vectors: req.texts.map(() => Array.from({ length: dims }, (_, j) => j === 0 ? 1 : 0) as readonly number[]),
          provider: "openai" as const,
          model: "dim-shift",
          dimensions: dims,
        };
      },
    };

    const chunks = [makeChunk({ id: "c1", text: "text1" }), makeChunk({ id: "c2", text: "text2" })];
    kwIndex.rebuild(chunks);

    await expect(
      syncEmbeddings({ chunks, provider: fakeDimShift, vectorIndex: vecIndex, batchSize: 1 }),
    ).rejects.toThrow(/dimension/i);
  });
});

// ── search ────────────────────────────────────────────────────────────────────

describe("SqliteVectorIndex.search", () => {
  async function seedIndex(chunks: KnowledgeChunk[], provider: FakeEmbeddingProvider) {
    kwIndex.rebuild(chunks);
    await syncEmbeddings({ chunks, provider, vectorIndex: vecIndex });
  }

  it("throws NoEmbeddingsForModelError when no embeddings exist for modelKey", () => {
    expect(() =>
      vecIndex.search({ vector: [1, 0, 0, 0], modelKey: "openai:none", limit: 5, visibilityCeiling: "imperial" }),
    ).toThrow(/no embeddings found/i);
  });

  it("returns hits ranked by cosine similarity", async () => {
    // c1 embedding = [1,0,0,0], c2 = [0,1,0,0], c3 = [0,0,1,0]
    let counter = 0;
    const provider = new FakeEmbeddingProvider({
      dimensions: DIMS,
      vectorFactory: () => {
        const v = Array(DIMS).fill(0) as number[];
        v[counter++ % DIMS] = 1;
        return v;
      },
    });
    const c1 = makeChunk({ id: "c1", text: "aaa" });
    const c2 = makeChunk({ id: "c2", text: "bbb" });
    const c3 = makeChunk({ id: "c3", text: "ccc" });
    await seedIndex([c1, c2, c3], provider);

    // Query vector [1,0,0,0] should rank c1 first
    const hits = vecIndex.search({
      vector: [1, 0, 0, 0],
      modelKey: provider.modelKey,
      limit: 3,
      visibilityCeiling: "imperial",
    });
    expect(hits[0]!.chunk.id).toBe("c1");
    expect(hits[0]!.cosineScore).toBeCloseTo(1, 5);
    // c2 and c3 are orthogonal → cosine = 0
    expect(hits[1]!.cosineScore).toBeCloseTo(0, 5);
    expect(hits[2]!.cosineScore).toBeCloseTo(0, 5);
  });

  it("assigns 1-based ranks", async () => {
    const chunks = [makeChunk({ id: "c1", text: "x" }), makeChunk({ id: "c2", text: "y" })];
    const provider = makeProvider();
    await seedIndex(chunks, provider);
    const hits = vecIndex.search({ vector: [1, 0, 0, 0], modelKey: provider.modelKey, limit: 2, visibilityCeiling: "imperial" });
    expect(hits[0]!.rank).toBe(1);
    expect(hits[1]!.rank).toBe(2);
  });

  it("applies visibility ceiling (public hides imperial chunks)", async () => {
    const pub = makeChunk({ id: "pub", text: "public text", visibility: "public" });
    const imp = makeChunk({ id: "imp", text: "imperial text", visibility: "imperial" });
    const provider = makeProvider();
    await seedIndex([pub, imp], provider);

    const hits = vecIndex.search({ vector: [1, 0, 0, 0], modelKey: provider.modelKey, limit: 10 }); // default ceiling = public
    expect(hits.map((h) => h.chunk.id)).toContain("pub");
    expect(hits.map((h) => h.chunk.id)).not.toContain("imp");
  });

  it("applies temporal filtering", async () => {
    const past = makeChunk({
      id: "past", text: "historical",
      validUntil: makeGameTime(1, 1, "early"),
    });
    const current = makeChunk({ id: "current", text: "present" });
    const provider = makeProvider();
    await seedIndex([past, current], provider);

    // Query at year=1, month=2, mid — past chunk's validUntil=dayIndex 0 is before this
    const time = makeGameTime(1, 2, "mid");
    const hits = vecIndex.search({
      vector: [1, 0, 0, 0],
      modelKey: provider.modelKey,
      limit: 10,
      visibilityCeiling: "imperial",
      currentTime: time,
    });
    const ids = hits.map((h) => h.chunk.id);
    expect(ids).toContain("current");
    expect(ids).not.toContain("past");
  });

  it("throws on dimension mismatch", async () => {
    const chunk = makeChunk({ id: "c1", text: "hello" });
    const provider = makeProvider(); // 4 dims
    await seedIndex([chunk], provider);

    expect(() =>
      vecIndex.search({ vector: [1, 0], modelKey: provider.modelKey, limit: 5, visibilityCeiling: "imperial" }),
    ).toThrow(/dimension mismatch/i);
  });

  it("respects limit", async () => {
    const chunks = Array.from({ length: 6 }, (_, i) =>
      makeChunk({ id: `c${i}`, text: `item ${i}` }),
    );
    const provider = makeProvider();
    await seedIndex(chunks, provider);

    const hits = vecIndex.search({ vector: [1, 0, 0, 0], modelKey: provider.modelKey, limit: 3, visibilityCeiling: "imperial" });
    expect(hits).toHaveLength(3);
  });

  it("tag filter (any mode) narrows results", async () => {
    const tagged = makeChunk({ id: "t1", text: "tagged", tags: ["礼仪"] });
    const untagged = makeChunk({ id: "t2", text: "plain" });
    const provider = makeProvider();
    await seedIndex([tagged, untagged], provider);

    const hits = vecIndex.search({
      vector: [1, 0, 0, 0],
      modelKey: provider.modelKey,
      limit: 10,
      visibilityCeiling: "imperial",
      tagFilter: { values: ["礼仪"], mode: "any" },
    });
    expect(hits.map((h) => h.chunk.id)).toEqual(["t1"]);
  });
});

/**
 * Suite C: packPromptKnowledge — budget packer.
 * Enforces: ≤4 chunks, ≤3200 chars, visibility ceiling, dedup, skip-not-break on oversize.
 *
 * Required exact-key assertions: packed chunks have exactly { id, title, text, sourceType }.
 * visibility, sourcePath, scores, vectors, ranks, hashes, model keys are all absent.
 */
import { describe, it, expect } from "vitest";
import { packPromptKnowledge } from "../../../src/engine/dialogue/knowledge/promptKnowledge";
import type { KnowledgeHybridHit } from "../../../src/engine/knowledge/retrieval/types";
import type { KnowledgeChunk } from "../../../src/engine/knowledge/model";

function makeHit(
  id: string,
  visibility: KnowledgeChunk["visibility"],
  textLen = 100,
): KnowledgeHybridHit {
  const chunk: KnowledgeChunk = {
    id,
    sourceType: "etiquette",
    title: `title-${id}`,
    text: "x".repeat(textLen),
    tags: [],
    entityIds: [],
    locationIds: [],
    visibility,
    sourcePath: "fake/path.md",
  };
  return {
    chunk,
    hybridScore: 1,
    rank: 1,
    keywordRank: 1,
    keywordScore: 0.5,
    vectorRank: null,
    cosineScore: null,
  };
}

describe("packPromptKnowledge", () => {
  it("returns up to 4 chunks, never more", () => {
    const hits = [1, 2, 3, 4, 5].map((i) => makeHit(`c${i}`, "public"));
    const packed = packPromptKnowledge(hits, "public");
    expect(packed.length).toBe(4);
    expect(packed.map((c) => c.id)).toEqual(["c1", "c2", "c3", "c4"]);
  });

  it("oversized chunk is SKIPPED (not a break) — later smaller chunks still included", () => {
    // hit 1: ~4000 chars (over 3200 limit by itself)
    // hit 2: 100 chars (well within remaining budget after skipping hit 1)
    const hits = [makeHit("big", "public", 4000), makeHit("small", "public", 100)];
    const packed = packPromptKnowledge(hits, "public");
    const ids = packed.map((c) => c.id);
    expect(ids).not.toContain("big");
    expect(ids).toContain("small");
  });

  it("exact char cap: sum of (title.length + text.length) ≤ 3200", () => {
    // 3 chunks × 1090 chars text + ~10 chars title each = ~3300 > 3200
    // → first two should fit, third skipped (also demonstrates skip-not-break since
    //   in this case no smaller chunk follows, but the assertion checks the cap)
    const hits = [1, 2, 3].map((i) => makeHit(`c${i}`, "public", 1090));
    const packed = packPromptKnowledge(hits, "public");
    const totalChars = packed.reduce((s, c) => s + c.title.length + c.text.length, 0);
    expect(totalChars).toBeLessThanOrEqual(3200);
    expect(packed.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("deduplicates chunks with the same ID — second occurrence is skipped", () => {
    const dup = makeHit("c1", "public");
    const hits = [dup, dup, makeHit("c2", "public")];
    const packed = packPromptKnowledge(hits, "public");
    expect(packed.filter((c) => c.id === "c1").length).toBe(1);
    expect(packed.map((c) => c.id)).toEqual(["c1", "c2"]);
  });

  it("drops chunks whose visibility exceeds the ceiling", () => {
    const hits = [
      makeHit("pub", "public"),
      makeHit("res", "restricted"),
      makeHit("imp", "imperial"),
    ];
    const packed = packPromptKnowledge(hits, "public");
    const ids = packed.map((c) => c.id);
    expect(ids).toEqual(["pub"]);
  });

  it("allows restricted chunks when ceiling is restricted", () => {
    const hits = [makeHit("res", "restricted"), makeHit("imp", "imperial")];
    const packed = packPromptKnowledge(hits, "restricted");
    const ids = packed.map((c) => c.id);
    expect(ids).toContain("res");
    expect(ids).not.toContain("imp");
  });

  it("allows all visibility levels when ceiling is imperial", () => {
    const hits = [makeHit("pub", "public"), makeHit("res", "restricted"), makeHit("imp", "imperial")];
    const packed = packPromptKnowledge(hits, "imperial");
    expect(packed.map((c) => c.id)).toEqual(["pub", "res", "imp"]);
  });

  it("packed DTO has exactly { id, title, text, sourceType } — visibility and sourcePath absent", () => {
    const hits = [makeHit("c1", "public", 10)];
    const packed = packPromptKnowledge(hits, "public");
    expect(Object.keys(packed[0]!).sort()).toEqual(["id", "sourceType", "text", "title"]);
    expect(packed[0]).not.toHaveProperty("visibility");
    expect(packed[0]).not.toHaveProperty("sourcePath");
  });

  it("preserves stable rank order among accepted chunks", () => {
    const hits = ["a", "b", "c"].map((id) => makeHit(id, "public"));
    const packed = packPromptKnowledge(hits, "public");
    expect(packed.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("returns empty array for empty hits", () => {
    expect(packPromptKnowledge([], "public")).toEqual([]);
  });

  it("does not mutate the input hits array", () => {
    const hits = [makeHit("c1", "public")];
    const before = JSON.stringify(hits);
    packPromptKnowledge(hits, "public");
    expect(JSON.stringify(hits)).toBe(before);
  });
});

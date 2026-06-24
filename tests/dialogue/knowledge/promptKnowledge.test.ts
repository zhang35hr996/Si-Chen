/**
 * Suite C: packPromptKnowledge — budget packer.
 * Enforces: ≤4 chunks, ≤3200 chars total, visibility ceiling filter.
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
  it("returns up to 4 chunks", () => {
    const hits = [1, 2, 3, 4, 5].map((i) => makeHit(`c${i}`, "public"));
    const packed = packPromptKnowledge(hits, "public");
    expect(packed.length).toBe(4);
  });

  it("respects MAX_PROMPT_CHARS = 3200 (stops before adding chunk that would exceed)", () => {
    // 3 chunks × 1100 chars each = 3300 > 3200, so only 2 should fit
    const hits = [1, 2, 3].map((i) => makeHit(`c${i}`, "public", 1090));
    const packed = packPromptKnowledge(hits, "public");
    expect(packed.length).toBeLessThan(3);
  });

  it("drops chunks whose visibility exceeds the ceiling", () => {
    const hits = [
      makeHit("pub", "public"),
      makeHit("res", "restricted"),
      makeHit("imp", "imperial"),
    ];
    const packed = packPromptKnowledge(hits, "public");
    const ids = packed.map((c) => c.id);
    expect(ids).toContain("pub");
    expect(ids).not.toContain("res");
    expect(ids).not.toContain("imp");
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
    expect(packed.length).toBe(3);
  });

  it("strips sourcePath from packed chunks", () => {
    const hits = [makeHit("c1", "public")];
    const packed = packPromptKnowledge(hits, "public");
    expect(packed[0]).not.toHaveProperty("sourcePath");
  });

  it("returns empty array for empty hits", () => {
    expect(packPromptKnowledge([], "public")).toEqual([]);
  });

  it("preserves id, title, text, sourceType, visibility", () => {
    const hits = [makeHit("c1", "public", 10)];
    const packed = packPromptKnowledge(hits, "public");
    expect(packed[0]!.id).toBe("c1");
    expect(packed[0]!.title).toBe("title-c1");
    expect(packed[0]!.visibility).toBe("public");
    expect(packed[0]!.sourceType).toBe("etiquette");
  });
});

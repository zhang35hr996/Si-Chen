import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameError } from "../../src/engine/infra/errors";
import { normalizeChunk, normalizeChunks } from "../../src/engine/knowledge/normalize";
import type { KnowledgeChunkInput } from "../../src/engine/knowledge/model";

function base(overrides: Partial<KnowledgeChunkInput> = {}): KnowledgeChunkInput {
  return {
    id: "test.chunk",
    sourceType: "etiquette",
    title: "  禁足礼制  ",
    text: "  受禁足处分的侍君不得离开所居宫殿。  ",
    tags: ["etiquette", "punishment", "etiquette"],
    entityIds: ["  shen_zhibai  ", ""],
    locationIds: [],
    visibility: "public",
    sourcePath: "fixtures/test.md",
    ...overrides,
  };
}

describe("normalizeChunk", () => {
  it("returns a valid chunk for correct input", () => {
    const errors: GameError[] = [];
    const chunk = normalizeChunk(base(), errors);
    expect(errors).toHaveLength(0);
    expect(chunk).not.toBeNull();
    expect(chunk!.id).toBe("test.chunk");
  });

  it("trims title and text", () => {
    const errors: GameError[] = [];
    const chunk = normalizeChunk(base(), errors);
    expect(chunk!.title).toBe("禁足礼制");
    expect(chunk!.text).toBe("受禁足处分的侍君不得离开所居宫殿。");
  });

  it("deduplicates and sorts tags", () => {
    const errors: GameError[] = [];
    const chunk = normalizeChunk(base(), errors);
    expect(chunk!.tags).toEqual(["etiquette", "punishment"]);
  });

  it("filters blank entityIds and trims remaining", () => {
    const errors: GameError[] = [];
    const chunk = normalizeChunk(base(), errors);
    expect(chunk!.entityIds).toEqual(["shen_zhibai"]);
  });

  it("preserves sourcePath", () => {
    const errors: GameError[] = [];
    const chunk = normalizeChunk(base(), errors);
    expect(chunk!.sourcePath).toBe("fixtures/test.md");
  });

  it("produces identical result on identical input (determinism)", () => {
    const e1: GameError[] = [];
    const e2: GameError[] = [];
    const c1 = normalizeChunk(base(), e1);
    const c2 = normalizeChunk(base(), e2);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });

  it("fails on empty title (after trim)", () => {
    const errors: GameError[] = [];
    const chunk = normalizeChunk(base({ title: "   " }), errors);
    expect(chunk).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("fails on empty text (after trim)", () => {
    const errors: GameError[] = [];
    const chunk = normalizeChunk(base({ text: "   " }), errors);
    expect(chunk).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("fails on invalid sourceType", () => {
    const errors: GameError[] = [];
    // @ts-expect-error intentional invalid type
    const chunk = normalizeChunk(base({ sourceType: "diary" }), errors);
    expect(chunk).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("fails on invalid visibility", () => {
    const errors: GameError[] = [];
    // @ts-expect-error intentional invalid value
    const chunk = normalizeChunk(base({ visibility: "classified" }), errors);
    expect(chunk).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });

  it("fails when validFrom is after validUntil", () => {
    const errors: GameError[] = [];
    const chunk = normalizeChunk(
      base({
        validFrom: makeGameTime(5, 3, "early"),
        validUntil: makeGameTime(2, 1, "late"),
      }),
      errors,
    );
    expect(chunk).toBeNull();
    expect(errors.some((e) => e.code === "INVALID_TIME_RANGE")).toBe(true);
  });

  it("accepts validFrom === validUntil", () => {
    const errors: GameError[] = [];
    const t = makeGameTime(3, 6, "mid");
    const chunk = normalizeChunk(base({ validFrom: t, validUntil: t }), errors);
    expect(chunk).not.toBeNull();
  });
});

describe("normalizeChunks", () => {
  it("returns chunks sorted by id", () => {
    const errors: GameError[] = [];
    const inputs = [
      base({ id: "z.last", text: "last chunk" }),
      base({ id: "a.first", text: "first chunk" }),
    ];
    const chunks = normalizeChunks(inputs, errors);
    expect(chunks.map((c) => c.id)).toEqual(["a.first", "z.last"]);
  });

  it("detects duplicate IDs", () => {
    const errors: GameError[] = [];
    const inputs = [base({ id: "dup" }), base({ id: "dup" })];
    const chunks = normalizeChunks(inputs, errors);
    expect(chunks).toHaveLength(1);
    expect(errors.some((e) => e.code === "DUPLICATE_ID")).toBe(true);
  });

  it("returns only valid chunks when some are invalid", () => {
    const errors: GameError[] = [];
    const inputs = [
      base({ id: "good", title: "Good" }),
      base({ id: "bad", title: "" }),
    ];
    const chunks = normalizeChunks(inputs, errors);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.id).toBe("good");
    expect(errors.length).toBeGreaterThan(0);
  });
});

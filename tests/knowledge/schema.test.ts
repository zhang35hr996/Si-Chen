import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import { knowledgeChunkInputSchema } from "../../src/engine/knowledge/schema";
import { VISIBILITY_RANK, visibilitiesAtOrBelow } from "../../src/engine/knowledge/model";

function validInput() {
  return {
    id: "test.chunk",
    sourceType: "etiquette" as const,
    title: "禁足礼制",
    text: "受禁足处分的侍君不得离开所居宫殿。",
    tags: ["etiquette"],
    entityIds: [],
    locationIds: [],
    visibility: "public" as const,
    sourcePath: "fixtures/test.md",
  };
}

describe("knowledgeChunkInputSchema", () => {
  it("accepts a valid chunk", () => {
    const r = knowledgeChunkInputSchema.safeParse(validInput());
    expect(r.success).toBe(true);
  });

  it("rejects empty id", () => {
    const r = knowledgeChunkInputSchema.safeParse({ ...validInput(), id: "" });
    expect(r.success).toBe(false);
  });

  it("rejects empty title", () => {
    const r = knowledgeChunkInputSchema.safeParse({ ...validInput(), title: "" });
    expect(r.success).toBe(false);
  });

  it("rejects empty text", () => {
    const r = knowledgeChunkInputSchema.safeParse({ ...validInput(), text: "" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid sourceType", () => {
    const r = knowledgeChunkInputSchema.safeParse({ ...validInput(), sourceType: "secret_diary" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid visibility", () => {
    const r = knowledgeChunkInputSchema.safeParse({ ...validInput(), visibility: "top_secret" });
    expect(r.success).toBe(false);
  });

  it("accepts optional validFrom/validUntil GameTime", () => {
    const r = knowledgeChunkInputSchema.safeParse({
      ...validInput(),
      validFrom: makeGameTime(1, 1, "early"),
      validUntil: makeGameTime(5, 12, "late"),
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid GameTime (missing dayIndex)", () => {
    const r = knowledgeChunkInputSchema.safeParse({
      ...validInput(),
      validFrom: { year: 1, month: 1, period: "early" },
    });
    expect(r.success).toBe(false);
  });
});

describe("VISIBILITY_RANK", () => {
  it("public < restricted < imperial", () => {
    expect(VISIBILITY_RANK.public).toBeLessThan(VISIBILITY_RANK.restricted);
    expect(VISIBILITY_RANK.restricted).toBeLessThan(VISIBILITY_RANK.imperial);
  });
});

describe("visibilitiesAtOrBelow", () => {
  it("public ceiling → only public", () => {
    expect(visibilitiesAtOrBelow("public")).toEqual(["public"]);
  });

  it("restricted ceiling → public and restricted", () => {
    const result = visibilitiesAtOrBelow("restricted");
    expect(result).toContain("public");
    expect(result).toContain("restricted");
    expect(result).not.toContain("imperial");
  });

  it("imperial ceiling → all three", () => {
    const result = visibilitiesAtOrBelow("imperial");
    expect(result).toContain("public");
    expect(result).toContain("restricted");
    expect(result).toContain("imperial");
  });
});

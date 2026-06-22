import { describe, it, expect } from "vitest";
import { dialogueToolOutputSchema, dialogueToolOutputJsonSchema } from "../../src/engine/dialogue/providerContract";

describe("dialogueToolOutputSchema", () => {
  it("accepts text-only (proposedClaims defaults to [])", () => {
    const r = dialogueToolOutputSchema.safeParse({ text: "本宫累了。" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.proposedClaims).toEqual([]);
  });
  it("rejects empty text", () => {
    expect(dialogueToolOutputSchema.safeParse({ text: "" }).success).toBe(false);
  });
  it("rejects a choices field (model cannot author options in v1)", () => {
    expect(dialogueToolOutputSchema.safeParse({ text: "嗯。", choices: [{ id: "x", text: "y" }] }).success).toBe(false);
  });
  it("caps proposedClaims at 8", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      claim: { id: `c${i}`, predicate: "holds_rank", subjectId: "s", modality: "assert" },
      sourceRefs: [{ kind: "memory", id: "m1" }], modality: "assert", certainty: 50,
    }));
    expect(dialogueToolOutputSchema.safeParse({ text: "嗯。", proposedClaims: many }).success).toBe(false);
  });
  it("tool JSON schema excludes non-model fields and forbids extras", () => {
    const props = (dialogueToolOutputJsonSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("text");
    expect(props).toHaveProperty("proposedClaims");
    for (const f of ["speaker", "expression", "choices", "usage", "providerMeta"]) expect(props).not.toHaveProperty(f);
    expect((dialogueToolOutputJsonSchema as { additionalProperties: unknown }).additionalProperties).toBe(false);
  });
});

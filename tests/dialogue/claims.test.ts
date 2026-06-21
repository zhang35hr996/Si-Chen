import { describe, it, expect } from "vitest";
import { z } from "zod";
import { proposedClaimSchema, claimToFactKey, type DialogueClaim } from "../../src/engine/dialogue/claims";

const claim = (over: Partial<DialogueClaim> = {}): DialogueClaim => ({
  id: "c1", predicate: "resides_at", subjectId: "shen_zhibai", object: "xianfu_palace",
  modality: "assert", ...over,
});

describe("proposedClaimSchema", () => {
  it("accepts a well-formed proposed claim", () => {
    const parsed = proposedClaimSchema.safeParse({
      claim: claim(), sourceContextIds: ["mem_shen_zhibai_000001"], modality: "assert", certainty: 90,
    });
    expect(parsed.success).toBe(true);
  });
  it("rejects certainty out of 0–100", () => {
    expect(proposedClaimSchema.safeParse({
      claim: claim(), sourceContextIds: [], modality: "assert", certainty: 150,
    }).success).toBe(false);
  });
  it("normalizes a missing proposedClaims array to []", () => {
    const wrapper = z.object({ proposedClaims: z.array(proposedClaimSchema).default([]) });
    expect(wrapper.parse({}).proposedClaims).toEqual([]);
  });
});

describe("claimToFactKey", () => {
  it("maps resides_at/holds_rank/alive to a FactKey", () => {
    expect(claimToFactKey(claim({ predicate: "resides_at" }))).toEqual({ predicate: "resides_at", subjectId: "shen_zhibai" });
    expect(claimToFactKey(claim({ predicate: "holds_rank" }))).toEqual({ predicate: "holds_rank", subjectId: "shen_zhibai" });
    expect(claimToFactKey(claim({ predicate: "alive" }))).toEqual({ predicate: "alive", subjectId: "shen_zhibai" });
  });
  it("returns undefined for predicates with no belief fact", () => {
    expect(claimToFactKey(claim({ predicate: "currently_same_residence" }))).toBeUndefined();
    expect(claimToFactKey(claim({ predicate: "caused_event" }))).toBeUndefined();
    expect(claimToFactKey(claim({ predicate: "parent_of" }))).toBeUndefined();
    expect(claimToFactKey(claim({ predicate: "responsible_for" }))).toBeUndefined();
  });
});

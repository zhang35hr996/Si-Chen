// tests/dialogue/claimGate.test.ts
import { describe, it, expect } from "vitest";
import { validateDialogueClaims, type ClaimGateContext } from "../../src/engine/dialogue/claimGate";
import type { BeliefProjection, FactKey, BelievedFact } from "../../src/engine/chronicle/belief";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";
import type { DialogueAudienceContext } from "../../src/engine/dialogue/audience";

const audience: DialogueAudienceContext = { targetId: "player", targetRole: "sovereign", presentCharacterIds: ["player"], privacy: "semi_private" };
const beliefsFrom = (facts: Record<string, BelievedFact>): BeliefProjection => ({
  getFact: (_charId: string, key: FactKey) => facts[`${key.predicate}:${key.subjectId}`],
});
const pc = (over: Partial<ProposedClaim> & { id?: string } = {}): ProposedClaim => ({
  claim: { id: over.id ?? "c1", predicate: "resides_at", subjectId: "shen_zhibai", object: "xianfu_palace", modality: "assert" },
  sourceContextIds: ["mem_1"], modality: "assert", certainty: 90, ...over,
});
const base = (over: Partial<ClaimGateContext> = {}): ClaimGateContext => ({
  speakerId: "gu_yunzhi", audience, beliefs: beliefsFrom({}), offeredContextIds: new Set(["mem_1"]), proposedClaims: [], ...over,
});

describe("validateDialogueClaims", () => {
  it("passes a claim that matches speaker belief from offered context", () => {
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "xianfu_palace", certainty: 100 } }),
      proposedClaims: [pc()],
    }));
    expect(r.ok).toBe(true);
    expect(r.acceptedClaims).toHaveLength(1);
  });
  it("flags unknown_source_context when a source id was not offered", () => {
    const r = validateDialogueClaims(base({ proposedClaims: [pc({ sourceContextIds: ["mem_X"] })] }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("unknown_source_context");
  });
  it("flags contradicts_speaker_belief when belief value differs", () => {
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "changchun_palace", certainty: 100 } }),
      proposedClaims: [pc()],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("contradicts_speaker_belief");
  });
  it("flags reveals_unknown_fact when belief is undefined but claim asserts", () => {
    const r = validateDialogueClaims(base({ proposedClaims: [pc({ certainty: 60 })] })); // belief empty
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("reveals_unknown_fact");
  });
  it("flags claims_excessive_certainty when low-certainty belief is asserted strongly", () => {
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "xianfu_palace", certainty: 30 } }),
      proposedClaims: [pc({ certainty: 95 })],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("claims_excessive_certainty");
  });
  it("flags identity_mismatch when a consort asserts an imperial act as the player", () => {
    const r = validateDialogueClaims(base({
      proposedClaims: [pc({ claim: { id: "c1", predicate: "caused_event", subjectId: "player", object: "decree", modality: "assert" }, sourceContextIds: ["mem_1"] })],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("identity_mismatch");
  });
  it("rejects the whole line (acceptedClaims empty) when any claim fails", () => {
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "xianfu_palace", certainty: 100 } }),
      proposedClaims: [pc({ id: "ok" }), pc({ id: "bad", sourceContextIds: ["mem_X"] })],
    }));
    expect(r.ok).toBe(false);
    expect(r.acceptedClaims).toHaveLength(0);
  });
  it("passes trivially on empty proposedClaims (mock)", () => {
    expect(validateDialogueClaims(base()).ok).toBe(true);
  });
});

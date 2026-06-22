// tests/dialogue/claimGate.test.ts
import { describe, it, expect } from "vitest";
import {
  validateDialogueClaims,
  isContradictedByBelief,
  isCoveredByAllowedClaim,
  isCoveredByForbiddenClaim,
  type ClaimGateContext,
} from "../../src/engine/dialogue/claimGate";
import type { BeliefProjection, FactKey, BelievedFact } from "../../src/engine/chronicle/belief";
import type { ProposedClaim, ContextRef } from "../../src/engine/dialogue/claims";
import type { DialogueClaim } from "../../src/engine/dialogue/claims";
import type { DialogueAudienceContext } from "../../src/engine/dialogue/audience";
import type { AuthorizedClaim } from "../../src/engine/dialogue/types";

const audience: DialogueAudienceContext = { targetId: "player", targetRole: "sovereign", presentCharacterIds: ["player"], privacy: "semi_private" };
const beliefsFrom = (facts: Record<string, BelievedFact>): BeliefProjection => ({
  getFact: (_charId: string, key: FactKey) => facts[`${key.predicate}:${key.subjectId}`],
});

const memRef = (id: string): ContextRef => ({ kind: "memory", id });
const evtRef = (id: string): ContextRef => ({ kind: "event", id });

const pc = (over: Partial<ProposedClaim> & { id?: string } = {}): ProposedClaim => ({
  claim: { id: over.id ?? "c1", predicate: "resides_at", subjectId: "shen_zhibai", object: "xianfu_palace", modality: "assert" },
  sourceRefs: [memRef("mem_1")], modality: "assert", certainty: 90, ...over,
});
const base = (over: Partial<ClaimGateContext> = {}): ClaimGateContext => ({
  speakerId: "gu_yunzhi", audience, beliefs: beliefsFrom({}), offeredContextIds: new Set(["mem_1"]), proposedClaims: [], ...over,
});

// ── Existing gate tests (migrated) ─────────────────────────────────────────────

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
    const r = validateDialogueClaims(base({ proposedClaims: [pc({ sourceRefs: [memRef("mem_X")] })] }));
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
      proposedClaims: [pc({ claim: { id: "c1", predicate: "caused_event", subjectId: "player", object: "decree", modality: "assert" }, sourceRefs: [memRef("mem_1")] })],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("identity_mismatch");
  });
  it("flags violates_etiquette when asserting a rank claim about a present consort before sovereign", () => {
    const r = validateDialogueClaims(base({
      audience: { targetId: "player", targetRole: "sovereign", presentCharacterIds: ["player", "lu_huaijin"], privacy: "semi_private" },
      speakerId: "shen_zhibai",
      beliefs: beliefsFrom({ "holds_rank:lu_huaijin": { value: "concubine", certainty: 100 } }),
      proposedClaims: [pc({
        claim: { id: "c1", predicate: "holds_rank", subjectId: "lu_huaijin", object: "concubine", modality: "assert" },
        sourceRefs: [memRef("mem_1")],
      })],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toEqual(["violates_etiquette"]);
  });
  it("rejects the whole line (acceptedClaims empty) when any claim fails", () => {
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "xianfu_palace", certainty: 100 } }),
      proposedClaims: [pc({ id: "ok" }), pc({ id: "bad", sourceRefs: [memRef("mem_X")] })],
    }));
    expect(r.ok).toBe(false);
    expect(r.acceptedClaims).toHaveLength(0);
  });
  it("passes trivially on empty proposedClaims (mock)", () => {
    expect(validateDialogueClaims(base()).ok).toBe(true);
  });
});

// ── isContradictedByBelief ─────────────────────────────────────────────────────

describe("isContradictedByBelief", () => {
  const aliveClaim = (modality: "assert" | "deny"): DialogueClaim => ({
    id: "c_alive", predicate: "alive", subjectId: "heir_001", modality,
  });
  const rankClaim = (object: string, modality: "assert" | "deny"): DialogueClaim => ({
    id: "c_rank", predicate: "holds_rank", subjectId: "shen_zhibai", object, modality,
  });

  it("alive affirm: contradicted when believed=false", () => {
    expect(isContradictedByBelief(aliveClaim("assert"), false)).toBe(true);
  });
  it("alive affirm: not contradicted when believed=true", () => {
    expect(isContradictedByBelief(aliveClaim("assert"), true)).toBe(false);
  });
  it("alive deny: contradicted when believed=true", () => {
    expect(isContradictedByBelief(aliveClaim("deny"), true)).toBe(true);
  });
  it("alive deny: consistent with believed=false", () => {
    expect(isContradictedByBelief(aliveClaim("deny"), false)).toBe(false);
  });
  it("holds_rank affirm: contradicted when believed rank differs", () => {
    expect(isContradictedByBelief(rankClaim("fenghou", "assert"), "zhaoyi")).toBe(true);
  });
  it("holds_rank affirm: not contradicted when believed rank matches", () => {
    expect(isContradictedByBelief(rankClaim("fenghou", "assert"), "fenghou")).toBe(false);
  });
  it("holds_rank deny object='X': contradicted when believed='X'", () => {
    expect(isContradictedByBelief(rankClaim("zhaoyi", "deny"), "zhaoyi")).toBe(true);
  });
  it("holds_rank deny object='X': not contradicted when believed≠'X'", () => {
    expect(isContradictedByBelief(rankClaim("zhaoyi", "deny"), "fenghou")).toBe(false);
  });
});

// ── claim gate — belief gate + event auth ─────────────────────────────────────

describe("claim gate — belief gate + event auth", () => {
  it("skips reveals_unknown_fact for event-authorized claim", () => {
    // claim about resides_at — no belief known (would normally flag reveals_unknown_fact)
    // but allowedClaims contains a matching authorized claim → eventAuthorized=true
    const auth: AuthorizedClaim = {
      claim: { id: "auth_1", predicate: "resides_at", subjectId: "shen_zhibai", object: "xianfu_palace", modality: "assert" },
      sourceRefs: [evtRef("evt_001")],
    };
    const proposed = pc({ sourceRefs: [evtRef("evt_001")] });
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({}), // no belief → would fire reveals_unknown_fact without auth
      offeredContextIds: new Set(["evt_001"]),
      proposedClaims: [proposed],
      allowedClaims: [auth],
    }));
    // eventAuthorized=true → reveals_unknown_fact skipped
    expect(r.findings.map((f) => f.code)).not.toContain("reveals_unknown_fact");
    expect(r.ok).toBe(true);
  });

  it("event-authorized rank claim passes when subject not in scene", () => {
    // holds_rank claim — belief returns undefined (subject not visible to speaker)
    // but event-authorized → reveals_unknown_fact skipped
    const auth: AuthorizedClaim = {
      claim: { id: "auth_rank", predicate: "holds_rank", subjectId: "lu_huaijin", object: "chenghui", modality: "assert" },
      sourceRefs: [evtRef("evt_rank_001")],
    };
    const proposed: ProposedClaim = {
      claim: { id: "c_rank", predicate: "holds_rank", subjectId: "lu_huaijin", object: "chenghui", modality: "assert" },
      sourceRefs: [evtRef("evt_rank_001")],
      modality: "assert",
      certainty: 90,
    };
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({}), // no belief available → would fire reveals_unknown_fact
      offeredContextIds: new Set(["evt_rank_001"]),
      proposedClaims: [proposed],
      allowedClaims: [auth],
      audience: { targetId: "player", targetRole: "sovereign", presentCharacterIds: ["player"], privacy: "semi_private" },
    }));
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => f.code)).not.toContain("reveals_unknown_fact");
  });

  it("event-authorized residence claim passes when subject not present", () => {
    const auth: AuthorizedClaim = {
      claim: { id: "auth_res", predicate: "resides_at", subjectId: "lu_huaijin", object: "zhongcui_gong", modality: "assert" },
      sourceRefs: [evtRef("evt_res_001")],
    };
    const proposed: ProposedClaim = {
      claim: { id: "c_res", predicate: "resides_at", subjectId: "lu_huaijin", object: "zhongcui_gong", modality: "assert" },
      sourceRefs: [evtRef("evt_res_001")],
      modality: "assert",
      certainty: 85,
    };
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({}),
      offeredContextIds: new Set(["evt_res_001"]),
      proposedClaims: [proposed],
      allowedClaims: [auth],
    }));
    expect(r.ok).toBe(true);
  });

  it("contradicts_speaker_belief fires for event-authorized claim with opposite belief", () => {
    // Even when event-authorized, belief contradiction still fires
    const auth: AuthorizedClaim = {
      claim: { id: "auth_wrong", predicate: "holds_rank", subjectId: "shen_zhibai", object: "zhaoyi", modality: "assert" },
      sourceRefs: [evtRef("evt_002")],
    };
    const proposed: ProposedClaim = {
      claim: { id: "c_wrong_rank", predicate: "holds_rank", subjectId: "shen_zhibai", object: "zhaoyi", modality: "assert" },
      sourceRefs: [evtRef("evt_002")],
      modality: "assert",
      certainty: 90,
    };
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "holds_rank:shen_zhibai": { value: "fenghou", certainty: 100 } }),
      offeredContextIds: new Set(["evt_002"]),
      proposedClaims: [proposed],
      allowedClaims: [auth],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("contradicts_speaker_belief");
  });
});

// ── claim gate — new violation codes ──────────────────────────────────────────

describe("claim gate — new violation codes", () => {
  it("source_not_authorized: empty sourceRefs", () => {
    const proposed: ProposedClaim = {
      claim: { id: "c_empty", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
      sourceRefs: [],
      modality: "assert",
      certainty: 80,
    };
    // sourceRefs.length === 0 → source_not_authorized
    // Note: schema requires min(1), so this tests the gate logic directly
    const r = validateDialogueClaims(base({
      offeredContextIds: new Set(["mem_1"]),
      proposedClaims: [proposed],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("source_not_authorized");
  });

  it("claim_explicitly_forbidden: covered by forbiddenClaims (fact+polarity only, no source check)", () => {
    const forbidden: DialogueClaim = {
      id: "f_1", predicate: "holds_rank", subjectId: "lu_huaijin", object: "chenghui", modality: "assert",
    };
    const proposed: ProposedClaim = {
      claim: { id: "c_forbidden", predicate: "holds_rank", subjectId: "lu_huaijin", object: "chenghui", modality: "assert" },
      sourceRefs: [memRef("mem_1")],
      modality: "assert",
      certainty: 80,
    };
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "holds_rank:lu_huaijin": { value: "chenghui", certainty: 100 } }),
      offeredContextIds: new Set(["mem_1"]),
      proposedClaims: [proposed],
      forbiddenClaims: [forbidden],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("claim_explicitly_forbidden");
  });

  it("claim_not_allowed: CLOSED [] rejects all fact claims", () => {
    // allowedClaims=[] means no claim can be authorized → claim_not_allowed
    const proposed = pc({
      claim: { id: "c_notallowed", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
      sourceRefs: [memRef("mem_1")],
    });
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "holds_rank:shen_zhibai": { value: "fenghou", certainty: 100 } }),
      offeredContextIds: new Set(["mem_1"]),
      proposedClaims: [proposed],
      allowedClaims: [], // CLOSED: empty list
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("claim_not_allowed");
  });

  it("claim_not_allowed: not covered by non-empty allowedClaims", () => {
    // allowedClaims has a claim about a different subject
    const auth: AuthorizedClaim = {
      claim: { id: "auth_other", predicate: "holds_rank", subjectId: "lu_huaijin", object: "chenghui", modality: "assert" },
      sourceRefs: [evtRef("evt_001")],
    };
    const proposed: ProposedClaim = {
      claim: { id: "c_mismatch", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
      sourceRefs: [evtRef("evt_001")],
      modality: "assert",
      certainty: 80,
    };
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "holds_rank:shen_zhibai": { value: "fenghou", certainty: 100 } }),
      offeredContextIds: new Set(["evt_001"]),
      proposedClaims: [proposed],
      allowedClaims: [auth],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("claim_not_allowed");
  });

  it("passes when covered by allowedClaims, source in authorized∩offered", () => {
    const auth: AuthorizedClaim = {
      claim: { id: "auth_pass", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
      sourceRefs: [evtRef("evt_001")],
    };
    const proposed: ProposedClaim = {
      claim: { id: "c_pass", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
      sourceRefs: [evtRef("evt_001")],
      modality: "assert",
      certainty: 80,
    };
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({}), // no belief — skipped because eventAuthorized
      offeredContextIds: new Set(["evt_001"]),
      proposedClaims: [proposed],
      allowedClaims: [auth],
    }));
    expect(r.ok).toBe(true);
  });

  it("allowedClaims=undefined → skip check (backward compat)", () => {
    // No allowedClaims defined → open mode, use old source check
    const proposed: ProposedClaim = {
      claim: { id: "c_compat", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
      sourceRefs: [memRef("mem_1")],
      modality: "assert",
      certainty: 80,
    };
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "holds_rank:shen_zhibai": { value: "fenghou", certainty: 100 } }),
      offeredContextIds: new Set(["mem_1"]),
      proposedClaims: [proposed],
      // allowedClaims NOT set → backward compat open mode
    }));
    expect(r.ok).toBe(true);
    expect(r.findings.map((f) => f.code)).not.toContain("claim_not_allowed");
  });

  it("source_not_authorized: sourceRef not in authorized.sourceRefs or not in offeredRefs", () => {
    // allowedClaims exists, claim matches by fact, but source intersection fails
    const auth: AuthorizedClaim = {
      claim: { id: "auth_ok", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
      sourceRefs: [evtRef("evt_001")], // authorized by evt_001
    };
    const proposed: ProposedClaim = {
      claim: { id: "c_badsrc", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
      sourceRefs: [evtRef("evt_999")], // not in authorized.sourceRefs
      modality: "assert",
      certainty: 80,
    };
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({}),
      offeredContextIds: new Set(["evt_001", "evt_999"]),
      proposedClaims: [proposed],
      allowedClaims: [auth],
    }));
    expect(r.ok).toBe(false);
    expect(r.findings.map((f) => f.code)).toContain("claim_not_allowed");
  });

  it("existing gate tests all pass (no regression — resides_at belief check)", () => {
    // Full regression: a claim with valid belief and offered source passes
    const r = validateDialogueClaims(base({
      beliefs: beliefsFrom({ "resides_at:shen_zhibai": { value: "xianfu_palace", certainty: 100 } }),
      proposedClaims: [pc()],
    }));
    expect(r.ok).toBe(true);
    expect(r.acceptedClaims).toHaveLength(1);
  });
});

// ── isCoveredByAllowedClaim ────────────────────────────────────────────────────

describe("isCoveredByAllowedClaim", () => {
  const auth: AuthorizedClaim = {
    claim: { id: "a1", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
    sourceRefs: [evtRef("evt_001")],
  };
  const proposed: ProposedClaim = {
    claim: { id: "p1", predicate: "holds_rank", subjectId: "shen_zhibai", object: "fenghou", modality: "assert" },
    sourceRefs: [evtRef("evt_001")],
    modality: "assert",
    certainty: 80,
  };
  const offered = new Set(["evt_001"]);

  it("returns true when fact+polarity+source all match", () => {
    expect(isCoveredByAllowedClaim(proposed, auth, offered)).toBe(true);
  });
  it("returns false when predicate differs", () => {
    const p2 = { ...proposed, claim: { ...proposed.claim, predicate: "resides_at" as const } };
    expect(isCoveredByAllowedClaim(p2, auth, offered)).toBe(false);
  });
  it("returns false when subjectId differs", () => {
    const p2 = { ...proposed, claim: { ...proposed.claim, subjectId: "lu_huaijin" } };
    expect(isCoveredByAllowedClaim(p2, auth, offered)).toBe(false);
  });
  it("returns false when object differs", () => {
    const p2 = { ...proposed, claim: { ...proposed.claim, object: "zhaoyi" } };
    expect(isCoveredByAllowedClaim(p2, auth, offered)).toBe(false);
  });
  it("returns false when polarity differs (assert vs deny)", () => {
    const p2: ProposedClaim = { ...proposed, claim: { ...proposed.claim, modality: "deny" }, modality: "deny" };
    expect(isCoveredByAllowedClaim(p2, auth, offered)).toBe(false);
  });
  it("returns false when sourceRef not in offered", () => {
    expect(isCoveredByAllowedClaim(proposed, auth, new Set(["other"]))).toBe(false);
  });
  it("returns false when sourceRef not in authorized.sourceRefs", () => {
    const p2: ProposedClaim = { ...proposed, sourceRefs: [evtRef("evt_999")] };
    expect(isCoveredByAllowedClaim(p2, auth, new Set(["evt_999"]))).toBe(false);
  });
});

// ── isCoveredByForbiddenClaim ──────────────────────────────────────────────────

describe("isCoveredByForbiddenClaim", () => {
  const forbidden: DialogueClaim = {
    id: "f1", predicate: "holds_rank", subjectId: "lu_huaijin", object: "chenghui", modality: "assert",
  };
  const proposed: ProposedClaim = {
    claim: { id: "c1", predicate: "holds_rank", subjectId: "lu_huaijin", object: "chenghui", modality: "assert" },
    sourceRefs: [memRef("mem_1")],
    modality: "assert",
    certainty: 80,
  };

  it("returns true when fact+polarity match (no source check)", () => {
    expect(isCoveredByForbiddenClaim(proposed, forbidden)).toBe(true);
  });
  it("returns false when predicate differs", () => {
    const p2 = { ...proposed, claim: { ...proposed.claim, predicate: "resides_at" as const } };
    expect(isCoveredByForbiddenClaim(p2, forbidden)).toBe(false);
  });
  it("returns false when subjectId differs", () => {
    const p2 = { ...proposed, claim: { ...proposed.claim, subjectId: "shen_zhibai" } };
    expect(isCoveredByForbiddenClaim(p2, forbidden)).toBe(false);
  });
  it("returns false when object differs", () => {
    const p2 = { ...proposed, claim: { ...proposed.claim, object: "jieyu" } };
    expect(isCoveredByForbiddenClaim(p2, forbidden)).toBe(false);
  });
  it("matches regardless of source (source check intentionally absent)", () => {
    // Different source ref — still matches (forbidden check doesn't care about sources)
    const p2: ProposedClaim = { ...proposed, sourceRefs: [evtRef("evt_never_offered")] };
    expect(isCoveredByForbiddenClaim(p2, forbidden)).toBe(true);
  });
});

// ── mentionWriteback — kind routing ───────────────────────────────────────────

// These are in the dedicated mentionWriteback test, but we add a note here:
// The gate itself doesn't write back — that's orchestrator/mentionWriteback's job.
// The new sourceRefs shape lets mentionWriteback route by kind.

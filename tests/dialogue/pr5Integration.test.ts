/**
 * PR5 integration: proves the 4 claim-gate chains.
 *
 * (a) CLOSED MODE  — allowedClaims=[] blocks factual claims (P0.1 fix)
 * (b) BELIEF GATE  — authorized claim contradicts belief → contradicts_speaker_belief
 * (c) NO CLAIMS    — proposedClaims:[] → line passes unchanged, mentionLog unchanged
 * (d) SOURCE GATE  — authorized fact but proposed sourceRef not in offeredRefKeys ∩ authorized → source_not_authorized
 *
 * Chains (b) and (d) use validateDialogueClaims directly with explicit allowedClaims so
 * the CLOSED gate is bypassed and the downstream belief/source checks are reachable.
 */
import { describe, it, expect } from "vitest";
import {
  assembleDialogueRequest,
  buildDialoguePolicyContext,
  produceDialogueTurn,
} from "../../src/engine/dialogue/orchestrator";
import { validateDialogueClaims } from "../../src/engine/dialogue/claimGate";
import { buildAudienceContext } from "../../src/engine/dialogue/audience";
import { GroundTruthBeliefProjection } from "../../src/engine/chronicle/belief";
import type { DialogueProvider, AuthorizedClaim } from "../../src/engine/dialogue/types";
import { contextRefKey } from "../../src/engine/dialogue/types";
import type { DialogueProviderResult } from "../../src/engine/dialogue/providerContract";
import { ok } from "../../src/engine/infra/result";
import { createNewGameState } from "../../src/engine/state/newGame";
import { withConsort } from "../helpers/consortFixture";
import { loadRealContent } from "../helpers/contentFixture";
import type { DialogueClaim, ProposedClaim } from "../../src/engine/dialogue/claims";

const db = loadRealContent();
// shen_zhibai is now event_only; inject her so belief projection can read her rank
const state = withConsort(createNewGameState(db), db, "shen_zhibai");
const SPEAKER = "shen_zhibai";
const VALID_TEXT = "臣侍告退，陛下早些歇息。";

function makeRequest() {
  const r = assembleDialogueRequest(db, state, SPEAKER, "zichendian");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function makeProvider(proposedClaims: ProposedClaim[], text = VALID_TEXT): DialogueProvider {
  return {
    id: "synthetic",
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: false, batch: false },
    generate(req) {
      return Promise.resolve(
        ok<DialogueProviderResult>({
          speaker: req.speakerId,
          text,
          choices: [],
          proposedClaims,
        }),
      );
    },
  };
}

describe("buildDialoguePolicyContext", () => {
  it("builds audience, beliefProjection, offeredRefKeys, now from the request", () => {
    const policy = buildDialoguePolicyContext(db, state, makeRequest());
    expect(policy.audience.targetId).toBe("player");
    expect(policy.audience.targetRole).toBe("sovereign");
    expect(policy.now).toMatchObject({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect(typeof policy.beliefProjection.getFact).toBe("function");
    // shen_zhibai has memories → offeredRefKeys is non-empty
    expect(policy.offeredRefKeys.size).toBeGreaterThan(0);
  });

  it("rejects an unknown speaker at request assembly (validated once, upstream)", () => {
    const result = assembleDialogueRequest(db, state, "char_ghost", "zichendian");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BAD_SPEAKER");
  });

  it("offeredRefKeys derives from promptContext.relevantMemories (single-source invariant)", () => {
    // Single-source contract: offeredRefKeys MUST be derived from promptContext.relevantMemories —
    // the exact memories that appear in the LLM prompt — not from speakerContext.relevantMemories.
    // Tampering promptContext.relevantMemories must be reflected verbatim in offeredRefKeys.
    const request = makeRequest();
    const original = request.promptContext.relevantMemories[0];
    expect(original).toBeDefined();
    const sentinelId = "sentinel_offered_id";
    const tampered = {
      ...request,
      promptContext: {
        ...request.promptContext,
        relevantMemories: [{ ...original!, id: sentinelId }],
        knownEvents: [],
      },
    };
    const policy = buildDialoguePolicyContext(db, state, tampered);
    expect(policy.offeredRefKeys).toBeInstanceOf(Set);
    expect(policy.offeredRefKeys.has(`memory:${sentinelId}`)).toBe(true);
    expect(policy.offeredRefKeys.size).toBe(1);
  });
});

describe("produceDialogueTurn — chain (c): no declarations", () => {
  it("passes with empty proposedClaims; mentionLog stays the same", async () => {
    const request = makeRequest();
    const result = await produceDialogueTurn(db, makeProvider([]), request, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.text).toBe(VALID_TEXT);
    expect(result.value.nextState.mentionLog.length).toBe(state.mentionLog.length);
    expect(result.value.line.meta.generated).toBe(true);
    expect(result.value.line.meta.degraded).toBe(false);
  });
});

describe("produceDialogueTurn — chain (a): CLOSED mode — no factual claims allowed", () => {
  it("passes with empty proposedClaims in CLOSED mode (no chronicle events → allowedClaims=[])", async () => {
    // Fresh state has no chronicle events → assembleDialogueRequest produces allowedClaims=[].
    // Empty proposedClaims should still pass (no claims to gate).
    const request = makeRequest();
    expect(request.promptContext.allowedClaims).toHaveLength(0); // CLOSED
    const result = await produceDialogueTurn(db, makeProvider([]), request, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.text).toBe(VALID_TEXT);
    expect(result.value.nextState.mentionLog.length).toBe(state.mentionLog.length);
  });

  it("rejects factual claim with claim_not_allowed when allowedClaims=[] (CLOSED E2E — P0.1)", async () => {
    // Verifies P0.1 fix: empty allowedClaims=[] is passed as CLOSED, not silently dropped to OPEN.
    // Before fix: allowedClaims=[] was converted to undefined → OPEN → claim passed.
    // After fix: allowedClaims=[] → CLOSED → claim_not_allowed finding.
    const request = makeRequest();
    expect(request.promptContext.allowedClaims).toHaveLength(0);
    const firstMemoryId = request.promptContext.relevantMemories[0]!.id;
    const factualClaim: ProposedClaim = {
      claim: { id: "c_closed", predicate: "holds_rank", subjectId: SPEAKER, object: "huanghou", modality: "assert" },
      sourceRefs: [{ kind: "memory" as const, id: firstMemoryId }],
      modality: "assert",
      certainty: 80,
    };
    const result = await produceDialogueTurn(db, makeProvider([factualClaim]), request, state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CLAIM_REJECTED");
      // Verify the specific violation — not just any CLAIM_REJECTED
      const findings = result.error.context?.findings as Array<{ code: string }> | undefined;
      expect(findings?.some((f) => f.code === "claim_not_allowed")).toBe(true);
    }
  });
});

describe("validateDialogueClaims — chain (b): authorized claim contradicts belief", () => {
  it("fires contradicts_speaker_belief when fact passes allowed gate but value contradicts belief", () => {
    // shen_zhibai is fenghou. We authorize holds_rank(shen_zhibai, zhaoyi) explicitly so it passes
    // the CLOSED gate, then the belief gate catches the contradiction.
    const request = makeRequest();
    const firstMemoryId = request.promptContext.relevantMemories[0]!.id;
    const offeredRefKeys = new Set([contextRefKey({ kind: "memory", id: firstMemoryId })]);
    const audience = buildAudienceContext(state, db, { speakerId: SPEAKER, targetId: "player" });
    const beliefs = new GroundTruthBeliefProjection(state);

    const authorized: AuthorizedClaim = {
      claim: { id: "auth_b", predicate: "holds_rank", subjectId: SPEAKER, object: "zhaoyi", modality: "assert" },
      sourceRefs: [{ kind: "memory" as const, id: firstMemoryId }],
    };
    const wrongRankClaim: ProposedClaim = {
      claim: { id: "c2", predicate: "holds_rank", subjectId: SPEAKER, object: "zhaoyi", modality: "assert" },
      sourceRefs: [{ kind: "memory" as const, id: firstMemoryId }],
      modality: "assert",
      certainty: 90,
    };

    const result = validateDialogueClaims({
      speakerId: SPEAKER,
      audience,
      beliefs,
      offeredRefKeys,
      proposedClaims: [wrongRankClaim],
      allowedClaims: [authorized],
    });

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "contradicts_speaker_belief")).toBe(true);
  });
});

describe("validateDialogueClaims — chain (d): authorized fact, unauthorized source", () => {
  it("fires source_not_authorized when proposed sourceRef is not in authorized sourceRefs", () => {
    // Authorize holds_rank(shen_zhibai, fenghou) with memory sourceRef X.
    // Propose the same claim but cite a DIFFERENT memory not in authorized sourceRefs.
    // The fact+polarity passes Phase 1 but Phase 2 (source intersection) fails → source_not_authorized.
    const request = makeRequest();
    const realMemoryId = request.promptContext.relevantMemories[0]!.id;
    const fakeSourceId = "fake_memory_id_not_in_authorized_xyz";
    // Both real and fake must be in offeredRefKeys to prove the rejection is source-authorization,
    // not mere "not offered" — the fake ID is not in offered but passes as "offered" for this test
    const offeredRefKeys = new Set([
      contextRefKey({ kind: "memory", id: realMemoryId }),
      contextRefKey({ kind: "memory", id: fakeSourceId }),
    ]);
    const audience = buildAudienceContext(state, db, { speakerId: SPEAKER, targetId: "player" });
    const beliefs = new GroundTruthBeliefProjection(state);

    const authorized: AuthorizedClaim = {
      claim: { id: "auth_d", predicate: "holds_rank", subjectId: SPEAKER, object: "huanghou", modality: "assert" },
      // Only realMemoryId is authorized; fakeSourceId is NOT
      sourceRefs: [{ kind: "memory" as const, id: realMemoryId }],
    };
    const wrongSrcClaim: ProposedClaim = {
      claim: { id: "c3", predicate: "holds_rank", subjectId: SPEAKER, object: "huanghou", modality: "assert" },
      // Claims the wrong source — not in authorized.sourceRefs
      sourceRefs: [{ kind: "memory" as const, id: fakeSourceId }],
      modality: "assert",
      certainty: 90,
    };

    const result = validateDialogueClaims({
      speakerId: SPEAKER,
      audience,
      beliefs,
      offeredRefKeys,
      proposedClaims: [wrongSrcClaim],
      allowedClaims: [authorized],
    });

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "source_not_authorized")).toBe(true);
  });
});

describe("validateDialogueClaims — claim_explicitly_forbidden: source-independence", () => {
  it("claim_explicitly_forbidden rejected regardless of sourceRef (source-independence)", () => {
    // Proves forbidden gate fires before source check: a different valid sourceRef
    // cannot bypass the forbidden claim gate.
    const request = makeRequest();
    const realMemoryId = request.promptContext.relevantMemories[0]!.id;
    const differentSourceId = "different_source_not_matching_forbidden_check_xyz";
    const offeredRefKeys = new Set([
      contextRefKey({ kind: "memory", id: realMemoryId }),
      contextRefKey({ kind: "memory", id: differentSourceId }),
    ]);
    const audience = buildAudienceContext(state, db, { speakerId: SPEAKER, targetId: "player" });
    const beliefs = new GroundTruthBeliefProjection(state);

    // Authorize the fact so it passes the CLOSED gate
    const authorized: AuthorizedClaim = {
      claim: { id: "auth_src_indep", predicate: "holds_rank", subjectId: SPEAKER, object: "huanghou", modality: "assert" },
      sourceRefs: [{ kind: "memory" as const, id: differentSourceId }],
    };

    // forbiddenClaims blocks this claim by fact+polarity
    const forbidden: DialogueClaim = {
      id: "forbid_src_indep",
      predicate: "holds_rank",
      subjectId: SPEAKER,
      object: "huanghou",
      modality: "assert",
    };

    // Proposed claim cites a DIFFERENT valid sourceRef
    const proposedClaim: ProposedClaim = {
      claim: { id: "c_src_indep", predicate: "holds_rank", subjectId: SPEAKER, object: "huanghou", modality: "assert" },
      sourceRefs: [{ kind: "memory" as const, id: differentSourceId }],
      modality: "assert",
      certainty: 80,
    };

    const result = validateDialogueClaims({
      speakerId: SPEAKER,
      audience,
      beliefs,
      offeredRefKeys,
      proposedClaims: [proposedClaim],
      allowedClaims: [authorized],
      forbiddenClaims: [forbidden],
    });

    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.code === "claim_explicitly_forbidden")).toBe(true);
  });
});

describe("produceDialogueTurn — gate ordering", () => {
  it("text gate failure still fails the line even with valid claims", async () => {
    const request = makeRequest();

    // forbidden text: 娘娘 is a forbidden term
    const provider = makeProvider([], "娘娘圣明。");

    const result = await produceDialogueTurn(db, provider, request, state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("GATE_REJECTED");
  });

  it("wrong speaker is rejected at finalizeLine level", async () => {
    const request = makeRequest();

    const wrongSpeakerProvider: DialogueProvider = {
      id: "wrong",
      kind: "generative",
      capabilities: { strictTools: false, promptCaching: false, batch: false },
      generate() {
        return Promise.resolve(
          ok<DialogueProviderResult>({
            speaker: "wei_sui", // not the requested speaker
            text: VALID_TEXT,
            choices: [],
            proposedClaims: [],
          }),
        );
      },
    };

    const result = await produceDialogueTurn(db, wrongSpeakerProvider, request, state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_SPEAKER");
  });
});

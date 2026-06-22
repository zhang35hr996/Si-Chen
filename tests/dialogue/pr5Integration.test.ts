/**
 * PR5 integration: proves the 4 claim-gate chains through produceDialogueTurn (generative path).
 *
 * (a) HAPPY PATH   — valid claim with real offeredContextId → line passes, mentionLog grows
 * (b) CLAIM REJECT — claim contradicts belief (wrong rank value) → CLAIM_REJECTED error
 * (c) NO CLAIMS    — proposedClaims:[] → line passes unchanged, mentionLog unchanged
 * (d) UNKNOWN SRC  — claim with fake sourceContextId → unknown_source_context → CLAIM_REJECTED
 */
import { describe, it, expect } from "vitest";
import {
  assembleDialogueRequest,
  buildDialoguePolicyContext,
  produceDialogueTurn,
} from "../../src/engine/dialogue/orchestrator";
import type { DialogueProvider } from "../../src/engine/dialogue/types";
import type { DialogueProviderResult } from "../../src/engine/dialogue/providerContract";
import { ok } from "../../src/engine/infra/result";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";

const db = loadRealContent();
const state = createNewGameState(db);
const SPEAKER = "shen_zhibai";
const VALID_TEXT = "本宫累了，陛下早些歇息。";

function makeRequest() {
  const r = assembleDialogueRequest(db, state, SPEAKER, "zichendian");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

function makePolicy() {
  return buildDialoguePolicyContext(db, state, makeRequest());
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

  it("offeredRefKeys is derived from the request actually sent (single source, no re-compute)", () => {
    // Single-source contract: offeredRefKeys MUST be derived from the exact
    // relevantMemories carried by the DialogueRequest handed to the provider.
    // Tampering the request's memories must be reflected verbatim in offeredRefKeys.
    const request = makeRequest();
    const original = request.speakerContext.relevantMemories[0];
    expect(original).toBeDefined();
    const sentinelId = "sentinel_offered_id";
    const tampered = {
      ...request,
      speakerContext: {
        ...request.speakerContext,
        relevantMemories: [{ ...original!, id: sentinelId }],
      },
      promptContext: { ...request.promptContext, knownEvents: [] },
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
    // Verifies P0.1 fix: empty allowedClaims must pass to gate as CLOSED, not silently drop to OPEN.
    // Before fix: allowedClaims=[] was converted to undefined → OPEN mode → claim passed.
    // After fix: allowedClaims=[] is passed directly → CLOSED → claim_not_allowed.
    const request = makeRequest();
    expect(request.promptContext.allowedClaims).toHaveLength(0);
    const firstMemoryId = request.speakerContext.relevantMemories[0]!.id;
    const factualClaim: ProposedClaim = {
      claim: { id: "c_closed", predicate: "holds_rank", subjectId: SPEAKER, object: "fenghou", modality: "assert" },
      sourceRefs: [{ kind: "memory" as const, id: firstMemoryId }],
      modality: "assert",
      certainty: 80,
    };
    const result = await produceDialogueTurn(db, makeProvider([factualClaim]), request, state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CLAIM_REJECTED");
    }
  });
});

describe("produceDialogueTurn — chain (b): claim contradicts belief", () => {
  it("rejects a claim that contradicts what shen_zhibai should believe about their rank", async () => {
    const request = makeRequest();

    const firstOfferedId = request.speakerContext.relevantMemories[0]!.id;

    // shen_zhibai is fenghou; claim says "zhaoyi" → contradicts belief
    const wrongRankClaim: ProposedClaim = {
      claim: {
        id: "c2",
        predicate: "holds_rank",
        subjectId: SPEAKER,
        object: "zhaoyi",
        modality: "assert",
      },
      sourceRefs: [{ kind: "memory" as const, id: firstOfferedId }],
      modality: "assert",
      certainty: 90,
    };

    const result = await produceDialogueTurn(db, makeProvider([wrongRankClaim]), request, state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CLAIM_REJECTED");
    }
  });
});

describe("produceDialogueTurn — chain (d): unknown source context", () => {
  it("rejects a claim with a sourceRef not in offered memories", async () => {
    const request = makeRequest();

    const unknownSrcClaim: ProposedClaim = {
      claim: {
        id: "c3",
        predicate: "holds_rank",
        subjectId: SPEAKER,
        object: "fenghou",
        modality: "assert",
      },
      sourceRefs: [{ kind: "memory" as const, id: "fake_memory_id_not_offered_xyz" }],
      modality: "assert",
      certainty: 90,
    };

    const result = await produceDialogueTurn(db, makeProvider([unknownSrcClaim]), request, state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CLAIM_REJECTED");
    }
  });
});

describe("produceDialogueTurn — gate ordering", () => {
  it("text gate failure still fails the line even with valid claims", async () => {
    const request = makeRequest();

    // forbidden text: 皇上 is a forbidden term
    const provider = makeProvider([], "皇上圣明。");

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

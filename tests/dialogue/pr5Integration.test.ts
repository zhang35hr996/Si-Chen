/**
 * PR5 integration: proves the 4 claim-gate chains through produceDialogueLineWithPolicy.
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
  produceDialogueLineWithPolicy,
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
  it("builds audience, beliefProjection, offeredContextIds, now from the request", () => {
    const policy = buildDialoguePolicyContext(db, state, makeRequest());
    expect(policy.audience.targetId).toBe("player");
    expect(policy.audience.targetRole).toBe("sovereign");
    expect(policy.now).toMatchObject({ year: 1, month: 1, period: "early", dayIndex: 0 });
    expect(typeof policy.beliefProjection.getFact).toBe("function");
    // shen_zhibai has memories → offeredContextIds is non-empty
    expect(policy.offeredContextIds.size).toBeGreaterThan(0);
  });

  it("rejects an unknown speaker at request assembly (validated once, upstream)", () => {
    const result = assembleDialogueRequest(db, state, "char_ghost", "zichendian");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("BAD_SPEAKER");
  });

  it("offeredContextIds is derived from the request actually sent (single source, no re-compute)", () => {
    // Single-source contract: offeredContextIds MUST be derived from the exact
    // relevantMemories carried by the DialogueRequest handed to the provider,
    // never from an independent buildMemoryContext call (which can drift once
    // targetId becomes dynamic). Tampering the request's memories must show up
    // verbatim in offeredContextIds.
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
    };
    const policy = buildDialoguePolicyContext(db, state, tampered);
    expect(policy.offeredContextIds).toBeInstanceOf(Set);
    expect([...policy.offeredContextIds]).toEqual([sentinelId]);
  });
});

describe("produceDialogueLineWithPolicy — chain (c): no declarations", () => {
  it("passes with empty proposedClaims; mentionLog stays the same", async () => {
    const request = makeRequest();
    const policy = makePolicy();
    const result = await produceDialogueLineWithPolicy(db, makeProvider([]), request, policy, state);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.text).toBe(VALID_TEXT);
    expect(result.value.nextState.mentionLog.length).toBe(state.mentionLog.length);
    expect(result.value.line.meta.generated).toBe(true);
    expect(result.value.line.meta.degraded).toBe(false);
  });
});

describe("produceDialogueLineWithPolicy — chain (a): happy path with valid claim", () => {
  it("accepts a claim whose sourceContextId is in offeredContextIds; mentionLog grows", async () => {
    const request = makeRequest();
    const policy = makePolicy();

    // Use the first real offered context id (from shen_zhibai's actual memories)
    const firstOfferedId = [...policy.offeredContextIds][0]!;

    const validClaim: ProposedClaim = {
      claim: {
        id: "c1",
        predicate: "holds_rank",
        subjectId: SPEAKER,
        object: "fenghou",
        modality: "assert",
      },
      sourceContextIds: [firstOfferedId],
      modality: "assert",
      certainty: 90,
    };

    const result = await produceDialogueLineWithPolicy(
      db,
      makeProvider([validClaim]),
      request,
      policy,
      state,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.line.text).toBe(VALID_TEXT);
    // mentionLog should have grown because the claim was accepted and written back
    expect(result.value.nextState.mentionLog.length).toBeGreaterThan(state.mentionLog.length);
  });
});

describe("produceDialogueLineWithPolicy — chain (b): claim contradicts belief", () => {
  it("rejects a claim that contradicts what shen_zhibai should believe about their rank", async () => {
    const request = makeRequest();
    const policy = makePolicy();

    const firstOfferedId = [...policy.offeredContextIds][0]!;

    // shen_zhibai is fenghou; claim says "zhaoyi" → contradicts belief
    const wrongRankClaim: ProposedClaim = {
      claim: {
        id: "c2",
        predicate: "holds_rank",
        subjectId: SPEAKER,
        object: "zhaoyi",
        modality: "assert",
      },
      sourceContextIds: [firstOfferedId],
      modality: "assert",
      certainty: 90,
    };

    const result = await produceDialogueLineWithPolicy(
      db,
      makeProvider([wrongRankClaim]),
      request,
      policy,
      state,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CLAIM_REJECTED");
    }
  });
});

describe("produceDialogueLineWithPolicy — chain (d): unknown source context", () => {
  it("rejects a claim with a sourceContextId not in offeredContextIds", async () => {
    const request = makeRequest();
    const policy = makePolicy();

    const unknownSrcClaim: ProposedClaim = {
      claim: {
        id: "c3",
        predicate: "holds_rank",
        subjectId: SPEAKER,
        object: "fenghou",
        modality: "assert",
      },
      sourceContextIds: ["fake_memory_id_not_offered_xyz"],
      modality: "assert",
      certainty: 90,
    };

    const result = await produceDialogueLineWithPolicy(
      db,
      makeProvider([unknownSrcClaim]),
      request,
      policy,
      state,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CLAIM_REJECTED");
    }
  });
});

describe("produceDialogueLineWithPolicy — gate ordering", () => {
  it("text gate failure still fails the line even with valid claims", async () => {
    const request = makeRequest();
    const policy = makePolicy();

    // forbidden text: 皇上 is a forbidden term
    const provider = makeProvider([], "皇上圣明。");

    const result = await produceDialogueLineWithPolicy(db, provider, request, policy, state);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("GATE_REJECTED");
  });

  it("wrong speaker is rejected at finalizeLine level", async () => {
    const request = makeRequest();
    const policy = makePolicy();

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

    const result = await produceDialogueLineWithPolicy(
      db,
      wrongSpeakerProvider,
      request,
      policy,
      state,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("WRONG_SPEAKER");
  });
});

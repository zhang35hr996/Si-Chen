/**
 * T3: validateDialogueProviderResult — shared validation pipeline.
 *
 * Tests validate:
 *   1. ok=true path: returns line + diagnostics
 *   2. Speaker-first ordering: WRONG_SPEAKER before CLAIM_REJECTED
 *   3. Claim gate failure: CLAIM_REJECTED, claimFindings non-empty
 *   4. Text gate failure: GATE_REJECTED, textFindings non-empty
 *   5. Diagnostics always present even on ok=false paths
 */
import { describe, it, expect } from "vitest";
import {
  assembleDialogueRequest,
  buildDialoguePolicyContext,
  validateDialogueProviderResult,
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

const PROVIDER: DialogueProvider = {
  id: "test-provider",
  kind: "generative",
  capabilities: { strictTools: true, promptCaching: false, batch: false },
  generate: async (req) =>
    ok<DialogueProviderResult>({
      speaker: req.speakerId,
      text: VALID_TEXT,
      choices: [],
      proposedClaims: [],
    }),
};

function makeResponse(
  overrides: Partial<DialogueProviderResult> = {},
): DialogueProviderResult {
  return {
    speaker: SPEAKER,
    text: VALID_TEXT,
    choices: [],
    proposedClaims: [],
    ...overrides,
  };
}

function makeWrongClaimResponse(): DialogueProviderResult {
  const firstOfferedId = [...makePolicy().offeredContextIds][0]!;
  // shen_zhibai is fenghou; claim says "zhaoyi" → contradicts belief
  const wrongRankClaim: ProposedClaim = {
    claim: {
      id: "c_wrong",
      predicate: "holds_rank",
      subjectId: SPEAKER,
      object: "zhaoyi",
      modality: "assert",
    },
    sourceContextIds: [firstOfferedId],
    modality: "assert",
    certainty: 90,
  };
  return makeResponse({ proposedClaims: [wrongRankClaim] });
}

describe("validateDialogueProviderResult", () => {
  it("ok=true: returns line + diagnostics", () => {
    const request = makeRequest();
    const policy = makePolicy();
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse(),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.line.speakerId).toBe(SPEAKER);
    expect(outcome.line.text).toBe(VALID_TEXT);
    expect(outcome.line.meta.generated).toBe(true);
    expect(outcome.line.meta.degraded).toBe(false);
    expect(outcome.diagnostics).toBeDefined();
    expect(outcome.diagnostics.claimFindings).toEqual([]);
    expect(outcome.diagnostics.textFindings).toEqual([]);
    expect(Array.isArray(outcome.diagnostics.acceptedClaims)).toBe(true);
  });

  it("ok=false speaker mismatch: error=WRONG_SPEAKER, diagnostics present", () => {
    const request = makeRequest();
    const policy = makePolicy();
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse({ speaker: "wei_sui" }), // wrong speaker
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("WRONG_SPEAKER");
    expect(outcome.diagnostics).toBeDefined();
    // diagnostics are empty because we failed before any gate ran
    expect(outcome.diagnostics.claimFindings).toEqual([]);
    expect(outcome.diagnostics.textFindings).toEqual([]);
    expect(outcome.diagnostics.acceptedClaims).toEqual([]);
  });

  it("ok=false wrong speaker + wrong claim: WRONG_SPEAKER (not CLAIM_REJECTED)", () => {
    // LLM-2: speaker check now precedes claim gate; wrong speaker always returns WRONG_SPEAKER
    // See: docs/superpowers/plans/2026-06-22-llm-2-prompt-compiler-eval.md T3
    const request = makeRequest();
    const policy = makePolicy();
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      // wrong speaker AND wrong claim — speaker check must win
      { ...makeWrongClaimResponse(), speaker: "wei_sui" },
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("WRONG_SPEAKER");
    // claim gate must NOT have run — so claimFindings stays empty
    expect(outcome.diagnostics.claimFindings).toEqual([]);
  });

  it("ok=false claim gate rejects: CLAIM_REJECTED, claimFindings non-empty", () => {
    const request = makeRequest();
    const policy = makePolicy();
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeWrongClaimResponse(),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("CLAIM_REJECTED");
    expect(outcome.diagnostics).toBeDefined();
    expect(outcome.diagnostics.claimFindings.length).toBeGreaterThan(0);
  });

  it("ok=false text gate rejects: GATE_REJECTED, textFindings non-empty", () => {
    const request = makeRequest();
    const policy = makePolicy();
    // 皇上 is a forbidden term
    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse({ text: "皇上圣明。" }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("GATE_REJECTED");
    expect(outcome.diagnostics).toBeDefined();
    expect(outcome.diagnostics.textFindings.length).toBeGreaterThan(0);
  });

  it("diagnostics.acceptedClaims present on ok=false text gate path", () => {
    const request = makeRequest();
    const policy = makePolicy();
    const firstOfferedId = [...policy.offeredContextIds][0]!;

    // A valid claim (should be accepted by claim gate) but forbidden text
    const validClaim: ProposedClaim = {
      claim: {
        id: "c_valid",
        predicate: "holds_rank",
        subjectId: SPEAKER,
        object: "fenghou",
        modality: "assert",
      },
      sourceContextIds: [firstOfferedId],
      modality: "assert",
      certainty: 90,
    };

    const outcome = validateDialogueProviderResult(
      db,
      PROVIDER,
      request,
      policy,
      makeResponse({ text: "皇上圣明。", proposedClaims: [validClaim] }),
    );

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;

    expect(outcome.error.code).toBe("GATE_REJECTED");
    // acceptedClaims should be populated from the claim gate that passed
    expect(outcome.diagnostics.acceptedClaims).toBeDefined();
    expect(Array.isArray(outcome.diagnostics.acceptedClaims)).toBe(true);
  });
});

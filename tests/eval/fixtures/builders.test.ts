/**
 * Golden scenario smoke tests (T5 + T11, LLM-2 / LLM-3).
 *
 * Runs representative golden scenarios through the full eval pipeline to
 * verify that fixture builders wire up correctly end-to-end.
 *
 * Scenarios exercised:
 *   sc001 — base_palace: gate passes, expectations pass
 *   sc013 — gate_reject_test: gate fails, raw text preserved
 *   sc023 — consort_with_grievance: proposedClaims=[] → gateStatus=pass (T11)
 *   sc011 — wrong_speaker_test: WRONG_SPEAKER → gateStatus=fail
 *   sc008 — demoted_consort: wenya compliant line passes gate
 *
 * T11 new tests:
 *   evaluateExpectations — requiredSourceRefs pass when all cited
 *   evaluateExpectations — fails required_source_not_cited when missing
 *   consort_with_grievance — proposedClaims: [] passes gate
 *   coresidence_conflict — resides_at → claim_not_allowed (CLOSED)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runEvalScenario, evaluateExpectations } from "../../../src/engine/dialogue/eval/evalRunner";
import { evalFixtures, GRIEVANCE_MEMORY_ID, RANK_EVENT_ID } from "./builders";
import type { EvalScenario } from "../../../src/engine/dialogue/eval/types";
import type { ProposedClaim } from "../../../src/engine/dialogue/claims";
import { validateDialogueClaims } from "../../../src/engine/dialogue/claimGate";
import { GroundTruthBeliefProjection } from "../../../src/engine/chronicle/belief";
import { buildAudienceContext } from "../../../src/engine/dialogue/audience";
import { loadRealContent } from "../../helpers/contentFixture";
import { createNewGameState } from "../../../src/engine/state/newGame";

// ── Load scenarios from JSONL ─────────────────────────────────────────────────

function loadScenarios(): EvalScenario[] {
  const raw = readFileSync(
    join(import.meta.dirname, "../golden/scenarios.jsonl"),
    "utf-8",
  );
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as EvalScenario);
}

const allScenarios = loadScenarios();

function getScenario(id: string): EvalScenario {
  const s = allScenarios.find((sc) => sc.id === id);
  if (!s) throw new Error(`scenario ${id} not found`);
  return s;
}

function getFixture(id: string) {
  const f = evalFixtures[id];
  if (!f) throw new Error(`fixture ${id} not found`);
  return f;
}

// ── Smoke tests ───────────────────────────────────────────────────────────────

describe("golden scenarios smoke", () => {
  it("sc001: base_palace passes gate and expectations", async () => {
    const scenario = getScenario("sc001");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 0);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("pass");
    expect(result.expectationStatus).toBe("pass");
    expect(result.text).toBeDefined();
    expect(result.servedText).toBeDefined();
  });

  it("sc013: gate_reject_test fails gate, raw text preserved", async () => {
    const scenario = getScenario("sc013");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 1);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("fail");
    // Raw text is preserved even when gate fails
    expect(result.text).toBe("皇上圣明，臣侍领旨。");
    expect(result.servedText).toBeUndefined();
    // textFindings should contain the forbidden_lexicon finding
    expect(result.textFindings.length).toBeGreaterThan(0);
    // gatePass=false expectation is satisfied → expectationStatus=pass
    expect(result.expectationStatus).toBe("pass");
  });

  it("sc023: consort_with_grievance proposedClaims=[] → gateStatus=pass", async () => {
    // T11: consort_with_grievance now returns proposedClaims: []
    // The grievance memory is in context but no claims are proposed → gate passes cleanly
    const scenario = getScenario("sc023");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 2);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("pass");
    expect(result.claimFindings).toEqual([]);
    expect(GRIEVANCE_MEMORY_ID).toBe("mem_eval_grievance_001");
  });

  it("sc011: wrong_speaker_test returns gateStatus=fail (WRONG_SPEAKER)", async () => {
    const scenario = getScenario("sc011");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 3);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("fail");
    // gatePass=false expectation → expectationStatus=pass
    expect(result.expectationStatus).toBe("pass");
  });

  it("sc008: demoted_consort wenya compliant line passes gate", async () => {
    const scenario = getScenario("sc008");
    const fixture = getFixture(scenario.fixtureId);
    const result = await runEvalScenario(scenario, fixture, "smoke-eval", 4);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("pass");
    expect(result.text).toBe("侍身领命，不敢有怨。");
    expect(result.expectationStatus).toBe("pass");
  });
});

// ── Scenario count validation ─────────────────────────────────────────────────

describe("scenarios.jsonl coverage", () => {
  it("has ≥32 scenarios (T11)", () => {
    expect(allScenarios.length).toBeGreaterThanOrEqual(32);
  });

  it("has ≥4 different speakerIds", () => {
    const speakers = new Set(allScenarios.map((s) => s.speakerId));
    expect(speakers.size).toBeGreaterThanOrEqual(4);
  });

  it("has ≥8 different fixtureIds (T11: new fixtures)", () => {
    const fixtures = new Set(allScenarios.map((s) => s.fixtureId));
    expect(fixtures.size).toBeGreaterThanOrEqual(8);
  });

  it("has ≥5 scenarios with sceneDirective", () => {
    const withDirective = allScenarios.filter((s) => s.sceneDirective !== undefined);
    expect(withDirective.length).toBeGreaterThanOrEqual(5);
  });

  it("has ≥5 scenarios with transcript", () => {
    const withTranscript = allScenarios.filter(
      (s) => s.transcript !== undefined && s.transcript.length > 0,
    );
    expect(withTranscript.length).toBeGreaterThanOrEqual(5);
  });

  it("has ≥5 scenarios with expectations.gatePass=true", () => {
    const withGatePassTrue = allScenarios.filter(
      (s) => s.expectations?.gatePass === true,
    );
    expect(withGatePassTrue.length).toBeGreaterThanOrEqual(5);
  });

  it("has ≥4 scenarios with expectations.gatePass=false (T11: coresidence + source mismatch)", () => {
    const withGatePassFalse = allScenarios.filter(
      (s) => s.expectations?.gatePass === false,
    );
    expect(withGatePassFalse.length).toBeGreaterThanOrEqual(4);
  });

  it("has ≥4 scenarios with expectations.forbiddenTexts", () => {
    const withForbiddenTexts = allScenarios.filter(
      (s) => s.expectations?.forbiddenTexts !== undefined && s.expectations.forbiddenTexts.length > 0,
    );
    expect(withForbiddenTexts.length).toBeGreaterThanOrEqual(4);
  });

  it("has ≥2 scenarios with expectations.requiredSourceRefs citing RANK_EVENT_ID (T11)", () => {
    const withRequired = allScenarios.filter(
      (s) =>
        s.expectations?.requiredSourceRefs !== undefined &&
        s.expectations.requiredSourceRefs.some((r) => r.id === RANK_EVENT_ID),
    );
    expect(withRequired.length).toBeGreaterThanOrEqual(2);
  });

  it("has ≥3 scenarios with mustKnowEventIds (T11)", () => {
    const withMustKnow = allScenarios.filter(
      (s) => s.mustKnowEventIds !== undefined && s.mustKnowEventIds.length > 0,
    );
    expect(withMustKnow.length).toBeGreaterThanOrEqual(3);
  });
});

// ── T11 required test suites ─────────────────────────────────────────────────

describe("evaluateExpectations (T11)", () => {
  const PASS_RESULT = {
    schemaStatus: "pass" as const,
    gateStatus: "pass" as const,
    text: "some text",
    knownEventIds: undefined as string[] | undefined,
  };

  it("requiredSourceRefs: passes when sourceRefs includes all required (contextRefKey match)", () => {
    const claim: ProposedClaim = {
      claim: {
        id: "c_test",
        predicate: "holds_rank",
        subjectId: "lu_huaijin",
        object: "chenghui",
        modality: "assert",
      },
      sourceRefs: [{ kind: "event" as const, id: RANK_EVENT_ID }],
      modality: "assert",
      certainty: 90,
    };
    const r = evaluateExpectations(
      { requiredSourceRefs: [{ kind: "event" as const, id: RANK_EVENT_ID }] },
      PASS_RESULT,
      { claimFindings: [], textFindings: [], acceptedClaims: [claim] },
    );
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("fails required_source_not_cited when source missing", () => {
    const r = evaluateExpectations(
      { requiredSourceRefs: [{ kind: "event" as const, id: RANK_EVENT_ID }] },
      PASS_RESULT,
      { claimFindings: [], textFindings: [], acceptedClaims: [] },
    );
    expect(r.status).toBe("fail");
    expect(r.findings).toContainEqual({
      code: "required_source_not_cited",
      detail: RANK_EVENT_ID,
    });
  });

  it("mustKnowEventIds: passes when event is in knownEventIds", () => {
    const r = evaluateExpectations(
      { gatePass: true },
      { ...PASS_RESULT, knownEventIds: [RANK_EVENT_ID] },
      { claimFindings: [], textFindings: [], acceptedClaims: [] },
      [RANK_EVENT_ID],
    );
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("mustKnowEventIds: fails required_event_not_in_prompt when event missing", () => {
    const r = evaluateExpectations(
      {},
      { ...PASS_RESULT, knownEventIds: [] },
      { claimFindings: [], textFindings: [], acceptedClaims: [] },
      [RANK_EVENT_ID],
    );
    expect(r.status).toBe("fail");
    expect(r.findings).toContainEqual({
      code: "required_event_not_in_prompt",
      detail: RANK_EVENT_ID,
    });
  });

  it("not_run when mustKnowEventIds only but schema not pass", () => {
    const r = evaluateExpectations(
      undefined,
      { schemaStatus: "not_run", gateStatus: "not_run", text: undefined, knownEventIds: undefined },
      undefined,
      [RANK_EVENT_ID],
    );
    expect(r.status).toBe("not_run");
  });
});

describe("consort_with_grievance (T11)", () => {
  it("proposedClaims: [] passes gate", async () => {
    // T11: fixture now returns proposedClaims: [] — tests gate passes with empty claims
    const fixture = evalFixtures["consort_with_grievance"]!;
    const scenario: EvalScenario = {
      id: "test-grievance-empty",
      fixtureId: "consort_with_grievance",
      speakerId: "lu_huaijin",
      locationId: "zhongcui_gong",
      expectations: { gatePass: true },
    };
    const result = await runEvalScenario(scenario, fixture, "t11-test", 0);

    expect(result.gateStatus).toBe("pass");
    expect(result.claimFindings).toEqual([]);
    expect(result.expectationStatus).toBe("pass");
  });
});

describe("claim_explicitly_forbidden (T11)", () => {
  it("source-independent forbidden claim fires regardless of sourceRef", () => {
    // claim_explicitly_forbidden is checked before source intersection (§3 step 2).
    // Even with a valid sourceRef in offeredContextIds, the claim is blocked.
    const db = loadRealContent();
    const state = createNewGameState(db);
    const SPEAKER = "lu_huaijin";
    const audience = buildAudienceContext(state, db, { speakerId: SPEAKER, targetId: "player" });
    const beliefs = new GroundTruthBeliefProjection(state);

    const ranClaim: ProposedClaim = {
      claim: {
        id: "c_forbidden",
        predicate: "holds_rank",
        subjectId: SPEAKER,
        object: "chenghui",
        modality: "assert",
      },
      sourceRefs: [{ kind: "event" as const, id: RANK_EVENT_ID }],
      modality: "assert",
      certainty: 90,
    };

    // Explicitly forbid holds_rank(lu_huaijin, chenghui, assert) by fact+polarity
    const result = validateDialogueClaims({
      speakerId: SPEAKER,
      audience,
      beliefs,
      offeredContextIds: new Set([RANK_EVENT_ID]),
      proposedClaims: [ranClaim],
      forbiddenClaims: [ranClaim.claim], // source-independent: only fact+polarity checked
    });

    expect(result.ok).toBe(false);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("claim_explicitly_forbidden");
    // Verify source-independence: same claim with different valid sourceRef → still forbidden
    expect(codes).not.toContain("source_not_authorized");
  });
});

describe("coresidence_conflict (T11)", () => {
  it("resides_at → claim_not_allowed (CLOSED)", () => {
    // Directly tests the claim gate in CLOSED mode (allowedClaims = []).
    // A resides_at claim is blocked when the authorized set is empty (CLOSED).
    const db = loadRealContent();
    const state = createNewGameState(db);
    const SPEAKER = "lu_huaijin";
    const audience = buildAudienceContext(state, db, { speakerId: SPEAKER, targetId: "player" });
    const beliefs = new GroundTruthBeliefProjection(state);

    const residesClaim: ProposedClaim = {
      claim: {
        id: "c_resides",
        predicate: "resides_at",
        subjectId: SPEAKER,
        object: "zhongcui_gong",
        modality: "assert",
      },
      sourceRefs: [{ kind: "event" as const, id: RANK_EVENT_ID }],
      modality: "assert",
      certainty: 80,
    };

    // CLOSED mode: allowedClaims = [] means nothing is authorized
    const result = validateDialogueClaims({
      speakerId: SPEAKER,
      audience,
      beliefs,
      offeredContextIds: new Set([RANK_EVENT_ID]),
      proposedClaims: [residesClaim],
      allowedClaims: [], // CLOSED: no authorized claims
    });

    expect(result.ok).toBe(false);
    const codes = result.findings.map((f) => f.code);
    expect(codes).toContain("claim_not_allowed");
  });
});

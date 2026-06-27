/**
 * Tests for runEvalScenario and evaluateExpectations (T4, LLM-2).
 *
 * All runEvalScenario tests use real db/state via loadRealContent +
 * createNewGameState — no mocking of assembleDialogueRequest or
 * validateDialogueProviderResult. The fixture definition is minimal but valid.
 *
 * evaluateExpectations is tested directly (exported as public API from
 * evalRunner.ts) plus indirectly through runEvalScenario.
 */
import { describe, it, expect } from "vitest";
import { runEvalScenario, evaluateExpectations } from "../../../src/engine/dialogue/eval/evalRunner";
import type {
  EvalFixtureDefinition,
  EvalFixtureResponse,
} from "../../../src/engine/dialogue/eval/fixtureProvider";
import {
  createFailingEvalFixtureProvider,
} from "../../../src/engine/dialogue/eval/fixtureProvider";
import type { EvalScenario } from "../../../src/engine/dialogue/eval/types";
import type { DialogueRequest } from "../../../src/engine/dialogue/types";
import type { ProposedClaim } from "../../../src/engine/dialogue/claims";
import type { ProviderError } from "../../../src/engine/dialogue/providerContract";
import { loadRealContent } from "../../helpers/contentFixture";
import { createNewGameState } from "../../../src/engine/state/newGame";
import {
  assembleDialogueRequest,
} from "../../../src/engine/dialogue/orchestrator";
import { evalFixtures } from "../../eval/fixtures/builders";

// ── Shared test infrastructure ────────────────────────────────────────────────

const db = loadRealContent();
const state = createNewGameState(db);

const SPEAKER = "shen_zhibai";
const LOCATION = "zichendian";
const VALID_TEXT = "臣侍告退，陛下早些歇息。";
// "娘娘" is a forbidden term (triggers text gate reject)
const GATE_REJECT_TEXT = "娘娘圣明。";

function makeScenario(overrides: Partial<EvalScenario> = {}): EvalScenario {
  return {
    id: "test-scenario",
    fixtureId: "test-fixture",
    speakerId: SPEAKER,
    locationId: LOCATION,
    ...overrides,
  };
}

function makeFixture(
  responseOverrides: Partial<EvalFixtureResponse> = {},
): EvalFixtureDefinition {
  return {
    buildState() {
      return { db, state };
    },
    responseFor(_scenario: EvalScenario, _request: DialogueRequest): EvalFixtureResponse {
      return { text: VALID_TEXT, ...responseOverrides };
    },
  };
}

/**
 * Returns an EvalFixtureDefinition whose provider always resolves with the
 * given ProviderError. Used to test the provider-error branches of runEvalScenario.
 */
function makeFixtureWithProviderError(error: ProviderError): EvalFixtureDefinition {
  return {
    buildState() { return { db, state }; },
    responseFor(_scenario: EvalScenario, _request: DialogueRequest): EvalFixtureResponse {
      return { text: VALID_TEXT };
    },
    providerFactory(_speakerId: string) {
      return createFailingEvalFixtureProvider(error);
    },
  };
}

/** Build a valid ProposedClaim using the first real offered memory. */
function makeValidClaim(): ProposedClaim {
  const request = assembleDialogueRequest(db, state, SPEAKER, LOCATION);
  if (!request.ok) throw new Error(request.error.message);
  const firstOfferedId = request.value.speakerContext.relevantMemories[0]!.id;
  return {
    claim: {
      id: "c_valid",
      predicate: "holds_rank",
      subjectId: SPEAKER,
      object: "huanghou",
      modality: "assert",
    },
    sourceRefs: [{ kind: "memory" as const, id: firstOfferedId }],
    modality: "assert",
    certainty: 90,
  };
}

/** Returns the first real memory id for shen_zhibai. */
function firstOfferedContextId(): string {
  const request = assembleDialogueRequest(db, state, SPEAKER, LOCATION);
  if (!request.ok) throw new Error(request.error.message);
  return request.value.speakerContext.relevantMemories[0]!.id;
}

// ── describe: runEvalScenario ─────────────────────────────────────────────────

describe("runEvalScenario", () => {
  it("pass path: schemaStatus=pass, gateStatus=pass, expectationStatus=pass", async () => {
    const scenario = makeScenario({
      expectations: { gatePass: true },
    });
    const result = await runEvalScenario(scenario, makeFixture(), "eval-1", 0);

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("pass");
    expect(result.expectationStatus).toBe("pass");
    expect(result.runId).toBe("eval-1-r0");
    expect(result.runIndex).toBe(0);
    expect(result.mode).toBe("fixture");
    expect(result.fixtureId).toBe("test-fixture");
  });

  it("result.text = model raw output even when gate fails", async () => {
    const scenario = makeScenario();
    const result = await runEvalScenario(
      scenario,
      makeFixture({ text: GATE_REJECT_TEXT }),
      "eval-1",
      0,
    );

    expect(result.gateStatus).toBe("fail");
    expect(result.text).toBe(GATE_REJECT_TEXT);
  });

  it("result.servedText set only when outcome.ok", async () => {
    // Pass case — servedText should be set
    const passResult = await runEvalScenario(makeScenario(), makeFixture(), "eval-1", 0);
    expect(passResult.gateStatus).toBe("pass");
    expect(passResult.servedText).toBe(VALID_TEXT);

    // Fail case — servedText must be undefined
    const failResult = await runEvalScenario(
      makeScenario(),
      makeFixture({ text: GATE_REJECT_TEXT }),
      "eval-1",
      0,
    );
    expect(failResult.gateStatus).toBe("fail");
    expect(failResult.servedText).toBeUndefined();
  });

  it("gateStatus=fail on text gate reject; result.text preserved", async () => {
    const scenario = makeScenario();
    const result = await runEvalScenario(
      scenario,
      makeFixture({ text: GATE_REJECT_TEXT }),
      "eval-1",
      0,
    );

    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("fail");
    expect(result.text).toBe(GATE_REJECT_TEXT);
    expect(result.textFindings.length).toBeGreaterThan(0);
  });

  it("gateStatus=not_run when assembleDialogueRequest fails (invalid speakerId)", async () => {
    // The assembly step itself fails when the speakerId is unknown — this returns
    // schemaStatus=not_run and gateStatus=not_run without ever calling the provider.
    const scenario = makeScenario({ speakerId: "char_ghost_nonexistent" });
    const result = await runEvalScenario(scenario, makeFixture(), "eval-1", 0);

    expect(result.schemaStatus).toBe("not_run");
    expect(result.gateStatus).toBe("not_run");
    expect(result.expectationStatus).toBe("not_run");
  });

  it("schemaStatus=not_run when assembleDialogueRequest fails", async () => {
    // Assembly failure path: bad speakerId → assembleDialogueRequest returns err →
    // runner returns early with schemaStatus=not_run, gateStatus=not_run, durationMs=0.
    const scenario = makeScenario({ speakerId: "no_such_speaker" });
    const result = await runEvalScenario(scenario, makeFixture(), "eval-2", 1);

    expect(result.schemaStatus).toBe("not_run");
    expect(result.gateStatus).toBe("not_run");
    expect(result.durationMs).toBe(0);
    expect(result.runId).toBe("eval-2-r1");
  });

  it("schemaStatus=fail when provider returns schema_invalid error", async () => {
    // Provider resolves err({kind:"protocol", cause:"schema_invalid"}) →
    // runner maps to schemaStatus="fail", gateStatus="not_run".
    const schemaInvalidError: ProviderError = {
      kind: "protocol",
      retryable: false,
      cause: "schema_invalid",
    };
    const scenario = makeScenario();
    const result = await runEvalScenario(
      scenario,
      makeFixtureWithProviderError(schemaInvalidError),
      "eval-3",
      0,
    );

    expect(result.schemaStatus).toBe("fail");
    expect(result.gateStatus).toBe("not_run");
    expect(result.expectationStatus).toBe("not_run");
    expect(result.providerError).toEqual({ kind: "protocol", cause: "schema_invalid" });
  });

  it("schemaStatus=not_run when provider returns transport/network error", async () => {
    // Provider resolves err({kind:"transport", cause:"network"}) →
    // runner maps to schemaStatus="not_run" (no "cause" on transport errors in runner logic),
    // gateStatus="not_run".
    const transportError: ProviderError = {
      kind: "transport",
      retryable: true,
      cause: "network",
    };
    const scenario = makeScenario();
    const result = await runEvalScenario(
      scenario,
      makeFixtureWithProviderError(transportError),
      "eval-4",
      0,
    );

    expect(result.schemaStatus).toBe("not_run");
    expect(result.gateStatus).toBe("not_run");
    expect(result.expectationStatus).toBe("not_run");
    expect(result.providerError).toEqual({ kind: "transport", cause: "network" });
  });

  it("expectationStatus=not_run when schemaStatus !== pass", async () => {
    const scenario = makeScenario({
      speakerId: "no_such_speaker",
      expectations: { gatePass: true },
    });
    const result = await runEvalScenario(scenario, makeFixture(), "eval-1", 0);

    expect(result.schemaStatus).toBe("not_run");
    expect(result.expectationStatus).toBe("not_run");
  });

  it("expectationStatus=not_run when gateStatus = not_run (transport error)", async () => {
    // Invalid speaker → assembly fails → gateStatus = not_run → expectations not_run
    const scenario = makeScenario({
      speakerId: "no_such_speaker",
      expectations: { gatePass: false, forbiddenTexts: ["娘娘"] },
    });
    const result = await runEvalScenario(scenario, makeFixture(), "eval-1", 0);

    expect(result.gateStatus).toBe("not_run");
    expect(result.expectationStatus).toBe("not_run");
  });

  it("expectationStatus=fail when gatePass=true but gate failed", async () => {
    const scenario = makeScenario({
      expectations: { gatePass: true },
    });
    const result = await runEvalScenario(
      scenario,
      makeFixture({ text: GATE_REJECT_TEXT }),
      "eval-1",
      0,
    );

    expect(result.gateStatus).toBe("fail");
    expect(result.expectationStatus).toBe("fail");
    expect(result.expectationFindings).toContainEqual(
      expect.objectContaining({ code: "unexpected_gate_result" }),
    );
  });

  it("expectationStatus=fail when forbiddenText found in result.text", async () => {
    // forbiddenTexts check is case-sensitive string inclusion in result.text
    // Use a text that passes the gate but contains a string we mark as forbidden in expectations
    const EXPECTED_FORBIDDEN = "告退";
    const scenario = makeScenario({
      expectations: { forbiddenTexts: [EXPECTED_FORBIDDEN] },
    });
    const result = await runEvalScenario(scenario, makeFixture(), "eval-1", 0);

    expect(result.gateStatus).toBe("pass");
    expect(result.text).toContain(EXPECTED_FORBIDDEN);
    expect(result.expectationStatus).toBe("fail");
    expect(result.expectationFindings).toContainEqual({
      code: "forbidden_text_present",
      detail: EXPECTED_FORBIDDEN,
    });
  });

  it("expectationStatus=pass when gatePass=false and gate actually failed", async () => {
    const scenario = makeScenario({
      expectations: { gatePass: false },
    });
    const result = await runEvalScenario(
      scenario,
      makeFixture({ text: GATE_REJECT_TEXT }),
      "eval-1",
      0,
    );

    expect(result.gateStatus).toBe("fail");
    expect(result.expectationStatus).toBe("pass");
    expect(result.expectationFindings).toEqual([]);
  });

  it("sceneDirective passed to assembleDialogueRequest via options", async () => {
    const DIRECTIVE = "侍君正在试探陛下。";
    const capturedRequests: DialogueRequest[] = [];

    const fixture: EvalFixtureDefinition = {
      buildState() {
        return { db, state };
      },
      responseFor(_scenario, request) {
        capturedRequests.push(request);
        return { text: VALID_TEXT };
      },
    };

    const scenario = makeScenario({ sceneDirective: DIRECTIVE });
    await runEvalScenario(scenario, fixture, "eval-1", 0);

    expect(capturedRequests.length).toBe(1);
    expect(capturedRequests[0]!.sceneDirective).toBe(DIRECTIVE);
  });

  it("wrong speaker fixture: gateStatus=fail, WRONG_SPEAKER in outcome", async () => {
    // speakerIdOverride makes the fixture provider return the wrong speaker
    const scenario = makeScenario();
    const result = await runEvalScenario(
      scenario,
      makeFixture({ speakerIdOverride: "wei_sui" }),
      "eval-1",
      0,
    );

    // The speaker check in validateDialogueProviderResult fails → gate fail
    expect(result.schemaStatus).toBe("pass");
    expect(result.gateStatus).toBe("fail");
    // text is still captured from the fixture response
    expect(result.text).toBe(VALID_TEXT);
  });

  it("requiredSourceRefs: fail when claim not in acceptedClaims.sourceRefs", async () => {
    const offeredId = firstOfferedContextId();
    const scenario = makeScenario({
      expectations: { requiredSourceRefs: [{ kind: "memory" as const, id: offeredId }] },
    });
    // No proposedClaims in the response → acceptedClaims is empty → id not cited
    const result = await runEvalScenario(scenario, makeFixture(), "eval-1", 0);

    expect(result.gateStatus).toBe("pass");
    expect(result.expectationStatus).toBe("fail");
    expect(result.expectationFindings).toContainEqual({
      code: "required_source_not_cited",
      detail: offeredId,
    });
  });

  it("requiredSourceRefs: pass when claim cited in acceptedClaims (direct evaluateExpectations)", () => {
    // In CLOSED mode (fresh state, allowedClaims=[]), even valid claims are blocked at the gate.
    // Test the requiredSourceRefs evaluation logic directly via evaluateExpectations.
    const validClaim = makeValidClaim();
    const offeredId = validClaim.sourceRefs[0]!.id;
    const r = evaluateExpectations(
      { requiredSourceRefs: [{ kind: "memory" as const, id: offeredId }] },
      { schemaStatus: "pass", gateStatus: "pass", text: VALID_TEXT },
      { claimFindings: [], textFindings: [], acceptedClaims: [validClaim], provenanceFindings: [] },
    );
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });
});

// ── describe: evaluateExpectations (direct unit tests) ────────────────────────

describe("evaluateExpectations", () => {
  const PASS_RESULT = { schemaStatus: "pass" as const, gateStatus: "pass" as const, text: "some text" };
  const FAIL_GATE_RESULT = { schemaStatus: "pass" as const, gateStatus: "fail" as const, text: "some text" };

  it("not_run when schemaStatus !== pass", () => {
    const r = evaluateExpectations(
      { gatePass: true },
      { schemaStatus: "not_run", gateStatus: "pass", text: "hello" },
      undefined,
    );
    expect(r.status).toBe("not_run");
    expect(r.findings).toEqual([]);
  });

  it("not_run when schemaStatus === fail", () => {
    const r = evaluateExpectations(
      { gatePass: true },
      { schemaStatus: "fail", gateStatus: "fail", text: "hello" },
      undefined,
    );
    expect(r.status).toBe("not_run");
    expect(r.findings).toEqual([]);
  });

  it("not_run when gateStatus === not_run", () => {
    const r = evaluateExpectations(
      { gatePass: true },
      { schemaStatus: "pass", gateStatus: "not_run", text: "hello" },
      undefined,
    );
    expect(r.status).toBe("not_run");
    expect(r.findings).toEqual([]);
  });

  it("not_run when text === undefined", () => {
    const r = evaluateExpectations(
      { gatePass: true },
      { schemaStatus: "pass", gateStatus: "pass", text: undefined },
      undefined,
    );
    expect(r.status).toBe("not_run");
    expect(r.findings).toEqual([]);
  });

  it("not_run when no expectations defined", () => {
    const r = evaluateExpectations(undefined, PASS_RESULT, undefined);
    expect(r.status).toBe("not_run");
    expect(r.findings).toEqual([]);
  });

  it("pass when all expectations met", () => {
    const r = evaluateExpectations(
      { gatePass: true, forbiddenTexts: ["龙颜"], requiredSourceRefs: [] },
      { ...PASS_RESULT, text: "无违禁词" },
      { claimFindings: [], textFindings: [], acceptedClaims: [], provenanceFindings: [] },
    );
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("fail on unexpected_gate_result (gatePass=true, gate=fail)", () => {
    const r = evaluateExpectations(
      { gatePass: true },
      FAIL_GATE_RESULT,
      undefined,
    );
    expect(r.status).toBe("fail");
    expect(r.findings).toContainEqual(
      expect.objectContaining({ code: "unexpected_gate_result" }),
    );
  });

  it("fail on unexpected_gate_result (gatePass=false, gate=pass)", () => {
    const r = evaluateExpectations(
      { gatePass: false },
      PASS_RESULT,
      undefined,
    );
    expect(r.status).toBe("fail");
    expect(r.findings).toContainEqual(
      expect.objectContaining({ code: "unexpected_gate_result" }),
    );
  });

  it("fail on forbidden_text_present", () => {
    const r = evaluateExpectations(
      { forbiddenTexts: ["龙颜"] },
      { ...PASS_RESULT, text: "陛下龙颜大悦。" },
      undefined,
    );
    expect(r.status).toBe("fail");
    expect(r.findings).toContainEqual({ code: "forbidden_text_present", detail: "龙颜" });
  });

  it("fail on required_source_not_cited", () => {
    const r = evaluateExpectations(
      { requiredSourceRefs: [{ kind: "memory" as const, id: "mem_001" }] },
      PASS_RESULT,
      { claimFindings: [], textFindings: [], acceptedClaims: [], provenanceFindings: [] },
    );
    expect(r.status).toBe("fail");
    expect(r.findings).toContainEqual({
      code: "required_source_not_cited",
      detail: "mem_001",
    });
  });

  it("pass when required source is cited", () => {
    const claim: ProposedClaim = {
      claim: {
        id: "c1",
        predicate: "holds_rank",
        subjectId: SPEAKER,
        object: "huanghou",
        modality: "assert",
      },
      sourceRefs: [{ kind: "memory" as const, id: "mem_001" }],
      modality: "assert",
      certainty: 90,
    };
    const r = evaluateExpectations(
      { requiredSourceRefs: [{ kind: "memory" as const, id: "mem_001" }] },
      PASS_RESULT,
      { claimFindings: [], textFindings: [], acceptedClaims: [claim], provenanceFindings: [] },
    );
    expect(r.status).toBe("pass");
    expect(r.findings).toEqual([]);
  });

  it("multiple failures all recorded in findings", () => {
    const r = evaluateExpectations(
      {
        gatePass: true,                         // fails: gate is actually "fail"
        forbiddenTexts: ["some text"],           // fails: text contains "some text"
        requiredSourceRefs: [{ kind: "memory" as const, id: "mem_999" }],   // fails: no acceptedClaims
      },
      FAIL_GATE_RESULT,
      { claimFindings: [], textFindings: [], acceptedClaims: [], provenanceFindings: [] },
    );
    expect(r.status).toBe("fail");
    expect(r.findings.length).toBe(3);
    const codes = r.findings.map((f) => f.code);
    expect(codes).toContain("unexpected_gate_result");
    expect(codes).toContain("forbidden_text_present");
    expect(codes).toContain("required_source_not_cited");
  });
});

// ── describe: sc040 — claim_explicitly_forbidden golden scenario ──────────────

describe("sc040 — claim_explicitly_forbidden for wenya rank claim", () => {
  it("gateStatus=fail and claimFindings contains claim_explicitly_forbidden", async () => {
    const scenario: EvalScenario = {
      id: "sc040",
      fixtureId: "forbidden_claim_test",
      speakerId: "wenya",
      locationId: "changmengong",
      expectations: { gatePass: false },
    };
    const fixture = evalFixtures["forbidden_claim_test"]!;
    const result = await runEvalScenario(scenario, fixture, "sc040-run", 0);

    expect(result.gateStatus).toBe("fail");
    expect(result.expectationStatus).toBe("pass");
    expect(result.claimFindings.some((f) => f.code === "claim_explicitly_forbidden")).toBe(true);
  });
});

/**
 * Eval runner (T4, LLM-2).
 *
 * runEvalScenario drives a single EvalScenario through the full dialogue
 * pipeline using a deterministic fixture provider instead of a real LLM.
 * It calls the shared validation pipeline (validateDialogueProviderResult)
 * and collects structured diagnostics for offline quality analysis.
 */
import {
  assembleDialogueRequest,
  buildDialoguePolicyContext,
  validateDialogueProviderResult,
} from "../orchestrator";
import { createEvalFixtureProvider } from "./fixtureProvider";
import type { EvalFixtureDefinition } from "./fixtureProvider";
import type {
  CheckStatus,
  EvalExpectationFinding,
  EvalResult,
  EvalScenario,
} from "./types";
import type { DialogueValidationDiagnostics } from "../types";

// ── evaluateExpectations ──────────────────────────────────────────────────────

/**
 * Checks scenario.expectations against the outcome gathered by runEvalScenario.
 *
 * Prerequisite guard: returns not_run when:
 *   - schemaStatus !== "pass" (provider didn't produce output)
 *   - gateStatus === "not_run" (gate pipeline never ran — transport error)
 *   - text === undefined (no raw text to inspect)
 *
 * Note: gateStatus === "fail" does NOT block expectation evaluation — the
 * text was still produced and we can check forbiddenTexts, gatePass, etc.
 */
export function evaluateExpectations(
  expectations: EvalScenario["expectations"],
  result: Pick<EvalResult, "schemaStatus" | "gateStatus" | "text">,
  diagnostics: DialogueValidationDiagnostics | undefined,
): { status: CheckStatus; findings: EvalExpectationFinding[] } {
  if (!expectations) return { status: "not_run", findings: [] };

  // prerequisite: not_run when schema failed, gate never ran, or no text
  if (
    result.schemaStatus !== "pass" ||
    result.gateStatus === "not_run" ||
    result.text === undefined
  ) {
    return { status: "not_run", findings: [] };
  }

  const findings: EvalExpectationFinding[] = [];

  if (expectations.gatePass !== undefined) {
    const actual = result.gateStatus === "pass";
    if (actual !== expectations.gatePass) {
      findings.push({
        code: "unexpected_gate_result",
        detail: `expected gatePass=${expectations.gatePass}, got ${actual}`,
      });
    }
  }

  for (const t of expectations.forbiddenTexts ?? []) {
    if (result.text.includes(t)) {
      findings.push({ code: "forbidden_text_present", detail: t });
    }
  }

  for (const id of expectations.requiredSourceContextIds ?? []) {
    const cited =
      diagnostics?.acceptedClaims.some((c) => c.sourceContextIds.includes(id)) ?? false;
    if (!cited) {
      findings.push({ code: "required_source_not_cited", detail: id });
    }
  }

  return { status: findings.length === 0 ? "pass" : "fail", findings };
}

// ── runEvalScenario ───────────────────────────────────────────────────────────

export async function runEvalScenario(
  scenario: EvalScenario,
  fixture: EvalFixtureDefinition,
  evaluationId: string,
  runIndex: number,
): Promise<EvalResult> {
  const runId = `${evaluationId}-r${runIndex}`;

  // Base shape — filled in progressively below
  const base = {
    scenarioId: scenario.id,
    runId,
    runIndex,
    fixtureId: scenario.fixtureId,
    model: "fixture",
    mode: "fixture" as const,
    claimFindings: [] as { code: string; claimId: string }[],
    textFindings: [] as { gate: string; severity: string; matched: string }[],
    expectationFindings: [] as EvalExpectationFinding[],
  };

  // Step 1 — build db + state from fixture
  const { db, state } = fixture.buildState();

  // Step 2 — assemble request
  const requestResult = assembleDialogueRequest(
    db,
    state,
    scenario.speakerId,
    scenario.locationId,
    {
      targetId: scenario.targetId,
      sceneDirective: scenario.sceneDirective,
      transcript: scenario.transcript,
    },
  );

  if (!requestResult.ok) {
    const expResult = evaluateExpectations(
      scenario.expectations,
      { schemaStatus: "not_run", gateStatus: "not_run", text: undefined },
      undefined,
    );
    return {
      ...base,
      schemaStatus: "not_run",
      gateStatus: "not_run",
      expectationStatus: expResult.status,
      expectationFindings: expResult.findings,
      durationMs: 0,
    };
  }

  const request = requestResult.value;

  // Step 3 — build policy context
  const policy = buildDialoguePolicyContext(db, state, request);

  // Step 4 — get fixture response
  const fixtureResponse = fixture.responseFor(scenario, request);

  // Step 5 — create fixture provider (or use injected override for tests)
  const provider = fixture.providerFactory
    ? fixture.providerFactory(scenario.speakerId)
    : createEvalFixtureProvider(fixtureResponse, scenario.speakerId);

  // Step 6 — call provider (timing wraps the generate call)
  const start = Date.now();
  const raw = await provider.generate(request);
  const durationMs = Date.now() - start;

  // Step 7 — provider error
  if (!raw.ok) {
    const providerError = raw.error;
    const cause = "cause" in providerError ? providerError.cause : undefined;
    const isSchemaInvalid = cause === "schema_invalid";

    const schemaStatus: CheckStatus = isSchemaInvalid ? "fail" : "not_run";
    const gateStatus: CheckStatus = "not_run";

    const expResult = evaluateExpectations(
      scenario.expectations,
      { schemaStatus, gateStatus, text: undefined },
      undefined,
    );

    return {
      ...base,
      schemaStatus,
      gateStatus,
      providerError: {
        kind: providerError.kind,
        ...(cause !== undefined ? { cause: String(cause) } : {}),
      },
      expectationStatus: expResult.status,
      expectationFindings: expResult.findings,
      durationMs,
    };
  }

  // Step 8 — provider ok: run validation pipeline
  const generatedText = raw.value.text;
  const usage = raw.value.usage;
  const requestId = raw.value.providerMeta?.requestId;

  const outcome = validateDialogueProviderResult(db, provider, request, policy, raw.value);

  let schemaStatus: CheckStatus = "pass";
  let gateStatus: CheckStatus;
  let servedText: string | undefined;

  const claimFindings = outcome.diagnostics.claimFindings.map((f) => ({
    code: f.code,
    claimId: f.claimId,
  }));
  const textFindings = outcome.diagnostics.textFindings.map((f) => ({
    gate: f.gate,
    severity: f.severity,
    matched: f.matched,
  }));

  if (outcome.ok) {
    gateStatus = "pass";
    servedText = outcome.line.text;
  } else {
    gateStatus = "fail";
    servedText = undefined;
  }

  // Step 9 — evaluate expectations
  const expResult = evaluateExpectations(
    scenario.expectations,
    { schemaStatus, gateStatus, text: generatedText },
    outcome.diagnostics,
  );

  // Step 10 — return complete result
  return {
    ...base,
    schemaStatus,
    gateStatus,
    claimFindings,
    textFindings,
    text: generatedText,
    ...(servedText !== undefined ? { servedText } : {}),
    ...(usage !== undefined
      ? {
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            ...(usage.cacheReadTokens !== undefined
              ? { cacheReadTokens: usage.cacheReadTokens }
              : {}),
          },
        }
      : {}),
    ...(requestId !== undefined ? { requestId } : {}),
    expectationStatus: expResult.status,
    expectationFindings: expResult.findings,
    durationMs,
  };
}

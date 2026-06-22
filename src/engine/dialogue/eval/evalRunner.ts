/**
 * Eval runner (T4, LLM-2).
 *
 * runEvalScenarioWithProvider is the shared execution core: it assembles a
 * DialogueRequest, runs the provider, validates the result, and evaluates
 * expectations — identically for fixture and online modes. The caller
 * supplies db/state and a makeProvider factory so the only differences
 * between modes live at the call site, not inside this file.
 *
 * runEvalScenario is the fixture-mode convenience wrapper.
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
  EvalExecutionMode,
  EvalExpectationFinding,
  EvalResult,
  EvalScenario,
} from "./types";
import type { DialogueProvider } from "../types";
import type { ContentDB } from "../../content/loader";
import type { GameState } from "../../state/types";
import type { DialogueRequest, DialogueValidationDiagnostics } from "../types";

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
  result: Pick<EvalResult, "schemaStatus" | "gateStatus" | "text" | "knownEventIds">,
  diagnostics: DialogueValidationDiagnostics | undefined,
  mustKnowEventIds?: string[],
): { status: CheckStatus; findings: EvalExpectationFinding[] } {
  if (!expectations && !mustKnowEventIds?.length) return { status: "not_run", findings: [] };

  // prerequisite: not_run when schema failed, gate never ran, or no text
  if (
    result.schemaStatus !== "pass" ||
    result.gateStatus === "not_run" ||
    result.text === undefined
  ) {
    return { status: "not_run", findings: [] };
  }

  const findings: EvalExpectationFinding[] = [];

  // ── mustKnowEventIds check ────────────────────────────────────────────────────
  const knownEventIdsSet = new Set(result.knownEventIds ?? []);
  for (const eventId of mustKnowEventIds ?? []) {
    if (!knownEventIdsSet.has(eventId)) {
      findings.push({ code: "required_event_not_in_prompt", detail: eventId });
    }
  }

  if (!expectations) {
    return { status: findings.length === 0 ? "pass" : "fail", findings };
  }

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

  for (const ref of expectations.requiredSourceRefs ?? []) {
    const cited =
      diagnostics?.acceptedClaims.some((c) =>
        c.sourceRefs.some((r) => r.kind === ref.kind && r.id === ref.id),
      ) ?? false;
    if (!cited) {
      findings.push({ code: "required_source_not_cited", detail: ref.id });
    }
  }

  return { status: findings.length === 0 ? "pass" : "fail", findings };
}

// ── runEvalScenarioWithProvider ───────────────────────────────────────────────

/**
 * Shared execution core used by both fixture and online eval paths.
 *
 * The caller provides db/state and a makeProvider factory; everything else
 * (request assembly, policy construction, validation, expectation evaluation)
 * is identical between modes.
 *
 * @param makeProvider - receives the assembled DialogueRequest so fixture mode
 *   can call fixture.responseFor(scenario, request) before creating the provider.
 */
export async function runEvalScenarioWithProvider(
  scenario: EvalScenario,
  db: ContentDB,
  state: GameState,
  makeProvider: (request: DialogueRequest) => DialogueProvider,
  evaluationId: string,
  runIndex: number,
  model: string,
  mode: EvalExecutionMode,
): Promise<EvalResult> {
  const runId = `${evaluationId}-r${runIndex}`;

  const base = {
    scenarioId: scenario.id,
    runId,
    runIndex,
    fixtureId: scenario.fixtureId,
    model,
    mode,
    sceneDirective: scenario.sceneDirective,
    claimFindings: [] as { code: string; claimId: string }[],
    textFindings: [] as { gate: string; severity: string; matched: string }[],
    expectationFindings: [] as EvalExpectationFinding[],
  };

  // Step 1 — assemble request
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
      { schemaStatus: "not_run", gateStatus: "not_run", text: undefined, knownEventIds: undefined },
      undefined,
      scenario.mustKnowEventIds,
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

  // Step 2 — build policy context
  const policy = buildDialoguePolicyContext(db, state, request);

  // Step 3 — create provider (fixture mode calls responseFor here; online just returns real provider)
  const provider = makeProvider(request);

  // Step 4 — call provider
  const start = Date.now();
  const raw = await provider.generate(request);
  const durationMs = Date.now() - start;

  // Step 5 — provider error
  if (!raw.ok) {
    const providerError = raw.error;
    const cause = "cause" in providerError ? providerError.cause : undefined;
    const isSchemaInvalid = cause === "schema_invalid";

    const schemaStatus: CheckStatus = isSchemaInvalid ? "fail" : "not_run";
    const gateStatus: CheckStatus = "not_run";

    const expResult = evaluateExpectations(
      scenario.expectations,
      { schemaStatus, gateStatus, text: undefined, knownEventIds: undefined },
      undefined,
      scenario.mustKnowEventIds,
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

  // Step 6 — validation pipeline
  const generatedText = raw.value.text;
  const usage = raw.value.usage;
  const requestId = raw.value.providerMeta?.requestId;

  // Populate knownEventIds from the assembled request's promptContext.knownEvents
  const knownEventIds = request.promptContext.knownEvents.map((e) => e.id);

  const outcome = validateDialogueProviderResult(db, provider, request, policy, raw.value);

  const claimFindings = outcome.diagnostics.claimFindings.map((f) => ({
    code: f.code,
    claimId: f.claimId,
  }));
  const textFindings = outcome.diagnostics.textFindings.map((f) => ({
    gate: f.gate,
    severity: f.severity,
    matched: f.matched,
  }));

  const gateStatus: CheckStatus = outcome.ok ? "pass" : "fail";
  const servedText = outcome.ok ? outcome.line.text : undefined;

  // Step 7 — evaluate expectations (same logic for fixture and online)
  const expResult = evaluateExpectations(
    scenario.expectations,
    { schemaStatus: "pass", gateStatus, text: generatedText, knownEventIds },
    outcome.diagnostics,
    scenario.mustKnowEventIds,
  );

  return {
    ...base,
    schemaStatus: "pass",
    gateStatus,
    claimFindings,
    textFindings,
    text: generatedText,
    knownEventIds,
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

// ── runEvalScenario (fixture-mode convenience wrapper) ────────────────────────

export async function runEvalScenario(
  scenario: EvalScenario,
  fixture: EvalFixtureDefinition,
  evaluationId: string,
  runIndex: number,
): Promise<EvalResult> {
  const { db, state } = fixture.buildState();
  return runEvalScenarioWithProvider(
    scenario,
    db,
    state,
    (request) => {
      const response = fixture.responseFor(scenario, request);
      return fixture.providerFactory
        ? fixture.providerFactory(scenario.speakerId)
        : createEvalFixtureProvider(response, scenario.speakerId);
    },
    evaluationId,
    runIndex,
    "fixture",
    "fixture",
  );
}

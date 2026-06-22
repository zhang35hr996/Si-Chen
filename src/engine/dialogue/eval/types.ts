/**
 * Eval runner types (T4, LLM-2).
 *
 * EvalResult carries all findings from a single scenario run. Text is preserved
 * even when the gate fails so evaluateExpectations can still check forbiddenTexts.
 * servedText is only set when the full validation pipeline succeeded (outcome.ok).
 */
import type { ContextRef } from "../claims";

export type EvalExecutionMode = "fixture" | "online";
export type CheckStatus = "pass" | "fail" | "not_run";

export interface EvalExpectationFinding {
  code: "unexpected_gate_result" | "forbidden_text_present" | "required_source_not_cited" | "required_event_not_in_prompt";
  detail: string;
}

export interface EvalResult {
  scenarioId: string;
  runId: string;             // "${evaluationId}-r${runIndex}"
  runIndex: number;
  fixtureId: string;
  model: string;
  mode: EvalExecutionMode;
  schemaStatus: CheckStatus;
  gateStatus: CheckStatus;
  providerError?: { kind: string; cause?: string };
  claimFindings: { code: string; claimId: string }[];
  textFindings: { gate: string; severity: string; matched: string }[];
  expectationStatus: CheckStatus;
  expectationFindings: EvalExpectationFinding[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
  requestId?: string;
  text?: string;             // model's raw generated text (preserved even if gate fails)
  servedText?: string;       // only set when outcome.ok === true
  sceneDirective?: string;   // populated from EvalScenario.sceneDirective
  durationMs: number;
  knownEventIds?: string[];  // event ids known to the speaker in this turn
}

export interface EvalScenario {
  id: string;
  fixtureId: string;
  speakerId: string;
  targetId?: string;
  locationId: string;
  sceneDirective?: string;
  transcript?: { speaker: string; text: string }[];
  /**
   * If set, all listed event ids must appear in the assembled request's
   * promptContext.knownEvents (i.e. the speaker must know these events).
   * Failing → finding { code: "required_event_not_in_prompt", detail: eventId }.
   */
  mustKnowEventIds?: string[];
  expectations?: {
    gatePass?: boolean;
    forbiddenTexts?: string[];
    requiredSourceRefs?: ContextRef[];
  };
}

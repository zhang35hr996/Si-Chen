/**
 * Eval fixture provider (T4, LLM-2).
 *
 * createEvalFixtureProvider returns a DialogueProvider that replays a
 * pre-built EvalFixtureResponse instead of calling a real LLM. Used in
 * runEvalScenario to drive the shared validation pipeline with deterministic
 * output so the eval runner can assert on gate results and diagnostics.
 */
import { ok } from "../../infra/result";
import type { ContentDB } from "../../content/loader";
import type { GameState } from "../../state/types";
import type { DialogueProvider } from "../types";
import type { DialogueRequest } from "../types";
import type { DialogueProviderResult } from "../providerContract";
import type { ProposedClaim } from "../claims";
import type { EvalScenario } from "./types";

export interface EvalFixtureResponse {
  text: string;
  proposedClaims?: ProposedClaim[];
  speakerIdOverride?: string;   // for testing wrong-speaker path
  expression?: string;
}

export interface EvalFixtureDefinition {
  buildState(): { db: ContentDB; state: GameState };
  responseFor(scenario: EvalScenario, request: DialogueRequest): EvalFixtureResponse;
}

/**
 * Returns a DialogueProvider whose generate() immediately resolves ok with the
 * given fixture response. The provider is "generative" so meta.generated=true
 * propagates through the validation pipeline.
 */
export function createEvalFixtureProvider(
  response: EvalFixtureResponse,
  speakerId: string,
): DialogueProvider {
  const result: DialogueProviderResult = {
    speaker: response.speakerIdOverride ?? speakerId,
    text: response.text,
    ...(response.expression !== undefined ? { expression: response.expression } : {}),
    choices: [],
    proposedClaims: response.proposedClaims ?? [],
  };

  return {
    id: "eval-fixture",
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: false, batch: false },
    generate(_request: DialogueRequest) {
      return Promise.resolve(ok(result));
    },
  };
}

/**
 * MockProvider (skeleton-plan §8): echoes the authored line from the request's
 * scripted payload, wrapped in the DialogueProviderResult shape the orchestrator
 * expects — so the validate-then-render path runs identically for mock and
 * future LLM output. It cannot generate freely, and says so.
 */
import { err, ok } from "../../infra/result";
import type { DialogueProvider } from "../types";
import type { ProviderError, DialogueProviderResult } from "../providerContract";

const NO_SCRIPT: ProviderError = { kind: "config", retryable: false, cause: "not_configured" };

export const mockProvider: DialogueProvider = {
  id: "mock",
  kind: "scripted",
  capabilities: { strictTools: false, promptCaching: false, batch: false },
  generate(request) {
    if (!request.scripted) return Promise.resolve(err<ProviderError>(NO_SCRIPT));
    const result: DialogueProviderResult = {
      speaker: request.speakerId,
      text: request.scripted.text,
      ...(request.scripted.expression !== undefined ? { expression: request.scripted.expression } : {}),
      choices: [], // request.scripted carries no choices in the current data path
      proposedClaims: [],
      providerMeta: { provider: "mock", model: "mock" },
    };
    return Promise.resolve(ok(result));
  },
};

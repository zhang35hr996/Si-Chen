/**
 * MockProvider (skeleton-plan §8): echoes the authored line from the request's
 * scripted payload, wrapped in the exact RawDialogueResponse shape a model
 * would return — so the validate-then-render path runs identically for mock
 * and future LLM output. It cannot generate freely, and says so.
 */
import { aiError } from "../../infra/errors";
import { err, ok } from "../../infra/result";
import type { DialogueProvider } from "../types";

export const mockProvider: DialogueProvider = {
  id: "mock",
  kind: "scripted",
  generate(request) {
    if (!request.scripted) {
      return Promise.resolve(
        err(aiError("NO_SCRIPT", "mock provider received a non-scripted request", {
          context: { speakerId: request.speakerId },
        })),
      );
    }
    return Promise.resolve(
      ok({
        speaker: request.speakerId,
        text: request.scripted.text,
        ...(request.scripted.expression !== undefined
          ? { expression: request.scripted.expression }
          : {}),
        choices: [],
      }),
    );
  },
};

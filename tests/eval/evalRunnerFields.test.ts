import { describe, it, expect } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";
import { runEvalScenarioWithProvider } from "../../src/engine/dialogue/eval/evalRunner";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import type { EvalScenario } from "../../src/engine/dialogue/eval/types";
import type { DialogueProvider } from "../../src/engine/dialogue/types";
import { err } from "../../src/engine/infra/result";
import type { ProviderError } from "../../src/engine/dialogue/providerContract";

const scenario: EvalScenario = {
  id: "t-prov",
  fixtureId: "base_palace",
  speakerId: "shen_zhibai",
  locationId: "kunninggong",
};

describe("EvalResult provenance fields", () => {
  it("records provider and speakerId", async () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const result = await runEvalScenarioWithProvider(
      scenario,
      db,
      state,
      () => mockProvider,
      "eval-x",
      0,
      "gpt-test",
      "online",
      "openai",
    );
    expect(result.speakerId).toBe("shen_zhibai");
    expect(result.provider).toBe("openai");
  });

  it("preserves usage + requestId when the provider fails with a billed protocol error", async () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const billedFailure: DialogueProvider = {
      id: "test:billed-fail",
      kind: "generative",
      capabilities: { strictTools: true, promptCaching: false, batch: false },
      generate: async () =>
        err<ProviderError>({
          kind: "protocol",
          retryable: true,
          cause: "no_tool_call",
          meta: {
            requestId: "req_billed",
            usage: { uncachedInputTokens: 80, totalInputTokens: 80, outputTokens: 0 },
          },
        }),
    };
    const result = await runEvalScenarioWithProvider(
      scenario,
      db,
      state,
      () => billedFailure,
      "eval-x",
      0,
      "gpt-test",
      "online",
      "openai",
    );
    expect(result.providerError).toMatchObject({ kind: "protocol", cause: "no_tool_call" });
    expect(result.usage).toEqual({ uncachedInputTokens: 80, totalInputTokens: 80, outputTokens: 0 });
    expect(result.requestId).toBe("req_billed");
  });

  it("turns an unexpected provider throw into a non-fatal EvalResult (does not abort)", async () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const throwing: DialogueProvider = {
      id: "test:throws",
      kind: "generative",
      capabilities: { strictTools: true, promptCaching: false, batch: false },
      generate: async () => {
        throw new Error("kaboom");
      },
    };
    const result = await runEvalScenarioWithProvider(
      scenario,
      db,
      state,
      () => throwing,
      "eval-x",
      0,
      "gpt-test",
      "online",
      "openai",
    );
    expect(result.providerError?.kind).toBe("transport");
    expect(result.gateStatus).toBe("not_run");
  });
});

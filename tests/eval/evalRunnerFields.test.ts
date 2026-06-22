import { describe, it, expect } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";
import { runEvalScenarioWithProvider } from "../../src/engine/dialogue/eval/evalRunner";
import { mockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import type { EvalScenario } from "../../src/engine/dialogue/eval/types";

describe("EvalResult provenance fields", () => {
  it("records provider and speakerId", async () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const scenario: EvalScenario = {
      id: "t-prov",
      fixtureId: "base_palace",
      speakerId: "shen_zhibai",
      locationId: "kunninggong",
    };
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
});

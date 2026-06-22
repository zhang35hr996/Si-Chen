import { describe, it, expect } from "vitest";
import { buildScorecard, scorecardToMarkdown, scorecardToTsv } from "../../../src/engine/dialogue/eval/report";
import type { EvalResult } from "../../../src/engine/dialogue/eval/types";

function baseResult(over: Partial<EvalResult>): EvalResult {
  return {
    scenarioId: "s",
    runId: "s-r0",
    runIndex: 0,
    fixtureId: "f",
    model: "gpt-x",
    provider: "openai",
    speakerId: "x",
    mode: "online",
    schemaStatus: "pass",
    gateStatus: "pass",
    claimFindings: [],
    textFindings: [],
    expectationStatus: "pass",
    expectationFindings: [],
    durationMs: 100,
    usage: { inputTokens: 10, outputTokens: 5 },
    ...over,
  } as EvalResult;
}

describe("buildScorecard", () => {
  it("emits one row per model with proxy fields null", () => {
    const rows = buildScorecard([
      { provider: "openai", model: "gpt-x", results: [baseResult({})] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "openai",
      model: "gpt-x",
      runCount: 1,
      characterProxyScore: null,
      styleProxyScore: null,
    });
    expect(rows[0]!.avgLatencyMs).toBe(100);
  });

  it("markdown and tsv derive from rows (same model names)", () => {
    const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results: [baseResult({})] }]);
    expect(scorecardToMarkdown(rows)).toContain("gpt-x");
    const tsv = scorecardToTsv(rows);
    expect(tsv.split("\n")[0]).toContain("model");
    expect(tsv.split("\n")[1]).toContain("gpt-x");
  });

  it("estCostUsd null renders without throwing when unpriced", () => {
    const rows = buildScorecard([{ provider: "openai", model: "unpriced", results: [baseResult({ model: "unpriced" })] }], {
      priceTable: {},
    });
    expect(rows[0]!.estCostUsd).toBeNull();
    expect(() => scorecardToMarkdown(rows)).not.toThrow();
  });
});

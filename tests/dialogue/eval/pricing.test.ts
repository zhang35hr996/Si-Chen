import { describe, it, expect } from "vitest";
import { costForUsage } from "../../../src/engine/dialogue/eval/pricing";

describe("costForUsage", () => {
  it("computes cost from input/output per-MTok", () => {
    const table = { "openai:gpt-x": { inputPerMTok: 1, outputPerMTok: 2 } };
    expect(costForUsage("openai:gpt-x", { inputTokens: 1_000_000, outputTokens: 500_000 }, table)).toBeCloseTo(1 + 1);
  });

  it("returns undefined for unknown model", () => {
    expect(costForUsage("x:y", { inputTokens: 10, outputTokens: 10 }, {})).toBeUndefined();
  });

  it("returns undefined when usage missing", () => {
    expect(
      costForUsage("openai:gpt-x", undefined, { "openai:gpt-x": { inputPerMTok: 1, outputPerMTok: 1 } }),
    ).toBeUndefined();
  });

  it("uses cacheReadPerMTok for cached tokens when present", () => {
    const table = { "anthropic:c": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 } };
    const c = costForUsage(
      "anthropic:c",
      { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000 },
      table,
    )!;
    // 1M input of which 1M is cache-read: plain input = 0, cache read billed at 0.3
    expect(c).toBeCloseTo(0.3);
  });
});

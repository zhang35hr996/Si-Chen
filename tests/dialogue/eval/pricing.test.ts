import { describe, it, expect } from "vitest";
import { costForUsage } from "../../../src/engine/dialogue/eval/pricing";
import type { NormalizedUsage } from "../../../src/engine/dialogue/providerContract";

const usage = (u: Partial<NormalizedUsage> & { uncachedInputTokens: number; totalInputTokens: number; outputTokens: number }): NormalizedUsage => u;

describe("costForUsage", () => {
  it("bills uncached input + output at their per-MTok rates", () => {
    const table = { "openai:gpt-x": { inputPerMTok: 1, outputPerMTok: 2 } };
    const u = usage({ uncachedInputTokens: 1_000_000, totalInputTokens: 1_000_000, outputTokens: 500_000 });
    expect(costForUsage("openai:gpt-x", u, table)).toBeCloseTo(1 + 1);
  });

  it("returns undefined for unknown model", () => {
    expect(costForUsage("x:y", usage({ uncachedInputTokens: 10, totalInputTokens: 10, outputTokens: 10 }), {})).toBeUndefined();
  });

  it("returns undefined when usage missing", () => {
    expect(costForUsage("openai:gpt-x", undefined, { "openai:gpt-x": { inputPerMTok: 1, outputPerMTok: 1 } })).toBeUndefined();
  });

  it("bills cacheReadTokens separately from uncached input", () => {
    const table = { "anthropic:c": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 } };
    // uncached 1M @3 + cacheRead 1M @0.3 = 3.3 (separate buckets, not subtracted)
    const u = usage({ uncachedInputTokens: 1_000_000, totalInputTokens: 2_000_000, outputTokens: 0, cacheReadTokens: 1_000_000 });
    expect(costForUsage("anthropic:c", u, table)).toBeCloseTo(3.3);
  });

  it("bills cacheCreationTokens at its rate (fallback to input rate)", () => {
    const table = { "anthropic:c": { inputPerMTok: 3, outputPerMTok: 15, cacheCreationPerMTok: 3.75 } };
    const u = usage({ uncachedInputTokens: 0, totalInputTokens: 1_000_000, outputTokens: 0, cacheCreationTokens: 1_000_000 });
    expect(costForUsage("anthropic:c", u, table)).toBeCloseTo(3.75);
  });
});

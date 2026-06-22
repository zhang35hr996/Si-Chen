import { describe, it, expect } from "vitest";
import { makeUsage, makeUsageFromTotal } from "../../src/engine/dialogue/providerContract";

describe("makeUsage (uncached-given, Anthropic)", () => {
  it("builds a usage object whose invariant holds by construction", () => {
    expect(makeUsage({ uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: 30, cacheCreationTokens: 20 })).toEqual({
      uncachedInputTokens: 100,
      totalInputTokens: 150,
      outputTokens: 10,
      cacheReadTokens: 30,
      cacheCreationTokens: 20,
    });
  });

  it("returns undefined when a required field is missing (no fake zero)", () => {
    expect(makeUsage({ uncachedInputTokens: 100 })).toBeUndefined(); // outputTokens missing
    expect(makeUsage({ outputTokens: 10 })).toBeUndefined(); // uncached missing
  });

  it("returns undefined for negative, fractional, or non-finite counts", () => {
    expect(makeUsage({ uncachedInputTokens: -1, outputTokens: 10 })).toBeUndefined();
    expect(makeUsage({ uncachedInputTokens: 1.5, outputTokens: 10 })).toBeUndefined();
    expect(makeUsage({ uncachedInputTokens: 100, outputTokens: NaN })).toBeUndefined();
    expect(makeUsage({ uncachedInputTokens: 100, outputTokens: 10, cacheReadTokens: -3 })).toBeUndefined();
  });
});

describe("makeUsageFromTotal (total-given, OpenAI/Gemini)", () => {
  it("derives uncached = total - cacheRead", () => {
    expect(makeUsageFromTotal({ totalInputTokens: 100, outputTokens: 20, cacheReadTokens: 30 })).toEqual({
      uncachedInputTokens: 70,
      totalInputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
    });
  });

  it("returns undefined when cacheRead exceeds total (contradictory)", () => {
    expect(makeUsageFromTotal({ totalInputTokens: 50, outputTokens: 0, cacheReadTokens: 80 })).toBeUndefined();
  });

  it("returns undefined when a required field is missing", () => {
    expect(makeUsageFromTotal({ totalInputTokens: 100 })).toBeUndefined();
    expect(makeUsageFromTotal({ outputTokens: 20 })).toBeUndefined();
  });

  it("returns undefined for negative or fractional counts", () => {
    expect(makeUsageFromTotal({ totalInputTokens: -5, outputTokens: 0 })).toBeUndefined();
    expect(makeUsageFromTotal({ totalInputTokens: 10.2, outputTokens: 0 })).toBeUndefined();
  });
});

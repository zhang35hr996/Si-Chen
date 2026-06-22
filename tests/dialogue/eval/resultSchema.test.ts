import { describe, it, expect } from "vitest";
import { evalResultSchema } from "../../../src/engine/dialogue/eval/resultSchema";

const valid = {
  scenarioId: "sc001",
  runId: "m-r0",
  runIndex: 0,
  fixtureId: "f",
  model: "gpt-x",
  provider: "openai",
  speakerId: "lu_huaijin",
  mode: "online",
  schemaStatus: "pass",
  gateStatus: "pass",
  expectationStatus: "pass",
  claimFindings: [],
  textFindings: [],
  expectationFindings: [],
  usage: { uncachedInputTokens: 70, totalInputTokens: 100, outputTokens: 20, cacheReadTokens: 30 },
  durationMs: 120,
};

describe("evalResultSchema", () => {
  it("accepts a well-formed normalized record", () => {
    expect(evalResultSchema.safeParse(valid).success).toBe(true);
  });

  it("tolerates unknown extra keys (forward-compat)", () => {
    expect(evalResultSchema.safeParse({ ...valid, futureField: 1 }).success).toBe(true);
  });

  it("rejects a record missing provider", () => {
    const { provider: _omit, ...rest } = valid;
    void _omit;
    expect(evalResultSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a stale-format usage that lacks normalized fields", () => {
    const stale = { ...valid, usage: { inputTokens: 100, outputTokens: 20 } };
    expect(evalResultSchema.safeParse(stale).success).toBe(false);
  });

  it("rejects an invalid mode", () => {
    expect(evalResultSchema.safeParse({ ...valid, mode: "batch" }).success).toBe(false);
  });

  it("rejects a usage that violates the total = uncached + cache invariant", () => {
    const bad = { ...valid, usage: { uncachedInputTokens: 70, totalInputTokens: 200, outputTokens: 20, cacheReadTokens: 30 } };
    const r = evalResultSchema.safeParse(bad);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => /totalInputTokens must equal/.test(i.message))).toBe(true);
  });

  it("rejects negative and fractional token counts", () => {
    expect(evalResultSchema.safeParse({ ...valid, usage: { uncachedInputTokens: -1, totalInputTokens: -1, outputTokens: 0 } }).success).toBe(false);
    expect(evalResultSchema.safeParse({ ...valid, usage: { uncachedInputTokens: 1.5, totalInputTokens: 1.5, outputTokens: 0 } }).success).toBe(false);
  });
});

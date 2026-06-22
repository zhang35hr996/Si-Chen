import { describe, it, expect } from "vitest";
import { parseEvalResultsText } from "../../tools/lib/loadEvalResults";

const validRecord = {
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

const jsonl = (objs: object[]): string => objs.map((o) => JSON.stringify(o)).join("\n") + "\n";

describe("parseEvalResultsText (shared eval-score/eval-report loader)", () => {
  it("parses well-formed normalized records", () => {
    const out = parseEvalResultsText(jsonl([validRecord, { ...validRecord, runId: "m-r1" }]));
    expect(out).toHaveLength(2);
    expect(out[0]!.usage?.totalInputTokens).toBe(100);
  });

  it("ignores blank lines", () => {
    expect(parseEvalResultsText("\n" + JSON.stringify(validRecord) + "\n\n")).toHaveLength(1);
  });

  it("rejects a STALE-format usage record (old inputTokens shape) — guards eval-score too", () => {
    const stale = { ...validRecord, usage: { inputTokens: 100, outputTokens: 20 } };
    expect(() => parseEvalResultsText(jsonl([stale]), "stale.jsonl")).toThrow(/not a valid EvalResult/);
  });

  it("rejects a persisted usage that violates the invariant (total != uncached + cache)", () => {
    const bad = { ...validRecord, usage: { uncachedInputTokens: 70, totalInputTokens: 999, outputTokens: 20, cacheReadTokens: 30 } };
    expect(() => parseEvalResultsText(jsonl([bad]))).toThrow(/totalInputTokens must equal/);
  });

  it("rejects negative / fractional token counts", () => {
    const neg = { ...validRecord, usage: { uncachedInputTokens: -1, totalInputTokens: -1, outputTokens: 20 } };
    expect(() => parseEvalResultsText(jsonl([neg]))).toThrow(/not a valid EvalResult/);
  });

  it("reports the offending line number", () => {
    expect(() => parseEvalResultsText(jsonl([validRecord, { ...validRecord, provider: undefined }]))).toThrow(/line 2/);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseEvalResultsText("{not json}\n")).toThrow(/invalid JSON/);
  });
});

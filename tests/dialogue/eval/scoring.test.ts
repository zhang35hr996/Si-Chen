/**
 * Tests for scoreResults (T6, LLM-2).
 *
 * Pure function — no I/O. All test cases use hand-crafted EvalResult stubs.
 */
import { describe, it, expect } from "vitest";
import { scoreResults } from "../../../src/engine/dialogue/eval/scoring";
import type { EvalResult } from "../../../src/engine/dialogue/eval/types";

// ── Minimal EvalResult stub factory ──────────────────────────────────────────

function makeResult(overrides: Partial<EvalResult> = {}): EvalResult {
  return {
    scenarioId: "sc001",
    runId: "fixture-0-r0",
    runIndex: 0,
    fixtureId: "base_palace",
    model: "fixture",
    provider: "fixture",
    speakerId: "shen_zhibai",
    mode: "fixture",
    schemaStatus: "pass",
    gateStatus: "pass",
    expectationStatus: "pass",
    claimFindings: [],
    textFindings: [],
    expectationFindings: [],
    durationMs: 10,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("scoreResults", () => {
  it("empty input returns zeros for all rates", () => {
    const report = scoreResults([]);
    expect(report.scenarioCount).toBe(0);
    expect(report.runCount).toBe(0);
    expect(report.schemaPassRate).toBe(0);
    expect(report.gatePassRate).toBe(0);
    expect(report.expectationPassRate).toBe(0);
    expect(report.cacheHitRate).toBe(0);
    expect(report.avgInputTokens).toBe(0);
    expect(report.avgOutputTokens).toBe(0);
  });

  it("all not_run returns 0 pass rates and 0 avg tokens", () => {
    const results = [
      makeResult({ schemaStatus: "not_run", gateStatus: "not_run", expectationStatus: "not_run" }),
      makeResult({ schemaStatus: "not_run", gateStatus: "not_run", expectationStatus: "not_run", scenarioId: "sc002" }),
    ];
    const report = scoreResults(results);
    // not_run excluded from denominator → 0/0 → rate=0
    expect(report.schemaPassRate).toBe(0);
    expect(report.gatePassRate).toBe(0);
    expect(report.expectationPassRate).toBe(0);
    // no usage → avg=0
    expect(report.avgInputTokens).toBe(0);
    expect(report.avgOutputTokens).toBe(0);
    expect(report.runCount).toBe(2);
  });

  it("schemaPassRate = pass / (pass+fail), not_run excluded from denominator", () => {
    const results = [
      makeResult({ schemaStatus: "pass" }),
      makeResult({ schemaStatus: "pass", scenarioId: "sc002" }),
      makeResult({ schemaStatus: "fail", scenarioId: "sc003" }),
      makeResult({ schemaStatus: "not_run", scenarioId: "sc004" }),  // excluded
    ];
    const report = scoreResults(results);
    // 2 pass / (2 pass + 1 fail) = 2/3
    expect(report.schemaPassRate).toBeCloseTo(2 / 3);
  });

  it("gatePassRate same logic — not_run excluded", () => {
    const results = [
      makeResult({ gateStatus: "pass" }),
      makeResult({ gateStatus: "fail", scenarioId: "sc002" }),
      makeResult({ gateStatus: "fail", scenarioId: "sc003" }),
      makeResult({ gateStatus: "not_run", scenarioId: "sc004" }),  // excluded
    ];
    const report = scoreResults(results);
    // 1 pass / (1 pass + 2 fail) = 1/3
    expect(report.gatePassRate).toBeCloseTo(1 / 3);
  });

  it("expectationPassRate same logic — not_run excluded", () => {
    const results = [
      makeResult({ expectationStatus: "pass" }),
      makeResult({ expectationStatus: "pass", scenarioId: "sc002" }),
      makeResult({ expectationStatus: "pass", scenarioId: "sc003" }),
      makeResult({ expectationStatus: "fail", scenarioId: "sc004" }),
      makeResult({ expectationStatus: "not_run", scenarioId: "sc005" }),  // excluded
    ];
    const report = scoreResults(results);
    // 3 pass / (3 pass + 1 fail) = 3/4
    expect(report.expectationPassRate).toBeCloseTo(3 / 4);
  });

  it("cacheHitRate = cacheReadTokens > 0 / total (not just defined)", () => {
    const results = [
      makeResult({ usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 200 } }),  // hit
      makeResult({ usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 } }),    // 0 = not a hit
      makeResult({ usage: { inputTokens: 100, outputTokens: 50 } }),                        // no cache field = not a hit
      makeResult({}),                                                                        // no usage = not a hit
    ];
    const report = scoreResults(results);
    // 1 hit / 4 total = 0.25
    expect(report.cacheHitRate).toBeCloseTo(0.25);
  });

  it("avgInputTokens only from results with usage defined", () => {
    const results = [
      makeResult({ usage: { inputTokens: 100, outputTokens: 50 } }),
      makeResult({ usage: { inputTokens: 200, outputTokens: 80 } }),
      makeResult({}),  // no usage — excluded from avg
    ];
    const report = scoreResults(results);
    // avg of 100, 200 = 150
    expect(report.avgInputTokens).toBeCloseTo(150);
  });

  it("avgOutputTokens only from results with usage defined", () => {
    const results = [
      makeResult({ usage: { inputTokens: 100, outputTokens: 40 } }),
      makeResult({ usage: { inputTokens: 200, outputTokens: 60 } }),
      makeResult({}),  // no usage — excluded
    ];
    const report = scoreResults(results);
    // avg of 40, 60 = 50
    expect(report.avgOutputTokens).toBeCloseTo(50);
  });

  it("scenarioCount counts distinct scenarioIds, runCount counts all results", () => {
    const results = [
      makeResult({ scenarioId: "sc001", runIndex: 0 }),
      makeResult({ scenarioId: "sc001", runIndex: 1 }),  // second run, same scenario
      makeResult({ scenarioId: "sc002", runIndex: 0 }),
    ];
    const report = scoreResults(results);
    expect(report.scenarioCount).toBe(2);
    expect(report.runCount).toBe(3);
  });

  it("all pass returns rate 1 with no not_run or fail", () => {
    const results = [
      makeResult(),
      makeResult({ scenarioId: "sc002" }),
      makeResult({ scenarioId: "sc003" }),
    ];
    const report = scoreResults(results);
    expect(report.schemaPassRate).toBe(1);
    expect(report.gatePassRate).toBe(1);
    expect(report.expectationPassRate).toBe(1);
  });

  it("all fail returns rate 0", () => {
    const results = [
      makeResult({ schemaStatus: "fail", gateStatus: "fail", expectationStatus: "fail" }),
      makeResult({ schemaStatus: "fail", gateStatus: "fail", expectationStatus: "fail", scenarioId: "sc002" }),
    ];
    const report = scoreResults(results);
    expect(report.schemaPassRate).toBe(0);
    expect(report.gatePassRate).toBe(0);
    expect(report.expectationPassRate).toBe(0);
  });
});

describe("scoreResults — metrics extension", () => {
  it("aggregates latency, tokens, lore violations, byType, and cost", () => {
    const results = [
      makeResult({
        provider: "openai",
        model: "m",
        durationMs: 100,
        usage: { inputTokens: 10, outputTokens: 5 },
        textFindings: [{ gate: "forbidden_lexicon", severity: "reject", matched: "皇上" }],
      }),
      makeResult({
        provider: "openai",
        model: "m",
        durationMs: 300,
        usage: { inputTokens: 20, outputTokens: 7 },
        textFindings: [{ gate: "rank_title", severity: "flag", matched: "x" }],
      }),
    ];
    const rep = scoreResults(results, { priceTable: { "openai:m": { inputPerMTok: 1, outputPerMTok: 1 } } });
    expect(rep.avgLatencyMs).toBe(200);
    expect(rep.p95LatencyMs).toBe(300);
    expect(rep.totalInputTokens).toBe(30);
    expect(rep.totalOutputTokens).toBe(12);
    expect(rep.loreViolationRate).toBeCloseTo(0.5); // one of two has forbidden_lexicon
    expect(rep.gateViolationsByType).toMatchObject({ forbidden_lexicon: 1, rank_title: 1 });
    expect(rep.estCostUsd).toBeGreaterThan(0);
  });

  it("estCostUsd is undefined when no result is priced", () => {
    const rep = scoreResults([makeResult({ provider: "openai", model: "unpriced", usage: { inputTokens: 1, outputTokens: 1 } })], {
      priceTable: {},
    });
    expect(rep.estCostUsd).toBeUndefined();
  });

  it("empty input returns zeroed metrics, not NaN", () => {
    const rep = scoreResults([]);
    expect(rep.avgLatencyMs).toBe(0);
    expect(rep.p95LatencyMs).toBe(0);
    expect(rep.totalInputTokens).toBe(0);
    expect(rep.loreViolationRate).toBe(0);
    expect(rep.gateViolationsByType).toEqual({});
    expect(rep.estCostUsd).toBeUndefined();
  });
});

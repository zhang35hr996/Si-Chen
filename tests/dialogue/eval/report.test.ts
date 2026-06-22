import { describe, it, expect } from "vitest";
import {
  buildScorecard,
  scorecardToMarkdown,
  scorecardToTsv,
  firstHeterogeneousRecord,
} from "../../../src/engine/dialogue/eval/report";
import type { EvalResult } from "../../../src/engine/dialogue/eval/types";
import type { SpeakerProfile } from "../../../src/engine/dialogue/eval/consistencyProxy";

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
    usage: { uncachedInputTokens: 10, totalInputTokens: 10, outputTokens: 5 },
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

  it("knownCostUsd null renders without throwing when unpriced", () => {
    const rows = buildScorecard([{ provider: "openai", model: "unpriced", results: [baseResult({ model: "unpriced" })] }], {
      priceTable: {},
    });
    expect(rows[0]!.knownCostUsd).toBeNull();
    expect(rows[0]!.costCoverageRate).toBe(0);
    expect(() => scorecardToMarkdown(rows)).not.toThrow();
  });
});

describe("buildScorecard — proxy wiring (PR3)", () => {
  const luProfile: SpeakerProfile = {
    selfRefs: ["侍身"],
    addressTerm: "陛下",
    quirkLexemes: ["侍身"],
    tabooTopics: [],
    register: "poetic",
  };

  it("populates proxy scores when a matching profile is supplied", () => {
    const results = [baseResult({ speakerId: "lu_huaijin", text: "侍身参见陛下。" })];
    const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results }], { profiles: { lu_huaijin: luProfile } });
    expect(typeof rows[0]!.characterProxyScore).toBe("number");
    expect(typeof rows[0]!.styleProxyScore).toBe("number");
  });

  it("leaves proxy columns null when no profiles are supplied", () => {
    const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results: [baseResult({ speakerId: "lu_huaijin" })] }]);
    expect(rows[0]!.characterProxyScore).toBeNull();
    expect(rows[0]!.styleProxyScore).toBeNull();
  });

  it("ignores speakers without a profile and stays null (no crash) when none match", () => {
    const results = [baseResult({ speakerId: "unknown_person", text: "x" })];
    const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results }], { profiles: { lu_huaijin: luProfile } });
    expect(rows[0]!.characterProxyScore).toBeNull();
    expect(rows[0]!.styleProxyScore).toBeNull();
    expect(Number.isNaN(rows[0]!.characterProxyScore as number | null)).toBe(false);
  });

  it("scores only the profiled speaker in a mixed batch", () => {
    const results = [
      baseResult({ speakerId: "lu_huaijin", text: "侍身参见陛下。", scenarioId: "s1" }),
      baseResult({ speakerId: "unknown_person", text: "x", scenarioId: "s2" }),
    ];
    const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results }], { profiles: { lu_huaijin: luProfile } });
    expect(typeof rows[0]!.characterProxyScore).toBe("number");
    expect(() => scorecardToMarkdown(rows)).not.toThrow();
  });
});

describe("firstHeterogeneousRecord", () => {
  it("returns null when all records share provider+model", () => {
    const results = [baseResult({}), baseResult({ scenarioId: "s2" }), baseResult({ scenarioId: "s3" })];
    expect(firstHeterogeneousRecord(results)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(firstHeterogeneousRecord([])).toBeNull();
  });

  it("flags the first record whose provider differs", () => {
    const results = [baseResult({}), baseResult({ provider: "google", model: "gpt-x", scenarioId: "s2" })];
    expect(firstHeterogeneousRecord(results)).toEqual({ index: 1, provider: "google", model: "gpt-x" });
  });

  it("flags the first record whose model differs", () => {
    const results = [baseResult({}), baseResult({ model: "gpt-y", scenarioId: "s2" })];
    expect(firstHeterogeneousRecord(results)).toEqual({ index: 1, provider: "openai", model: "gpt-y" });
  });
});

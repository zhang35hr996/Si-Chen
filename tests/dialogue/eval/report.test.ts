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

  it("stays null when a profiled speaker produced NO text (provider failures only)", () => {
    // matching profile but every record failed → no scorable text → null, not inflated
    const results = [
      baseResult({ speakerId: "lu_huaijin", scenarioId: "s1", providerError: { kind: "transport" } }),
      baseResult({ speakerId: "lu_huaijin", scenarioId: "s2", providerError: { kind: "protocol", cause: "no_tool_call" } }),
    ];
    const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results }], { profiles: { lu_huaijin: luProfile } });
    expect(rows[0]!.characterProxyScore).toBeNull();
    expect(rows[0]!.styleProxyScore).toBeNull();
  });

  it("ignores no-text records: a valid line + a failed record scores like the valid line alone", () => {
    const valid = baseResult({ speakerId: "lu_huaijin", text: "侍身参见陛下。", scenarioId: "s1" });
    const failed = baseResult({ speakerId: "lu_huaijin", scenarioId: "s2", providerError: { kind: "protocol", cause: "no_tool_call" } });
    const withFail = buildScorecard([{ provider: "openai", model: "gpt-x", results: [valid, failed] }], { profiles: { lu_huaijin: luProfile } });
    const validOnly = buildScorecard([{ provider: "openai", model: "gpt-x", results: [valid] }], { profiles: { lu_huaijin: luProfile } });
    expect(withFail[0]!.characterProxyScore).toBe(validOnly[0]!.characterProxyScore);
    expect(withFail[0]!.styleProxyScore).toBe(validOnly[0]!.styleProxyScore);
  });

  it("scores only the speaker that produced text when another speaker fully failed", () => {
    const shenProfile: SpeakerProfile = { selfRefs: ["本宫"], addressTerm: "陛下", quirkLexemes: [], tabooTopics: [], register: "formal" };
    const results = [
      baseResult({ speakerId: "lu_huaijin", scenarioId: "s1", providerError: { kind: "transport" } }), // no text
      baseResult({ speakerId: "shen_zhibai", text: "本宫参见陛下。", scenarioId: "s2" }),
    ];
    const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results }], {
      profiles: { lu_huaijin: luProfile, shen_zhibai: shenProfile },
    });
    const shenOnly = buildScorecard(
      [{ provider: "openai", model: "gpt-x", results: [results[1]!] }],
      { profiles: { shen_zhibai: shenProfile } },
    );
    expect(rows[0]!.characterProxyScore).toBe(shenOnly[0]!.characterProxyScore);
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

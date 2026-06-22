import { describe, it, expect } from "vitest";
import {
  characterProxyScore,
  styleProxyScore,
  extractQuirkLexemes,
  type SpeakerProfile,
} from "../../../src/engine/dialogue/eval/consistencyProxy";
import type { EvalResult } from "../../../src/engine/dialogue/eval/types";

function res(text: string, findings: { gate: string }[] = []): EvalResult {
  return {
    scenarioId: "s",
    runId: "s-r0",
    runIndex: 0,
    fixtureId: "f",
    model: "m",
    provider: "p",
    speakerId: "lu_huaijin",
    mode: "online",
    schemaStatus: "pass",
    gateStatus: "pass",
    claimFindings: [],
    textFindings: findings.map((f) => ({ gate: f.gate, severity: "reject", matched: "x" })),
    expectationStatus: "pass",
    expectationFindings: [],
    durationMs: 100,
    text,
  } as EvalResult;
}

const profile: SpeakerProfile = {
  selfRefs: ["侍身"],
  addressTerm: "陛下",
  quirkLexemes: ["侍身", "陛下"],
  tabooTopics: ["家中来信"],
  register: "poetic",
};

describe("extractQuirkLexemes", () => {
  it("extracts only MANDATORY fixed-phrase lexemes, skipping conditional quirks", () => {
    // 自称/称玩家 are unconditional; 失落时…偶尔…脱口而出 is conditional → 曾经 excluded
    expect(extractQuirkLexemes(["自称『侍身』", "称玩家『陛下』", "失落时偶尔会脱口而出『曾经』"])).toEqual([
      "侍身",
      "陛下",
    ]);
  });

  it("ignores quoted phrases with no fixed-phrase marker", () => {
    expect(extractQuirkLexemes(["语调轻软"])).toEqual([]);
    expect(extractQuirkLexemes(["心情好时会念『春日』"])).toEqual([]); // conditional + no fixed marker
    expect(extractQuirkLexemes(["『随便』"])).toEqual([]); // bare quote, no declaration
  });

  it("extracts 常说 / 口头禅 declarations", () => {
    expect(extractQuirkLexemes(["常说『罢了』", "口头禅『可不是』"])).toEqual(["罢了", "可不是"]);
  });
});

describe("characterProxyScore", () => {
  it("scores a clean in-character line higher than a gate-flagged one", () => {
    const good = characterProxyScore([res("侍身参见陛下。")], profile).score;
    const bad = characterProxyScore([res("臣参见皇上。", [{ gate: "self_ref" }, { gate: "rank_title" }])], profile).score;
    expect(good).toBeGreaterThan(bad);
  });

  it("returns a score in [0,1] with a signal breakdown carrying evidence", () => {
    const out = characterProxyScore([res("侍身参见陛下。")], profile);
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(1);
    expect(out.signals.length).toBeGreaterThan(0);
    expect(out.signals.every((s) => "name" in s && "weight" in s && "value" in s && "evidence" in s)).toBe(true);
  });

  it("makes the quirk signal weight 0 (not full marks) when no mandatory lexemes", () => {
    const p: SpeakerProfile = { ...profile, quirkLexemes: [] };
    const quirk = characterProxyScore([res("侍身参见陛下。")], p).signals.find((s) => s.name === "quirk_adherence")!;
    expect(quirk.weight).toBe(0);
    expect(quirk.evidence).toContain("not_scorable");
  });

  it("makes cross_scenario_stability weight 0 for a single line (not_scorable)", () => {
    const stability = characterProxyScore([res("侍身参见陛下。")], profile).signals.find((s) => s.name === "cross_scenario_stability")!;
    expect(stability.weight).toBe(0);
    expect(stability.evidence).toContain("not_scorable");
  });

  it("not_scorable signals do not inflate the score (equals weighted mean of scorable signals)", () => {
    // single line missing the player address → address value 0.5; quirk + stability not_scorable
    const p: SpeakerProfile = { ...profile, quirkLexemes: [] };
    const out = characterProxyScore([res("侍身今日甚好。")], p);
    // scorable signals: self_ref(0.3,1) + address(0.2,0.5) + taboo(0.15,1); weight sum 0.65
    const expected = (0.3 * 1 + 0.2 * 0.5 + 0.15 * 1) / 0.65;
    expect(out.score).toBeCloseTo(expected);
    expect(out.score).toBeLessThan(1); // would have been higher if quirk counted as full marks
  });

  it("address_correctness: full only when the expected address is observed; 0.5 when absent", () => {
    const withAddr = characterProxyScore([res("侍身参见陛下。")], profile).signals.find((s) => s.name === "address_correctness")!;
    expect(withAddr.value).toBe(1);
    expect(withAddr.evidence).toContain("陛下");
    const noAddr = characterProxyScore([res("今日天气甚好。")], profile).signals.find((s) => s.name === "address_correctness")!;
    expect(noAddr.value).toBe(0.5);
    expect(noAddr.evidence).toContain("no player address");
  });

  it("penalizes when a taboo topic surfaces", () => {
    const clean = characterProxyScore([res("侍身参见陛下。")], profile).score;
    const taboo = characterProxyScore([res("侍身近日收到家中来信。")], profile).score;
    expect(taboo).toBeLessThan(clean);
  });
});

describe("styleProxyScore", () => {
  it("lowers score when an anachronism appears", () => {
    const clean = styleProxyScore([res("侍身如约而来。")], profile).score;
    const modern = styleProxyScore([res("侍身打开手机。")], profile).score;
    expect(clean).toBeGreaterThan(modern);
  });

  it("returns a score in [0,1]", () => {
    const out = styleProxyScore([res("侍身如约而来。")], profile);
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(1);
  });
});

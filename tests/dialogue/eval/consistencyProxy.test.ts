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
  it("pulls 『…』-quoted tokens only", () => {
    expect(extractQuirkLexemes(["自称『侍身』", "称玩家『陛下』", "失落时偶尔脱口而出『曾经』"])).toEqual([
      "侍身",
      "陛下",
      "曾经",
    ]);
    expect(extractQuirkLexemes(["语调轻软"])).toEqual([]);
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

  it("does not penalize quirks when quirkLexemes is empty (not_scorable)", () => {
    const p: SpeakerProfile = { ...profile, quirkLexemes: [] };
    const quirk = characterProxyScore([res("侍身参见陛下。")], p).signals.find((s) => s.name === "quirk_adherence")!;
    expect(quirk.value).toBe(1);
    expect(quirk.evidence).toContain("not_scorable");
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

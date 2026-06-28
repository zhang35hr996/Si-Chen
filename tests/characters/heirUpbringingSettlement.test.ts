import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CharacterStanding, GameState, Heir } from "../../src/engine/state/types";
import {
  applyMonthlyHeirUpbringing,
  planMonthlyHeirUpbringing,
  upbringingMonthKey,
} from "../../src/engine/characters/heirUpbringingSettlement";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const defaultPersonality = {
  empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50,
};

function makeHeir(id: string, over: Partial<Heir> = {}): Heir {
  return {
    id, sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"),
    favor: 50, legitimate: false, petName: "",
    education: { scholarship: 20, martial: 20, virtue: 20 },
    health: 70, talent: 50, diligence: 50,
    personality: defaultPersonality,
    interests: [], imperialFear: 30, neglect: 30, custodianBond: 30,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
    ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
    ...over,
  };
}

/** Consort standing with controllable personality/household for careScore. */
function consortStanding(over: Partial<CharacterStanding> = {}): CharacterStanding {
  return {
    rank: "guiren", favor: 50, peakFavor: 50,
    personality: {
      intelligence: 50, scheming: 25, sociability: 50, compassion: 50,
      courage: 40, jealousy: 35, emotionalStability: 55, pride: 45,
    },
    household: { servantOpinion: 50, livingStandard: 40, privateWealthLevel: 20 },
    ...over,
  };
}

function makeState(heirs: Heir[] = []): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs = heirs;
  s.standing = {};
  s.generatedConsorts = {};
  s.settledHeirUpbringingMonths = [];
  // year 8 so that a heir born year 1 is age 7 (a minor, in school range)
  s.calendar = { ...s.calendar, year: 8 };
  return s;
}

const NOW = makeGameTime(8, 1, "early");

// ── 月键 / 基础守卫 ────────────────────────────────────────────────────────────

describe("upbringingMonthKey", () => {
  it("formats as year:pad2(month)", () => {
    expect(upbringingMonthKey(makeGameTime(6, 1, "early"))).toBe("6:01");
    expect(upbringingMonthKey(makeGameTime(6, 12, "late"))).toBe("6:12");
  });
});

describe("planMonthlyHeirUpbringing — 守卫", () => {
  it("已结算本月 → 空 changes（幂等）", () => {
    const s = makeState([makeHeir("h1")]);
    s.settledHeirUpbringingMonths = [upbringingMonthKey(NOW)];
    expect(planMonthlyHeirUpbringing(db, s, NOW).changes).toHaveLength(0);
  });

  it("已故皇嗣不结算", () => {
    const s = makeState([makeHeir("h1", { lifecycle: "deceased" })]);
    expect(planMonthlyHeirUpbringing(db, s, NOW).changes).toHaveLength(0);
  });

  it("18 岁以上不结算", () => {
    const s = makeState([makeHeir("h1", { birthAt: makeGameTime(1, 1, "early") })]);
    s.calendar = { ...s.calendar, year: 19 }; // age 18
    expect(planMonthlyHeirUpbringing(db, s, makeGameTime(19, 1, "early")).changes).toHaveLength(0);
  });
});

// ── 无有效抚养人 ───────────────────────────────────────────────────────────────

describe("无有效抚养人", () => {
  it("无养父且久未召见 → 忽视上升", () => {
    const s = makeState([makeHeir("h1")]); // no adoptiveFatherId, no lastImperialInteractionAt
    const plan = planMonthlyHeirUpbringing(db, s, NOW);
    const c = plan.changes[0]!;
    expect(c.neglectDelta).toBe(6);
    expect(c.careOutcome).toBe("no_effective_custodian");
    expect(c.custodianBondDelta).toBe(0);
  });

  it("无养父但本月召见 → 忽视不增加（imperial_attention）", () => {
    const s = makeState([makeHeir("h1", { lastImperialInteractionAt: makeGameTime(8, 1, "early") })]);
    const plan = planMonthlyHeirUpbringing(db, s, NOW);
    const c = plan.changes[0]!;
    expect(c.neglectDelta).toBeLessThanOrEqual(0);
    expect(c.careOutcome).toBe("imperial_attention");
  });

  it("无养父 2 月前召见 → 忽视少增 (+4)", () => {
    const s = makeState([makeHeir("h1", { lastImperialInteractionAt: makeGameTime(7, 11, "early") })]);
    // now month ordinal = 8*... ; interaction 2 months earlier
    const now = makeGameTime(8, 1, "early"); // monthOrdinal 8*12-? ; diff handled by monthOrdinal
    const plan = planMonthlyHeirUpbringing(db, s, now);
    const c = plan.changes[0]!;
    expect(c.neglectDelta).toBe(4); // 6 - 2
  });
});

// ── 有有效抚养人 ───────────────────────────────────────────────────────────────

describe("有有效抚养人", () => {
  function stateWithCustodian(personality: Partial<CharacterStanding["personality"]> = {}, household: Partial<CharacterStanding["household"]> = {}): GameState {
    const heir = makeHeir("h1", { adoptiveFatherId: "cust1", custodianBond: 30 });
    const s = makeState([heir]);
    const base = consortStanding();
    s.standing["cust1"] = {
      ...base,
      personality: { ...base.personality!, ...personality },
      household: { ...base.household!, ...household },
    };
    // register as a generated consort so resolveCustodianAvailability sees a consort
    s.generatedConsorts["cust1"] = {
      id: "cust1", kind: "consort", profile: { name: "照料娘娘", surname: "林", age: 25 },
      defaultLocation: "some_palace",
    } as unknown as GameState["generatedConsorts"][string];
    return s;
  }

  it("高 careScore 的悉心照料概率高于低 careScore（分布单调）", () => {
    const high = stateWithCustodian({ compassion: 95, emotionalStability: 95, sociability: 95 }, { servantOpinion: 95, livingStandard: 95 });
    const low = stateWithCustodian({ compassion: 5, emotionalStability: 5, sociability: 5 }, { servantOpinion: 5, livingStandard: 5 });

    let highAttentive = 0, lowAttentive = 0;
    for (let i = 0; i < 60; i++) {
      const hs = { ...high, rngSeed: 1000 + i };
      const ls = { ...low, rngSeed: 1000 + i };
      if (planMonthlyHeirUpbringing(db, hs, NOW).changes[0]!.careOutcome === "attentive_custodian") highAttentive++;
      if (planMonthlyHeirUpbringing(db, ls, NOW).changes[0]!.careOutcome === "attentive_custodian") lowAttentive++;
    }
    expect(highAttentive).toBeGreaterThan(lowAttentive);
  });

  it("personality 只改变分布，结果仍是合法 careOutcome 之一", () => {
    const s = stateWithCustodian();
    const c = planMonthlyHeirUpbringing(db, s, NOW).changes[0]!;
    expect(["attentive_custodian", "ordinary_custodian", "inattentive_custodian"]).toContain(c.careOutcome);
  });

  it("相同 seed/state 结果完全稳定", () => {
    const s = stateWithCustodian({ compassion: 70 });
    const a = planMonthlyHeirUpbringing(db, s, NOW).changes[0]!;
    const b = planMonthlyHeirUpbringing(db, s, NOW).changes[0]!;
    expect(a).toEqual(b);
  });
});

// ── apply（不可变 + clamp + 月键） ─────────────────────────────────────────────

describe("applyMonthlyHeirUpbringing", () => {
  it("写入 neglect/bond 增量并登记月键；不修改输入 state", () => {
    const heir = makeHeir("h1", { neglect: 30, custodianBond: 30 });
    const s = makeState([heir]);
    const plan = planMonthlyHeirUpbringing(db, s, NOW);
    const s2 = applyMonthlyHeirUpbringing(s, plan);
    expect(s2).not.toBe(s);
    expect(s.settledHeirUpbringingMonths).toHaveLength(0); // input untouched
    expect(s2.settledHeirUpbringingMonths).toContain(upbringingMonthKey(NOW));
    expect(s2.resources.bloodline.heirs[0]!.neglect).toBe(36); // 30 + 6 (no custodian)
  });

  it("clamp 到 0–100", () => {
    const heir = makeHeir("h1", { neglect: 98 });
    const s = makeState([heir]);
    const plan = planMonthlyHeirUpbringing(db, s, NOW);
    const s2 = applyMonthlyHeirUpbringing(s, plan);
    expect(s2.resources.bloodline.heirs[0]!.neglect).toBe(100);
  });

  it("已登记月键则不重复 apply", () => {
    const s = makeState([makeHeir("h1")]);
    const plan = planMonthlyHeirUpbringing(db, s, NOW);
    const s2 = applyMonthlyHeirUpbringing(s, plan);
    const s3 = applyMonthlyHeirUpbringing(s2, plan);
    expect(s3).toBe(s2);
  });

  it("idempotent：apply 后再 plan 本月为空", () => {
    const s = makeState([makeHeir("h1")]);
    const s2 = applyMonthlyHeirUpbringing(s, planMonthlyHeirUpbringing(db, s, NOW));
    expect(planMonthlyHeirUpbringing(db, s2, NOW).changes).toHaveLength(0);
  });
});

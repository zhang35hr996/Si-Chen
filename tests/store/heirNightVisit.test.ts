import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime, createCalendar } from "../../src/engine/calendar/time";
import { applyEffects } from "../../src/engine/effects/funnel";
import type { GameState, Heir } from "../../src/engine/state/types";
import {
  buildHeirNightVisit,
  describeHeirNeglect,
  describeCustodianRelation,
} from "../../src/store/heirNightVisit";

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

/** night = AP slot 4 (戌时). slot = apMax - ap. apMax 5 → ap 1 = slot 4 = night. */
function nightState(heirs: Heir[]): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs = heirs;
  s.calendar = { ...createCalendar(), ap: 1, year: 8 }; // night + heir age 7 (resides in yuqing for daughter ≥5)
  return s;
}

function dayState(heirs: Heir[]): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs = heirs;
  s.calendar = { ...createCalendar(), ap: 5, year: 8 }; // slot 0 = 卯时 = day
  return s;
}

// ── 描述 ───────────────────────────────────────────────────────────────────────

describe("describeHeirNeglect", () => {
  it("bands", () => {
    expect(describeHeirNeglect(10)).toBe("起居安稳");
    expect(describeHeirNeglect(30)).toBe("偶有寂寥");
    expect(describeHeirNeglect(50)).toBe("近来似受冷落");
    expect(describeHeirNeglect(70)).toBe("久疏照拂");
    expect(describeHeirNeglect(90)).toBe("性情已显孤僻戒备");
  });
});

describe("describeCustodianRelation", () => {
  it("无有效抚养人 → 提示", () => {
    const heir = makeHeir("h1"); // no custodian
    const s = nightState([heir]);
    expect(describeCustodianRelation(db, s, heir)).toBe("当前无人能够亲自照料。");
  });
});

// ── buildHeirNightVisit ────────────────────────────────────────────────────────

describe("buildHeirNightVisit", () => {
  it("非夜间 → null", () => {
    const heir = makeHeir("h1");
    expect(buildHeirNightVisit(db, dayState([heir]), "h1", "heart_to_heart")).toBeNull();
  });

  it("已故 → null", () => {
    const heir = makeHeir("h1", { lifecycle: "deceased" });
    expect(buildHeirNightVisit(db, nightState([heir]), "h1", "heart_to_heart")).toBeNull();
  });

  it("未迁居（年幼）→ null", () => {
    const heir = makeHeir("h1", { birthAt: makeGameTime(6, 1, "early") }); // age 2 at year 8
    expect(buildHeirNightVisit(db, nightState([heir]), "h1", "quiet_company")).toBeNull();
  });

  it("夜间在居 → plan（含 heir_night_visit effect）", () => {
    const heir = makeHeir("h1");
    const plan = buildHeirNightVisit(db, nightState([heir]), "h1", "heart_to_heart");
    expect(plan).not.toBeNull();
    expect(plan!.effects[0]).toEqual({ type: "heir_night_visit", heirId: "h1", action: "heart_to_heart" });
    expect(plan!.lines.length).toBeGreaterThan(0);
    expect(plan!.speakerName).toBeTruthy();
  });

  it("高忽视分支台词与平常不同", () => {
    const high = buildHeirNightVisit(db, nightState([makeHeir("h1", { neglect: 80 })]), "h1", "heart_to_heart")!;
    const calm = buildHeirNightVisit(db, nightState([makeHeir("h1", { neglect: 10, closeness: 70 })]), "h1", "heart_to_heart")!;
    expect(high.lines.join("")).not.toBe(calm.lines.join(""));
    expect(high.lines.join("")).toContain("无所适从");
  });

  it("有 active 伴读 → 谈心提及伴读名", () => {
    const heir = makeHeir("h1");
    const s = nightState([heir]);
    s.heirCompanions["h1"] = {
      id: "companion_assignment_h1_0", heirId: "h1", companion: { kind: "royal_relative", personId: "r1" },
      assignedAt: makeGameTime(7, 1, "early"), status: "active", bond: 5, ageAtAssignment: 7,
      profile: { name: "宗室小友", sex: "female", legitimate: true, personality: defaultPersonality },
    };
    const plan = buildHeirNightVisit(db, s, "h1", "heart_to_heart")!;
    // companion branch only fires when not high-neglect/high-fear; this heir is neutral
    expect(plan.lines.join("")).toContain("宗室小友");
  });
});

// ── heir_night_visit effect apply ──────────────────────────────────────────────

describe("heir_night_visit effect", () => {
  it("谈心：favor+2 closeness+4 fear-2 neglect-8，写 lastImperialInteractionAt", () => {
    const heir = makeHeir("h1", { favor: 50, closeness: 50, imperialFear: 30, neglect: 30 });
    const s = nightState([heir]);
    const r = applyEffects(db, s, [{ type: "heir_night_visit", heirId: "h1", action: "heart_to_heart" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.favor).toBe(52);
    expect(h.closeness).toBe(54);
    expect(h.imperialFear).toBe(28);
    expect(h.neglect).toBe(22);
    expect(h.lastImperialInteractionAt).toBeDefined();
  });

  it("陪坐：favor+3 closeness+3 fear-1 neglect-9", () => {
    const heir = makeHeir("h1", { favor: 50, closeness: 50, imperialFear: 30, neglect: 30 });
    const s = nightState([heir]);
    const r = applyEffects(db, s, [{ type: "heir_night_visit", heirId: "h1", action: "quiet_company" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.favor).toBe(53);
    expect(h.closeness).toBe(53);
    expect(h.imperialFear).toBe(29);
    expect(h.neglect).toBe(21);
  });

  it("非夜间被 effect 校验拒绝", () => {
    const heir = makeHeir("h1");
    const s = dayState([heir]);
    const r = applyEffects(db, s, [{ type: "heir_night_visit", heirId: "h1", action: "heart_to_heart" }]);
    expect(r.ok).toBe(false);
  });

  it("未迁居皇嗣被 effect 校验拒绝", () => {
    const heir = makeHeir("h1", { birthAt: makeGameTime(6, 1, "early") }); // age 2
    const s = nightState([heir]);
    const r = applyEffects(db, s, [{ type: "heir_night_visit", heirId: "h1", action: "quiet_company" }]);
    expect(r.ok).toBe(false);
  });

  it("已故皇嗣被 effect 校验拒绝", () => {
    const heir = makeHeir("h1", { lifecycle: "deceased" });
    const s = nightState([heir]);
    const r = applyEffects(db, s, [{ type: "heir_night_visit", heirId: "h1", action: "heart_to_heart" }]);
    expect(r.ok).toBe(false);
  });
});

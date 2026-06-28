import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, Heir, HeirCompanionAssignment } from "../../src/engine/state/types";
import { buildWenzhaoLesson, buildWenzhaoTutorReport, courseLabel } from "../../src/store/heirEducation";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const HEIR_ID = "heir_edu_001";
const PEER_ID = "heir_edu_002";

function makeHeir(id: string, over: {
  sex?: "daughter" | "son";
  birthYear?: number;
  lifecycle?: "alive" | "deceased";
  education?: { scholarship: number; martial: number; virtue: number };
  talent?: number;
  diligence?: number;
  neglect?: number;
  curiosity?: number;
  assertiveness?: number;
  restraint?: number;
  guile?: number;
  health?: number;
  sociability?: number;
  empathy?: number;
} = {}): Heir {
  const sex = over.sex ?? "daughter";
  return {
    id, sex, fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(over.birthYear ?? 1, 1, "early"),
    favor: 50, legitimate: true, petName: "青青",
    education: over.education ?? { scholarship: 30, martial: 25, virtue: 28 },
    health: over.health ?? 70,
    talent: over.talent ?? 55,
    diligence: over.diligence ?? 50,
    ambition: 25, closeness: 50, support: 20, faction: "none",
    lifecycle: over.lifecycle ?? "alive",
    personality: {
      empathy: over.empathy ?? 50,
      guile: over.guile ?? 30,
      restraint: over.restraint ?? 50,
      sociability: over.sociability ?? 50,
      assertiveness: over.assertiveness ?? 50,
      curiosity: over.curiosity ?? 50,
    },
    interests: [],
    imperialFear: 20, neglect: over.neglect ?? 20, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
  };
}

function makeState(over: Parameters<typeof makeHeir>[1] & { withPeer?: boolean } = {}): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push(makeHeir(HEIR_ID, over));
  if (over.withPeer) {
    // peer daughter also enrolled at year=6 (age=5)
    s.resources.bloodline.heirs.push(makeHeir(PEER_ID, { sex: "daughter" }));
  }
  s.calendar = { ...s.calendar, year: 6 }; // daughter age 5 = enrolled
  return s;
}

// ── courseLabel ───────────────────────────────────────────────────────────────

describe("courseLabel", () => {
  it("daughter scholarship → 经史治术", () => expect(courseLabel("daughter", "scholarship")).toBe("经史治术"));
  it("daughter martial → 骑射兵略", () => expect(courseLabel("daughter", "martial")).toBe("骑射兵略"));
  it("daughter virtue → 礼法德行", () => expect(courseLabel("daughter", "virtue")).toBe("礼法德行"));
  it("son scholarship → 经史诗书", () => expect(courseLabel("son", "scholarship")).toBe("经史诗书"));
  it("son martial → 骑射强身", () => expect(courseLabel("son", "martial")).toBe("骑射强身"));
  it("son virtue → 礼仪德行", () => expect(courseLabel("son", "virtue")).toBe("礼仪德行"));
});

// ── buildWenzhaoLesson ────────────────────────────────────────────────────────

describe("buildWenzhaoLesson", () => {
  it("returns null for unknown heir", () => {
    expect(buildWenzhaoLesson(makeState(), "ghost", "scholarship")).toBeNull();
  });

  it("returns null for deceased heir", () => {
    expect(buildWenzhaoLesson(makeState({ lifecycle: "deceased" }), HEIR_ID, "scholarship")).toBeNull();
  });

  it("returns null for non-enrolled son at age 5", () => {
    const s = makeState({ sex: "son" }); // year=6, birthYear=1 → age=5 < 7
    expect(buildWenzhaoLesson(s, HEIR_ID, "scholarship")).toBeNull();
  });

  it("returns plan with heir_educate effect (favorDelta=0)", () => {
    const plan = buildWenzhaoLesson(makeState(), HEIR_ID, "scholarship");
    expect(plan).not.toBeNull();
    const eff = plan!.effects[0]!;
    expect(eff.type).toBe("heir_educate");
    if (eff.type !== "heir_educate") return;
    expect(eff.heirId).toBe(HEIR_ID);
    expect(eff.subject).toBe("scholarship");
    expect(eff.favorDelta).toBe(0);
    expect(eff.attrDelta).toBeGreaterThanOrEqual(1);
    expect(eff.attrDelta).toBeLessThanOrEqual(4);
  });

  it("excellent performance → attrDelta 4", () => {
    const s = makeState({ education: { scholarship: 90, martial: 50, virtue: 50 }, talent: 90, diligence: 90, neglect: 0, health: 100 });
    const plan = buildWenzhaoLesson(s, HEIR_ID, "scholarship")!;
    const eff = plan.effects[0] as { attrDelta: number };
    expect(eff.attrDelta).toBe(4);
  });

  it("poor performance → attrDelta 1", () => {
    const s = makeState({ education: { scholarship: 0, martial: 0, virtue: 0 }, talent: 0, diligence: 0, neglect: 100, health: 10 });
    const plan = buildWenzhaoLesson(s, HEIR_ID, "scholarship")!;
    const eff = plan.effects[0] as { attrDelta: number };
    expect(eff.attrDelta).toBe(1);
  });

  it("is deterministic — same state same result", () => {
    const s = makeState();
    const p1 = buildWenzhaoLesson(s, HEIR_ID, "scholarship");
    const p2 = buildWenzhaoLesson(s, HEIR_ID, "scholarship");
    expect(p1!.lines).toEqual(p2!.lines);
    const e1 = p1!.effects[0] as { attrDelta: number };
    const e2 = p2!.effects[0] as { attrDelta: number };
    expect(e1.attrDelta).toBe(e2.attrDelta);
  });

  it("high guile does NOT change attrDelta (score is unaffected)", () => {
    const base = makeState({ guile: 10, education: { scholarship: 20, martial: 20, virtue: 20 } });
    const highGuile = makeState({ guile: 90, education: { scholarship: 20, martial: 20, virtue: 20 } });
    const pBase = buildWenzhaoLesson(base, HEIR_ID, "scholarship")!;
    const pHigh = buildWenzhaoLesson(highGuile, HEIR_ID, "scholarship")!;
    const deltaBase = (pBase.effects[0] as { attrDelta: number }).attrDelta;
    const deltaHigh = (pHigh.effects[0] as { attrDelta: number }).attrDelta;
    expect(deltaBase).toBe(deltaHigh);
  });

  it("lesson lines use gender-specific course name for daughter", () => {
    const plan = buildWenzhaoLesson(makeState(), HEIR_ID, "scholarship")!;
    expect(plan.lines.join("")).toContain("经史治术");
    expect(plan.lines.join("")).not.toContain("学问");
  });

  it("lesson lines use gender-specific course name for son", () => {
    // son enrolled at year=8 (age=7)
    const s = makeState({ sex: "son" });
    s.calendar = { ...s.calendar, year: 8 };
    s.resources.bloodline.heirs[0]!.portraitVariants = { baby: "boy_baby1", kid: "boy_kid1", child: "boy_child1", teen: "boy_teen1" };
    const plan = buildWenzhaoLesson(s, HEIR_ID, "scholarship")!;
    expect(plan.lines.join("")).toContain("经史诗书");
  });

  it("returns non-empty lines with portraitSet and speakerName", () => {
    const plan = buildWenzhaoLesson(makeState(), HEIR_ID, "virtue");
    expect(plan!.lines.length).toBeGreaterThan(0);
    expect(plan!.portraitSet).toBeTruthy();
    expect(plan!.speakerName).toBeTruthy();
  });

  // ── 同窗片段 ──────────────────────────────────────────────────────────────

  it("no peer fragment when only one student", () => {
    // no withPeer — single student, should never get peer lines
    const s = makeState({ sociability: 90 });
    // run multiple dayIndex to get enough samples
    const fragments: boolean[] = [];
    for (let i = 0; i < 20; i++) {
      const state = { ...s, calendar: { ...s.calendar, dayIndex: i } };
      const plan = buildWenzhaoLesson(state, HEIR_ID, "scholarship")!;
      // peer fragment lines would be distinct from standard 2-line output
      fragments.push(plan.lines.length > 2);
    }
    expect(fragments.every((f) => !f)).toBe(true);
  });

  it("peer fragment can appear when two students exist", () => {
    const s = makeState({ withPeer: true });
    let found = false;
    for (let i = 0; i < 30; i++) {
      const state = { ...s, calendar: { ...s.calendar, dayIndex: i } };
      const plan = buildWenzhaoLesson(state, HEIR_ID, "scholarship")!;
      if (plan.lines.length > 2) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("lines are deterministic with peers", () => {
    const s = makeState({ withPeer: true });
    const p1 = buildWenzhaoLesson(s, HEIR_ID, "martial")!;
    const p2 = buildWenzhaoLesson(s, HEIR_ID, "martial")!;
    expect(p1.lines).toEqual(p2.lines);
  });
});

// ── isWenzhaoStudent age boundary (via lesson) ───────────────────────────────

describe("son 18 岁离校边界", () => {
  it("son 17 岁仍在读", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.heirs.push(makeHeir(HEIR_ID, { sex: "son", birthYear: 1 }));
    s.calendar = { ...s.calendar, year: 18 }; // age=17
    expect(buildWenzhaoLesson(s, HEIR_ID, "scholarship")).not.toBeNull();
  });

  it("son 18 岁离校", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.heirs.push(makeHeir(HEIR_ID, { sex: "son", birthYear: 1 }));
    s.calendar = { ...s.calendar, year: 19 }; // age=18
    expect(buildWenzhaoLesson(s, HEIR_ID, "scholarship")).toBeNull();
  });

  it("daughter 18 岁仍在读", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.heirs.push(makeHeir(HEIR_ID, { sex: "daughter", birthYear: 1 }));
    s.calendar = { ...s.calendar, year: 19 }; // age=18
    expect(buildWenzhaoLesson(s, HEIR_ID, "scholarship")).not.toBeNull();
  });
});

// ── buildWenzhaoTutorReport ───────────────────────────────────────────────────

describe("buildWenzhaoTutorReport", () => {
  it("returns null for unknown heir", () => {
    expect(buildWenzhaoTutorReport(makeState(), "ghost")).toBeNull();
  });

  it("returns null for non-enrolled heir", () => {
    const s = makeState({ sex: "son" }); // age 5, son not enrolled
    expect(buildWenzhaoTutorReport(s, HEIR_ID)).toBeNull();
  });

  it("returns report with summary and warnings arrays", () => {
    const report = buildWenzhaoTutorReport(makeState(), HEIR_ID);
    expect(report).not.toBeNull();
    expect(Array.isArray(report!.summary)).toBe(true);
    expect(report!.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(report!.warnings)).toBe(true);
  });

  it("summary uses gender-specific course labels", () => {
    const report = buildWenzhaoTutorReport(makeState({ education: { scholarship: 40, martial: 20, virtue: 30 } }), HEIR_ID)!;
    const combined = report.summary.join(" ");
    expect(combined).toContain("经史治术");
    expect(combined).toContain("骑射兵略");
    expect(combined).toContain("礼法德行");
    expect(combined).toContain("40");
  });

  it("neglect ≥ 60 triggers warning", () => {
    const report = buildWenzhaoTutorReport(makeState({ neglect: 70 }), HEIR_ID);
    expect(report!.warnings.length).toBeGreaterThan(0);
    expect(report!.warnings.join("")).toContain("关怀");
  });

  it("low neglect produces no neglect warning", () => {
    const report = buildWenzhaoTutorReport(makeState({ neglect: 10 }), HEIR_ID);
    expect(report!.warnings.join("")).not.toContain("关怀");
  });

  it("highly imbalanced education triggers balance warning", () => {
    const report = buildWenzhaoTutorReport(
      makeState({ neglect: 0, education: { scholarship: 90, martial: 5, virtue: 5 } }), HEIR_ID,
    );
    expect(report!.warnings.join("")).toContain("均衡");
  });
});

// ── 伴读优先同窗片段 ─────────────────────────────────────────────────────────────

const defaultPersonality = { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 };

function makeCompanionAssignment(companionName: string): HeirCompanionAssignment {
  return {
    heirId: HEIR_ID,
    companion: { kind: "royal_relative", personId: "royal_youth_h1_6" },
    assignedAt: makeGameTime(6, 1, "early"),
    status: "active",
    bond: 5,
    profile: {
      name: companionName,
      sex: "female",
      age: 5,
      legitimate: true,
      personality: { ...defaultPersonality, sociability: 80 }, // high social → bothSocial path
    },
  };
}

describe("伴读优先同窗片段", () => {
  it("peer fragment uses companion name when active companion exists", () => {
    const s = makeState({ sociability: 80 }); // high social → bothSocial
    s.heirCompanions[HEIR_ID] = makeCompanionAssignment("宗室小友");

    let foundCompanionName = false;
    for (let i = 0; i < 30; i++) {
      const state = { ...s, calendar: { ...s.calendar, dayIndex: i } };
      const plan = buildWenzhaoLesson(state, HEIR_ID, "scholarship")!;
      if (plan.lines.join("").includes("宗室小友")) {
        foundCompanionName = true;
        break;
      }
    }
    expect(foundCompanionName).toBe(true);
  });

  it("peer fragment appears even with no peer heir when companion exists", () => {
    // No peer heir in bloodline, but companion is active
    const s = makeState({ sociability: 80 });
    s.heirCompanions[HEIR_ID] = makeCompanionAssignment("宗室伴读");

    let found = false;
    for (let i = 0; i < 30; i++) {
      const state = { ...s, calendar: { ...s.calendar, dayIndex: i } };
      const plan = buildWenzhaoLesson(state, HEIR_ID, "scholarship")!;
      if (plan.lines.length > 2) { found = true; break; }
    }
    expect(found).toBe(true);
  });

  it("still no peer fragment with single student and no companion", () => {
    const s = makeState({ sociability: 90 });
    // no companion, no peer heir
    for (let i = 0; i < 20; i++) {
      const state = { ...s, calendar: { ...s.calendar, dayIndex: i } };
      const plan = buildWenzhaoLesson(state, HEIR_ID, "scholarship")!;
      expect(plan.lines.length).toBeLessThanOrEqual(2);
    }
  });
});

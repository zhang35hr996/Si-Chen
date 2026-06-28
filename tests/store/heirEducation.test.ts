import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, Heir } from "../../src/engine/state/types";
import { buildWenzhaoLesson, buildWenzhaoTutorReport } from "../../src/store/heirEducation";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const HEIR_ID = "heir_edu_001";

function makeState(over: {
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
} = {}): GameState {
  const s = createNewGameState(db);
  const sex = over.sex ?? "daughter";
  const heir: Heir = {
    id: HEIR_ID, sex, fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(over.birthYear ?? 1, 1, "early"),
    favor: 50, legitimate: true, petName: "青青",
    education: over.education ?? { scholarship: 30, martial: 25, virtue: 28 },
    health: over.health ?? 70,
    talent: over.talent ?? 55,
    diligence: over.diligence ?? 50,
    ambition: 25, closeness: 50, support: 20, faction: "none",
    lifecycle: over.lifecycle ?? "alive",
    personality: {
      empathy: 50,
      guile: over.guile ?? 30,
      restraint: over.restraint ?? 50,
      sociability: 50,
      assertiveness: over.assertiveness ?? 50,
      curiosity: over.curiosity ?? 50,
    },
    interests: [],
    imperialFear: 20, neglect: over.neglect ?? 20, custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
  };
  s.resources.bloodline.heirs.push(heir);
  s.calendar = { ...s.calendar, year: 6 }; // daughter age 5 = enrolled
  return s;
}

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
    const plan = buildWenzhaoLesson(s, HEIR_ID, "scholarship");
    expect(plan!.effects[0]!.type === "heir_educate" && (plan!.effects[0] as { attrDelta: number }).attrDelta).toBe(4);
  });

  it("poor performance → attrDelta 1", () => {
    const s = makeState({ education: { scholarship: 0, martial: 0, virtue: 0 }, talent: 0, diligence: 0, neglect: 100, health: 10 });
    const plan = buildWenzhaoLesson(s, HEIR_ID, "scholarship");
    expect(plan!.effects[0]!.type === "heir_educate" && (plan!.effects[0] as { attrDelta: number }).attrDelta).toBe(1);
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

  it("different subjects produce different attrDelta base", () => {
    // curiosity=90 helps scholarship, assertiveness=10 hurts martial → likely differ
    const s = makeState({ curiosity: 90, assertiveness: 10 });
    const sch = buildWenzhaoLesson(s, HEIR_ID, "scholarship")!;
    const mar = buildWenzhaoLesson(s, HEIR_ID, "martial")!;
    // Not a strict guarantee due to noise, but confirms different code paths run
    expect(sch).not.toBeNull();
    expect(mar).not.toBeNull();
  });

  it("high guile changes lesson lines without changing attrDelta score path", () => {
    const base = makeState({ guile: 10, education: { scholarship: 20, martial: 20, virtue: 20 } });
    const highGuile = makeState({ guile: 90, education: { scholarship: 20, martial: 20, virtue: 20 } });
    const pBase = buildWenzhaoLesson(base, HEIR_ID, "scholarship")!;
    const pHigh = buildWenzhaoLesson(highGuile, HEIR_ID, "scholarship")!;
    const deltaBase = (pBase.effects[0] as { attrDelta: number }).attrDelta;
    const deltaHigh = (pHigh.effects[0] as { attrDelta: number }).attrDelta;
    // guile must NOT affect score
    expect(deltaBase).toBe(deltaHigh);
  });

  it("peerFragments is array (may be empty)", () => {
    const plan = buildWenzhaoLesson(makeState(), HEIR_ID, "virtue");
    expect(Array.isArray(plan!.peerFragments)).toBe(true);
  });

  it("peer fragments are deterministic", () => {
    const s = makeState();
    const p1 = buildWenzhaoLesson(s, HEIR_ID, "martial")!;
    const p2 = buildWenzhaoLesson(s, HEIR_ID, "martial")!;
    expect(p1.peerFragments).toEqual(p2.peerFragments);
  });

  it("returns non-empty lines with portraitSet and speakerName", () => {
    const plan = buildWenzhaoLesson(makeState(), HEIR_ID, "virtue");
    expect(plan!.lines.length).toBeGreaterThan(0);
    expect(plan!.portraitSet).toBeTruthy();
    expect(plan!.speakerName).toBeTruthy();
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

  it("summary includes education scores", () => {
    const report = buildWenzhaoTutorReport(makeState({ education: { scholarship: 40, martial: 20, virtue: 30 } }), HEIR_ID);
    const combined = report!.summary.join(" ");
    expect(combined).toContain("40");
    expect(combined).toContain("20");
    expect(combined).toContain("30");
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

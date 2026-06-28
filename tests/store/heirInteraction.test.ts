import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { buildHeirSummon, buildHeirLesson, buildTutorReport } from "../../src/store/heirInteraction";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, Heir } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const defaultPersonality = { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 };
const boyPortraitVariants = { baby: "boy_baby1", kid: "boy_kid1", child: "boy_child1", teen: "boy_teen1" };

function stateAt(year: number): { state: GameState; heir: Heir } {
  const s = createNewGameState(db);
  (s.calendar as { year: number }).year = year;
  const heir: Heir = {
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"), favor: 50, legitimate: true,
    petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 }, health: 60, talent: 50, diligence: 50,
    personality: defaultPersonality,
    interests: [],
    imperialFear: 20, neglect: 40, custodianBond: 0,
    portraitVariants: boyPortraitVariants,
    ambition: 20, closeness: 50, support: 20, faction: "none", lifecycle: "alive",
  };
  s.resources.bloodline.heirs.push(heir);
  return { state: s, heir };
}

describe("buildHeirSummon", () => {
  it("returns heir_summon effect and stage-specific lines + portrait", () => {
    const { state, heir } = stateAt(1); // 0 岁 infant → baby stage
    const plan = buildHeirSummon(db, state, heir.id)!;
    expect(plan.effects).toEqual([{ type: "heir_summon", heirId: heir.id }]);
    expect(plan.portraitSet).toBe("boy_baby1"); // portraitVariants.baby
    expect(plan.lines.length).toBeGreaterThan(0);
  });

  it("5-year-old son uses kid portrait (not yet enrolled)", () => {
    const { state, heir } = stateAt(6); // 5 岁 → kid stage (son opens at 7)
    const plan = buildHeirSummon(db, state, heir.id)!;
    expect(plan.portraitSet).toBe("boy_kid1"); // portraitVariants.kid
  });

  it("returns null for unknown heir", () => {
    const { state } = stateAt(1);
    expect(buildHeirSummon(db, state, "nope")).toBeNull();
  });
});

describe("buildHeirLesson", () => {
  it("targets a subject, returns heir_educate effect + portrait + lines", () => {
    const { state, heir } = stateAt(8); // son: 7 岁开蒙，year=8 → 7 岁 enrolled
    const plan = buildHeirLesson(db, state, heir.id)!;
    const eff = plan.effects[0]!;
    expect(eff.type).toBe("heir_educate");
    expect(plan.portraitSet).toBe("boy_kid1"); // 7 岁 → kid stage
    expect(plan.lines.length).toBeGreaterThan(0);
  });

  it("returns null for a non-enrolled heir (son < 7 岁)", () => {
    const { state, heir } = stateAt(7); // son 6 岁，尚未开蒙
    expect(buildHeirLesson(db, state, heir.id)).toBeNull();
  });
});

describe("buildTutorReport", () => {
  it("returns 先生 report lines for an enrolled heir (no attr change)", () => {
    const { state, heir } = stateAt(8); // son 7 岁开蒙
    const lines = buildTutorReport(db, state, heir.id)!;
    expect(lines.length).toBeGreaterThan(0);
  });
});

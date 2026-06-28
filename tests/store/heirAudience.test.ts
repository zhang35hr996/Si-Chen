import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, Heir } from "../../src/engine/state/types";
import {
  buildHeirAudienceAction,
  resolveHeirLessonPerformance,
} from "../../src/store/heirAudience";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const HEIR_ID = "heir_000001";

function makeState(overrides: {
  sex?: "daughter" | "son";
  birthYear?: number;
  lifecycle?: "alive" | "deceased";
  sociability?: number;
  imperialFear?: number;
  closeness?: number;
  favor?: number;
  assertiveness?: number;
  curiosity?: number;
  guile?: number;
  education?: { scholarship: number; martial: number; virtue: number };
  talent?: number;
  diligence?: number;
  neglect?: number;
} = {}): GameState {
  const s = createNewGameState(db);
  const sex = overrides.sex ?? "daughter";
  const heir: Heir = {
    id: HEIR_ID, sex, fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(overrides.birthYear ?? 1, 1, "early"),
    favor: overrides.favor ?? 50,
    legitimate: true, petName: "团团",
    education: overrides.education ?? { scholarship: 20, martial: 15, virtue: 18 },
    health: 70,
    talent: overrides.talent ?? 55,
    diligence: overrides.diligence ?? 50,
    ambition: 25, closeness: overrides.closeness ?? 50, support: 20,
    faction: "none",
    lifecycle: overrides.lifecycle ?? "alive",
    personality: {
      empathy: 50, guile: overrides.guile ?? 50, restraint: 50,
      sociability: overrides.sociability ?? 50, assertiveness: overrides.assertiveness ?? 50,
      curiosity: overrides.curiosity ?? 50,
    },
    interests: [],
    imperialFear: overrides.imperialFear ?? 20,
    neglect: overrides.neglect ?? 30,
    custodianBond: 0,
    portraitVariants: { baby: "girl_baby1", kid: "girl_kid1", child: "girl_child1", teen: "girl_teen1" },
  };
  s.resources.bloodline.heirs.push(heir);
  // Game is at year 6 by default (daughter age 5 = schooling; son age 5 = toddler)
  s.calendar = { ...s.calendar, year: 6 };
  return s;
}

// ── buildHeirAudienceAction ───────────────────────────────────────────────────

describe("buildHeirAudienceAction", () => {
  it("returns null for unknown heirId", () => {
    expect(buildHeirAudienceAction(makeState(), "bad_id", "talk")).toBeNull();
  });

  it("returns null for deceased heir", () => {
    const s = makeState({ lifecycle: "deceased" });
    expect(buildHeirAudienceAction(s, HEIR_ID, "talk")).toBeNull();
  });

  it("returns plan with correct effect for talk", () => {
    const plan = buildHeirAudienceAction(makeState(), HEIR_ID, "talk");
    expect(plan).not.toBeNull();
    expect(plan!.effects).toEqual([{ type: "heir_audience", heirId: HEIR_ID, action: "talk" }]);
  });

  it("returns plan with correct effect for play", () => {
    const plan = buildHeirAudienceAction(makeState(), HEIR_ID, "play");
    expect(plan!.effects).toEqual([{ type: "heir_audience", heirId: HEIR_ID, action: "play" }]);
  });

  it("returns non-empty lines", () => {
    const plan = buildHeirAudienceAction(makeState(), HEIR_ID, "talk");
    expect(plan!.lines.length).toBeGreaterThan(0);
    expect(plan!.lines[0]!.length).toBeGreaterThan(0);
  });

  it("returns portraitSet from heirPortraitSet()", () => {
    const plan = buildHeirAudienceAction(makeState(), HEIR_ID, "talk");
    // year=6, birthYear=1 → age=5, daughter → kid stage → girl_kid1
    expect(plan!.portraitSet).toBe("girl_kid1");
  });

  it("infant uses baby portrait (乳母 scene)", () => {
    // year=6, birthYear=6 → age=0 → infant/baby
    const s = makeState({ birthYear: 6 });
    const plan = buildHeirAudienceAction(s, HEIR_ID, "play");
    expect(plan!.portraitSet).toBe("girl_baby1");
  });

  it("high sociability produces different lines from low sociability", () => {
    const highSoc = buildHeirAudienceAction(makeState({ sociability: 90 }), HEIR_ID, "talk");
    const lowSoc = buildHeirAudienceAction(makeState({ sociability: 10 }), HEIR_ID, "talk");
    expect(highSoc!.lines.join("")).not.toBe(lowSoc!.lines.join(""));
  });

  it("high imperialFear changes lines", () => {
    const highFear = buildHeirAudienceAction(makeState({ imperialFear: 80 }), HEIR_ID, "talk");
    const lowFear = buildHeirAudienceAction(makeState({ imperialFear: 5 }), HEIR_ID, "talk");
    expect(highFear!.lines.join("")).not.toBe(lowFear!.lines.join(""));
  });
});

// ── resolveHeirLessonPerformance ──────────────────────────────────────────────

describe("resolveHeirLessonPerformance", () => {
  it("returns null for unknown heir", () => {
    expect(resolveHeirLessonPerformance(makeState(), "ghost")).toBeNull();
  });

  it("returns null for pre-enlightenment heir (son age 5)", () => {
    // year=6, birthYear=1 → age=5; son enlightenmentAge=7 → not enrolled
    const s = makeState({ sex: "son", birthYear: 1 });
    expect(resolveHeirLessonPerformance(s, HEIR_ID)).toBeNull();
  });

  it("returns null for deceased heir", () => {
    const s = makeState({ lifecycle: "deceased" });
    // set age to 10 so enrolled
    s.calendar = { ...s.calendar, year: 11 };
    expect(resolveHeirLessonPerformance(s, HEIR_ID)).toBeNull();
  });

  it("returns result for enrolled heir", () => {
    // daughter age 5 at year 6 → enrolled (enlightenmentAge=5)
    const result = resolveHeirLessonPerformance(makeState(), HEIR_ID);
    expect(result).not.toBeNull();
    expect(["scholarship", "martial", "virtue"]).toContain(result!.subject);
    expect(["excellent", "good", "mixed", "poor"]).toContain(result!.performance);
    expect(result!.reportLines.length).toBeGreaterThan(0);
  });

  it("is deterministic — same state gives same result", () => {
    const s = makeState();
    const r1 = resolveHeirLessonPerformance(s, HEIR_ID);
    const r2 = resolveHeirLessonPerformance(s, HEIR_ID);
    expect(r1!.subject).toBe(r2!.subject);
    expect(r1!.performance).toBe(r2!.performance);
  });

  it("high neglect tends to lower performance (statistical)", () => {
    const highNeglect = makeState({ neglect: 90, education: { scholarship: 40, martial: 40, virtue: 40 } });
    const lowNeglect = makeState({ neglect: 0, education: { scholarship: 40, martial: 40, virtue: 40 } });
    const rHigh = resolveHeirLessonPerformance(highNeglect, HEIR_ID);
    const rLow = resolveHeirLessonPerformance(lowNeglect, HEIR_ID);
    const perfOrder = ["poor", "mixed", "good", "excellent"];
    expect(perfOrder.indexOf(rHigh!.performance)).toBeLessThanOrEqual(
      perfOrder.indexOf(rLow!.performance),
    );
  });

  it("portraitSet matches heirPortraitSet()", () => {
    const result = resolveHeirLessonPerformance(makeState(), HEIR_ID);
    // age 5, daughter → kid → girl_kid1
    expect(result!.portraitSet).toBe("girl_kid1");
  });
});

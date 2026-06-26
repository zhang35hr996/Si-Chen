import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";
import { gestationConfig, buildBirth, plannedBirth, birthDue, birthPhrase, collectNewbornIds } from "../../src/store/gestation";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function sovereignCarrying(month: number): GameState {
  const s = createNewGameState(db);
  const conceivedAt = makeGameTime(1, month, "early");
  s.resources.bloodline.pregnancy = { status: "carrying", conceivedAt, candidateIds: [] };
  s.resources.bloodline.gestations = [{ carrier: "sovereign", conceivedAt }];
  return s;
}

describe("gestationConfig", () => {
  it("reads world.gestation", () => {
    expect(gestationConfig(db).termMonths).toBe(10);
  });
});

describe("plannedBirth", () => {
  it("sovereign births at 孕十月", () => {
    const s = sovereignCarrying(1);
    expect(plannedBirth(db, s)!.birthMonthOrdinal).toBe(monthOrdinal(makeGameTime(1, 10, "early")));
  });
  it("returns null with no gestation", () => {
    expect(plannedBirth(db, createNewGameState(db))).toBeNull();
  });
});

describe("birthDue", () => {
  it("not due before the planned month", () => {
    const s = sovereignCarrying(1); // birth at month 10, now is month 1
    expect(birthDue(db, s)).toBe(false);
  });
  it("due once past the planned month", () => {
    const s = sovereignCarrying(1);
    s.calendar = { ...makeGameTime(2, 1, "early"), ap: 6, apMax: 6, eraName: "" }; // monthOrdinal 13 > 10
    expect(birthDue(db, s)).toBe(true);
  });
});

describe("buildBirth", () => {
  it("self-pregnancy → safe birth effect with favor 65 + lines; applying lands an heir", () => {
    const s = sovereignCarrying(1);
    s.calendar = { ...makeGameTime(1, 10, "early"), ap: 6, apMax: 6, eraName: "" };
    const plan = buildBirth(db, s);
    expect(plan).not.toBeNull();
    expect(plan!.bearer).toBe("sovereign");
    expect(plan!.bearerOutcome).toBe("safe");
    const birth = plan!.effects.find((e) => e.type === "birth");
    expect(birth).toBeDefined();
    expect(plan!.lines.length).toBeGreaterThan(0);
    const r = applyEffects(db, s, plan!.effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(1);
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(65); // selfPregnancy=65, no omen (seed=1)
  });

  it("returns null with no gestation", () => {
    expect(buildBirth(db, createNewGameState(db))).toBeNull();
  });
});

describe("birthPhrase", () => {
  it("single daughter → 一位皇子", () => expect(birthPhrase("daughter")).toBe("一位皇子"));
  it("single son → 一位皇郎", () => expect(birthPhrase("son")).toBe("一位皇郎"));
  it("mixed-sex twins (son+daughter) → 子郎双生", () => expect(birthPhrase("son", "daughter")).toBe("子郎双生"));
  it("mixed-sex twins reversed (daughter+son) → 子郎双生", () => expect(birthPhrase("daughter", "son")).toBe("子郎双生"));
  it("twin daughters → 两位双生皇子", () => expect(birthPhrase("daughter", "daughter")).toBe("两位双生皇子"));
  it("twin sons → 两位双生皇郎", () => expect(birthPhrase("son", "son")).toBe("两位双生皇郎"));
  it("never produces 两位龙凤双胎", () => {
    const phrases = [
      birthPhrase("son", "daughter"),
      birthPhrase("daughter", "son"),
      birthPhrase("daughter", "daughter"),
      birthPhrase("son", "son"),
      birthPhrase("daughter"),
      birthPhrase("son"),
    ];
    expect(phrases.some((p) => p.includes("两位龙凤双胎"))).toBe(false);
  });
});

describe("buildBirth narrative — twin phrases", () => {
  // seed=6 sovereign → mixedSexTwins (roll=1 < 5); seed=12 lu_huaijin → mixedSexTwins
  it("mixed-sex twin narrative contains 子郎双生 (sovereign seed=6)", () => {
    const s = sovereignCarrying(1);
    s.rngSeed = 6;
    s.calendar = { ...makeGameTime(1, 10, "early"), ap: 6, apMax: 6, eraName: "" };
    const plan = buildBirth(db, s);
    expect(plan).not.toBeNull();
    expect(plan!.lines[0]).toContain("子郎双生");
    expect(plan!.lines[0]).not.toContain("两位龙凤双胎");
  });

  it("twin daughters narrative contains 两位双生皇子 (sovereign seed=9)", () => {
    // find a seed giving twoDaughters for sovereign
    const s = sovereignCarrying(1);
    s.calendar = { ...makeGameTime(1, 10, "early"), ap: 6, apMax: 6, eraName: "" };
    // seeds 1-100: find first that gives twoDaughters for sovereign
    for (let seed = 1; seed <= 100; seed++) {
      s.rngSeed = seed;
      const plan = buildBirth(db, s);
      if (plan && plan.lines[0]!.includes("两位双生皇子")) {
        expect(plan.lines[0]).toContain("两位双生皇子");
        return;
      }
    }
    // Ensure we found at least one (DEFAULT has 5% twoDaughters)
    throw new Error("No twoDaughters seed found in first 100 seeds for sovereign — unexpected");
  });

  it("twin sons narrative contains 两位双生皇郎 (sovereign seeds)", () => {
    const s = sovereignCarrying(1);
    s.calendar = { ...makeGameTime(1, 10, "early"), ap: 6, apMax: 6, eraName: "" };
    for (let seed = 1; seed <= 100; seed++) {
      s.rngSeed = seed;
      const plan = buildBirth(db, s);
      if (plan && plan.lines[0]!.includes("两位双生皇郎")) {
        expect(plan.lines[0]).toContain("两位双生皇郎");
        return;
      }
    }
    throw new Error("No twoSons seed found in first 100 seeds for sovereign — unexpected");
  });
});

describe("collectNewbornIds", () => {
  it("single birth: beforeCount=0, 1 heir → [heir_000001]", () => {
    expect(collectNewbornIds(0, [{ id: "heir_000001" }])).toEqual(["heir_000001"]);
  });

  it("twin birth: beforeCount=0, 2 heirs → both IDs in push order", () => {
    expect(collectNewbornIds(0, [{ id: "heir_000001" }, { id: "heir_000002" }])).toEqual(["heir_000001", "heir_000002"]);
  });

  it("second birth when first already exists: beforeCount=1 → only new ID", () => {
    expect(collectNewbornIds(1, [{ id: "heir_000001" }, { id: "heir_000002" }])).toEqual(["heir_000002"]);
  });

  it("no survivors: beforeCount equals length → empty", () => {
    expect(collectNewbornIds(1, [{ id: "heir_000001" }])).toEqual([]);
  });

  it("empty heirs → empty", () => {
    expect(collectNewbornIds(0, [])).toEqual([]);
  });
});

describe("twin naming queue — funnel integration", () => {
  const baseBirth = {
    type: "birth" as const,
    sex: "daughter" as const,
    fatherId: "lu_huaijin",
    bearer: "lu_huaijin",
    legitimate: false,
    favor: 25,
    recoverUntilMonth: 20,
  };

  function consortCarrying(): ReturnType<typeof createNewGameState> {
    const s0 = createNewGameState(db);
    const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
    if (!a.ok) throw new Error();
    const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
    if (!b.ok) throw new Error();
    const c = applyEffects(db, b.value, [{ type: "pregnancy_transfer", carrierId: "lu_huaijin", atMonth: 3 }]);
    if (!c.ok) throw new Error();
    return c.value;
  }

  it("single safe birth → 1 ID in newborn list", () => {
    const before = 0;
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "safe" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = collectNewbornIds(before, r.value.resources.bloodline.heirs);
    expect(ids).toEqual(["heir_000001"]);
  });

  it("twin safe → 2 IDs in push order", () => {
    const before = 0;
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "safe", twinSex: "son" as const, twinFavor: 20 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = collectNewbornIds(before, r.value.resources.bloodline.heirs);
    expect(ids).toEqual(["heir_000001", "heir_000002"]);
  });

  it("twin bearer_dies → 2 IDs (children survive, bearer dies)", () => {
    const before = 0;
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "bearer_dies", twinSex: "son" as const, twinFavor: 20 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = collectNewbornIds(before, r.value.resources.bloodline.heirs);
    expect(ids).toHaveLength(2);
  });

  it("twin child_dies → empty queue (both children die)", () => {
    const before = 0;
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "child_dies", twinSex: "son" as const, twinFavor: 20 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(collectNewbornIds(before, r.value.resources.bloodline.heirs)).toHaveLength(0);
  });

  it("twin both → empty queue (everyone dies)", () => {
    const before = 0;
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "both", twinSex: "son" as const, twinFavor: 20 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(collectNewbornIds(before, r.value.resources.bloodline.heirs)).toHaveLength(0);
  });

  it("process queue: name each twin in order → both petNames set", () => {
    const before = 0;
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "safe", twinSex: "son" as const, twinFavor: 20 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ids = collectNewbornIds(before, r.value.resources.bloodline.heirs);
    expect(ids).toEqual(["heir_000001", "heir_000002"]);

    // Name first child (queue head)
    const r2 = applyEffects(db, r.value, [{ type: "heir_name", heirId: ids[0]!, field: "pet", name: "小一" }]);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    // Queue shifts: [ids[1]] remains
    const remainingIds = ids.slice(1);
    expect(remainingIds).toEqual(["heir_000002"]);

    // Name second child
    const r3 = applyEffects(db, r2.value, [{ type: "heir_name", heirId: remainingIds[0]!, field: "pet", name: "小二" }]);
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;

    // Both have petNames; queue is empty
    const h1 = r3.value.resources.bloodline.heirs.find((h) => h.id === "heir_000001");
    const h2 = r3.value.resources.bloodline.heirs.find((h) => h.id === "heir_000002");
    expect(h1!.petName).toBe("小一");
    expect(h2!.petName).toBe("小二");
  });
});

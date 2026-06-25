import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";
import { gestationConfig, buildBirth, plannedBirth, birthDue, birthPhrase } from "../../src/store/gestation";
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
  it("dragon-phoenix (son+daughter) → 一对龙凤胎", () => expect(birthPhrase("son", "daughter")).toBe("一对龙凤胎"));
  it("dragon-phoenix reversed (daughter+son) → 一对龙凤胎", () => expect(birthPhrase("daughter", "son")).toBe("一对龙凤胎"));
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
  // seed=6 sovereign → dragonPhoenix (roll=1 < 5); seed=12 lu_huaijin → dragonPhoenix
  it("dragon-phoenix twin narrative contains 一对龙凤胎 (sovereign seed=6)", () => {
    const s = sovereignCarrying(1);
    s.rngSeed = 6;
    s.calendar = { ...makeGameTime(1, 10, "early"), ap: 6, apMax: 6, eraName: "" };
    const plan = buildBirth(db, s);
    expect(plan).not.toBeNull();
    expect(plan!.lines[0]).toContain("一对龙凤胎");
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

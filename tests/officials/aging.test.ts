import { describe, expect, it } from "vitest";
import { ageOfficialsOneYear } from "../../src/engine/officials/aging";
import { markOfficialDead } from "../../src/engine/officials/lifecycle";
import { isRetirementAgeEligible, naturalDeathChance, retirementChance } from "../../src/engine/officials/lifecycleRules";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const T = { year: 2, month: 1, period: "early" as const, dayIndex: 0 };

describe("ageOfficialsOneYear", () => {
  it("ages living officials and family members by 1; freezes dead/deceased; leaves consorts untouched", () => {
    const s = createNewGameState(db, 1);
    const oId = Object.keys(s.officials)[0]!;
    const deadState = markOfficialDead(s, oId, "natural_death", T);
    expect(deadState.ok).toBe(true);
    if (!deadState.ok) return;
    const before = deadState.value;
    const aged = ageOfficialsOneYear(before);

    for (const [id, o] of Object.entries(aged.officials)) {
      const prev = before.officials[id]!;
      expect(o.age).toBe(o.status === "dead" ? prev.age : prev.age + 1);
    }
    for (const [id, m] of Object.entries(aged.familyMembers)) {
      const prev = before.familyMembers[id]!;
      expect(m.age).toBe(m.deceasedAt ? prev.age : prev.age + 1);
    }
    // consort standing/profile ages are not in officials/familyMembers → untouched
    expect(aged.standing).toBe(before.standing);
  });
});

describe("lifecycle rule curves", () => {
  it("natural death chance rises with age and is bounded", () => {
    expect(naturalDeathChance(40)).toBeLessThan(naturalDeathChance(65));
    expect(naturalDeathChance(65)).toBeLessThan(naturalDeathChance(85));
    for (const a of [20, 55, 70, 90]) {
      expect(naturalDeathChance(a)).toBeGreaterThanOrEqual(0);
      expect(naturalDeathChance(a)).toBeLessThanOrEqual(100);
    }
  });

  it("retirement is age-gated at 55 and rises with age", () => {
    expect(isRetirementAgeEligible(54)).toBe(false);
    expect(isRetirementAgeEligible(55)).toBe(true);
    expect(retirementChance(50)).toBe(0);
    expect(retirementChance(57)).toBeLessThan(retirementChance(62));
    expect(retirementChance(62)).toBeLessThan(retirementChance(70));
  });
});

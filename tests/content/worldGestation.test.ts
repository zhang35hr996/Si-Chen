import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

describe("world.gestation content", () => {
  const content = loadGameContent();
  if (!content.ok) throw new Error("content failed to load");
  const g = content.value.world.gestation;

  it("loads gestation config", () => {
    expect(g).toBeDefined();
    expect(g!.termMonths).toBe(10);
    expect(g!.transferEarliestMonth).toBe(3);
    expect(g!.earlyBirth).toEqual({ month8: 10, month9: 20 });
    expect(g!.recovery).toEqual({ safeMonths: 1, dystociaMonths: 3 });
    expect(g!.dystocia.baseAtMonth3).toBe(5);
    expect(g!.dystocia.perMonthAfter).toBe(8);
    expect(g!.dystocia.outcomeSplit).toEqual({ childDies: 50, bearerDies: 30, both: 20 });
    expect(g!.childFavor.selfPregnancy).toBe(100);
    expect(g!.childFavor.fenghouBonus).toBe(30);
    expect(g!.childFavor.tierValues).toEqual({ abundant: 50, favored: 38, small: 25, fallen: 12, none: 0 });
  });

  it("loads a companionship script line", () => {
    expect(content.value.world.bedchamberScript!.companionship.lines.length).toBeGreaterThan(0);
  });
});

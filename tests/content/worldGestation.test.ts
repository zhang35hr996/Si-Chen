import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { twinsConfigSchema, birthOmenConfigSchema } from "../../src/engine/content/schemas";

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
    expect(g!.childFavor.selfPregnancy).toBe(65);
    expect(g!.childFavor.empressBonus).toBe(15);
    expect(g!.childFavor.tierValues).toEqual({ abundant: 46, favored: 38, small: 30, fallen: 22, none: 15 });
  });

  it("loads a companionship script line", () => {
    expect(content.value.world.bedchamberScript!.companionship.lines.length).toBeGreaterThan(0);
  });
});

describe("twinsConfigSchema probability validation", () => {
  it("accepts total <= 100", () => {
    expect(twinsConfigSchema.safeParse({ mixedSexTwinsChance: 5, twoDaughtersChance: 5, twoSonsChance: 5 }).success).toBe(true);
    expect(twinsConfigSchema.safeParse({ mixedSexTwinsChance: 34, twoDaughtersChance: 33, twoSonsChance: 33 }).success).toBe(true);
  });

  it("accepts total exactly 100", () => {
    expect(twinsConfigSchema.safeParse({ mixedSexTwinsChance: 40, twoDaughtersChance: 30, twoSonsChance: 30 }).success).toBe(true);
  });

  it("rejects total > 100", () => {
    const r = twinsConfigSchema.safeParse({ mixedSexTwinsChance: 50, twoDaughtersChance: 30, twoSonsChance: 30 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.message.includes("twins chance total"))).toBe(true);
  });
});

describe("birthOmenConfigSchema probability validation", () => {
  it("accepts total <= 100", () => {
    expect(birthOmenConfigSchema.safeParse({
      auspiciousChance: 10, inauspiciousChance: 5,
      auspiciousFavorDelta: 10, inauspiciousFavorDelta: -10,
    }).success).toBe(true);
  });

  it("accepts total exactly 100", () => {
    expect(birthOmenConfigSchema.safeParse({
      auspiciousChance: 50, inauspiciousChance: 50,
      auspiciousFavorDelta: 10, inauspiciousFavorDelta: -10,
    }).success).toBe(true);
  });

  it("rejects total > 100", () => {
    const r = birthOmenConfigSchema.safeParse({
      auspiciousChance: 60, inauspiciousChance: 50,
      auspiciousFavorDelta: 10, inauspiciousFavorDelta: -10,
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.message.includes("birth omen chance total"))).toBe(true);
  });
});

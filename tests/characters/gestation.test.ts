import { describe, expect, it } from "vitest";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";
import {
  DEFAULT_GESTATION,
  dystociaChance,
  earlyBirthHit,
  gestationMonth,
  plannedBirthMonth,
  birthSlot,
  recoverUntilMonth,
} from "../../src/engine/characters/gestation";

const at = (y: number, m: number) => makeGameTime(y, m, "early");

describe("gestationMonth (anchor +1)", () => {
  it("受孕月=孕一月, 次月=孕二月, +9月=孕十月", () => {
    const conceived = at(1, 1);
    expect(gestationMonth(at(1, 1), conceived)).toBe(1);
    expect(gestationMonth(at(1, 2), conceived)).toBe(2);
    expect(gestationMonth(at(1, 10), conceived)).toBe(10);
  });
  it("crosses the year boundary", () => {
    const conceived = at(1, 6);
    expect(gestationMonth(at(2, 3), conceived)).toBe(10);
  });
});

describe("dystociaChance", () => {
  it("孕三月=base, grows perMonthAfter, clamps 0–100", () => {
    expect(dystociaChance(3, DEFAULT_GESTATION)).toBe(5);
    expect(dystociaChance(4, DEFAULT_GESTATION)).toBe(13);
    expect(dystociaChance(9, DEFAULT_GESTATION)).toBe(53);
    expect(dystociaChance(2, DEFAULT_GESTATION)).toBe(5); // never below base
    expect(dystociaChance(99, DEFAULT_GESTATION)).toBe(100); // clamp
  });
});

describe("earlyBirthHit determinism", () => {
  it("same inputs → same result", () => {
    const a = earlyBirthHit(42, monthOrdinal(at(1, 8)), "shen", 8, DEFAULT_GESTATION);
    const b = earlyBirthHit(42, monthOrdinal(at(1, 8)), "shen", 8, DEFAULT_GESTATION);
    expect(a).toBe(b);
  });
  it("0% never, 100% always", () => {
    const cfg0 = { ...DEFAULT_GESTATION, earlyBirth: { month8: 0, month9: 0 } };
    const cfg100 = { ...DEFAULT_GESTATION, earlyBirth: { month8: 100, month9: 100 } };
    expect(earlyBirthHit(1, 5, "x", 8, cfg0)).toBe(false);
    expect(earlyBirthHit(1, 5, "x", 8, cfg100)).toBe(true);
  });
});

describe("plannedBirthMonth", () => {
  const conceived = at(1, 1); // 孕十月 = monthOrdinal(1,10)
  it("sovereign always 孕十月", () => {
    expect(plannedBirthMonth(1, conceived, "sovereign", { ...DEFAULT_GESTATION, earlyBirth: { month8: 100, month9: 100 } }))
      .toBe(monthOrdinal(at(1, 10)));
  });
  it("consort with 0% early → 孕十月", () => {
    const cfg = { ...DEFAULT_GESTATION, earlyBirth: { month8: 0, month9: 0 } };
    expect(plannedBirthMonth(1, conceived, "shen", cfg)).toBe(monthOrdinal(at(1, 10)));
  });
  it("consort with 100% month8 → 孕八月", () => {
    const cfg = { ...DEFAULT_GESTATION, earlyBirth: { month8: 100, month9: 100 } };
    expect(plannedBirthMonth(1, conceived, "shen", cfg)).toBe(monthOrdinal(at(1, 8)));
  });
});

describe("birthSlot", () => {
  it("is deterministic and within [0, apMax)", () => {
    const slot = birthSlot(7, monthOrdinal(at(1, 10)), 6);
    expect(slot).toBe(birthSlot(7, monthOrdinal(at(1, 10)), 6));
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(6);
  });
});

describe("recoverUntilMonth", () => {
  it("safe = birthMonth + safeMonths + 1; dystocia = birthMonth + dystociaMonths + 1", () => {
    const bm = monthOrdinal(at(1, 10));
    expect(recoverUntilMonth(bm, true, DEFAULT_GESTATION)).toBe(bm + 2);
    expect(recoverUntilMonth(bm, false, DEFAULT_GESTATION)).toBe(bm + 4);
  });
});

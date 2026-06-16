import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import {
  DEFAULT_TIERS,
  computeFavorStats,
  type BedchamberThresholds,
} from "../../src/engine/characters/favorTier";
import type { BedchamberEncounter, BedchamberRecord } from "../../src/engine/state/types";

const th: BedchamberThresholds = DEFAULT_TIERS;

function visits(month: number, n: number): BedchamberEncounter[] {
  return Array.from({ length: n }, () => ({ at: makeGameTime(1, month, "early"), mode: "passion" as const }));
}
function record(...es: BedchamberEncounter[][]): BedchamberRecord {
  return { encounters: es.flat() };
}

describe("computeFavorStats", () => {
  it("empty log = 无宠, all counts 0", () => {
    const s = computeFavorStats(undefined, makeGameTime(1, 1, "early"), th);
    expect(s).toMatchObject({ tier: "none", lastMonth: 0, lastThreeMonths: 0, lastYear: 0 });
  });

  const rec = record(visits(1, 4), visits(2, 3), visits(3, 3));
  it("一月末 = 小宠 (n3=4)", () => {
    expect(computeFavorStats(rec, makeGameTime(1, 1, "late"), th).tier).toBe("small");
  });
  it("二月末 = 宠爱 (n3=7)", () => {
    expect(computeFavorStats(rec, makeGameTime(1, 2, "late"), th).tier).toBe("favored");
  });
  it("三月末 = 盛宠 (n3=10)", () => {
    expect(computeFavorStats(rec, makeGameTime(1, 3, "late"), th).tier).toBe("abundant");
  });
  it("四月 = 宠爱 (n3=6, 掉回)", () => {
    const s = computeFavorStats(rec, makeGameTime(1, 4, "early"), th);
    expect(s.tier).toBe("favored");
    expect(s.lastThreeMonths).toBe(6);
    expect(s.lastMonth).toBe(0);
  });

  it("失宠: 曾达宠爱+ 但近三月跌破小宠", () => {
    const r = record(visits(1, 5));
    const s = computeFavorStats(r, makeGameTime(1, 6, "early"), th);
    expect(s.lastThreeMonths).toBe(0);
    expect(s.tier).toBe("fallen");
  });

  it("无宠: 有过侍寝但从未达宠爱, 近三月跌破小宠", () => {
    const r = record(visits(1, 2));
    const s = computeFavorStats(r, makeGameTime(1, 6, "early"), th);
    expect(s.tier).toBe("none");
  });

  it("近一年窗口 = 当前月+前11月", () => {
    const r = record(visits(1, 1), visits(2, 1));
    const s = computeFavorStats(r, makeGameTime(2, 1, "early"), th);
    expect(s.lastYear).toBe(1);
  });
});

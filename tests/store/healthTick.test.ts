import { describe, expect, it } from "vitest";
import { projectMonthlyHealth, monthlyIllnessRate } from "../../src/store/healthTick";
const base = { age: 20, isYearStart: false, pregnancyMonthlyCost: false } as const;

describe("monthlyIllnessRate", () => {
  it("young healthy ≈ 0.426% (not 1%)", () => {
    const r = monthlyIllnessRate(100, 20);
    expect(r).toBeGreaterThan(0.004); expect(r).toBeLessThan(0.005);
  });
});
describe("projectMonthlyHealth branches", () => {
  it("year-start age≥35 applies decay; non-year-start does not", () => {
    expect(projectMonthlyHealth({ ...base, age: 45, isYearStart: true, health: 80, status: "healthy", seedKey: "d" }).nextHealth).toBe(78); // −2
    expect(projectMonthlyHealth({ ...base, age: 45, isYearStart: false, health: 80, status: "healthy", seedKey: "d" }).nextHealth).toBe(80);
  });
  it("sick damage in 1..2", () => {
    const o = projectMonthlyHealth({ ...base, health: 50, status: "sick", seedKey: "s" });
    expect(50 - o.nextHealth).toBeGreaterThanOrEqual(1); expect(50 - o.nextHealth).toBeLessThanOrEqual(2);
  });
  it("critical damage in 3..5", () => {
    const o = projectMonthlyHealth({ ...base, health: 50, status: "critical", seedKey: "c" });
    expect(50 - o.nextHealth).toBeGreaterThanOrEqual(3); expect(50 - o.nextHealth).toBeLessThanOrEqual(5);
  });
  it("critical sudden death: health stays >0 but dies (seed baked to hit the 5% roll) — UNCONDITIONAL", () => {
    // SEED_SUDDEN="s7": healthRoll("s7:sudden")=2 < 5
    const o = projectMonthlyHealth({ ...base, age: 70, health: 70, status: "critical", seedKey: "s7" });
    expect(o.died).toBe(true);                 // no `if` — the baked seed MUST hit
    expect(o.nextHealth).toBeGreaterThan(0);   // 70 − (3..5) > 0
    expect(o.deathCause).toBe("critical_sudden");
  });
  it("health hitting 0 → died illness, no further transition", () => {
    const o = projectMonthlyHealth({ ...base, health: 2, status: "critical", seedKey: "x" });
    expect(o.nextHealth).toBe(0); expect(o.died).toBe(true); expect(o.deathCause).toBe("illness");
  });
  it("newly-sick this month takes NO damage (healthy→sick onset, nextHealth unchanged) — UNCONDITIONAL", () => {
    // SEED_ONSET="F": healthRollBasisPoints("F:onset")=422 < monthlyIllnessRate(20,60)*10000≈735
    const o = projectMonthlyHealth({ ...base, age: 60, health: 20, status: "healthy", seedKey: "F" });
    expect(o.nextStatus).toBe("sick");         // baked seed MUST hit onset
    expect(o.nextHealth).toBe(20);             // no 病损 the month of onset
  });
  it("sick single mutually-exclusive transition lands in exactly one bucket", () => {
    const o = projectMonthlyHealth({ ...base, health: 50, status: "sick", seedKey: "t" });
    expect(["sick","critical","healthy"]).toContain(o.nextStatus);
  });
});

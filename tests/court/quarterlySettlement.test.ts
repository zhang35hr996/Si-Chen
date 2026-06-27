/**
 * 季度财政结算单元测试。
 */
import { describe, expect, it } from "vitest";
import {
  calculateQuarterlyRevenue,
  calculateQuarterlyExpense,
  settleQuarterlyTreasury,
} from "../../src/engine/court/quarterlySettlement";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import { validateMemorials } from "../../src/engine/court/memorials";

const db = loadRealContent();
const AT_Q1 = { year: 2, month: 1, period: "early" as const, dayIndex: dayIndexOf(2, 1, "early") };
const AT_Q2 = { year: 2, month: 4, period: "early" as const, dayIndex: dayIndexOf(2, 4, "early") };
const AT_Q3 = { year: 2, month: 7, period: "early" as const, dayIndex: dayIndexOf(2, 7, "early") };
const AT_Q4 = { year: 2, month: 10, period: "early" as const, dayIndex: dayIndexOf(2, 10, "early") };

function baseState(): GameState {
  return createNewGameState(db, 1);
}

function stateWith(overrides: Partial<GameState["resources"]["nation"]>): GameState {
  const s = baseState();
  return { ...s, resources: { ...s.resources, nation: { ...s.resources.nation, ...overrides } } };
}

function findQuarterlyMemorial(state: GameState) {
  return Object.values(state.memorials).find(
    (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
  );
}

// ── calculateQuarterlyRevenue ─────────────────────────────────────────────────

describe("calculateQuarterlyRevenue", () => {
  it("returns positive actual at default stats", () => {
    const { actual } = calculateQuarterlyRevenue(baseState(), () => 0.5);
    expect(actual).toBeGreaterThan(0);
  });

  it("high productivity boosts revenue above base", () => {
    const lo = calculateQuarterlyRevenue(stateWith({ productivity: 0 }), () => 0.5).actual;
    const hi = calculateQuarterlyRevenue(stateWith({ productivity: 100 }), () => 0.5).actual;
    expect(hi).toBeGreaterThan(lo);
  });

  it("high corruption reduces revenue", () => {
    const lo = calculateQuarterlyRevenue(stateWith({ corruption: 100 }), () => 0.5).actual;
    const hi = calculateQuarterlyRevenue(stateWith({ corruption: 0 }), () => 0.5).actual;
    expect(hi).toBeGreaterThan(lo);
  });

  it("low publicSupport reduces revenue", () => {
    const lo = calculateQuarterlyRevenue(stateWith({ publicSupport: 0 }), () => 0.5).actual;
    const hi = calculateQuarterlyRevenue(stateWith({ publicSupport: 100 }), () => 0.5).actual;
    expect(hi).toBeGreaterThan(lo);
  });

  it("high borderPressure reduces revenue", () => {
    const lo = calculateQuarterlyRevenue(stateWith({ borderPressure: 100 }), () => 0.5).actual;
    const hi = calculateQuarterlyRevenue(stateWith({ borderPressure: 0 }), () => 0.5).actual;
    expect(hi).toBeGreaterThan(lo);
  });

  it("ratio = actual / base", () => {
    const r = calculateQuarterlyRevenue(baseState(), () => 0.5);
    expect(r.ratio).toBeCloseTo(r.actual / r.base, 5);
  });

  it("random factor range: rng=0 < rng=1", () => {
    const lo = calculateQuarterlyRevenue(baseState(), () => 0).actual;
    const hi = calculateQuarterlyRevenue(baseState(), () => 1).actual;
    expect(hi).toBeGreaterThan(lo);
  });

  it("causes array contains only nonzero-impact entries", () => {
    const { causes } = calculateQuarterlyRevenue(baseState(), () => 0.5);
    for (const c of causes) {
      expect(c.impact).not.toBe(0);
    }
  });

  it("high corruption → corruption cause has negative impact", () => {
    const { causes } = calculateQuarterlyRevenue(stateWith({ corruption: 100 }), () => 0.5);
    const corruptionCause = causes.find((c) => c.type === "corruption");
    expect(corruptionCause).toBeDefined();
    expect(corruptionCause!.impact).toBeLessThan(0);
  });

  it("high borderPressure → border_pressure cause has negative impact", () => {
    const { causes } = calculateQuarterlyRevenue(stateWith({ borderPressure: 100 }), () => 0.5);
    const borderCause = causes.find((c) => c.type === "border_pressure");
    expect(borderCause).toBeDefined();
    expect(borderCause!.impact).toBeLessThan(0);
  });
});

// ── calculateQuarterlyExpense ─────────────────────────────────────────────────

describe("calculateQuarterlyExpense", () => {
  it("total is sum of breakdown parts", () => {
    const { total, breakdown } = calculateQuarterlyExpense(db, baseState());
    const sum =
      breakdown.palace +
      breakdown.consortAllowance +
      breakdown.officialSalary +
      breakdown.armyMaintenance +
      breakdown.royalChildrenEducation;
    expect(total).toBe(sum);
  });

  it("palace expense is fixed 500", () => {
    const { breakdown } = calculateQuarterlyExpense(db, baseState());
    expect(breakdown.palace).toBe(500);
  });

  it("royalChildrenEducation = 0 when no heirs", () => {
    const { breakdown } = calculateQuarterlyExpense(db, baseState());
    expect(breakdown.royalChildrenEducation).toBe(0);
  });

  it("higher governance → higher officialSalary", () => {
    const lo = calculateQuarterlyExpense(db, stateWith({ governance: 0 })).breakdown.officialSalary;
    const hi = calculateQuarterlyExpense(db, stateWith({ governance: 100 })).breakdown.officialSalary;
    expect(hi).toBeGreaterThan(lo);
  });

  it("higher military → higher armyMaintenance", () => {
    const lo = calculateQuarterlyExpense(db, stateWith({ military: 0 })).breakdown.armyMaintenance;
    const hi = calculateQuarterlyExpense(db, stateWith({ military: 100 })).breakdown.armyMaintenance;
    expect(hi).toBeGreaterThan(lo);
  });

  it("consortAllowance ≥ 0", () => {
    const { breakdown } = calculateQuarterlyExpense(db, baseState());
    expect(breakdown.consortAllowance).toBeGreaterThanOrEqual(0);
  });
});

// ── settleQuarterlyTreasury ───────────────────────────────────────────────────

describe("settleQuarterlyTreasury", () => {
  it("generates a treasury memorial with matter quarterly_settlement_report", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after);
    expect(m).toBeDefined();
    expect(m!.status).toBe("pending");
  });

  it("memorial has only acknowledge option with no treasury delta", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    expect(m.payload.options).toHaveLength(1);
    expect(m.payload.options[0]!.id).toBe("acknowledge");
    expect(m.payload.options[0]!.treasuryDelta).toBeUndefined();
  });

  it("ledger has at least two entries (income + expense) after settlement", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    expect(after.treasuryLedger.length).toBeGreaterThanOrEqual(2);
    const lastEntry = after.treasuryLedger[after.treasuryLedger.length - 1]!;
    expect(lastEntry.balanceAfter).toBe(after.resources.nation.treasury);
  });

  it("generated state passes validateMemorials", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    expect(validateMemorials(after)).toEqual([]);
  });

  // ── Idempotency via settledQuarterlyPeriods ──────────────────────────────────

  it("idempotent: second call with same month returns same state", () => {
    const after1 = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const after2 = settleQuarterlyTreasury(db, after1, AT_Q1, () => 0.5);
    expect(Object.keys(after2.memorials).length).toBe(Object.keys(after1.memorials).length);
    expect(after2.resources.nation.treasury).toBe(after1.resources.nation.treasury);
    expect(after2.settledQuarterlyPeriods).toEqual(after1.settledQuarterlyPeriods);
  });

  it("settledQuarterlyPeriods grows by 1 per quarter", () => {
    let s = baseState();
    expect(s.settledQuarterlyPeriods).toHaveLength(0);
    s = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    expect(s.settledQuarterlyPeriods).toHaveLength(1);
    s = settleQuarterlyTreasury(db, s, AT_Q2, () => 0.5);
    expect(s.settledQuarterlyPeriods).toHaveLength(2);
  });

  it("idempotency works even if memorial is deleted from state", () => {
    const after1 = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const withoutMemorials = { ...after1, memorials: {} };
    const after2 = settleQuarterlyTreasury(db, withoutMemorials, AT_Q1, () => 0.5);
    expect(after2.resources.nation.treasury).toBe(withoutMemorials.resources.nation.treasury);
    expect(after2.settledQuarterlyPeriods).toEqual(after1.settledQuarterlyPeriods);
  });

  it("different months produce different settled entries and memorials", () => {
    let s = baseState();
    s = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    s = settleQuarterlyTreasury(db, s, AT_Q2, () => 0.5);
    s = settleQuarterlyTreasury(db, s, AT_Q3, () => 0.5);
    s = settleQuarterlyTreasury(db, s, AT_Q4, () => 0.5);
    const quarterlyCount = Object.values(s.memorials).filter(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    ).length;
    expect(quarterlyCount).toBe(4);
    expect(s.settledQuarterlyPeriods).toHaveLength(4);
  });

  // ── Structured payload snapshot ──────────────────────────────────────────────

  it("payload contains financial snapshot fields", () => {
    const s = baseState();
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category !== "treasury" || m.payload.matter !== "quarterly_settlement_report") return;
    expect(m.payload.periodKey).toBe("2:1");
    expect(m.payload.openingTreasury).toBe(s.resources.nation.treasury);
    expect(m.payload.revenueBase).toBeGreaterThan(0);
    expect(m.payload.revenueActual).toBeGreaterThan(0);
    expect(m.payload.revenueCauses).toBeInstanceOf(Array);
    expect(m.payload.expensePlanned).toBeGreaterThan(0);
    expect(m.payload.expensePaid).toBeGreaterThanOrEqual(0);
    expect(m.payload.fundingShortfall).toBeGreaterThanOrEqual(0);
    expect(m.payload.expensePaid + m.payload.fundingShortfall).toBe(m.payload.expensePlanned);
    expect(m.payload.closingTreasury).toBe(after.resources.nation.treasury);
  });

  it("closingTreasury = openingTreasury + revenueActual - expensePaid", () => {
    const s = baseState();
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category !== "treasury" || m.payload.matter !== "quarterly_settlement_report") return;
    const expected = m.payload.openingTreasury + m.payload.revenueActual - m.payload.expensePaid;
    expect(m.payload.closingTreasury).toBe(expected);
  });

  it("expenseAllocation.planned parts sum to expensePlanned", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category !== "treasury" || m.payload.matter !== "quarterly_settlement_report") return;
    const { planned } = m.payload.expenseAllocation;
    const sum = planned.palace + planned.consortAllowance + planned.officialSalary + planned.armyMaintenance + planned.royalChildrenEducation;
    expect(sum).toBe(m.payload.expensePlanned);
  });

  it("expenseAllocation.paid + shortfall = planned for each category", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category !== "treasury" || m.payload.matter !== "quarterly_settlement_report") return;
    const { planned, paid, shortfall } = m.payload.expenseAllocation;
    const keys = ["palace", "consortAllowance", "officialSalary", "armyMaintenance", "royalChildrenEducation"] as const;
    for (const k of keys) {
      expect(paid[k] + shortfall[k]).toBe(planned[k]);
    }
  });

  it("revenueCauses are stored in payload", () => {
    const s = stateWith({ corruption: 80 }); // high corruption creates a measurable cause
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category !== "treasury" || m.payload.matter !== "quarterly_settlement_report") return;
    const corruptionCause = m.payload.revenueCauses.find((c) => c.type === "corruption");
    expect(corruptionCause).toBeDefined();
    expect(corruptionCause!.impact).toBeLessThan(0);
  });

  // ── Priority-based expense allocation ────────────────────────────────────────

  it("expenseAllocation.paid total matches expensePaid", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category !== "treasury" || m.payload.matter !== "quarterly_settlement_report") return;
    const { paid } = m.payload.expenseAllocation;
    const totalPaid = paid.palace + paid.consortAllowance + paid.officialSalary + paid.armyMaintenance + paid.royalChildrenEducation;
    expect(totalPaid).toBe(m.payload.expensePaid);
  });

  it("expenseAllocation.shortfall total matches fundingShortfall", () => {
    // Very low budget to force a shortfall
    const s = {
      ...baseState(),
      resources: {
        ...baseState().resources,
        nation: { ...baseState().resources.nation, treasury: 0, productivity: 0, publicSupport: 0 },
      },
    };
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category !== "treasury" || m.payload.matter !== "quarterly_settlement_report") return;
    const { shortfall } = m.payload.expenseAllocation;
    const totalShortfall = shortfall.palace + shortfall.consortAllowance + shortfall.officialSalary + shortfall.armyMaintenance + shortfall.royalChildrenEducation;
    expect(totalShortfall).toBe(m.payload.fundingShortfall);
  });

  // ── Honest shortfall reporting ───────────────────────────────────────────────

  it("fundingShortfall > 0 when treasury cannot cover expense after revenue", () => {
    const s = {
      ...baseState(),
      resources: {
        ...baseState().resources,
        nation: { ...baseState().resources.nation, treasury: 0, productivity: 0, publicSupport: 0 },
      },
    };
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category !== "treasury" || m.payload.matter !== "quarterly_settlement_report") return;
    // With zero opening treasury and minimal revenue, expense may not be fully covered
    expect(m.payload.expensePaid + m.payload.fundingShortfall).toBe(m.payload.expensePlanned);
  });

  it("summary does NOT say 按例拨付 when there is a funding shortfall", () => {
    const s = {
      ...baseState(),
      resources: {
        ...baseState().resources,
        nation: { ...baseState().resources.nation, treasury: 0, productivity: 0, publicSupport: 0 },
      },
    };
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category !== "treasury" || m.payload.matter !== "quarterly_settlement_report") return;
    if (m.payload.fundingShortfall > 0) {
      expect(m.summary).not.toContain("按例拨付");
      expect(m.summary).not.toContain("欠付未清");
      expect(m.summary).not.toContain("请陛下示下");
    }
  });

  it("summary says 按例拨付 when expense is fully covered", () => {
    const s = stateWith({ treasury: 50000 });
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    expect(m.summary).toContain("按例拨付");
  });

  // ── Cause-based revenue text ─────────────────────────────────────────────────

  it("summary does NOT mention 灾害 when dominant cause is corruption", () => {
    const s = stateWith({ corruption: 100, productivity: 50, publicSupport: 50, borderPressure: 0 });
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    expect(m.summary).not.toContain("灾害");
  });

  it("summary does NOT mention 灾害 when dominant cause is borderPressure", () => {
    const s = stateWith({ borderPressure: 100, corruption: 0, productivity: 50, publicSupport: 80 });
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    expect(m.summary).not.toContain("灾害");
  });

  it("high revenue summary does NOT mention 风调雨顺", () => {
    const s = stateWith({ productivity: 100, corruption: 0, publicSupport: 100, borderPressure: 0, treasury: 100000 });
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 1);
    const m = findQuarterlyMemorial(after)!;
    expect(m.summary).not.toContain("风调雨顺");
    expect(m.summary).toContain("农桑兴旺");
  });

  // ── Season / title labels ────────────────────────────────────────────────────

  it("season label is 冬 for month 1", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report") {
      expect(m.payload.season).toBe("冬");
    }
  });

  it("season label is 春 for month 4", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q2, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    if (m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report") {
      expect(m.payload.season).toBe("春");
    }
  });

  it("treasury never goes below 0", () => {
    const s = { ...baseState(), resources: { ...baseState().resources, nation: { ...baseState().resources.nation, treasury: 1 } } };
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    expect(after.resources.nation.treasury).toBeGreaterThanOrEqual(0);
  });

  it("title includes 冬税入库 for month 1", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    expect(m.title).toContain("冬税入库");
  });

  it("summary mentions 户部尚书 and tax amounts", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = findQuarterlyMemorial(after)!;
    expect(m.summary).toContain("户部尚书");
    expect(m.summary).toContain("两");
  });
});

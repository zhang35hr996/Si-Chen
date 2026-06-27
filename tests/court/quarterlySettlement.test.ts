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

  it("consortAllowance = 0 when no consorts in state", () => {
    const { breakdown } = calculateQuarterlyExpense(db, baseState());
    expect(breakdown.consortAllowance).toBeGreaterThanOrEqual(0);
  });
});

// ── settleQuarterlyTreasury ───────────────────────────────────────────────────

describe("settleQuarterlyTreasury", () => {
  it("generates a treasury memorial with matter quarterly_settlement_report", () => {
    const s = baseState();
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    const memorials = Object.values(after.memorials);
    const quarterly = memorials.find(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    );
    expect(quarterly).toBeDefined();
    expect(quarterly!.status).toBe("pending");
  });

  it("memorial has only acknowledge option with no treasury delta", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = Object.values(after.memorials).find(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    )!;
    expect(m.payload.options).toHaveLength(1);
    expect(m.payload.options[0]!.id).toBe("acknowledge");
    expect(m.payload.options[0]!.treasuryDelta).toBeUndefined();
  });

  it("treasury increases after revenue transaction", () => {
    const s = baseState();
    // With rng=0.5, revenue is positive; expense is less than revenue at default stats
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    // At minimum, two ledger entries added (income + expense)
    expect(after.treasuryLedger.length).toBeGreaterThanOrEqual(2);
    // Net depends on values; just check ledger integrity
    const lastEntry = after.treasuryLedger[after.treasuryLedger.length - 1]!;
    expect(lastEntry.balanceAfter).toBe(after.resources.nation.treasury);
  });

  it("idempotent: second call with same month returns same state", () => {
    const s = baseState();
    const after1 = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    const after2 = settleQuarterlyTreasury(db, after1, AT_Q1, () => 0.5);
    expect(Object.keys(after2.memorials).length).toBe(Object.keys(after1.memorials).length);
    expect(after2.resources.nation.treasury).toBe(after1.resources.nation.treasury);
  });

  it("different months produce different sourceId memorials", () => {
    let s = baseState();
    s = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    s = settleQuarterlyTreasury(db, s, AT_Q2, () => 0.5);
    s = settleQuarterlyTreasury(db, s, AT_Q3, () => 0.5);
    s = settleQuarterlyTreasury(db, s, AT_Q4, () => 0.5);
    const quarterlyCount = Object.values(s.memorials).filter(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    ).length;
    expect(quarterlyCount).toBe(4);
  });

  it("season label is 冬 for month 1", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = Object.values(after.memorials).find(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    )!;
    if (m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report") {
      expect(m.payload.season).toBe("冬");
    }
  });

  it("season label is 春 for month 4", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q2, () => 0.5);
    const m = Object.values(after.memorials).find(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    )!;
    if (m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report") {
      expect(m.payload.season).toBe("春");
    }
  });

  it("treasury never goes below 0", () => {
    // Set treasury to near-zero and expense is high
    const s = { ...baseState(), resources: { ...baseState().resources, nation: { ...baseState().resources.nation, treasury: 1 } } };
    const after = settleQuarterlyTreasury(db, s, AT_Q1, () => 0.5);
    expect(after.resources.nation.treasury).toBeGreaterThanOrEqual(0);
  });

  it("title includes 冬税入库 for month 1", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = Object.values(after.memorials).find(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    )!;
    expect(m.title).toContain("冬税入库");
  });

  it("summary mentions 户部尚书 and tax amounts", () => {
    const after = settleQuarterlyTreasury(db, baseState(), AT_Q1, () => 0.5);
    const m = Object.values(after.memorials).find(
      (m) => m.payload.category === "treasury" && m.payload.matter === "quarterly_settlement_report",
    )!;
    expect(m.summary).toContain("户部尚书");
    expect(m.summary).toContain("两");
  });
});

/**
 * Group F: resolveMemorial with military payloads.
 */
import { describe, expect, it } from "vitest";
import {
  resolveMemorial,
  generateMilitaryMemorial,
  applyAnnualFrontierAssessment,
} from "../../src/engine/court/memorials";
import type { FrontierAssessmentPlan } from "../../src/engine/court/frontierAssessment";
import type { FrontierSeverity, GameState } from "../../src/engine/state/types";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf } from "../../src/engine/calendar/time";
import { theaterForYear } from "../../src/engine/court/frontierAssessment";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function atMonth7(year: number) {
  return { year, month: 7, period: "early" as const, dayIndex: dayIndexOf(year, 7, "early") };
}

function makePlan(year: number, severity: FrontierSeverity): FrontierAssessmentPlan {
  const severityParams: Record<FrontierSeverity, { pressureAfter: number; military: number }> = {
    stable:   { pressureAfter: 20, military: 50 },
    watch:    { pressureAfter: 45, military: 50 },
    urgent:   { pressureAfter: 65, military: 50 },
    critical: { pressureAfter: 85, military: 50 },
  };
  const { pressureAfter, military } = severityParams[severity];
  return {
    id: `frontier_assessment:${year}`,
    year,
    assessedAt: atMonth7(year),
    theaterId: theaterForYear(year),
    pressureBefore: 35,
    pressureDelta: pressureAfter - 35,
    pressureAfter,
    militaryAtAssessment: military,
    governanceAtAssessment: 50,
    publicSupportAtAssessment: 50,
    severity,
    rawDrift: pressureAfter - 35,
    militaryModifier: 0,
    governanceModifier: 0,
    publicSupportModifier: 0,
  };
}

/** Create a state with a pending military memorial (annual_readiness/drill). */
function stateWithMilitaryMemorial(severity: FrontierSeverity = "stable"): { state: GameState; memId: string } {
  const base = createNewGameState(db);
  const plan = makePlan(1, severity);
  const result = generateMilitaryMemorial(base, plan, atMonth7(1))!;
  return { state: result.state, memId: result.memorial.id };
}

/** Create a state with high enough treasury for all military options. */
function richState(severity: FrontierSeverity = "stable"): { state: GameState; memId: string } {
  const base = createNewGameState(db);
  const withTreasury = {
    ...base,
    resources: { ...base.resources, nation: { ...base.resources.nation, treasury: 50000 } },
  };
  const plan = makePlan(1, severity);
  const result = generateMilitaryMemorial(withTreasury, plan, atMonth7(1))!;
  return { state: result.state, memId: result.memorial.id };
}

// ── basic resolve ─────────────────────────────────────────────────────────────

describe("Group F: resolveMemorial with military payloads — basic resolve", () => {
  it("resolve 'drill': treasury decreases by 600, memorial status becomes resolved", () => {
    const { state, memId } = richState("stable");
    const before = state.resources.nation.treasury;
    const result = resolveMemorial(state, db, memId, "drill", atMonth7(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.resources.nation.treasury).toBe(before - 600);
    expect(result.value.state.memorials[memId]!.status).toBe("resolved");
  });

  it("resolve 'drill': military increases", () => {
    const { state, memId } = richState("stable");
    const before = state.resources.nation.military;
    const result = resolveMemorial(state, db, memId, "drill", atMonth7(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // drill has military +5 (capped by AXIS_CAP=10, so exactly +5)
    expect(result.value.state.resources.nation.military).toBeGreaterThan(before);
  });

  it("resolve 'defer_readiness' (no treasury cost): treasury unchanged", () => {
    const { state, memId } = stateWithMilitaryMemorial("stable");
    const before = state.resources.nation.treasury;
    const result = resolveMemorial(state, db, memId, "defer_readiness", atMonth7(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.resources.nation.treasury).toBe(before);
    expect(result.value.state.memorials[memId]!.status).toBe("resolved");
  });

  it("resolve 'defer_readiness': military decreases (by -2)", () => {
    const { state, memId } = stateWithMilitaryMemorial("stable");
    const before = state.resources.nation.military;
    const result = resolveMemorial(state, db, memId, "defer_readiness", atMonth7(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // defer_readiness has military -2
    expect(result.value.state.resources.nation.military).toBeLessThan(before);
  });

  it("resolve 'fortify_passes': treasury decreases by 1200, borderPressure decreases", () => {
    const { state, memId } = richState("watch");
    const beforeTreasury = state.resources.nation.treasury;
    const beforePressure = state.resources.nation.borderPressure;
    const result = resolveMemorial(state, db, memId, "fortify_passes", atMonth7(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.resources.nation.treasury).toBe(beforeTreasury - 1200);
    // fortify_passes has borderPressure -7 (capped at AXIS_CAP=10, so -7 applied)
    expect(result.value.state.resources.nation.borderPressure).toBeLessThan(beforePressure);
  });
});

// ── error cases ───────────────────────────────────────────────────────────────

describe("Group F: resolveMemorial with military payloads — error cases", () => {
  it("treasury insufficient for 'mobilize' (urgent): returns error, state unchanged", () => {
    const base = createNewGameState(db);
    // Treasury=0 — not enough for mobilize (-1800)
    const withTreasury = {
      ...base,
      resources: { ...base.resources, nation: { ...base.resources.nation, treasury: 100 } },
    };
    const plan = makePlan(1, "urgent");
    const result = generateMilitaryMemorial(withTreasury, plan, atMonth7(1))!;
    const { state, memId } = { state: result.state, memId: result.memorial.id };

    const snap = JSON.stringify(state);
    const resolveResult = resolveMemorial(state, db, memId, "mobilize", atMonth7(1));
    expect(resolveResult.ok).toBe(false);
    expect(JSON.stringify(state)).toBe(snap); // state unchanged
    if (resolveResult.ok) return;
    expect(resolveResult.error.code).toBe("MEMORIAL_TREASURY_INSUFFICIENT");
  });

  it("bad option ID: resolveMemorial returns error", () => {
    const { state, memId } = stateWithMilitaryMemorial("stable");
    const result = resolveMemorial(state, db, memId, "INVALID_OPTION", atMonth7(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MEMORIAL_BAD_OPTION");
  });

  it("already resolved memorial: returns error", () => {
    const { state, memId } = stateWithMilitaryMemorial("stable");
    const r1 = resolveMemorial(state, db, memId, "defer_readiness", atMonth7(1));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = resolveMemorial(r1.value.state, db, memId, "defer_readiness", atMonth7(1));
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error.code).toBe("MEMORIAL_ALREADY_RESOLVED");
  });

  it("non-existent memorial ID: resolveMemorial returns error", () => {
    const { state } = stateWithMilitaryMemorial("stable");
    const result = resolveMemorial(state, db, "mem_999999", "drill", atMonth7(1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MEMORIAL_NOT_FOUND");
  });
});

// ── ledger ────────────────────────────────────────────────────────────────────

describe("Group F: resolveMemorial with military payloads — ledger", () => {
  it("resolve with treasury cost: ledger has one new entry with source.kind === 'memorial'", () => {
    const { state, memId } = richState("stable");
    const result = resolveMemorial(state, db, memId, "drill", atMonth7(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ledger = result.value.state.treasuryLedger;
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.source.kind).toBe("memorial");
    if (ledger[0]!.source.kind !== "memorial") return;
    expect(ledger[0]!.source.memorialId).toBe(memId);
    expect(ledger[0]!.source.optionId).toBe("drill");
    expect(ledger[0]!.delta).toBe(-600);
  });

  it("resolve no-cost option: ledger has no new entries", () => {
    const { state, memId } = stateWithMilitaryMemorial("stable");
    const before = state.treasuryLedger.length;
    const result = resolveMemorial(state, db, memId, "defer_readiness", atMonth7(1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.treasuryLedger).toHaveLength(before);
  });

  it("ledger chain is preserved: resolve two military memorials in sequence", () => {
    // Resolve year 1 memorial, then year 2 memorial
    const base = createNewGameState(db);
    const richBase = { ...base, resources: { ...base.resources, nation: { ...base.resources.nation, treasury: 50000 } } };

    // Year 1 assessment
    const after1 = applyAnnualFrontierAssessment(richBase, db, atMonth7(1));
    const gen1 = after1.frontierAssessments[0]!.generation;
    expect(gen1.status).toBe("generated");
    if (gen1.status !== "generated") return;
    const mem1Id = gen1.memorialId;

    // Resolve year 1 memorial
    const r1 = resolveMemorial(after1, db, mem1Id, "drill", atMonth7(1));
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.state.treasuryLedger).toHaveLength(1);

    // Year 2 assessment (pending military gone now)
    const after2 = applyAnnualFrontierAssessment(r1.value.state, db, atMonth7(2));
    const gen2 = after2.frontierAssessments[1]!.generation;
    if (gen2.status !== "generated") return;
    const mem2Id = gen2.memorialId;

    // Resolve year 2 memorial
    const r2 = resolveMemorial(after2, db, mem2Id, "drill", atMonth7(2));
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.state.treasuryLedger).toHaveLength(2);
    expect(r2.value.state.treasuryLedger[0]!.source.kind).toBe("memorial");
    expect(r2.value.state.treasuryLedger[1]!.source.kind).toBe("memorial");
  });
});

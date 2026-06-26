/**
 * Group B: disaster 奏折国库消耗（Phase 4B）。
 * 验证 resolveMemorial 在灾情奏折 relief/tax_remit 选项上原子地扣减国库并写入台账。
 */
import { describe, expect, it } from "vitest";
import { generateDisasterMemorial, resolveMemorial } from "../../src/engine/court/memorials";
import { validateTreasuryLedger } from "../../src/engine/court/treasuryLedger";
import { validateMemorials } from "../../src/engine/court/memorials";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const AT = { year: 2, month: 3, period: "mid" as const, dayIndex: 200 };

function stateWithTreasury(treasury: number): GameState {
  const base = createNewGameState(db, 1);
  return { ...base, resources: { ...base.resources, nation: { ...base.resources.nation, treasury } } };
}

function disasterState(severity: "minor" | "major", treasury = 10000) {
  const base = stateWithTreasury(treasury);
  const gen = generateDisasterMemorial(base, "jiangnan", severity, AT)!;
  return { state: gen.state, memId: gen.memorial.id };
}

// ── minor relief ────────────────────────────────────────────────────────────

describe("Group B: disaster costs — minor relief", () => {
  it("resolves, decreases treasury by 400, adds one ledger entry", () => {
    const { state, memId } = disasterState("minor");
    const before = state.resources.nation.treasury;
    const r = resolveMemorial(state, db, memId, "relief", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.treasury).toBe(before - 400);
    expect(r.value.state.treasuryLedger).toHaveLength(1);
    const entry = r.value.state.treasuryLedger[0]!;
    expect(entry.delta).toBe(-400);
    expect(entry.balanceBefore).toBe(before);
    expect(entry.balanceAfter).toBe(before - 400);
    expect(entry.source.memorialId).toBe(memId);
    expect(entry.source.optionId).toBe("relief");
  });

  it("公民支持度 (publicSupport) 在灾情 relief 后应提升", () => {
    const { state, memId } = disasterState("minor");
    const before = state.resources.nation.publicSupport;
    const r = resolveMemorial(state, db, memId, "relief", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.publicSupport).toBeGreaterThan(before);
  });
});

// ── minor tax_remit ─────────────────────────────────────────────────────────

describe("Group B: disaster costs — minor tax_remit", () => {
  it("resolves, decreases treasury by 250", () => {
    const { state, memId } = disasterState("minor");
    const before = state.resources.nation.treasury;
    const r = resolveMemorial(state, db, memId, "tax_remit", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.treasury).toBe(before - 250);
    expect(r.value.state.treasuryLedger).toHaveLength(1);
    expect(r.value.state.treasuryLedger[0]!.delta).toBe(-250);
  });
});

// ── major relief ────────────────────────────────────────────────────────────

describe("Group B: disaster costs — major relief", () => {
  it("resolves, decreases treasury by 900", () => {
    const { state, memId } = disasterState("major");
    const before = state.resources.nation.treasury;
    const r = resolveMemorial(state, db, memId, "relief", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.treasury).toBe(before - 900);
    expect(r.value.state.treasuryLedger).toHaveLength(1);
    expect(r.value.state.treasuryLedger[0]!.delta).toBe(-900);
  });
});

// ── major tax_remit ─────────────────────────────────────────────────────────

describe("Group B: disaster costs — major tax_remit", () => {
  it("resolves, decreases treasury by 600", () => {
    const { state, memId } = disasterState("major");
    const before = state.resources.nation.treasury;
    const r = resolveMemorial(state, db, memId, "tax_remit", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.treasury).toBe(before - 600);
    expect(r.value.state.treasuryLedger).toHaveLength(1);
    expect(r.value.state.treasuryLedger[0]!.delta).toBe(-600);
  });
});

// ── ignore: no ledger entry, treasury unchanged ─────────────────────────────

describe("Group B: disaster costs — ignore", () => {
  it("no ledger entry, treasury unchanged", () => {
    const { state, memId } = disasterState("major");
    const before = state.resources.nation.treasury;
    const r = resolveMemorial(state, db, memId, "ignore", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.treasury).toBe(before);
    expect(r.value.state.treasuryLedger).toHaveLength(0);
    expect(validateMemorials(r.value.state)).toEqual([]);
    expect(validateTreasuryLedger(r.value.state)).toEqual([]);
  });
});

// ── treasury insufficient ───────────────────────────────────────────────────

describe("Group B: disaster costs — treasury insufficient", () => {
  it("insufficient → resolver fails, memorial still pending, ledger unchanged", () => {
    const { state, memId } = disasterState("major", 500); // treasury=500 < 900
    const snap = JSON.stringify(state);
    const r = resolveMemorial(state, db, memId, "relief", AT);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("MEMORIAL_TREASURY_INSUFFICIENT");
    // Input state must be byte-identical
    expect(JSON.stringify(state)).toBe(snap);
    // Memorial still pending
    expect(state.memorials[memId]!.status).toBe("pending");
    // No ledger entry
    expect(state.treasuryLedger).toHaveLength(0);
  });

  it("minor tax_remit: exactly sufficient passes, one less fails", () => {
    const { state: stateOk, memId: memIdOk } = disasterState("minor", 250);
    const rOk = resolveMemorial(stateOk, db, memIdOk, "tax_remit", AT);
    expect(rOk.ok).toBe(true);

    const { state: stateFail, memId: memIdFail } = disasterState("minor", 249);
    const rFail = resolveMemorial(stateFail, db, memIdFail, "tax_remit", AT);
    expect(rFail.ok).toBe(false);
    if (rFail.ok) return;
    expect(rFail.error.code).toBe("MEMORIAL_TREASURY_INSUFFICIENT");
  });
});

// ── atomicity: effects failure ──────────────────────────────────────────────

describe("Group B: disaster costs — atomicity", () => {
  it("on insufficient treasury: neither treasury nor ledger changes (byte-identical)", () => {
    const { state, memId } = disasterState("major", 100);
    const snap = JSON.stringify(state);
    resolveMemorial(state, db, memId, "relief", AT);
    expect(JSON.stringify(state)).toBe(snap);
  });

  it("double-resolve blocked: no second ledger entry after first succeeds", () => {
    const { state, memId } = disasterState("minor");
    const first = resolveMemorial(state, db, memId, "relief", AT);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.state.treasuryLedger).toHaveLength(1);

    // Try to resolve again
    const second = resolveMemorial(first.value.state, db, memId, "relief", AT);
    expect(second.ok).toBe(false);
    // Ledger count unchanged
    expect(first.value.state.treasuryLedger).toHaveLength(1);
  });

  it("resolved state passes both validateMemorials and validateTreasuryLedger", () => {
    const { state, memId } = disasterState("minor");
    const r = resolveMemorial(state, db, memId, "tax_remit", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(validateMemorials(r.value.state)).toEqual([]);
    expect(validateTreasuryLedger(r.value.state)).toEqual([]);
  });
});

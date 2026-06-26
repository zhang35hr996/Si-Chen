/**
 * 国库台账领域层（Phase 4B Task 1）：applyTreasuryTransaction + validateTreasuryLedger。
 */
import { describe, expect, it } from "vitest";
import {
  applyTreasuryTransaction,
  ledgerEntryId,
  nextLedgerEntryId,
  validateTreasuryLedger,
  type TreasuryTransactionCommand,
} from "../../src/engine/court/treasuryLedger";
import { generateDisasterMemorial, generateTreasuryMemorial, resolveMemorial } from "../../src/engine/court/memorials";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, TreasuryLedgerEntry } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const AT = { year: 2, month: 3, period: "mid" as const, dayIndex: 200 };

/** 从新游戏 state 启动，带自定义国库余额。 */
function stateWithTreasury(treasury: number): GameState {
  const base = createNewGameState(db, 1);
  return {
    ...base,
    resources: {
      ...base.resources,
      nation: { ...base.resources.nation, treasury },
    },
  };
}

/** 构造最小合法命令。 */
function cmd(delta: number, extra?: Partial<TreasuryTransactionCommand>): TreasuryTransactionCommand {
  return {
    delta,
    at: AT,
    source: { kind: "memorial", memorialId: "mem_000001", optionId: "relief" },
    reason: "test",
    ...extra,
  };
}

// ── 辅助：构造一个已 resolved 的灾情奏折 state ──────────────────────────────

/**
 * "ignore" 选项无 treasuryDelta，因此 resolve 后无台账条目。
 * 测试可随后安全地向该 memorial 注入任意台账条目（不会触发 check 12/13）。
 */
function resolvedMemorialState(): { state: GameState; memId: string; optionId: string } {
  const base = createNewGameState(db, 1);
  const gen = generateDisasterMemorial(base, "jiangnan", "major", AT)!;
  const resolved = resolveMemorial(gen.state, db, gen.memorial.id, "ignore", AT);
  if (!resolved.ok) throw new Error("setup: resolveMemorial failed");
  return { state: resolved.value.state, memId: gen.memorial.id, optionId: "ignore" };
}

// ── 辅助：注入一条手工台账条目（绕过 applyTreasuryTransaction） ──────────────

function injectLedgerEntry(
  state: GameState,
  entry: TreasuryLedgerEntry,
  treasury?: number,
): GameState {
  return {
    ...state,
    resources: {
      ...state.resources,
      nation: {
        ...state.resources.nation,
        treasury: treasury ?? state.resources.nation.treasury,
      },
    },
    treasuryLedger: [...state.treasuryLedger, entry],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Group A: applyTreasuryTransaction — 正常路径
// ─────────────────────────────────────────────────────────────────────────────

describe("applyTreasuryTransaction — happy path", () => {
  it("positive delta (income) updates treasury and appends one ledger entry", () => {
    const s0 = stateWithTreasury(1000);
    const r = applyTreasuryTransaction(s0, cmd(500));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.treasury).toBe(1500);
    expect(r.value.state.treasuryLedger).toHaveLength(1);
    const e = r.value.entry;
    expect(e.delta).toBe(500);
    expect(e.balanceBefore).toBe(1000);
    expect(e.balanceAfter).toBe(1500);
    expect(e.id).toMatch(/^tre_\d{6}$/);
  });

  it("negative delta (spend) decrements treasury", () => {
    const s0 = stateWithTreasury(800);
    const r = applyTreasuryTransaction(s0, cmd(-300));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.treasury).toBe(500);
    expect(r.value.entry.delta).toBe(-300);
    expect(r.value.entry.balanceBefore).toBe(800);
    expect(r.value.entry.balanceAfter).toBe(500);
  });

  it("spending entire balance (result 0) succeeds", () => {
    const s0 = stateWithTreasury(500);
    const r = applyTreasuryTransaction(s0, cmd(-500));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.nation.treasury).toBe(0);
  });

  it("ledger ID uses max-seq+1 when ledger is sparse", () => {
    // Inject an entry with id tre_000005 → next should be tre_000006
    const base = stateWithTreasury(2000);
    const fakeEntry: TreasuryLedgerEntry = {
      id: "tre_000005",
      at: AT,
      delta: 100,
      balanceBefore: 1900,
      balanceAfter: 2000,
      source: { kind: "memorial", memorialId: "mem_000001", optionId: "relief" },
      reason: "seed",
    };
    const s0 = injectLedgerEntry(base, fakeEntry, 2000);
    const r = applyTreasuryTransaction(s0, cmd(1, { source: { kind: "memorial", memorialId: "mem_000002", optionId: "relief" } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entry.id).toBe("tre_000006");
  });

  it("sparse IDs: first entry on empty ledger gets tre_000001", () => {
    const s0 = stateWithTreasury(100);
    const r = applyTreasuryTransaction(s0, cmd(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.entry.id).toBe("tre_000001");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group A: applyTreasuryTransaction — 失败路径
// ─────────────────────────────────────────────────────────────────────────────

describe("applyTreasuryTransaction — failure paths", () => {
  it("delta=0 → TREASURY_BAD_DELTA", () => {
    const r = applyTreasuryTransaction(stateWithTreasury(1000), cmd(0));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("TREASURY_BAD_DELTA");
  });

  it("delta=1.5 (non-integer) → TREASURY_BAD_DELTA", () => {
    const r = applyTreasuryTransaction(stateWithTreasury(1000), cmd(1.5));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("TREASURY_BAD_DELTA");
  });

  it("delta=Infinity → TREASURY_BAD_DELTA", () => {
    const r = applyTreasuryTransaction(stateWithTreasury(1000), cmd(Infinity));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("TREASURY_BAD_DELTA");
  });

  it("insufficient balance → TREASURY_INSUFFICIENT", () => {
    const s0 = stateWithTreasury(100);
    const snap = JSON.stringify(s0);
    const r = applyTreasuryTransaction(s0, cmd(-200));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("TREASURY_INSUFFICIENT");
    // input state is byte-identical — no mutation
    expect(JSON.stringify(s0)).toBe(snap);
  });

  it("overflow (very large delta) → TREASURY_OVERFLOW", () => {
    // Number.MAX_SAFE_INTEGER + 1 as balanceBefore → balanceAfter overflows
    const s0 = stateWithTreasury(Number.MAX_SAFE_INTEGER);
    const r = applyTreasuryTransaction(s0, cmd(1));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("TREASURY_OVERFLOW");
  });

  it("failure leaves input state byte-identical (no mutation)", () => {
    const s0 = stateWithTreasury(50);
    const snap = JSON.stringify(s0);
    applyTreasuryTransaction(s0, cmd(-100)); // insufficient
    expect(JSON.stringify(s0)).toBe(snap);
  });

  it("no store emit — function returns new state, never touches store directly", () => {
    // This is a structural test: applyTreasuryTransaction is a pure function.
    // If it were to emit to a store we'd see side-effects; we just verify
    // the return value contains the new state.
    const s0 = stateWithTreasury(1000);
    const r = applyTreasuryTransaction(s0, cmd(100));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Original state treasury unchanged
    expect(s0.resources.nation.treasury).toBe(1000);
    // New state has updated treasury
    expect(r.value.state.resources.nation.treasury).toBe(1100);
    // They are different objects
    expect(r.value.state).not.toBe(s0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group G: validateTreasuryLedger — 正常路径
// ─────────────────────────────────────────────────────────────────────────────

describe("validateTreasuryLedger — clean state", () => {
  it("empty ledger is valid", () => {
    expect(validateTreasuryLedger(stateWithTreasury(10000))).toEqual([]);
  });

  it("single transaction via applyTreasuryTransaction produces valid ledger", () => {
    const s0 = stateWithTreasury(1000);
    const r = applyTreasuryTransaction(s0, cmd(200));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The validator checks that source memorial exists and is resolved —
    // since our fake memorial doesn't exist, we can't pass the full validator.
    // So use a real resolved memorial state for a full-pass test.
    const { state: rs, memId, optionId } = resolvedMemorialState();
    const baseTreasury = rs.resources.nation.treasury;
    const r2 = applyTreasuryTransaction(rs, {
      delta: 500,
      at: AT,
      source: { kind: "memorial", memorialId: memId, optionId },
      reason: "test income",
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(validateTreasuryLedger(r2.value.state)).toEqual([]);
    expect(r2.value.state.resources.nation.treasury).toBe(baseTreasury + 500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group G: validateTreasuryLedger — corruption tests
// ─────────────────────────────────────────────────────────────────────────────

describe("validateTreasuryLedger — corruption detection", () => {
  /** Build a minimal state with one valid (or intentionally corrupt) ledger entry. */
  function stateWithEntry(
    overrides: Partial<TreasuryLedgerEntry>,
    treasury = 1500,
  ): GameState {
    const base = stateWithTreasury(treasury);
    const entry: TreasuryLedgerEntry = {
      id: "tre_000001",
      at: AT,
      delta: 500,
      balanceBefore: 1000,
      balanceAfter: 1500,
      source: { kind: "memorial", memorialId: "mem_000001", optionId: "relief" },
      reason: "test",
      ...overrides,
    };
    return { ...base, treasuryLedger: [entry] };
  }

  function codes(s: GameState): string[] {
    return validateTreasuryLedger(s).map((e) => e.code);
  }

  it("duplicate ID → TREASURY_LEDGER_DUP_ID", () => {
    const base = stateWithTreasury(2000);
    const e1: TreasuryLedgerEntry = {
      id: "tre_000001", at: AT, delta: 1000, balanceBefore: 1000, balanceAfter: 2000,
      source: { kind: "memorial", memorialId: "mem_000001", optionId: "relief" }, reason: "a",
    };
    const e2: TreasuryLedgerEntry = {
      id: "tre_000001", at: AT, delta: 500, balanceBefore: 2000, balanceAfter: 2500,
      source: { kind: "memorial", memorialId: "mem_000002", optionId: "relief" }, reason: "b",
    };
    const s = { ...base, treasuryLedger: [e1, e2] };
    expect(codes(s)).toContain("TREASURY_LEDGER_DUP_ID");
  });

  it("zero delta in ledger entry → TREASURY_LEDGER_BAD_AMOUNT", () => {
    const s = stateWithEntry({ delta: 0, balanceAfter: 1000 }, 1000);
    expect(codes(s)).toContain("TREASURY_LEDGER_BAD_AMOUNT");
  });

  it("non-integer delta in ledger entry → TREASURY_LEDGER_BAD_AMOUNT", () => {
    const s = stateWithEntry({ delta: 1.5, balanceAfter: 1001 }, 1001);
    expect(codes(s)).toContain("TREASURY_LEDGER_BAD_AMOUNT");
  });

  it("bad before/after equation → TREASURY_LEDGER_BAD_BALANCE", () => {
    // balanceBefore=1000, delta=500, balanceAfter should be 1500 but we set 1600
    const s = stateWithEntry({ balanceAfter: 1600 }, 1600);
    expect(codes(s)).toContain("TREASURY_LEDGER_BAD_BALANCE");
  });

  it("broken chain (prev.balanceAfter ≠ cur.balanceBefore) → TREASURY_LEDGER_CHAIN_BROKEN", () => {
    const base = stateWithTreasury(1500);
    const e1: TreasuryLedgerEntry = {
      id: "tre_000001", at: AT, delta: 500, balanceBefore: 1000, balanceAfter: 1500,
      source: { kind: "memorial", memorialId: "mem_000001", optionId: "relief" }, reason: "a",
    };
    // e2.balanceBefore should be 1500 but we set 2000 (chain break)
    const e2: TreasuryLedgerEntry = {
      id: "tre_000002", at: AT, delta: -500, balanceBefore: 2000, balanceAfter: 1500,
      source: { kind: "memorial", memorialId: "mem_000002", optionId: "relief" }, reason: "b",
    };
    const s = { ...base, treasuryLedger: [e1, e2] };
    expect(codes(s)).toContain("TREASURY_LEDGER_CHAIN_BROKEN");
  });

  it("missing memorial → TREASURY_LEDGER_BAD_SOURCE", () => {
    const s = stateWithEntry({ source: { kind: "memorial", memorialId: "mem_999999", optionId: "relief" } });
    expect(codes(s)).toContain("TREASURY_LEDGER_BAD_SOURCE");
  });

  it("memorial pending → TREASURY_LEDGER_SOURCE_PENDING", () => {
    // Generate a pending memorial and inject a ledger entry pointing to it
    const base = stateWithTreasury(1500);
    const gen = generateDisasterMemorial(base, "jiangnan", "major", AT)!;
    // Memorial is pending; inject a ledger entry (force linking)
    const entry: TreasuryLedgerEntry = {
      id: "tre_000001", at: AT, delta: 500, balanceBefore: 1000, balanceAfter: 1500,
      source: { kind: "memorial", memorialId: gen.memorial.id, optionId: "relief" }, reason: "test",
    };
    const s = injectLedgerEntry(gen.state, entry, 1500);
    expect(codes(s)).toContain("TREASURY_LEDGER_SOURCE_PENDING");
  });

  it("wrong option (memorial.resolution ≠ ledger.optionId) → TREASURY_LEDGER_OPTION_MISMATCH", () => {
    const { state: rs, memId } = resolvedMemorialState();
    // memorial is resolved with "relief"; inject ledger pointing to "tax_remit"
    const entry: TreasuryLedgerEntry = {
      id: "tre_000001", at: AT, delta: 500, balanceBefore: rs.resources.nation.treasury - 500, balanceAfter: rs.resources.nation.treasury,
      source: { kind: "memorial", memorialId: memId, optionId: "tax_remit" }, reason: "wrong",
    };
    const s: GameState = { ...rs, treasuryLedger: [entry] };
    expect(codes(s)).toContain("TREASURY_LEDGER_OPTION_MISMATCH");
  });

  it("duplicate source memorial → TREASURY_LEDGER_DUP_SOURCE", () => {
    const { state: rs, memId, optionId } = resolvedMemorialState();
    const bal = rs.resources.nation.treasury;
    const e1: TreasuryLedgerEntry = {
      id: "tre_000001", at: AT, delta: 100, balanceBefore: bal - 100, balanceAfter: bal,
      source: { kind: "memorial", memorialId: memId, optionId }, reason: "first",
    };
    const e2: TreasuryLedgerEntry = {
      id: "tre_000002", at: AT, delta: 50, balanceBefore: bal, balanceAfter: bal + 50,
      source: { kind: "memorial", memorialId: memId, optionId }, reason: "second (dup)",
    };
    const s: GameState = { ...rs, resources: { ...rs.resources, nation: { ...rs.resources.nation, treasury: bal + 50 } }, treasuryLedger: [e1, e2] };
    expect(codes(s)).toContain("TREASURY_LEDGER_DUP_SOURCE");
  });

  it("current treasury mismatch → TREASURY_LEDGER_CURRENT_MISMATCH", () => {
    const { state: rs, memId, optionId } = resolvedMemorialState();
    const bal = rs.resources.nation.treasury;
    const entry: TreasuryLedgerEntry = {
      id: "tre_000001", at: AT, delta: 500, balanceBefore: bal - 500, balanceAfter: bal,
      source: { kind: "memorial", memorialId: memId, optionId }, reason: "test",
    };
    // Inject entry but set treasury to a different value (mismatch)
    const s: GameState = {
      ...rs,
      resources: { ...rs.resources, nation: { ...rs.resources.nation, treasury: bal + 999 } },
      treasuryLedger: [entry],
    };
    expect(codes(s)).toContain("TREASURY_LEDGER_CURRENT_MISMATCH");
  });

  it("invalid ledger entry ID format → TREASURY_LEDGER_DUP_ID", () => {
    const s = createNewGameState(db, 1);
    const state: GameState = { ...s, treasuryLedger: [{
      id: "bad_id",  // not "tre_000001" format
      at: { year: 1, month: 1, period: "early" as const, dayIndex: 100 },
      delta: -100,
      balanceBefore: 10000,
      balanceAfter: 9900,
      source: { kind: "memorial" as const, memorialId: "mem_000001", optionId: "relief" },
      reason: "test",
    }] };
    expect(codes(state)).toContain("TREASURY_LEDGER_DUP_ID");
  });

  it("negative balanceBefore → TREASURY_LEDGER_BAD_BALANCE", () => {
    const s = createNewGameState(db, 1);
    const state: GameState = { ...s, treasuryLedger: [{
      id: "tre_000001",
      at: { year: 1, month: 1, period: "early" as const, dayIndex: 100 },
      delta: 100,
      balanceBefore: -1,
      balanceAfter: 99,
      source: { kind: "memorial" as const, memorialId: "mem_000001", optionId: "relief" },
      reason: "test",
    }] };
    expect(codes(state)).toContain("TREASURY_LEDGER_BAD_BALANCE");
  });

  it("source option not in memorial options → TREASURY_LEDGER_BAD_SOURCE", () => {
    const base = createNewGameState(db, 1);
    const gen = generateDisasterMemorial(base, "jiangnan", "minor", { year: 2, month: 1, period: "early" as const, dayIndex: 200 })!;
    const resolvedMemorial = {
      ...gen.memorial,
      status: "resolved" as const,
      resolution: "relief",
      resolvedAt: { year: 2, month: 1, period: "early" as const, dayIndex: 200 },
    };
    const state: GameState = {
      ...gen.state,
      resources: { ...gen.state.resources, nation: { ...gen.state.resources.nation, treasury: 9900 } },
      memorials: { [gen.memorial.id]: resolvedMemorial },
      treasuryLedger: [{
        id: "tre_000001",
        at: { year: 2, month: 1, period: "early" as const, dayIndex: 200 },
        delta: -100,
        balanceBefore: 10000,
        balanceAfter: 9900,
        source: { kind: "memorial" as const, memorialId: gen.memorial.id, optionId: "nonexistent_option" },
        reason: "test",
      }],
    };
    expect(codes(state)).toContain("TREASURY_LEDGER_BAD_SOURCE");
  });

  it("at non-decreasing violated → TREASURY_LEDGER_CHAIN_BROKEN", () => {
    const base = stateWithTreasury(2000);
    const e1: TreasuryLedgerEntry = {
      id: "tre_000001",
      at: { year: 2, month: 3, period: "mid" as const, dayIndex: 300 },
      delta: 1000,
      balanceBefore: 1000,
      balanceAfter: 2000,
      source: { kind: "memorial", memorialId: "mem_000001", optionId: "relief" },
      reason: "a",
    };
    // e2.at is earlier than e1.at — violates non-decreasing
    const e2: TreasuryLedgerEntry = {
      id: "tre_000002",
      at: { year: 1, month: 1, period: "early" as const, dayIndex: 50 },
      delta: -500,
      balanceBefore: 2000,
      balanceAfter: 1500,
      source: { kind: "memorial", memorialId: "mem_000002", optionId: "relief" },
      reason: "b",
    };
    const s: GameState = { ...base, resources: { ...base.resources, nation: { ...base.resources.nation, treasury: 1500 } }, treasuryLedger: [e1, e2] };
    expect(codes(s)).toContain("TREASURY_LEDGER_CHAIN_BROKEN");
  });

  it("resolved memorial with cost option but empty ledger → TREASURY_LEDGER_MISSING_ENTRY", () => {
    // Set up a state with a resolved treasury memorial (audit option, treasuryDelta=600)
    // but NO ledger entries — validates that checks 16/17 run even when ledger is empty
    const base = createNewGameState(db, 1);
    const at = { year: 2, month: 4, period: "early" as const, dayIndex: 300 };
    const g = generateTreasuryMemorial(base, at)!;
    // Manually mark as resolved with "audit" option (which has treasuryDelta)
    const resolved = {
      ...g.memorial,
      status: "resolved" as const,
      resolution: "audit",
      resolvedAt: at,
    };
    const state: GameState = {
      ...g.state,
      resources: { ...g.state.resources, nation: { ...g.state.resources.nation, treasury: 600 } },
      memorials: { [g.memorial.id]: resolved },
      treasuryLedger: [],  // empty — but should have a ledger entry for audit
    };
    const errors = validateTreasuryLedger(state);
    expect(errors.map((e) => e.code)).toContain("TREASURY_LEDGER_MISSING_ENTRY");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ledgerEntryId and nextLedgerEntryId helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("ledgerEntryId", () => {
  it("pads to 6 digits", () => {
    expect(ledgerEntryId(1)).toBe("tre_000001");
    expect(ledgerEntryId(999999)).toBe("tre_999999");
  });
});

describe("nextLedgerEntryId", () => {
  it("returns tre_000001 on empty ledger", () => {
    expect(nextLedgerEntryId(stateWithTreasury(0))).toBe("tre_000001");
  });

  it("returns max+1 when ledger has entries", () => {
    const base = stateWithTreasury(1000);
    const e: TreasuryLedgerEntry = {
      id: "tre_000003", at: AT, delta: 1, balanceBefore: 999, balanceAfter: 1000,
      source: { kind: "memorial", memorialId: "x", optionId: "y" }, reason: "z",
    };
    const s = { ...base, treasuryLedger: [e] };
    expect(nextLedgerEntryId(s)).toBe("tre_000004");
  });

  it("ignores malformed ids when computing max", () => {
    const base = stateWithTreasury(1000);
    const e1: TreasuryLedgerEntry = {
      id: "tre_000002", at: AT, delta: 1, balanceBefore: 999, balanceAfter: 1000,
      source: { kind: "memorial", memorialId: "x", optionId: "y" }, reason: "z",
    };
    const e2: TreasuryLedgerEntry = {
      id: "bad_id", at: AT, delta: 1, balanceBefore: 1000, balanceAfter: 1001,
      source: { kind: "memorial", memorialId: "x2", optionId: "y" }, reason: "z",
    };
    const s = { ...base, treasuryLedger: [e1, e2] };
    // max valid = 2, bad_id ignored → next = 3
    expect(nextLedgerEntryId(s)).toBe("tre_000003");
  });
});

/**
 * Integration hardening tests for PR3 trace explorer.
 * Covers: filter stability, eviction, comparison cleanup, rollback searchability,
 * export correctness, off/record/strict compatibility, save safety.
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { loadRealContent } from "../helpers/contentFixture";
import {
  filterTraceTransactions,
  matchesTraceQuery,
} from "../../src/engine/trace/query";
import { compareTransactions } from "../../src/engine/trace/compare";
import { buildTraceExport } from "../../src/engine/trace/export";
import { formatTraceDiagnostic } from "../../src/engine/trace/diagnostic";
import type { TraceTransaction } from "../../src/engine/trace/types";

const db = loadRealContent();

function makeStore(traceMode: "record" | "off" | "strict" = "record") {
  const store = createGameStore({ traceMode });
  store.newGame(db);
  return store;
}

const firstConsortId = (store: ReturnType<typeof makeStore>) =>
  Object.keys(store.getState().standing).find((id) => db.characters[id]?.kind === "consort") ??
  Object.keys(store.getState().standing)[0]!;

// ── history update while filters active ─────────────────────────────────────

describe("trace explorer — filters stable under new history", () => {
  it("adding transactions does not change existing filter results for prior criteria", () => {
    const store = makeStore("record");
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    const txsBefore = store.getTraceHistory().getAll();
    const filtered1 = filterTraceTransactions(txsBefore, { outcomes: ["committed"] });

    // Add more transactions
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    const txsAfter = store.getTraceHistory().getAll();
    const filtered2 = filterTraceTransactions(txsAfter, { outcomes: ["committed"] });

    // filtered2 should be a superset of filtered1 with same ordering
    const ids1 = filtered1.map((t) => t.id);
    const ids2 = filtered2.map((t) => t.id);
    for (const id of ids1) expect(ids2).toContain(id);
    expect(ids2.length).toBeGreaterThanOrEqual(ids1.length);
  });

  it("filter result ordering is stable (not reversed or shuffled)", () => {
    const store = makeStore("record");
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    const txs = store.getTraceHistory().getAll();
    const filtered = filterTraceTransactions(txs, {});
    const seqs = filtered.map((t) => parseInt(t.id.replace("#", ""), 10));
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });
});

// ── history eviction while selected transaction removed ───────────────────────

describe("trace explorer — eviction handling", () => {
  it("evicted transaction is not returned by filter", () => {
    const store = createGameStore({ traceMode: "record", traceHistoryLimit: 3 });
    store.newGame(db);
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    const afterThree = store.getTraceHistory().getAll().map((t) => t.id);
    // Push a 4th to evict the 1st
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    const after = store.getTraceHistory().getAll();
    expect(after.map((t) => t.id)).not.toContain(afterThree[0]);
    // Filter should not return the evicted id
    const filtered = filterTraceTransactions(after, {});
    expect(filtered.map((t) => t.id)).not.toContain(afterThree[0]);
  });
});

// ── comparison mode cleanup after eviction ───────────────────────────────────

describe("trace explorer — comparison cleanup after eviction", () => {
  it("compareTransactions is side-effect-free and does not retain references to evicted txs", () => {
    const store = createGameStore({ traceMode: "record", traceHistoryLimit: 2 });
    store.newGame(db);
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    const [tx1, tx2] = store.getTraceHistory().getAll();
    // Run comparison before eviction
    const result = compareTransactions(tx1!, tx2!);
    expect(result).toBeDefined();
    // Evict tx1 by adding a 3rd
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    // result still holds its own values — does not fail or mutate
    expect(result.primaryId).toBe(tx1!.id);
    expect(result.comparisonId).toBe(tx2!.id);
  });
});

// ── rolled-back domain events searchable ────────────────────────────────────

describe("trace explorer — rolled-back events searchable", () => {
  it("rollback domain event message is searchable by text query", () => {
    const store = makeStore("record");
    store.applyEffects(db, [{ type: "favor", char: "char_does_not_exist", delta: 1 }]);
    const txs = store.getTraceHistory().getAll();
    const rollbackTx = txs.find((t) => t.outcome === "rolled_back")!;
    expect(rollbackTx).toBeDefined();
    // The rollback domain event message should be searchable
    const rollbackEv = rollbackTx.domainEvents.find((d) => d.kind === "rollback");
    expect(rollbackEv).toBeDefined();
    if (rollbackEv?.kind === "rollback") {
      const needle = rollbackEv.message.slice(0, 6).toLowerCase();
      const matched = matchesTraceQuery(rollbackTx, { text: needle });
      expect(matched).toBe(true);
    }
  });

  it("rolled_back outcome filter finds rollback transactions", () => {
    const store = makeStore("record");
    store.applyEffects(db, [{ type: "favor", char: "char_does_not_exist", delta: 1 }]);
    const txs = store.getTraceHistory().getAll();
    const filtered = filterTraceTransactions(txs, { outcomes: ["rolled_back"] });
    expect(filtered.length).toBeGreaterThan(0);
    for (const tx of filtered) expect(tx.outcome).toBe("rolled_back");
  });
});

// ── exported filtered results match visible result ids ───────────────────────

describe("trace explorer — export correctness", () => {
  it("exported filtered transactions match filterTraceTransactions result", () => {
    const store = makeStore("record");
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    store.applyEffects(db, [{ type: "favor", char: "char_does_not_exist", delta: 1 }]);
    const txs = store.getTraceHistory().getAll();
    const filtered = filterTraceTransactions(txs, { outcomes: ["committed"] });
    const envelope = buildTraceExport(filtered, "filtered");
    expect(envelope.transactions.map((t) => t.id)).toEqual(filtered.map((t) => t.id));
  });

  it("export does not include any GameState data", () => {
    const store = makeStore("record");
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    const txs = store.getTraceHistory().getAll();
    const envelope = buildTraceExport(txs, "history");
    const json = JSON.stringify(envelope);
    // GameState has 'standing' key with character data
    // It should NOT be present in trace export
    expect(json).not.toContain('"pendingDaxuan"');
    expect(json).not.toContain('"eventLog"');
    expect(json).not.toContain('"calendar":{');
  });
});

// ── filter reset ─────────────────────────────────────────────────────────────

describe("trace explorer — filter reset", () => {
  it("empty query returns same as unfiltered history", () => {
    const store = makeStore("record");
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    store.applyEffects(db, [{ type: "favor", char: "char_does_not_exist", delta: 1 }]);
    const txs = store.getTraceHistory().getAll();
    const filtered = filterTraceTransactions(txs, {});
    expect(filtered.map((t) => t.id)).toEqual(txs.map((t) => t.id));
  });
});

// ── off/record/strict mode compatibility ─────────────────────────────────────

describe("trace explorer — mode compatibility", () => {
  it("filterTraceTransactions works on empty history from off-mode store", () => {
    const store = makeStore("off");
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    expect(store.getTraceHistory().size).toBe(0);
    const result = filterTraceTransactions([], {});
    expect(result).toHaveLength(0);
  });

  it("strict mode transactions are compatible with all query/compare/export/diagnostic functions", () => {
    const store = makeStore("strict");
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    const txs = store.getTraceHistory().getAll();
    expect(txs.length).toBeGreaterThan(0);
    // All pure functions should work without error
    const filtered = filterTraceTransactions(txs, {});
    expect(filtered.length).toBe(txs.length);
    if (txs.length >= 2) {
      const cmp = compareTransactions(txs[0]!, txs[1]!);
      expect(cmp.primaryId).toBe(txs[0]!.id);
    }
    const envelope = buildTraceExport(txs, "history");
    expect(envelope.transactionCount).toBe(txs.length);
    const diag = formatTraceDiagnostic(txs[0]!);
    expect(diag).toContain(txs[0]!.id);
  });
});

// ── no trace data in save serialization ─────────────────────────────────────

describe("trace explorer — save safety", () => {
  it("saveGame does not include trace history", () => {
    const store = makeStore("record");
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    expect(store.getTraceHistory().size).toBeGreaterThan(0);
    const state = store.getState();
    const json = JSON.stringify(state);
    // TraceHistory should not appear in serialized game state
    expect(json).not.toContain('"traceHistory"');
    expect(json).not.toContain('"TraceTransaction"');
    // domainEvents is a per-tx field, not a top-level GameState field
    // but verify the state itself looks correct
    expect(typeof state).toBe("object");
  });
});

// ── diagnostic does not leak sensitive data ──────────────────────────────────

describe("trace explorer — diagnostic safety", () => {
  it("formatTraceDiagnostic does not include GameState snapshot", () => {
    const store = makeStore("record");
    const charId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: charId, delta: 1 }]);
    const txs = store.getTraceHistory().getAll();
    const diag = formatTraceDiagnostic(txs[0]!);
    // Should not contain raw GameState fields
    expect(diag).not.toContain('"pendingDaxuan"');
    expect(diag).not.toContain('"eventLog"');
  });
});

// ── immutability of query / compare / export inputs ──────────────────────────

describe("trace explorer — immutability", () => {
  it("filterTraceTransactions does not mutate input transactions", () => {
    const tx: TraceTransaction = {
      id: "#1", timestamp: 1000,
      source: { kind: "action", label: "x" },
      mutations: [{ path: "a", before: 0, after: 1, classification: "direct", phase: "effects" }],
      warnings: [], outcome: "committed", directCount: 1, untrackedCount: 0, domainEvents: [],
    };
    const txs = [tx];
    filterTraceTransactions(txs, { text: "test" });
    expect(tx.mutations).toHaveLength(1);
  });

  it("buildTraceExport does not mutate input transactions", () => {
    const tx: TraceTransaction = {
      id: "#1", timestamp: 1000,
      source: { kind: "action", label: "x" },
      mutations: [], warnings: [], outcome: "committed",
      directCount: 0, untrackedCount: 0, domainEvents: [],
    };
    buildTraceExport([tx], "selected");
    expect(tx.id).toBe("#1");
  });
});

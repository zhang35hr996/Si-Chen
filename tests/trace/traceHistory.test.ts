import { describe, expect, it } from "vitest";
import { TraceHistory } from "../../src/engine/trace/history";
import type { TraceTransaction } from "../../src/engine/trace/types";

function makeTx(id: string): TraceTransaction {
  return {
    id,
    timestamp: Date.now(),
    source: { kind: "action", label: "test" },
    mutations: [],
    warnings: [],
    outcome: "committed",
    directCount: 0,
    untrackedCount: 0,
  };
}

describe("TraceHistory", () => {
  it("stores and retrieves transactions in insertion order", () => {
    const h = new TraceHistory();
    const tx1 = makeTx("#1");
    const tx2 = makeTx("#2");
    h.push(tx1);
    h.push(tx2);
    expect(h.getAll()).toEqual([tx1, tx2]);
    expect(h.size).toBe(2);
  });

  it("evicts oldest when limit is exceeded (ring buffer)", () => {
    const h = new TraceHistory(3);
    h.push(makeTx("#1"));
    h.push(makeTx("#2"));
    h.push(makeTx("#3"));
    h.push(makeTx("#4")); // evicts #1
    const ids = h.getAll().map((t) => t.id);
    expect(ids).toEqual(["#2", "#3", "#4"]);
    expect(h.size).toBe(3);
  });

  it("generates monotonically increasing nextId", () => {
    const h = new TraceHistory();
    expect(h.nextId()).toBe("#1");
    expect(h.nextId()).toBe("#2");
    expect(h.nextId()).toBe("#3");
  });

  it("clear() empties the ring buffer", () => {
    const h = new TraceHistory();
    h.push(makeTx("#1"));
    h.clear();
    expect(h.size).toBe(0);
    expect(h.getAll()).toHaveLength(0);
  });
});

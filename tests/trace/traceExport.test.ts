import { describe, expect, it } from "vitest";
import { buildTraceExport, buildExportFilename, serializeTraceExport } from "../../src/engine/trace/export";
import type { TraceTransaction } from "../../src/engine/trace/types";

function makeTx(overrides: Partial<TraceTransaction> = {}): TraceTransaction {
  return {
    id: "#1",
    timestamp: 1000,
    source: { kind: "action", sourceId: "applyEffects", label: "applyEffects" },
    mutations: [],
    warnings: [],
    outcome: "committed",
    directCount: 0,
    untrackedCount: 0,
    domainEvents: [],
    ...overrides,
  };
}

// ── selected export ──────────────────────────────────────────────────────────

describe("buildTraceExport — selected", () => {
  it("produces scope=selected with one transaction", () => {
    const tx = makeTx({ id: "#3" });
    const env = buildTraceExport([tx], "selected");
    expect(env.scope).toBe("selected");
    expect(env.transactionCount).toBe(1);
    expect(env.transactions).toHaveLength(1);
    expect(env.transactions[0]?.id).toBe("#3");
  });
});

// ── filtered export ──────────────────────────────────────────────────────────

describe("buildTraceExport — filtered", () => {
  it("exports all supplied transactions as filtered", () => {
    const txs = [makeTx({ id: "#1" }), makeTx({ id: "#2" }), makeTx({ id: "#3" })];
    const env = buildTraceExport(txs, "filtered");
    expect(env.scope).toBe("filtered");
    expect(env.transactionCount).toBe(3);
    expect(env.transactions.map((t) => t.id)).toEqual(["#1", "#2", "#3"]);
  });
});

// ── history export ───────────────────────────────────────────────────────────

describe("buildTraceExport — history", () => {
  it("exports all transactions with scope=history", () => {
    const txs = [makeTx({ id: "#1" }), makeTx({ id: "#2" })];
    const env = buildTraceExport(txs, "history");
    expect(env.scope).toBe("history");
    expect(env.transactionCount).toBe(2);
  });
});

// ── stable ordering ──────────────────────────────────────────────────────────

describe("buildTraceExport — stable ordering", () => {
  it("preserves input order", () => {
    const txs = ["#5", "#2", "#8"].map((id) => makeTx({ id }));
    const env = buildTraceExport(txs, "history");
    expect(env.transactions.map((t) => t.id)).toEqual(["#5", "#2", "#8"]);
  });
});

// ── schemaVersion ────────────────────────────────────────────────────────────

describe("buildTraceExport — schemaVersion", () => {
  it("always sets schemaVersion to 1", () => {
    const env = buildTraceExport([makeTx()], "selected");
    expect(env.schemaVersion).toBe(1);
  });

  it("sets exportedAt to an ISO string", () => {
    const env = buildTraceExport([], "history");
    expect(() => new Date(env.exportedAt)).not.toThrow();
    expect(env.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ── no state/save data ───────────────────────────────────────────────────────

describe("buildTraceExport — safety", () => {
  it("does not include any field beyond trace data", () => {
    const env = buildTraceExport([makeTx()], "selected");
    const keys = Object.keys(env);
    expect(keys).toEqual(["schemaVersion", "exportedAt", "scope", "transactionCount", "transactions"]);
  });

  it("transactions have expected fields only", () => {
    const env = buildTraceExport([makeTx()], "selected");
    const tx = env.transactions[0]!;
    expect("id" in tx).toBe(true);
    expect("mutations" in tx).toBe(true);
    expect("domainEvents" in tx).toBe(true);
    // No GameState references
    expect("state" in tx).toBe(false);
    expect("gameState" in tx).toBe(false);
  });
});

// ── nested domain event arrays ───────────────────────────────────────────────

describe("buildTraceExport — domain events", () => {
  it("preserves domain events in exported transactions", () => {
    const tx = makeTx({
      domainEvents: [
        { kind: "memory", operation: "created", ownerId: "lu", entryId: "e1", phase: "effects" },
        { kind: "rollback", failedPhase: "effects", message: "err", attemptedMutationCount: 0, attemptedDomainEventCount: 0, phase: "effects" },
      ],
    });
    const env = buildTraceExport([tx], "selected");
    expect(env.transactions[0]?.domainEvents).toHaveLength(2);
    expect(env.transactions[0]?.domainEvents[0]?.kind).toBe("memory");
    expect(env.transactions[0]?.domainEvents[1]?.kind).toBe("rollback");
  });
});

// ── rollback transactions ────────────────────────────────────────────────────

describe("buildTraceExport — rollback transactions", () => {
  it("exports rolled_back transactions with error field", () => {
    const tx = makeTx({ outcome: "rolled_back", error: "char not found" });
    const env = buildTraceExport([tx], "selected");
    expect(env.transactions[0]?.outcome).toBe("rolled_back");
    expect(env.transactions[0]?.error).toBe("char not found");
  });
});

// ── special strings and undefined fields ─────────────────────────────────────

describe("buildTraceExport — undefined handling", () => {
  it("omits undefined optional fields in mutations", () => {
    const tx = makeTx({
      mutations: [{
        path: "x.favor", before: 0, after: 5, delta: 5,
        classification: "direct", phase: "effects",
        // effectType, effectIndex, reason are undefined
      }],
    });
    const env = buildTraceExport([tx], "selected");
    const mut = env.transactions[0]?.mutations[0]!;
    expect("effectType" in mut).toBe(false);
    expect("effectIndex" in mut).toBe(false);
    expect("reason" in mut).toBe(false);
    expect(mut.path).toBe("x.favor");
  });

  it("converts undefined mutation values to null", () => {
    const tx = makeTx({
      mutations: [{
        path: "x", before: undefined, after: undefined,
        classification: "untracked", phase: "boundary",
      }],
    });
    const env = buildTraceExport([tx], "selected");
    expect(env.transactions[0]?.mutations[0]?.before).toBeNull();
    expect(env.transactions[0]?.mutations[0]?.after).toBeNull();
  });
});

// ── input immutability ───────────────────────────────────────────────────────

describe("buildTraceExport — immutability", () => {
  it("does not mutate the input transactions array", () => {
    const txs = [makeTx({ id: "#1" }), makeTx({ id: "#2" })];
    const snapshot = txs.map((t) => ({ ...t }));
    buildTraceExport(txs, "history");
    expect(txs[0]?.id).toBe(snapshot[0]?.id);
    expect(txs[1]?.id).toBe(snapshot[1]?.id);
  });
});

// ── serializeTraceExport ──────────────────────────────────────────────────────

describe("serializeTraceExport", () => {
  it("produces valid JSON", () => {
    const env = buildTraceExport([makeTx()], "selected");
    const json = serializeTraceExport(env);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as typeof env;
    expect(parsed.schemaVersion).toBe(1);
  });
});

// ── buildExportFilename ───────────────────────────────────────────────────────

describe("buildExportFilename", () => {
  it("includes scope in filename", () => {
    const name = buildExportFilename("selected", new Date("2026-01-15T10:30:00Z"));
    expect(name).toContain("selected");
    expect(name).toMatch(/^si-chen-trace-/);
    expect(name).toMatch(/\.json$/);
  });

  it("produces deterministic filename for same timestamp", () => {
    const d = new Date("2026-01-15T10:30:00Z");
    expect(buildExportFilename("filtered", d)).toBe(buildExportFilename("filtered", d));
  });
});

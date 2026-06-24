import { describe, expect, it } from "vitest";
import {
  collectTraceFacets,
  filterTraceTransactions,
  matchesTraceQuery,
} from "../../src/engine/trace/query";
import type { TraceQuery } from "../../src/engine/trace/query";
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

// ── empty query ──────────────────────────────────────────────────────────────

describe("matchesTraceQuery — empty query", () => {
  it("matches any transaction when query is empty", () => {
    const tx = makeTx();
    expect(matchesTraceQuery(tx, {})).toBe(true);
  });

  it("matches rolled_back transactions with empty query", () => {
    const tx = makeTx({ outcome: "rolled_back" });
    expect(matchesTraceQuery(tx, {})).toBe(true);
  });
});

// ── text normalization ───────────────────────────────────────────────────────

describe("matchesTraceQuery — text search", () => {
  it("matches case-insensitively", () => {
    const tx = makeTx({ source: { kind: "action", label: "MyLabel" } });
    expect(matchesTraceQuery(tx, { text: "mylabel" })).toBe(true);
    expect(matchesTraceQuery(tx, { text: "MYLABEL" })).toBe(true);
  });

  it("blank text means no restriction", () => {
    const tx = makeTx({ source: { kind: "action", label: "anything" } });
    expect(matchesTraceQuery(tx, { text: "" })).toBe(true);
    expect(matchesTraceQuery(tx, { text: "   " })).toBe(true);
  });

  it("non-matching text returns false", () => {
    const tx = makeTx({ source: { kind: "action", label: "favor" } });
    expect(matchesTraceQuery(tx, { text: "zzznomatch" })).toBe(false);
  });

  it("searches mutation path", () => {
    const tx = makeTx({
      mutations: [{
        path: "standing.guQingchu.favor",
        before: 10, after: 15, delta: 5,
        classification: "direct", phase: "effects",
      }],
    });
    expect(matchesTraceQuery(tx, { text: "guqingchu" })).toBe(true);
  });

  it("searches mutation reason", () => {
    const tx = makeTx({
      mutations: [{
        path: "standing.x.favor",
        before: 0, after: 5, delta: 5,
        classification: "direct", phase: "effects",
        reason: "favor capped from +10",
      }],
    });
    expect(matchesTraceQuery(tx, { text: "capped" })).toBe(true);
  });

  it("searches domain event fields — rollback message", () => {
    const tx = makeTx({
      domainEvents: [{
        kind: "rollback",
        failedPhase: "effects",
        message: "char not found: nobody",
        attemptedMutationCount: 0,
        attemptedDomainEventCount: 0,
        phase: "effects",
      }],
    });
    expect(matchesTraceQuery(tx, { text: "char not found" })).toBe(true);
    expect(matchesTraceQuery(tx, { text: "nobody" })).toBe(true);
  });

  it("searches memory domain event summary", () => {
    const tx = makeTx({
      domainEvents: [{
        kind: "memory",
        operation: "created",
        ownerId: "lu_huaijin",
        entryId: "mem_lu_huaijin_000001",
        summary: "test summary phrase",
        phase: "effects",
      }],
    });
    expect(matchesTraceQuery(tx, { text: "test summary" })).toBe(true);
  });

  it("searches source.sourceId", () => {
    const tx = makeTx({ source: { kind: "imperial_command", sourceId: "impose_confinement", label: "..." } });
    expect(matchesTraceQuery(tx, { text: "impose_confinement" })).toBe(true);
  });
});

// ── AND across categories ────────────────────────────────────────────────────

describe("matchesTraceQuery — AND across categories", () => {
  it("requires both outcome AND source kind to match", () => {
    const tx = makeTx({ outcome: "committed", source: { kind: "action", label: "x" } });
    expect(matchesTraceQuery(tx, { outcomes: ["committed"], sourceKinds: ["action"] })).toBe(true);
    expect(matchesTraceQuery(tx, { outcomes: ["rolled_back"], sourceKinds: ["action"] })).toBe(false);
    expect(matchesTraceQuery(tx, { outcomes: ["committed"], sourceKinds: ["event"] })).toBe(false);
  });

  it("requires text AND outcome to both match", () => {
    const tx = makeTx({ outcome: "rolled_back", source: { kind: "action", label: "roll" } });
    expect(matchesTraceQuery(tx, { text: "roll", outcomes: ["committed"] })).toBe(false);
    expect(matchesTraceQuery(tx, { text: "roll", outcomes: ["rolled_back"] })).toBe(true);
  });
});

// ── OR within a category ─────────────────────────────────────────────────────

describe("matchesTraceQuery — OR within category", () => {
  it("outcome OR: committed OR rolled_back passes either", () => {
    const committed = makeTx({ outcome: "committed" });
    const rolled = makeTx({ outcome: "rolled_back" });
    const q: TraceQuery = { outcomes: ["committed", "rolled_back"] };
    expect(matchesTraceQuery(committed, q)).toBe(true);
    expect(matchesTraceQuery(rolled, q)).toBe(true);
  });

  it("sourceKinds OR: event OR action passes either", () => {
    const event = makeTx({ source: { kind: "event", label: "e" } });
    const action = makeTx({ source: { kind: "action", label: "a" } });
    const q: TraceQuery = { sourceKinds: ["event", "action"] };
    expect(matchesTraceQuery(event, q)).toBe(true);
    expect(matchesTraceQuery(action, q)).toBe(true);
  });

  it("phases OR: a tx with one matching phase passes", () => {
    const tx = makeTx({
      mutations: [
        { path: "x", before: 0, after: 1, classification: "direct", phase: "effects" },
        { path: "y", before: 0, after: 1, classification: "scheduled", phase: "chronicle_append" },
      ],
    });
    expect(matchesTraceQuery(tx, { phases: ["effects"] })).toBe(true);
    expect(matchesTraceQuery(tx, { phases: ["chronicle_append"] })).toBe(true);
    expect(matchesTraceQuery(tx, { phases: ["settlement"] })).toBe(false);
  });
});

// ── committed/rolled_back filtering ─────────────────────────────────────────

describe("filterTraceTransactions — outcome filter", () => {
  it("filters to committed only", () => {
    const txs = [
      makeTx({ id: "#1", outcome: "committed" }),
      makeTx({ id: "#2", outcome: "rolled_back" }),
      makeTx({ id: "#3", outcome: "committed" }),
    ];
    const result = filterTraceTransactions(txs, { outcomes: ["committed"] });
    expect(result.map((t) => t.id)).toEqual(["#1", "#3"]);
  });

  it("filters to rolled_back only", () => {
    const txs = [
      makeTx({ id: "#1", outcome: "committed" }),
      makeTx({ id: "#2", outcome: "rolled_back" }),
    ];
    const result = filterTraceTransactions(txs, { outcomes: ["rolled_back"] });
    expect(result.map((t) => t.id)).toEqual(["#2"]);
  });
});

// ── source filtering ─────────────────────────────────────────────────────────

describe("filterTraceTransactions — source filters", () => {
  it("sourceKinds filter", () => {
    const txs = [
      makeTx({ id: "#1", source: { kind: "event", label: "e" } }),
      makeTx({ id: "#2", source: { kind: "action", label: "a" } }),
    ];
    expect(filterTraceTransactions(txs, { sourceKinds: ["event"] }).map((t) => t.id)).toEqual(["#1"]);
  });

  it("sourceIds filter", () => {
    const txs = [
      makeTx({ id: "#1", source: { kind: "event", sourceId: "ev_001", label: "e" } }),
      makeTx({ id: "#2", source: { kind: "event", sourceId: "ev_002", label: "e" } }),
    ];
    expect(filterTraceTransactions(txs, { sourceIds: ["ev_001"] }).map((t) => t.id)).toEqual(["#1"]);
  });
});

// ── phase filtering ──────────────────────────────────────────────────────────

describe("filterTraceTransactions — phase filter", () => {
  it("passes only transactions with a mutation in the specified phase", () => {
    const txs = [
      makeTx({ id: "#1", mutations: [{ path: "x", before: 0, after: 1, classification: "direct", phase: "effects" }] }),
      makeTx({ id: "#2", mutations: [{ path: "y", before: 0, after: 1, classification: "scheduled", phase: "advance" }] }),
    ];
    expect(filterTraceTransactions(txs, { phases: ["effects"] }).map((t) => t.id)).toEqual(["#1"]);
  });
});

// ── mutation classification filtering ───────────────────────────────────────

describe("filterTraceTransactions — classification filter", () => {
  it("passes only transactions with an untracked mutation", () => {
    const txs = [
      makeTx({ id: "#1", untrackedCount: 1, mutations: [{ path: "x", before: 0, after: 1, classification: "untracked", phase: "boundary" }] }),
      makeTx({ id: "#2", mutations: [{ path: "x", before: 0, after: 1, classification: "direct", phase: "effects" }] }),
    ];
    expect(filterTraceTransactions(txs, { mutationClassifications: ["untracked"] }).map((t) => t.id)).toEqual(["#1"]);
  });
});

// ── domain kind filtering ────────────────────────────────────────────────────

describe("filterTraceTransactions — domain kind filter", () => {
  it("passes only transactions with a rollback domain event", () => {
    const txs = [
      makeTx({
        id: "#1",
        outcome: "rolled_back",
        domainEvents: [{ kind: "rollback", failedPhase: "effects", message: "err", attemptedMutationCount: 0, attemptedDomainEventCount: 0, phase: "effects" }],
      }),
      makeTx({ id: "#2", outcome: "committed", domainEvents: [] }),
    ];
    expect(filterTraceTransactions(txs, { domainKinds: ["rollback"] }).map((t) => t.id)).toEqual(["#1"]);
  });

  it("passes transactions with memory or queue domain events", () => {
    const txs = [
      makeTx({ id: "#1", domainEvents: [{ kind: "memory", operation: "created", ownerId: "x", entryId: "e1", phase: "effects" }] }),
      makeTx({ id: "#2", domainEvents: [{ kind: "queue", queue: "pendingAftermath", operation: "enqueued", itemId: "i1", phase: "boundary_diff" }] }),
      makeTx({ id: "#3", domainEvents: [] }),
    ];
    const result = filterTraceTransactions(txs, { domainKinds: ["memory", "queue"] });
    expect(result.map((t) => t.id)).toEqual(["#1", "#2"]);
  });
});

// ── warning/untracked flags ──────────────────────────────────────────────────

describe("filterTraceTransactions — hasWarnings / hasUntracked", () => {
  it("hasWarnings=true passes only transactions with warnings", () => {
    const txs = [
      makeTx({ id: "#1", warnings: [{ message: "oops" }] }),
      makeTx({ id: "#2", warnings: [] }),
    ];
    expect(filterTraceTransactions(txs, { hasWarnings: true }).map((t) => t.id)).toEqual(["#1"]);
  });

  it("hasUntracked=true passes only transactions with untrackedCount > 0", () => {
    const txs = [
      makeTx({ id: "#1", untrackedCount: 2 }),
      makeTx({ id: "#2", untrackedCount: 0 }),
    ];
    expect(filterTraceTransactions(txs, { hasUntracked: true }).map((t) => t.id)).toEqual(["#1"]);
  });
});

// ── stable ordering ──────────────────────────────────────────────────────────

describe("filterTraceTransactions — stable ordering", () => {
  it("preserves insertion order", () => {
    const txs = ["#5", "#2", "#8", "#1"].map((id) => makeTx({ id, outcome: "committed" }));
    const result = filterTraceTransactions(txs, { outcomes: ["committed"] });
    expect(result.map((t) => t.id)).toEqual(["#5", "#2", "#8", "#1"]);
  });
});

// ── immutable input ──────────────────────────────────────────────────────────

describe("filterTraceTransactions — immutability", () => {
  it("does not mutate the input array", () => {
    const txs = [makeTx({ id: "#1" }), makeTx({ id: "#2", outcome: "rolled_back" })];
    const snapshot = [...txs];
    filterTraceTransactions(txs, { outcomes: ["committed"] });
    expect(txs).toEqual(snapshot);
  });
});

// ── collectTraceFacets ───────────────────────────────────────────────────────

describe("collectTraceFacets", () => {
  it("counts outcomes correctly", () => {
    const txs = [
      makeTx({ id: "#1", outcome: "committed" }),
      makeTx({ id: "#2", outcome: "rolled_back" }),
      makeTx({ id: "#3", outcome: "committed" }),
    ];
    const facets = collectTraceFacets(txs);
    expect(facets.outcomes.committed).toBe(2);
    expect(facets.outcomes.rolled_back).toBe(1);
    expect(facets.totalCount).toBe(3);
  });

  it("counts source kinds", () => {
    const txs = [
      makeTx({ source: { kind: "event", label: "e" } }),
      makeTx({ source: { kind: "action", label: "a" } }),
      makeTx({ source: { kind: "event", label: "e2" } }),
    ];
    const facets = collectTraceFacets(txs);
    expect(facets.sourceKinds["event"]).toBe(2);
    expect(facets.sourceKinds["action"]).toBe(1);
  });

  it("counts mutation phases (per-tx dedup)", () => {
    const txs = [
      makeTx({ mutations: [
        { path: "a", before: 0, after: 1, classification: "direct", phase: "effects" },
        { path: "b", before: 0, after: 1, classification: "direct", phase: "effects" }, // same phase, same tx
      ] }),
      makeTx({ mutations: [
        { path: "c", before: 0, after: 1, classification: "scheduled", phase: "advance" },
      ] }),
    ];
    const facets = collectTraceFacets(txs);
    // "effects" appears in 1 tx, "advance" in 1 tx
    expect(facets.phases["effects"]).toBe(1);
    expect(facets.phases["advance"]).toBe(1);
  });

  it("counts domain kinds", () => {
    const txs = [
      makeTx({ domainEvents: [
        { kind: "memory", operation: "created", ownerId: "x", entryId: "e1", phase: "effects" },
        { kind: "memory", operation: "propagated", ownerId: "y", entryId: "e2", phase: "effects" },
      ] }),
      makeTx({ domainEvents: [
        { kind: "queue", queue: "pendingAftermath", operation: "enqueued", itemId: "i1", phase: "boundary_diff" },
      ] }),
    ];
    const facets = collectTraceFacets(txs);
    expect(facets.domainKinds["memory"]).toBe(1); // tx1 has memory, counted once per tx
    expect(facets.domainKinds["queue"]).toBe(1);
  });

  it("empty history returns all-zero facets", () => {
    const facets = collectTraceFacets([]);
    expect(facets.totalCount).toBe(0);
    expect(Object.keys(facets.outcomes)).toHaveLength(0);
  });
});

import { describe, expect, it } from "vitest";
import { compareTransactions } from "../../src/engine/trace/compare";
import type { TraceTransaction } from "../../src/engine/trace/types";
import type { MutationRecord } from "../../src/engine/trace/types";

function makeMut(overrides: Partial<MutationRecord> = {}): MutationRecord {
  return {
    path: "standing.x.favor",
    before: 0,
    after: 5,
    delta: 5,
    classification: "direct",
    phase: "effects",
    ...overrides,
  };
}

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

// ── same transaction comparison ──────────────────────────────────────────────

describe("compareTransactions — same transaction", () => {
  it("has zero diffs when comparing identical transactions", () => {
    const tx = makeTx({
      mutations: [makeMut()],
      domainEvents: [{ kind: "memory", operation: "created", ownerId: "x", entryId: "e1", phase: "effects" }],
    });
    const result = compareTransactions(tx, tx);
    expect(result.mutationSummary.onlyPrimary).toHaveLength(0);
    expect(result.mutationSummary.onlyComparison).toHaveLength(0);
    expect(result.mutationSummary.changed).toHaveLength(0);
    expect(result.mutationSummary.unchangedCount).toBe(1);
    expect(result.domainSummary.unchangedCount).toBe(1);
    expect(result.domainSummary.changed).toHaveLength(0);
    expect(result.domainSummary.onlyPrimary).toHaveLength(0);
    expect(result.domainSummary.onlyComparison).toHaveLength(0);
  });

  it("reports no metadata changes for identical transactions", () => {
    const tx = makeTx();
    const result = compareTransactions(tx, tx);
    expect(result.metadataChanges.outcome).toBeNull();
    expect(result.metadataChanges.source).toBeNull();
  });
});

// ── same path but different after value ─────────────────────────────────────

describe("compareTransactions — value diff", () => {
  it("detects changed mutation when after value differs", () => {
    const primary = makeTx({ mutations: [makeMut({ path: "x.favor", before: 0, after: 5 })] });
    const comparison = makeTx({ mutations: [makeMut({ path: "x.favor", before: 0, after: 10 })] });
    const result = compareTransactions(primary, comparison);
    expect(result.mutationSummary.changed).toHaveLength(1);
    expect(result.mutationSummary.changed[0]?.differs).toBe(true);
    expect(result.mutationSummary.onlyPrimary).toHaveLength(0);
    expect(result.mutationSummary.onlyComparison).toHaveLength(0);
  });

  it("detects changed mutation when reason differs", () => {
    const primary = makeTx({ mutations: [makeMut({ reason: "favor capped" })] });
    const comparison = makeTx({ mutations: [makeMut({ reason: undefined })] });
    const result = compareTransactions(primary, comparison);
    expect(result.mutationSummary.changed).toHaveLength(1);
  });
});

// ── path only in left/right ──────────────────────────────────────────────────

describe("compareTransactions — only in one side", () => {
  it("path only in primary → onlyPrimary", () => {
    const primary = makeTx({ mutations: [makeMut({ path: "x.favor" }), makeMut({ path: "y.favor" })] });
    const comparison = makeTx({ mutations: [makeMut({ path: "x.favor" })] });
    const result = compareTransactions(primary, comparison);
    expect(result.mutationSummary.onlyPrimary.map((m) => m.path)).toEqual(["y.favor"]);
    expect(result.mutationSummary.onlyComparison).toHaveLength(0);
  });

  it("path only in comparison → onlyComparison", () => {
    const primary = makeTx({ mutations: [makeMut({ path: "x.favor" })] });
    const comparison = makeTx({ mutations: [makeMut({ path: "x.favor" }), makeMut({ path: "z.favor" })] });
    const result = compareTransactions(primary, comparison);
    expect(result.mutationSummary.onlyComparison.map((m) => m.path)).toEqual(["z.favor"]);
    expect(result.mutationSummary.onlyPrimary).toHaveLength(0);
  });
});

// ── duplicated paths remain deterministic ────────────────────────────────────

describe("compareTransactions — duplicate paths", () => {
  it("duplicate keys are disambiguated by occurrence index", () => {
    const m1 = makeMut({ path: "x.favor", before: 0, after: 5 });
    const m2 = makeMut({ path: "x.favor", before: 5, after: 10 });
    const primary = makeTx({ mutations: [m1, m2] });
    const comparison = makeTx({ mutations: [m1, m2] });
    const result = compareTransactions(primary, comparison);
    expect(result.mutationSummary.onlyPrimary).toHaveLength(0);
    expect(result.mutationSummary.onlyComparison).toHaveLength(0);
    expect(result.mutationSummary.unchangedCount).toBe(2);
  });

  it("duplicate paths with different values each show as changed", () => {
    const primary = makeTx({
      mutations: [makeMut({ path: "x.favor", before: 0, after: 5 }), makeMut({ path: "x.favor", before: 5, after: 10 })],
    });
    const comparison = makeTx({
      mutations: [makeMut({ path: "x.favor", before: 0, after: 5 }), makeMut({ path: "x.favor", before: 5, after: 99 })],
    });
    const result = compareTransactions(primary, comparison);
    expect(result.mutationSummary.unchangedCount).toBe(1); // first occurrence matches
    expect(result.mutationSummary.changed).toHaveLength(1); // second occurrence differs
  });
});

// ── domain event matching ────────────────────────────────────────────────────

describe("compareTransactions — domain events", () => {
  it("matches identical memory events → unchangedCount=1", () => {
    const d = { kind: "memory" as const, operation: "created" as const, ownerId: "lu", entryId: "e1", phase: "effects" };
    const primary = makeTx({ domainEvents: [d] });
    const comparison = makeTx({ domainEvents: [d] });
    const summary = compareTransactions(primary, comparison).domainSummary;
    expect(summary.unchangedCount).toBe(1);
    expect(summary.changed).toHaveLength(0);
    expect(summary.onlyPrimary).toHaveLength(0);
    expect(summary.onlyComparison).toHaveLength(0);
  });

  it("detects domain event only in primary", () => {
    const d = { kind: "memory" as const, operation: "created" as const, ownerId: "lu", entryId: "e1", phase: "effects" };
    const primary = makeTx({ domainEvents: [d] });
    const comparison = makeTx({ domainEvents: [] });
    const result = compareTransactions(primary, comparison);
    expect(result.domainSummary.onlyPrimary).toHaveLength(1);
    expect(result.domainSummary.onlyComparison).toHaveLength(0);
  });

  it("matches identical rollback events → unchangedCount=1", () => {
    const d = { kind: "rollback" as const, failedPhase: "effects", message: "err", attemptedMutationCount: 0, attemptedDomainEventCount: 0, phase: "effects" };
    const primary = makeTx({ domainEvents: [d] });
    const comparison = makeTx({ domainEvents: [d] });
    const summary = compareTransactions(primary, comparison).domainSummary;
    expect(summary.unchangedCount).toBe(1);
    expect(summary.changed).toHaveLength(0);
  });

  it("detects payload difference for same-key domain events → changed bucket", () => {
    // Two queue events with same semantic key (queue|pendingRetirements|resolved|official-x)
    // but different resolution field — approved vs retained.
    const approved = {
      kind: "queue" as const, queue: "pendingRetirements", operation: "resolved" as const,
      itemId: "official-x", resolution: "approved" as const, phase: "direct_mutation",
    };
    const retained = {
      kind: "queue" as const, queue: "pendingRetirements", operation: "resolved" as const,
      itemId: "official-x", resolution: "retained" as const, phase: "direct_mutation",
    };
    const primary = makeTx({ domainEvents: [approved] });
    const comparison = makeTx({ domainEvents: [retained] });
    const summary = compareTransactions(primary, comparison).domainSummary;
    // Same semantic key → matched but payload differs → in changed, not unchanged
    expect(summary.changed).toHaveLength(1);
    expect(summary.changed[0]?.differs).toBe(true);
    expect(summary.unchangedCount).toBe(0);
    expect(summary.onlyPrimary).toHaveLength(0);
    expect(summary.onlyComparison).toHaveLength(0);
  });

  it("detects eligibility payload difference when failedBefore arrays differ", () => {
    const base = {
      kind: "eligibility" as const, eventId: "evt_001", transition: "became_ineligible" as const,
      phase: "boundary_diff",
    };
    const withFailure = { ...base, failedBefore: [], failedAfter: [{ conditionType: "flagSet", expected: true, actual: false }] };
    const withoutFailure = { ...base, failedBefore: [], failedAfter: [] };
    const primary = makeTx({ domainEvents: [withFailure] });
    const comparison = makeTx({ domainEvents: [withoutFailure] });
    const summary = compareTransactions(primary, comparison).domainSummary;
    expect(summary.changed).toHaveLength(1);
    expect(summary.unchangedCount).toBe(0);
  });
});

// ── committed vs rolled_back ─────────────────────────────────────────────────

describe("compareTransactions — outcome mismatch", () => {
  it("reports outcome metadata change when comparing committed vs rolled_back", () => {
    const primary = makeTx({ outcome: "committed" });
    const comparison = makeTx({ outcome: "rolled_back" });
    const result = compareTransactions(primary, comparison);
    expect(result.metadataChanges.outcome).not.toBeNull();
    expect(result.metadataChanges.outcome?.primary).toBe("committed");
    expect(result.metadataChanges.outcome?.comparison).toBe("rolled_back");
  });
});

// ── input immutability ───────────────────────────────────────────────────────

describe("compareTransactions — immutability", () => {
  it("does not mutate primary or comparison", () => {
    const primary = makeTx({ mutations: [makeMut()], domainEvents: [{ kind: "memory" as const, operation: "created" as const, ownerId: "x", entryId: "e1", phase: "effects" }] });
    const comparison = makeTx({ mutations: [makeMut({ path: "y.favor" })] });
    const primaryMutationsSnap = [...primary.mutations];
    const compMutationsSnap = [...comparison.mutations];
    compareTransactions(primary, comparison);
    expect(primary.mutations).toEqual(primaryMutationsSnap);
    expect(comparison.mutations).toEqual(compMutationsSnap);
  });
});

// ── stable ordering ──────────────────────────────────────────────────────────

describe("compareTransactions — stable ordering", () => {
  it("onlyPrimary preserves primary mutation order", () => {
    const primary = makeTx({
      mutations: [
        makeMut({ path: "a.favor" }),
        makeMut({ path: "b.favor" }),
        makeMut({ path: "c.favor" }),
      ],
    });
    const comparison = makeTx({ mutations: [] });
    const result = compareTransactions(primary, comparison);
    expect(result.mutationSummary.onlyPrimary.map((m) => m.path)).toEqual(["a.favor", "b.favor", "c.favor"]);
  });
});

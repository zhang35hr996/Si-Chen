import { describe, expect, it } from "vitest";
import { formatTraceDiagnostic } from "../../src/engine/trace/diagnostic";
import type { TraceTransaction } from "../../src/engine/trace/types";

function makeTx(overrides: Partial<TraceTransaction> = {}): TraceTransaction {
  return {
    id: "#5",
    timestamp: 1000,
    source: { kind: "imperial_command", sourceId: "impose_confinement", label: "imperial: impose_confinement" },
    mutations: [],
    warnings: [],
    outcome: "committed",
    directCount: 0,
    untrackedCount: 0,
    domainEvents: [],
    ...overrides,
  };
}

// ── committed transaction ────────────────────────────────────────────────────

describe("formatTraceDiagnostic — committed", () => {
  it("includes transaction id, outcome, and source kind", () => {
    const result = formatTraceDiagnostic(makeTx());
    expect(result).toContain("#5");
    expect(result).toContain("committed");
    expect(result).toContain("imperial_command");
  });

  it("does not include 'attempted' for committed transactions", () => {
    const result = formatTraceDiagnostic(makeTx());
    expect(result).not.toContain("attempted");
  });

  it("includes source label and sourceId", () => {
    const result = formatTraceDiagnostic(makeTx());
    expect(result).toContain("impose_confinement");
    expect(result).toContain("imperial: impose_confinement");
  });

  it("includes game time when present", () => {
    const result = formatTraceDiagnostic(makeTx({ gameTime: "Year 1 Month 3" }));
    expect(result).toContain("Year 1 Month 3");
  });
});

// ── rolled-back transaction ──────────────────────────────────────────────────

describe("formatTraceDiagnostic — rolled_back", () => {
  it("includes 'rolled_back' in outcome", () => {
    const result = formatTraceDiagnostic(makeTx({ outcome: "rolled_back", error: "char not found" }));
    expect(result).toContain("rolled_back");
  });

  it("includes error message", () => {
    const result = formatTraceDiagnostic(makeTx({ outcome: "rolled_back", error: "char not found: xyz" }));
    expect(result).toContain("char not found: xyz");
  });

  it("labels mutations as attempted for rolled_back", () => {
    const result = formatTraceDiagnostic(makeTx({
      outcome: "rolled_back",
      mutations: [{ path: "x", before: 0, after: 1, classification: "direct", phase: "effects" }],
    }));
    expect(result).toContain("attempted");
  });
});

// ── memory events ────────────────────────────────────────────────────────────

describe("formatTraceDiagnostic — memory events", () => {
  it("includes memory event operation and ownerId", () => {
    const result = formatTraceDiagnostic(makeTx({
      domainEvents: [{
        kind: "memory", operation: "created", ownerId: "lu_huaijin",
        entryId: "mem_lu_huaijin_000001", summary: "received gift",
        phase: "effects",
      }],
    }));
    expect(result).toContain("memory created");
    expect(result).toContain("lu_huaijin");
    expect(result).toContain("received gift");
  });

  it("includes sourceCourtEventId for propagated events", () => {
    const result = formatTraceDiagnostic(makeTx({
      domainEvents: [{
        kind: "memory", operation: "propagated", ownerId: "lu",
        entryId: "mem_lu_000001", sourceCourtEventId: "evt_000001",
        phase: "effects",
      }],
    }));
    expect(result).toContain("evt_000001");
  });
});

// ── queue events ─────────────────────────────────────────────────────────────

describe("formatTraceDiagnostic — queue events", () => {
  it("includes queue name, operation, and itemId", () => {
    const result = formatTraceDiagnostic(makeTx({
      domainEvents: [{
        kind: "queue", queue: "pendingRetirements", operation: "resolved",
        itemId: "official_001", resolution: "approved", reason: "approved",
        phase: "direct_mutation",
      }],
    }));
    expect(result).toContain("pendingRetirements");
    expect(result).toContain("resolved");
    expect(result).toContain("official_001");
    expect(result).toContain("approved");
  });
});

// ── eligibility events ───────────────────────────────────────────────────────

describe("formatTraceDiagnostic — eligibility events", () => {
  it("includes eventId and transition", () => {
    const result = formatTraceDiagnostic(makeTx({
      domainEvents: [{
        kind: "eligibility", eventId: "event_001", transition: "became_eligible",
        failedBefore: [{ conditionType: "favorAtLeast", expected: 50, actual: 30 }],
        failedAfter: [],
        phase: "boundary_diff",
      }],
    }));
    expect(result).toContain("event_001");
    expect(result).toContain("became_eligible");
  });
});

// ── truncation ───────────────────────────────────────────────────────────────

describe("formatTraceDiagnostic — truncation", () => {
  it("truncates very long mutation paths", () => {
    const longPath = "a".repeat(200);
    const result = formatTraceDiagnostic(makeTx({
      mutations: [{ path: longPath, before: 0, after: 1, classification: "direct", phase: "effects" }],
    }));
    expect(result).not.toContain(longPath);
    expect(result).toContain("…");
  });

  it("truncates very long before/after values", () => {
    const bigArray = Array.from({ length: 100 }, (_, i) => i);
    const result = formatTraceDiagnostic(makeTx({
      mutations: [{ path: "x", before: bigArray, after: bigArray, classification: "direct", phase: "effects" }],
    }));
    // Should not throw and result should be bounded
    expect(result.length).toBeLessThan(10000);
  });

  it("shows at most 20 mutations, then ellipsis for the rest", () => {
    const muts = Array.from({ length: 25 }, (_, i) => ({
      path: `field_${i}`,
      before: 0,
      after: 1,
      classification: "direct" as const,
      phase: "effects",
    }));
    const result = formatTraceDiagnostic(makeTx({ mutations: muts }));
    expect(result).toContain("… and 5 more");
  });
});

// ── deterministic formatting ─────────────────────────────────────────────────

describe("formatTraceDiagnostic — deterministic", () => {
  it("produces the same output for the same transaction", () => {
    const tx = makeTx({
      mutations: [{ path: "x.favor", before: 0, after: 5, classification: "direct", phase: "effects" }],
      domainEvents: [{ kind: "memory" as const, operation: "created" as const, ownerId: "x", entryId: "e1", phase: "effects" }],
    });
    expect(formatTraceDiagnostic(tx)).toBe(formatTraceDiagnostic(tx));
  });

  it("field order is stable across calls", () => {
    const tx = makeTx();
    const lines1 = formatTraceDiagnostic(tx).split("\n");
    const lines2 = formatTraceDiagnostic(tx).split("\n");
    expect(lines1).toEqual(lines2);
  });
});

// ── empty sections ───────────────────────────────────────────────────────────

describe("formatTraceDiagnostic — empty sections", () => {
  it("shows Warnings: 0 when no warnings", () => {
    const result = formatTraceDiagnostic(makeTx());
    expect(result).toContain("Warnings: 0");
  });

  it("shows Domain events: 0 when no domain events", () => {
    const result = formatTraceDiagnostic(makeTx());
    expect(result).toContain("Domain events: 0");
  });
});

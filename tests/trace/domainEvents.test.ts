import { describe, expect, it } from "vitest";
import { TraceCollector } from "../../src/engine/trace/collector";
import type { MemoryTraceEvent, QueueTraceEvent } from "../../src/engine/trace/domainEvents";

describe("TraceCollector – domain events", () => {
  it("recordDomainEvent accumulates events", () => {
    const c = new TraceCollector();
    const ev: MemoryTraceEvent = {
      kind: "memory", operation: "created", ownerId: "char_a",
      entryId: "char_a:mem:1", phase: "effects",
    };
    c.recordDomainEvent(ev);
    expect(c.getDomainEvents()).toHaveLength(1);
    expect(c.getDomainEvents()[0]).toMatchObject({ kind: "memory", operation: "created" });
  });

  it("recordMemoryEvent attaches kind automatically", () => {
    const c = new TraceCollector();
    c.recordMemoryEvent({ operation: "propagated", ownerId: "char_b", entryId: "char_b:mem:2", phase: "effects" });
    const evs = c.getDomainEvents();
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ kind: "memory", operation: "propagated" });
  });

  it("recordQueueEvent attaches kind automatically", () => {
    const c = new TraceCollector();
    const ev: Omit<QueueTraceEvent, "kind"> = { queue: "pendingRetirements", operation: "resolved", itemId: "off_1", resolution: "approved", phase: "direct_mutation" };
    c.recordQueueEvent(ev);
    const evs = c.getDomainEvents();
    expect(evs[0]).toMatchObject({ kind: "queue", queue: "pendingRetirements", operation: "resolved", resolution: "approved" });
  });

  it("recordEligibilityEvent attaches kind automatically", () => {
    const c = new TraceCollector();
    c.recordEligibilityEvent({ eventId: "ev_foo", transition: "became_eligible", failedBefore: [{ conditionType: "flagSet", path: "x" }], failedAfter: [], phase: "boundary_diff" });
    const evs = c.getDomainEvents();
    expect(evs[0]).toMatchObject({ kind: "eligibility", transition: "became_eligible" });
  });

  it("fail() records a rollback domain event with counts before the failure", () => {
    const c = new TraceCollector();
    c.record({ path: "x", before: 0, after: 1 });
    c.recordMemoryEvent({ operation: "created", ownerId: "a", entryId: "a:mem:0", phase: "effects" });
    c.fail("effects", { message: "boom", code: "BAD_STATE" });
    const evs = c.getDomainEvents();
    expect(evs).toHaveLength(2); // memory event + rollback event
    const rollback = evs.find((e) => e.kind === "rollback");
    expect(rollback).toMatchObject({
      kind: "rollback",
      failedPhase: "effects",
      errorCode: "BAD_STATE",
      message: "boom",
      attemptedMutationCount: 1,
      attemptedDomainEventCount: 1, // memory event counted before the rollback itself
    });
  });

  it("fail() accepts array of errors", () => {
    const c = new TraceCollector();
    c.fail("chronicle_append", [{ message: "err1", code: "E1" }, { message: "err2", code: "E2" }]);
    const evs = c.getDomainEvents();
    const rollback = evs.find((e) => e.kind === "rollback");
    expect(rollback).toMatchObject({ message: "err1; err2", errorCode: "E1" });
  });

  it("fail() accepts plain string", () => {
    const c = new TraceCollector();
    c.fail("effects", "something broke");
    const evs = c.getDomainEvents();
    expect(evs[0]).toMatchObject({ kind: "rollback", message: "something broke" });
    expect((evs[0] as { errorCode?: string }).errorCode).toBeUndefined();
  });

  it("getDomainEvents returns empty array initially", () => {
    const c = new TraceCollector();
    expect(c.getDomainEvents()).toHaveLength(0);
  });

  it("domain events are preserved independently from mutation records", () => {
    const c = new TraceCollector();
    c.record({ path: "foo", before: 1, after: 2 });
    c.recordMemoryEvent({ operation: "created", ownerId: "char_c", entryId: "char_c:mem:0", phase: "effects" });
    expect(c.getMutations()).toHaveLength(1);
    expect(c.getDomainEvents()).toHaveLength(1);
  });
});

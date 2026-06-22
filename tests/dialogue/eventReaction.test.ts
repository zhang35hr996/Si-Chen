/**
 * Tests for eventToReactionContext and MAX_REACTION_AGE_DAYS (Task 2).
 */
import { describe, expect, it } from "vitest";
import { eventToReactionContext, MAX_REACTION_AGE_DAYS } from "../../src/engine/dialogue/eventReaction";
import type { CourtEvent } from "../../src/engine/state/types";

const BASE_TIME = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

function makeEvent(overrides: Partial<CourtEvent>): CourtEvent {
  return {
    id: "evt_000001",
    type: "rank_changed",
    occurredAt: BASE_TIME,
    participants: [],
    payload: {},
    publicity: { scope: "palace", persistence: "contemporaneous" },
    publicSalience: 50,
    retention: "fast",
    tags: [],
    ...overrides,
  };
}

describe("MAX_REACTION_AGE_DAYS", () => {
  it("is 3", () => {
    expect(MAX_REACTION_AGE_DAYS).toBe(3);
  });
});

describe("eventToReactionContext", () => {
  it("rank_changed: subject role, direction from payload (demote)", () => {
    const event = makeEvent({
      type: "rank_changed",
      participants: [{ charId: "consort_gu", role: "subject" }],
      payload: { direction: "demote" },
    });
    const ctx = eventToReactionContext(event);
    expect(ctx).toBeDefined();
    expect(ctx!.eventType).toBe("rank_changed");
    expect(ctx!.subjectId).toBe("consort_gu");
    expect(ctx!.direction).toBe("demote");
  });

  it("rank_changed: subject role, direction from payload (promote)", () => {
    const event = makeEvent({
      type: "rank_changed",
      participants: [{ charId: "consort_gu", role: "subject" }],
      payload: { direction: "promote" },
    });
    const ctx = eventToReactionContext(event);
    expect(ctx).toBeDefined();
    expect(ctx!.eventType).toBe("rank_changed");
    expect(ctx!.subjectId).toBe("consort_gu");
    expect(ctx!.direction).toBe("promote");
  });

  it("residence_changed: mover role", () => {
    const event = makeEvent({
      type: "residence_changed",
      participants: [{ charId: "shen_zhibai", role: "mover" }],
      payload: {},
    });
    const ctx = eventToReactionContext(event);
    expect(ctx).toBeDefined();
    expect(ctx!.eventType).toBe("residence_changed");
    expect(ctx!.subjectId).toBe("shen_zhibai");
    expect(ctx!.direction).toBeUndefined();
  });

  it("heir_born: prefers adoptive_father over birth_father", () => {
    const event = makeEvent({
      type: "heir_born",
      participants: [
        { charId: "lu_huaijin", role: "birth_father" },
        { charId: "shen_zhibai", role: "adoptive_father" },
        { charId: "heir_000001", role: "newborn" },
      ],
      payload: {},
    });
    const ctx = eventToReactionContext(event);
    expect(ctx).toBeDefined();
    expect(ctx!.eventType).toBe("heir_born");
    expect(ctx!.subjectId).toBe("shen_zhibai"); // adoptive_father preferred
  });

  it("heir_born: falls back to birth_father when no adoptive_father", () => {
    const event = makeEvent({
      type: "heir_born",
      participants: [
        { charId: "lu_huaijin", role: "birth_father" },
        { charId: "heir_000001", role: "newborn" },
      ],
      payload: {},
    });
    const ctx = eventToReactionContext(event);
    expect(ctx).toBeDefined();
    expect(ctx!.eventType).toBe("heir_born");
    expect(ctx!.subjectId).toBe("lu_huaijin");
  });

  it("heir_died: prefers adoptive_father over birth_father", () => {
    const event = makeEvent({
      type: "heir_died",
      participants: [
        { charId: "lu_huaijin", role: "birth_father" },
        { charId: "shen_zhibai", role: "adoptive_father" },
      ],
      payload: {},
    });
    const ctx = eventToReactionContext(event);
    expect(ctx).toBeDefined();
    expect(ctx!.eventType).toBe("heir_died");
    expect(ctx!.subjectId).toBe("shen_zhibai"); // adoptive_father preferred
  });

  it("heir_died: falls back to birth_father when no adoptive_father", () => {
    const event = makeEvent({
      type: "heir_died",
      participants: [
        { charId: "lu_huaijin", role: "birth_father" },
      ],
      payload: {},
    });
    const ctx = eventToReactionContext(event);
    expect(ctx).toBeDefined();
    expect(ctx!.subjectId).toBe("lu_huaijin");
  });

  it("undefined for non-reactable types (punished)", () => {
    const event = makeEvent({
      type: "punished",
      participants: [{ charId: "consort_gu", role: "subject" }],
      payload: {},
    });
    const ctx = eventToReactionContext(event);
    expect(ctx).toBeUndefined();
  });

  it("undefined for non-reactable types (rewarded)", () => {
    const event = makeEvent({
      type: "rewarded",
      participants: [{ charId: "consort_gu", role: "subject" }],
      payload: {},
    });
    expect(eventToReactionContext(event)).toBeUndefined();
  });

  it("undefined for non-reactable types (conflict)", () => {
    const event = makeEvent({ type: "conflict", participants: [], payload: {} });
    expect(eventToReactionContext(event)).toBeUndefined();
  });

  it("undefined for non-reactable types (promise)", () => {
    const event = makeEvent({ type: "promise", participants: [], payload: {} });
    expect(eventToReactionContext(event)).toBeUndefined();
  });

  it("undefined for non-reactable types (secret_discovered)", () => {
    const event = makeEvent({ type: "secret_discovered", participants: [], payload: {} });
    expect(eventToReactionContext(event)).toBeUndefined();
  });

  it("undefined when required role absent (rank_changed without subject)", () => {
    const event = makeEvent({
      type: "rank_changed",
      participants: [{ charId: "consort_gu", role: "witness" }],
      payload: { direction: "demote" },
    });
    expect(eventToReactionContext(event)).toBeUndefined();
  });

  it("undefined when required role absent (residence_changed without mover)", () => {
    const event = makeEvent({
      type: "residence_changed",
      participants: [],
      payload: {},
    });
    expect(eventToReactionContext(event)).toBeUndefined();
  });

  it("undefined when required role absent (heir_born without birth_father or adoptive_father)", () => {
    const event = makeEvent({
      type: "heir_born",
      participants: [{ charId: "heir_000001", role: "newborn" }],
      payload: {},
    });
    expect(eventToReactionContext(event)).toBeUndefined();
  });

  it("is deterministic given same inputs", () => {
    const event = makeEvent({
      type: "rank_changed",
      participants: [{ charId: "consort_gu", role: "subject" }],
      payload: { direction: "promote" },
    });
    const ctx1 = eventToReactionContext(event);
    const ctx2 = eventToReactionContext(event);
    expect(ctx1).toEqual(ctx2);
  });
});

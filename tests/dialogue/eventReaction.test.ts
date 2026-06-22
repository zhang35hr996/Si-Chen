/**
 * Tests for eventToReactionContext, MAX_REACTION_AGE_DAYS (Task 2),
 * and selectReactionEvent (Task 4).
 */
import { describe, expect, it } from "vitest";
import {
  eventToReactionContext,
  MAX_REACTION_AGE_DAYS,
  selectReactionEvent,
} from "../../src/engine/dialogue/eventReaction";
import type { CourtEvent, EventReactionRecord, GameState } from "../../src/engine/state/types";

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

// ── selectReactionEvent (Task 4) ──────────────────────────────────────────────

/** Minimal GameState stub — only the fields selectReactionEvent reads. */
function makeState(overrides: { eventReactionLog?: EventReactionRecord[] } = {}): GameState {
  return {
    eventReactionLog: overrides.eventReactionLog ?? [],
  } as unknown as GameState;
}

/** A reactable rank_changed event occurring at the given dayIndex. */
function makeReactableEvent(id: string, dayIndex: number, type: CourtEvent["type"] = "rank_changed"): CourtEvent {
  return makeEvent({
    id,
    type,
    occurredAt: { year: 1, month: 1, period: "early" as const, dayIndex },
    participants: [{ charId: "consort_gu", role: "subject" }],
    payload: { direction: "promote" },
  });
}

/** A non-reactable event (punished has no reaction context). */
function makeNonReactableEvent(id: string, dayIndex: number): CourtEvent {
  return makeEvent({
    id,
    type: "punished",
    occurredAt: { year: 1, month: 1, period: "early" as const, dayIndex },
    participants: [{ charId: "consort_gu", role: "subject" }],
    payload: {},
  });
}

describe("selectReactionEvent", () => {
  const SPEAKER = "consort_mei";
  const AUDIENCE = "sovereign";
  const currentDayIndex = 5;

  it("returns undefined when sceneDirective is set (reaction disabled for authored scenes)", () => {
    const event = makeReactableEvent("evt_001", currentDayIndex);
    const state = makeState();
    const result = selectReactionEvent({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      events: [event],
      chronicle: [],
      state,
      currentDayIndex,
      sceneDirective: "some_directive",
    });
    expect(result).toBeUndefined();
  });

  it("skips future events and too-old events, picks the in-window one", () => {
    const futureEvent = makeReactableEvent("evt_future", currentDayIndex + 1);
    const tooOldEvent = makeReactableEvent("evt_old", currentDayIndex - MAX_REACTION_AGE_DAYS - 1);
    const validEvent = makeReactableEvent("evt_valid", currentDayIndex - 1);
    const state = makeState();
    const result = selectReactionEvent({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      events: [futureEvent, tooOldEvent, validEvent],
      chronicle: [],
      state,
      currentDayIndex,
    });
    expect(result?.id).toBe("evt_valid");
  });

  it("skips non-reactable event types (no reaction context)", () => {
    const nonReactable = makeNonReactableEvent("evt_punished", currentDayIndex);
    const state = makeState();
    const result = selectReactionEvent({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      events: [nonReactable],
      chronicle: [],
      state,
      currentDayIndex,
    });
    expect(result).toBeUndefined();
  });

  it("skips events with no required participant role (no reaction context)", () => {
    // heir_born without birth_father or adoptive_father → eventToReactionContext returns undefined
    const noRoleEvent = makeEvent({
      id: "evt_no_role",
      type: "heir_born",
      occurredAt: { year: 1, month: 1, period: "early" as const, dayIndex: currentDayIndex },
      participants: [{ charId: "heir_000001", role: "newborn" }],
      payload: {},
    });
    const state = makeState();
    const result = selectReactionEvent({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      events: [noRoleEvent],
      chronicle: [],
      state,
      currentDayIndex,
    });
    expect(result).toBeUndefined();
  });

  it("once-only: skips event already in eventReactionLog for (speakerId, audienceId, eventId)", () => {
    const event = makeReactableEvent("evt_001", currentDayIndex);
    const state = makeState({
      eventReactionLog: [
        {
          speakerId: SPEAKER,
          audienceId: AUDIENCE,
          eventId: "evt_001",
          reactedAt: { year: 1, month: 1, period: "early" as const, dayIndex: currentDayIndex },
        },
      ],
    });
    const result = selectReactionEvent({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      events: [event],
      chronicle: [],
      state,
      currentDayIndex,
    });
    expect(result).toBeUndefined();
  });

  it("allows same event for different audienceId (different triple)", () => {
    const event = makeReactableEvent("evt_001", currentDayIndex);
    const state = makeState({
      eventReactionLog: [
        {
          speakerId: SPEAKER,
          audienceId: "other_audience",
          eventId: "evt_001",
          reactedAt: { year: 1, month: 1, period: "early" as const, dayIndex: currentDayIndex },
        },
      ],
    });
    const result = selectReactionEvent({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      events: [event],
      chronicle: [],
      state,
      currentDayIndex,
    });
    expect(result?.id).toBe("evt_001");
  });

  it("picks most recent eligible event (dayIndex desc, id desc as tiebreaker)", () => {
    const older = makeReactableEvent("evt_a", currentDayIndex - 2);
    const newer = makeReactableEvent("evt_b", currentDayIndex - 1);
    const state = makeState();
    const result = selectReactionEvent({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      events: [older, newer],
      chronicle: [],
      state,
      currentDayIndex,
    });
    expect(result?.id).toBe("evt_b");
  });

  it("picks event with higher id as tiebreaker when dayIndex is equal", () => {
    const eventA = makeReactableEvent("evt_000002", currentDayIndex - 1);
    const eventB = makeReactableEvent("evt_000001", currentDayIndex - 1);
    const state = makeState();
    const result = selectReactionEvent({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      events: [eventA, eventB],
      chronicle: [],
      state,
      currentDayIndex,
    });
    expect(result?.id).toBe("evt_000002");
  });

  it("returns undefined when no eligible events exist", () => {
    const state = makeState();
    const result = selectReactionEvent({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      events: [],
      chronicle: [],
      state,
      currentDayIndex,
    });
    expect(result).toBeUndefined();
  });
});

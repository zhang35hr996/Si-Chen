/**
 * Tests for buildReactionPlan → BuiltReaction (Task 5).
 */
import { describe, expect, it } from "vitest";
import { buildReactionPlan } from "../../src/engine/dialogue/reactionAssembler";
import type { CourtEvent, EventReactionRecord, GameState } from "../../src/engine/state/types";

// ── Minimal stubs ─────────────────────────────────────────────────────────────

/** Minimal GameState stub — only the fields that buildReactionPlan touches. */
function makeState(overrides: {
  eventReactionLog?: EventReactionRecord[];
  standing?: GameState["standing"];
} = {}): GameState {
  return {
    eventReactionLog: overrides.eventReactionLog ?? [],
    standing: overrides.standing ?? {},
    resources: {
      bloodline: { heirs: [] },
    },
  } as unknown as GameState;
}

/** A reactable rank_changed event at dayIndex 5. */
function makeReactableEvent(id = "evt_001", dayIndex = 5): CourtEvent {
  return {
    id,
    type: "rank_changed",
    occurredAt: { year: 1, month: 1, period: "early" as const, dayIndex },
    participants: [{ charId: "consort_gu", role: "subject" }],
    payload: { direction: "promote" },
    publicity: { scope: "palace", persistence: "contemporaneous" },
    publicSalience: 50,
    retention: "fast",
    tags: [],
  };
}

const SPEAKER = "consort_mei";
const AUDIENCE = "player"; // sovereign
const CURRENT_DAY = 5;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildReactionPlan", () => {
  it("undefined when no eligible event (empty knownEventsAll)", () => {
    const state = makeState();
    const result = buildReactionPlan({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      knownEventsAll: [],
      chronicle: [],
      state,
      currentDayIndex: CURRENT_DAY,
    });
    expect(result).toBeUndefined();
  });

  it("returns { plan, sourceEventId } for an eligible event", () => {
    const event = makeReactableEvent();
    const state = makeState();
    const result = buildReactionPlan({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      knownEventsAll: [event],
      chronicle: [],
      state,
      currentDayIndex: CURRENT_DAY,
    });
    expect(result).toBeDefined();
    expect(result!.sourceEventId).toBe("evt_001");
    expect(result!.plan).toBeDefined();
    expect(typeof result!.plan.primary).toBe("string");
    expect(Array.isArray(result!.plan.subjectIds)).toBe(true);
    expect(Array.isArray(result!.plan.claimNeeds)).toBe(true);
    expect(Array.isArray(result!.plan.rationaleCodes)).toBe(true);
  });

  it("sourceEventId matches the id of the selected event", () => {
    const event = makeReactableEvent("evt_special_99");
    const state = makeState();
    const result = buildReactionPlan({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      knownEventsAll: [event],
      chronicle: [],
      state,
      currentDayIndex: CURRENT_DAY,
    });
    expect(result).toBeDefined();
    expect(result!.sourceEventId).toBe("evt_special_99");
  });

  it("undefined when sceneDirective is set (authored scenes suppress reaction)", () => {
    const event = makeReactableEvent();
    const state = makeState();
    const result = buildReactionPlan({
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      knownEventsAll: [event],
      chronicle: [],
      state,
      currentDayIndex: CURRENT_DAY,
      sceneDirective: "scripted_scene_directive",
    });
    expect(result).toBeUndefined();
  });

  it("is deterministic: same input produces identical output", () => {
    const event = makeReactableEvent();
    const state = makeState();
    const args = {
      speakerId: SPEAKER,
      audienceId: AUDIENCE,
      knownEventsAll: [event],
      chronicle: [] as readonly CourtEvent[],
      state,
      currentDayIndex: CURRENT_DAY,
    };
    const result1 = buildReactionPlan(args);
    const result2 = buildReactionPlan(args);
    expect(result1).toEqual(result2);
  });
});

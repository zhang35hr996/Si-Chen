/**
 * PR-A item 9: events get a unified activation score (effective salience decays,
 * relevance/present bonuses, recent-reaction penalty) so prompt-event selection
 * stops being a raw publicSalience re-scan.
 *
 * Run: npx vitest run tests/dialogue/eventActivation.test.ts
 */
import { describe, it, expect } from "vitest";
import { eventActivationScore } from "../../src/engine/dialogue/retrievalScore";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent, EventReactionRecord, GameState } from "../../src/engine/state/types";

const evt = (over: Partial<CourtEvent> = {}): CourtEvent => ({
  id: "evt_1",
  type: "rank_changed",
  occurredAt: makeGameTime(5, 1, "early"),
  participants: [{ charId: "gu", role: "subject" }],
  payload: {},
  publicity: { scope: "palace", persistence: "contemporaneous" },
  publicSalience: 60,
  retention: "fast",
  tags: ["promotion"],
  ...over,
});

const ctx = (over = {}) => ({
  now: makeGameTime(5, 1, "early"),
  topicTags: [] as string[],
  subjectIds: [] as string[],
  presentCharacterIds: [] as string[],
  audienceId: "player",
  speakerId: "a",
  ...over,
});

describe("eventActivationScore", () => {
  it("an old event of equal salience scores lower than a fresh one (effective-salience decay)", () => {
    const s = createInitialState();
    const fresh = eventActivationScore(s, evt({ occurredAt: makeGameTime(5, 1, "early") }), ctx());
    const old = eventActivationScore(s, evt({ occurredAt: makeGameTime(1, 1, "early") }), ctx());
    expect(fresh).toBeGreaterThan(old);
  });

  it("a topic match raises the score", () => {
    const s = createInitialState();
    const base = eventActivationScore(s, evt(), ctx());
    const onTopic = eventActivationScore(s, evt(), ctx({ topicTags: ["promotion"] }));
    expect(onTopic).toBeGreaterThan(base);
  });

  it("a present participant raises the score", () => {
    const s = createInitialState();
    const base = eventActivationScore(s, evt(), ctx());
    const present = eventActivationScore(s, evt(), ctx({ presentCharacterIds: ["gu"] }));
    expect(present).toBeGreaterThan(base);
  });

  it("a recent reaction by this speaker lowers the score (don't re-surface it)", () => {
    const reaction: EventReactionRecord = {
      speakerId: "a",
      audienceId: "player",
      eventId: "evt_1",
      reactedAt: makeGameTime(5, 1, "early"),
    };
    const s: GameState = { ...createInitialState(), eventReactionLog: [reaction] };
    const noReaction = eventActivationScore(createInitialState(), evt(), ctx());
    const reacted = eventActivationScore(s, evt(), ctx());
    expect(reacted).toBeLessThan(noReaction);
  });
});

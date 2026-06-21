// tests/dialogue/claimAssembler.test.ts
import { describe, it, expect } from "vitest";
import { assembleClaims } from "../../src/engine/dialogue/claimAssembler";
import { GroundTruthBeliefProjection } from "../../src/engine/chronicle/belief";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";
import type { ReactionPlan } from "../../src/engine/dialogue/reactionTypes";
import type { DialogueMemoryContext } from "../../src/engine/dialogue/memoryContext";
import type { MemoryEntry } from "../../src/engine/state/types";
import { makeGameTime } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const plan = (over: Partial<ReactionPlan> = {}): ReactionPlan => ({
  subjectIds: [],
  primary: "remain_reserved",
  intensity: 0,
  openness: 50,
  claimNeeds: [],
  rationaleCodes: [],
  ...over,
});

const emptyCtx: DialogueMemoryContext = { activatedMemories: [], knownEvents: [] };

const defaultAudience = {
  targetId: "player",
  targetRole: "sovereign" as const,
  presentCharacterIds: ["player"],
  privacy: "semi_private" as const,
};

describe("assembleClaims", () => {
  it("derives a forbidden currently_same_residence claim when an old co-residence memory is now false", () => {
    const state = createNewGameState(db);
    // Use two real consort IDs that have standing entries at new-game
    const ids = Object.keys(state.standing);
    const [speaker, other] = ids as [string, string];
    // Force different residences so the co-residence conclusion is now stale
    state.standing[speaker]!.residence = "xianfu_palace";
    state.standing[other]!.residence = "changchun_palace";
    const mem: MemoryEntry = {
      id: "m_res",
      ownerId: speaker,
      kind: "episodic",
      subjectIds: [speaker, other],
      perspective: "witness",
      summary: "曾同住咸福宫",
      strength: 60,
      retention: "slow",
      emotions: {},
      triggerTags: ["residence"],
      unresolved: false,
      createdAt: makeGameTime(1, 1, "early"),
    };
    const ctx: DialogueMemoryContext = { activatedMemories: [mem], knownEvents: [] };
    const beliefs = new GroundTruthBeliefProjection(state);
    const out = assembleClaims({
      speakerId: speaker,
      reactionPlan: plan(),
      memoryContext: ctx,
      beliefs,
      state,
      audience: defaultAudience,
    });
    expect(
      out.forbidden.some(
        (c) =>
          c.predicate === "currently_same_residence" &&
          c.subjectId === other &&
          c.object === false,
      ),
    ).toBe(true);
  });

  it("derives an allowed holds_rank claim from a subject_event claimNeed when the fact is visible", () => {
    const state = createNewGameState(db);
    // Pick a consort that is currently present (has palaceEnteredAt ≤ now and is not deceased)
    const subject = Object.keys(state.standing)[0]!;
    // speakerId must also be currently present; use a second consort as speaker
    const speakerId = Object.keys(state.standing)[1]!;
    const beliefs = new GroundTruthBeliefProjection(state);
    const out = assembleClaims({
      speakerId,
      reactionPlan: plan({ claimNeeds: [{ about: "subject_event", subjectId: subject }] }),
      memoryContext: emptyCtx,
      beliefs,
      state,
      audience: defaultAudience,
    });
    expect(out.allowed.some((c) => c.subjectId === subject)).toBe(true);
  });

  it("is deterministic", () => {
    const state = createNewGameState(db);
    const speakerId = Object.keys(state.standing)[0]!;
    const beliefs = new GroundTruthBeliefProjection(state);
    const args = {
      speakerId,
      reactionPlan: plan(),
      memoryContext: emptyCtx,
      beliefs,
      state,
      audience: defaultAudience,
    };
    expect(assembleClaims(args)).toEqual(assembleClaims(args));
  });

  it("produces stable sort: forbidden sorted by predicate then subjectId", () => {
    const state = createNewGameState(db);
    const ids = Object.keys(state.standing);
    const speaker = ids[0]!;
    // Create two subjects with different residences for multi-entry forbidden check
    const s1 = ids[1]!;
    const s2 = ids[2]!;
    state.standing[speaker]!.residence = "xianfu_palace";
    state.standing[s1]!.residence = "changchun_palace";
    state.standing[s2]!.residence = "chengqian_palace";
    const mem: MemoryEntry = {
      id: "m_res2",
      ownerId: speaker,
      kind: "episodic",
      subjectIds: [speaker, s1, s2],
      perspective: "witness",
      summary: "曾同住",
      strength: 50,
      retention: "slow",
      emotions: {},
      triggerTags: ["residence"],
      unresolved: false,
      createdAt: makeGameTime(1, 1, "early"),
    };
    const ctx: DialogueMemoryContext = { activatedMemories: [mem], knownEvents: [] };
    const beliefs = new GroundTruthBeliefProjection(state);
    const out = assembleClaims({
      speakerId: speaker,
      reactionPlan: plan(),
      memoryContext: ctx,
      beliefs,
      state,
      audience: defaultAudience,
    });
    // forbidden should be sorted by predicate then subjectId
    const sorted = [...out.forbidden].sort((a, b) =>
      a.predicate < b.predicate ? -1 : a.predicate > b.predicate ? 1
        : a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0,
    );
    expect(out.forbidden).toEqual(sorted);
  });
});

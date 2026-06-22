// tests/dialogue/claimAssembler.test.ts
import { describe, it, expect } from "vitest";
import {
  isLatestFactMutation,
  eventToAuthorizedClaims,
  assembleClaims,
} from "../../src/engine/dialogue/claimAssembler";
import { GroundTruthBeliefProjection } from "../../src/engine/chronicle/belief";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";
import type { CourtEvent, GameState, MemoryEntry } from "../../src/engine/state/types";
import type { ContextRef } from "../../src/engine/dialogue/types";
import type { BuiltReaction } from "../../src/engine/dialogue/reactionAssembler";
import { makeGameTime, type MonthPeriod } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Convert a 0-based dayIndex into (year, month, period) for makeGameTime.
 * dayIndex = ((year-1)*12 + (month-1))*3 + periodOrdinal
 * period ordinals: early=0, mid=1, late=2
 */
function gameTimeFromDay(dayIndex: number): ReturnType<typeof makeGameTime> {
  const periodOrdinal = dayIndex % 3;
  const totalMonths = Math.floor(dayIndex / 3);
  const year = Math.floor(totalMonths / 12) + 1;
  const month = (totalMonths % 12) + 1;
  const periods: MonthPeriod[] = ["early", "mid", "late"];
  return makeGameTime(year, month, periods[periodOrdinal]!);
}

function makeRankChangedEvent(
  id: string,
  subjectId: string,
  fromRank: string,
  toRank: string,
  dayIndex: number,
): CourtEvent {
  return {
    id,
    type: "rank_changed",
    occurredAt: gameTimeFromDay(dayIndex),
    participants: [{ charId: subjectId, role: "subject" }],
    payload: { from: fromRank, to: toRank, direction: "promote" },
    publicity: { scope: "palace", persistence: "institutional" },
    publicSalience: 80,
    retention: "slow",
    tags: [],
  };
}

function makeHeirBornEvent(id: string, heirId: string, dayIndex: number): CourtEvent {
  return {
    id,
    type: "heir_born",
    occurredAt: gameTimeFromDay(dayIndex),
    participants: [],
    payload: { heirId },
    publicity: { scope: "realm", persistence: "institutional" },
    publicSalience: 100,
    retention: "permanent",
    tags: [],
  };
}

function makeHeirDiedEvent(id: string, heirId: string, dayIndex: number): CourtEvent {
  return {
    id,
    type: "heir_died",
    occurredAt: gameTimeFromDay(dayIndex),
    participants: [],
    payload: { heirId },
    publicity: { scope: "palace", persistence: "institutional" },
    publicSalience: 90,
    retention: "permanent",
    tags: [],
  };
}

function makeUnknownEventType(id: string, dayIndex: number): CourtEvent {
  return {
    id,
    type: "punished",
    occurredAt: gameTimeFromDay(dayIndex),
    participants: [{ charId: "char_a", role: "punished" }],
    payload: {},
    publicity: { scope: "palace", persistence: "contemporaneous" },
    publicSalience: 30,
    retention: "fast",
    tags: [],
  };
}

const defaultAudience = {
  targetId: "player",
  targetRole: "sovereign" as const,
  presentCharacterIds: ["player"],
  privacy: "semi_private" as const,
};

const eventRef = (id: string): ContextRef => ({ kind: "event", id });

// ── isLatestFactMutation ───────────────────────────────────────────────────────

describe("isLatestFactMutation", () => {
  it("true for single mutation event", () => {
    const e = makeRankChangedEvent("evt_001", "char_a", "zhaoyi", "jieyu", 5);
    expect(isLatestFactMutation(e, [e])).toBe(true);
  });

  it("true for latest of multiple rank changes", () => {
    const e1 = makeRankChangedEvent("evt_001", "char_a", "zhaoyi", "jieyu", 2);
    const e2 = makeRankChangedEvent("evt_002", "char_a", "jieyu", "fengyi", 5);
    const chronicle = [e1, e2];
    expect(isLatestFactMutation(e2, chronicle)).toBe(true);
    expect(isLatestFactMutation(e1, chronicle)).toBe(false);
  });

  it("false for older rank change", () => {
    const e1 = makeRankChangedEvent("evt_001", "char_a", "zhaoyi", "jieyu", 2);
    const e2 = makeRankChangedEvent("evt_002", "char_a", "jieyu", "fengyi", 5);
    expect(isLatestFactMutation(e1, [e1, e2])).toBe(false);
  });

  it("false for cyclic rank change (away and back — old event not latest)", () => {
    // char_a promoted to jieyu (day 2), then demoted back to zhaoyi (day 5)
    const e1 = makeRankChangedEvent("evt_001", "char_a", "zhaoyi", "jieyu", 2);
    const e2 = makeRankChangedEvent("evt_002", "char_a", "jieyu", "zhaoyi", 5);
    expect(isLatestFactMutation(e1, [e1, e2])).toBe(false);
    expect(isLatestFactMutation(e2, [e1, e2])).toBe(true);
  });

  it("heir_born and heir_died share predicate×subject; latest wins", () => {
    const born = makeHeirBornEvent("evt_001", "heir_001", 3);
    const died = makeHeirDiedEvent("evt_002", "heir_001", 8);
    expect(isLatestFactMutation(died, [born, died])).toBe(true);
    expect(isLatestFactMutation(born, [born, died])).toBe(false);
  });

  it("false for heir_born after heir_died supersedes it", () => {
    // heir died (day 5) supersedes birth event (day 1)
    const born = makeHeirBornEvent("evt_001", "heir_001", 1);
    const died = makeHeirDiedEvent("evt_002", "heir_001", 5);
    expect(isLatestFactMutation(born, [born, died])).toBe(false);
  });

  it("tie-breaks same day by id desc", () => {
    // Same dayIndex — higher id wins (lexicographic desc)
    const e1 = makeRankChangedEvent("evt_001", "char_a", "zhaoyi", "jieyu", 5);
    const e2 = makeRankChangedEvent("evt_002", "char_a", "jieyu", "fengyi", 5);
    // "evt_002" > "evt_001" lexicographically → evt_002 is latest
    expect(isLatestFactMutation(e2, [e1, e2])).toBe(true);
    expect(isLatestFactMutation(e1, [e1, e2])).toBe(false);
  });
});

// ── eventToAuthorizedClaims ────────────────────────────────────────────────────

describe("eventToAuthorizedClaims", () => {
  it("rank_changed: both state check and latest-mutation must pass", () => {
    const state = createNewGameState(content.value);
    const subjectId = Object.keys(state.standing)[0]!;
    const targetRank = state.standing[subjectId]!.rank;
    const event = makeRankChangedEvent("evt_001", subjectId, "zhaoyi", targetRank, 1);
    const chronicle = [event];
    const claims = eventToAuthorizedClaims(event, state, eventRef("evt_001"), chronicle);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.claim.predicate).toBe("holds_rank");
    expect(claims[0]!.claim.subjectId).toBe(subjectId);
    expect(claims[0]!.claim.object).toBe(targetRank);
    expect(claims[0]!.claim.modality).toBe("assert");
    expect(claims[0]!.sourceRefs).toEqual([{ kind: "event", id: "evt_001" }]);
  });

  it("rank_changed fails state check → []", () => {
    const state = createNewGameState(content.value);
    const subjectId = Object.keys(state.standing)[0]!;
    // payload.to does NOT match current standing rank
    const event = makeRankChangedEvent("evt_001", subjectId, "zhaoyi", "wrong_rank_id", 1);
    const chronicle = [event];
    const claims = eventToAuthorizedClaims(event, state, eventRef("evt_001"), chronicle);
    expect(claims).toHaveLength(0);
  });

  it("rank_changed fails latest-mutation → []", () => {
    const state = createNewGameState(content.value);
    const subjectId = Object.keys(state.standing)[0]!;
    const currentRank = state.standing[subjectId]!.rank;
    // e1 is older, e2 is newer — e1 should fail isLatestFactMutation
    const e1 = makeRankChangedEvent("evt_001", subjectId, "zhaoyi", currentRank, 1);
    const e2 = makeRankChangedEvent("evt_002", subjectId, currentRank, currentRank, 3);
    const chronicle = [e1, e2];
    const claims = eventToAuthorizedClaims(e1, state, eventRef("evt_001"), chronicle);
    expect(claims).toHaveLength(0);
  });

  it("heir_born → alive assert when lifecycle='alive' AND latest", () => {
    const state = createNewGameState(content.value);
    const heirId = "heir_001";
    state.resources.bloodline.heirs.push({
      id: heirId,
      sex: "son",
      fatherId: null,
      bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"),
      favor: 50,
      legitimate: true,
      petName: "小宝",
      education: { scholarship: 0, martial: 0, virtue: 0 },
      health: 80,
      talent: 50,
      diligence: 50,
      ambition: 30,
      closeness: 60,
      support: 40,
      faction: "none",
      lifecycle: "alive",
    });
    const event = makeHeirBornEvent("evt_001", heirId, 1);
    const claims = eventToAuthorizedClaims(event, state, eventRef("evt_001"), [event]);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.claim.predicate).toBe("alive");
    expect(claims[0]!.claim.subjectId).toBe(heirId);
    expect(claims[0]!.claim.modality).toBe("assert");
  });

  it("heir_born → [] when no longer alive", () => {
    const state = createNewGameState(content.value);
    const heirId = "heir_001";
    state.resources.bloodline.heirs.push({
      id: heirId,
      sex: "son",
      fatherId: null,
      bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"),
      favor: 50,
      legitimate: true,
      petName: "小宝",
      education: { scholarship: 0, martial: 0, virtue: 0 },
      health: 0,
      talent: 50,
      diligence: 50,
      ambition: 30,
      closeness: 60,
      support: 40,
      faction: "none",
      lifecycle: "deceased",
      deceasedAt: makeGameTime(1, 1, "late"),
    });
    const born = makeHeirBornEvent("evt_001", heirId, 1);
    const claims = eventToAuthorizedClaims(born, state, eventRef("evt_001"), [born]);
    expect(claims).toHaveLength(0);
  });

  it("heir_died → alive deny when lifecycle≠'alive' AND latest", () => {
    const state = createNewGameState(content.value);
    const heirId = "heir_001";
    state.resources.bloodline.heirs.push({
      id: heirId,
      sex: "daughter",
      fatherId: null,
      bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"),
      favor: 30,
      legitimate: false,
      petName: "小花",
      education: { scholarship: 0, martial: 0, virtue: 0 },
      health: 0,
      talent: 40,
      diligence: 40,
      ambition: 20,
      closeness: 50,
      support: 20,
      faction: "none",
      lifecycle: "deceased",
      deceasedAt: makeGameTime(1, 2, "early"),
    });
    const born = makeHeirBornEvent("evt_001", heirId, 1);
    const died = makeHeirDiedEvent("evt_002", heirId, 5);
    const chronicle = [born, died];
    const claims = eventToAuthorizedClaims(died, state, eventRef("evt_002"), chronicle);
    expect(claims).toHaveLength(1);
    expect(claims[0]!.claim.predicate).toBe("alive");
    expect(claims[0]!.claim.modality).toBe("deny");
    expect(claims[0]!.claim.subjectId).toBe(heirId);
  });

  it("alive claim has no object field", () => {
    const state = createNewGameState(content.value);
    const heirId = "heir_alive_test";
    state.resources.bloodline.heirs.push({
      id: heirId,
      sex: "son",
      fatherId: null,
      bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"),
      favor: 50,
      legitimate: true,
      petName: "宝儿",
      education: { scholarship: 0, martial: 0, virtue: 0 },
      health: 90,
      talent: 60,
      diligence: 60,
      ambition: 40,
      closeness: 70,
      support: 50,
      faction: "none",
      lifecycle: "alive",
    });
    const event = makeHeirBornEvent("evt_001", heirId, 1);
    const claims = eventToAuthorizedClaims(event, state, eventRef("evt_001"), [event]);
    expect(claims).toHaveLength(1);
    expect("object" in claims[0]!.claim).toBe(false);
  });

  it("claim id deterministic", () => {
    const state = createNewGameState(content.value);
    const subjectId = Object.keys(state.standing)[0]!;
    const targetRank = state.standing[subjectId]!.rank;
    const event = makeRankChangedEvent("evt_001", subjectId, "zhaoyi", targetRank, 1);
    const chronicle = [event];
    const c1 = eventToAuthorizedClaims(event, state, eventRef("evt_001"), chronicle);
    const c2 = eventToAuthorizedClaims(event, state, eventRef("evt_001"), chronicle);
    expect(c1[0]!.claim.id).toBe(c2[0]!.claim.id);
    expect(c1[0]!.claim.id).toBe(`event:evt_001:holds_rank:${subjectId}:affirm`);
  });

  it("returns [] for non-whitelisted types; no crash when role absent", () => {
    const state = createNewGameState(content.value);
    const punished = makeUnknownEventType("evt_000", 1);
    const claims = eventToAuthorizedClaims(punished, state, eventRef("evt_000"), [punished]);
    expect(claims).toHaveLength(0);

    // rank_changed with no participants → no crash, returns []
    const noRole: CourtEvent = {
      ...makeRankChangedEvent("evt_010", "char_a", "zhaoyi", "jieyu", 1),
      participants: [],
    };
    const claims2 = eventToAuthorizedClaims(noRole, state, eventRef("evt_010"), [noRole]);
    expect(claims2).toHaveLength(0);
  });
});

// ── assembleClaims ─────────────────────────────────────────────────────────────

describe("assembleClaims", () => {
  function makeBaseArgs(state: GameState, offeredEvents: CourtEvent[] = [], offeredMemories: MemoryEntry[] = []) {
    const beliefs = new GroundTruthBeliefProjection(state);
    return {
      speakerId: "speaker",
      builtReaction: undefined as BuiltReaction | undefined,
      offeredMemories,
      offeredEvents,
      beliefs,
      state,
      audience: defaultAudience,
    };
  }

  it("aggregates by authorizedClaimAggKey (not claimFactKey alone)", () => {
    const state = createNewGameState(content.value);
    const subjectId = Object.keys(state.standing)[0]!;
    const targetRank = state.standing[subjectId]!.rank;
    // e2 is newer — only e2 passes isLatestFactMutation
    const e1 = makeRankChangedEvent("evt_001", subjectId, "zhaoyi", targetRank, 1);
    const e2 = makeRankChangedEvent("evt_002", subjectId, "zhaoyi", targetRank, 3);
    state.chronicle = [e1, e2];
    const out = assembleClaims(makeBaseArgs(state, [e1, e2]));
    const rankClaims = out.allowed.filter((c) => c.claim.predicate === "holds_rank" && c.claim.subjectId === subjectId);
    // e1 fails isLatestFactMutation → only e2 contributes
    expect(rankClaims.length).toBe(1);
    expect(rankClaims[0]!.claim.id).toContain("evt_002");
  });

  it("does NOT merge alive:affirm and alive:deny", () => {
    const state = createNewGameState(content.value);
    const heirId = "heir_merge_test";
    state.resources.bloodline.heirs.push({
      id: heirId,
      sex: "son",
      fatherId: null,
      bearer: "sovereign",
      birthAt: makeGameTime(1, 1, "early"),
      favor: 50,
      legitimate: true,
      petName: "试儿",
      education: { scholarship: 0, martial: 0, virtue: 0 },
      health: 0,
      talent: 50,
      diligence: 50,
      ambition: 30,
      closeness: 60,
      support: 40,
      faction: "none",
      lifecycle: "deceased",
    });
    const born = makeHeirBornEvent("evt_001", heirId, 1);
    const died = makeHeirDiedEvent("evt_002", heirId, 3);
    state.chronicle = [born, died];
    // born fails state check (lifecycle=deceased); died passes and is latest
    const out = assembleClaims(makeBaseArgs(state, [born, died]));
    const aliveClaims = out.allowed.filter((c) => c.claim.predicate === "alive" && c.claim.subjectId === heirId);
    expect(aliveClaims.every((c) => c.claim.modality === "deny")).toBe(true);
  });

  it("memory→event chain: skips if sourceEventId event not in offeredEvents", () => {
    const state = createNewGameState(content.value);
    const subjectId = Object.keys(state.standing)[0]!;
    const targetRank = state.standing[subjectId]!.rank;
    const event = makeRankChangedEvent("evt_001", subjectId, "zhaoyi", targetRank, 1);
    state.chronicle = [event];

    const memory: MemoryEntry = {
      id: "mem_001",
      ownerId: "speaker",
      kind: "episodic",
      sourceEventId: "evt_001", // points to event, but event NOT in offeredEvents
      subjectIds: [subjectId],
      perspective: "witness",
      summary: "晋位",
      strength: 70,
      retention: "slow",
      emotions: {},
      triggerTags: ["rank"],
      unresolved: false,
      createdAt: makeGameTime(1, 1, "early"),
    };

    // offeredEvents is EMPTY — event not in window
    const out = assembleClaims(makeBaseArgs(state, [], [memory]));
    expect(out.allowed.filter((c) => c.claim.predicate === "holds_rank")).toHaveLength(0);
  });

  it("memory→event chain: co-authorizes when event IS in offeredEvents", () => {
    const state = createNewGameState(content.value);
    const subjectId = Object.keys(state.standing)[0]!;
    const targetRank = state.standing[subjectId]!.rank;
    const event = makeRankChangedEvent("evt_001", subjectId, "zhaoyi", targetRank, 1);
    state.chronicle = [event];

    const memory: MemoryEntry = {
      id: "mem_001",
      ownerId: "speaker",
      kind: "episodic",
      sourceEventId: "evt_001",
      subjectIds: [subjectId],
      perspective: "witness",
      summary: "晋位",
      strength: 70,
      retention: "slow",
      emotions: {},
      triggerTags: ["rank"],
      unresolved: false,
      createdAt: makeGameTime(1, 1, "early"),
    };

    // offeredEvents includes event — memory co-authorizes it
    const out = assembleClaims(makeBaseArgs(state, [event], [memory]));
    const rankClaims = out.allowed.filter((c) => c.claim.predicate === "holds_rank" && c.claim.subjectId === subjectId);
    expect(rankClaims.length).toBe(1);
    // sourceRefs should include both the event ref and the memory ref
    const refs = rankClaims[0]!.sourceRefs;
    expect(refs.some((r) => r.kind === "event" && r.id === "evt_001")).toBe(true);
    expect(refs.some((r) => r.kind === "memory" && r.id === "mem_001")).toBe(true);
  });

  it("authored memory without sourceEventId generates no fact claims", () => {
    const state = createNewGameState(content.value);
    const memory: MemoryEntry = {
      id: "mem_no_src",
      ownerId: "speaker",
      kind: "episodic",
      // sourceEventId deliberately absent
      subjectIds: ["char_x"],
      perspective: "witness",
      summary: "某事",
      strength: 60,
      retention: "slow",
      emotions: {},
      triggerTags: [],
      unresolved: false,
      createdAt: makeGameTime(1, 1, "early"),
    };
    const out = assembleClaims(makeBaseArgs(state, [], [memory]));
    expect(out.allowed).toHaveLength(0);
  });

  it("builtReaction undefined → no event claims, no crash", () => {
    const state = createNewGameState(content.value);
    const out = assembleClaims(makeBaseArgs(state, []));
    expect(out.allowed).toHaveLength(0);
    expect(out.forbidden).toHaveLength(0);
  });

  it("excludes claim with empty sourceRefs from output", () => {
    // invariant: every allowed claim has at least one sourceRef
    const state = createNewGameState(content.value);
    const subjectId = Object.keys(state.standing)[0]!;
    const targetRank = state.standing[subjectId]!.rank;
    const event = makeRankChangedEvent("evt_001", subjectId, "zhaoyi", targetRank, 1);
    state.chronicle = [event];
    const out = assembleClaims(makeBaseArgs(state, [event]));
    for (const ac of out.allowed) {
      expect(ac.sourceRefs.length).toBeGreaterThan(0);
    }
  });

  it("forbiddenClaims are DialogueClaim[] (no source binding)", () => {
    const state = createNewGameState(content.value);
    const out = assembleClaims(makeBaseArgs(state));
    // T6: forbidden is always empty; T7 will populate it
    expect(out.forbidden).toEqual([]);
    for (const fc of out.forbidden) {
      expect("sourceRefs" in fc).toBe(false);
    }
  });
});

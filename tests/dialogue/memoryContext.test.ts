import { describe, expect, it } from "vitest";
import { buildMemoryContext, recallKnownEvents, selectPromptEvents, selectPromptEventsByActivation } from "../../src/engine/dialogue/memoryContext";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent, MemoryEntry } from "../../src/engine/state/types";

// ── helpers ──────────────────────────────────────────────────────────────────

function mem(over: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "mem_a_000001", ownerId: "a", kind: "impression", subjectIds: ["player"], perspective: "witness",
    summary: "x", strength: 50, retention: "slow", emotions: {}, triggerTags: ["t"], unresolved: false,
    createdAt: makeGameTime(1, 1, "early"), ...over,
  };
}

function evt(over: Partial<CourtEvent>): CourtEvent {
  return {
    id: "evt_000001",
    type: "rank_changed",
    occurredAt: makeGameTime(1, 1, "early"),
    participants: [{ charId: "consort_gu", role: "subject" }],
    payload: {},
    publicity: { scope: "palace", persistence: "institutional" },
    publicSalience: 50,
    retention: "slow",
    tags: [],
    ...over,
  };
}

// ── existing test (preserved) ─────────────────────────────────────────────────

describe("buildMemoryContext (legacy)", () => {
  it("召回→精排→产出 activatedMemories（高分在前，确定性）", () => {
    const s = createInitialState({ calendar: { month: 2 } });
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    const m = (id: string, strength: number): MemoryEntry => ({
      id, ownerId: "a", kind: "impression", subjectIds: ["x"], perspective: "witness", summary: "x",
      strength, retention: "slow", emotions: {}, triggerTags: ["t"], unresolved: false, createdAt: makeGameTime(1, 1, "early"),
    });
    s.memories["a"] = { nextSeq: 3, entries: [m("mem_a_1", 90), m("mem_a_2", 80)] };
    const ctx = { now: makeGameTime(1, 2, "early"), topicTags: ["t"], subjectIds: [], presentCharacterIds: [], audienceId: "player", speakerId: "a" };
    const out = buildMemoryContext(s, { speakerId: "a", topicTags: ["t"] }, ctx, 5);
    expect(out.activatedMemories.length).toBeGreaterThan(0);
    expect(out.activatedMemories[0]!.strength).toBeGreaterThanOrEqual(out.activatedMemories.at(-1)!.strength);
    expect(buildMemoryContext(s, { speakerId: "a", topicTags: ["t"] }, ctx, 5)).toEqual(out);
  });
});

// ── recallKnownEvents ─────────────────────────────────────────────────────────

describe("buildMemoryContext memory/event quota (P1)", () => {
  it("a relevant memory survives even when more than five events outscore it", () => {
    const s = createInitialState({ calendar: { month: 3 } });
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    s.memories["a"] = {
      nextSeq: 2,
      entries: [mem({ id: "mem_relevant", ownerId: "a", strength: 50, triggerTags: ["t"], subjectIds: ["x"] })],
    };
    // 6 high-salience, recent events that all match the topic → they outscore the memory
    for (let i = 0; i < 6; i++) {
      s.chronicle.push(evt({
        id: `evt_hi_${i}`,
        tags: ["t"],
        publicity: { scope: "palace", persistence: "institutional" },
        occurredAt: makeGameTime(1, 2, "early"),
        publicSalience: 70 + i * 5,
      }));
    }
    const ctx = { now: makeGameTime(1, 3, "early"), topicTags: ["t"], subjectIds: [], presentCharacterIds: [], audienceId: "player", speakerId: "a" };
    const out = buildMemoryContext(s, { speakerId: "a", topicTags: ["t"] }, ctx, 5);
    expect(out.activatedMemories.map((m) => m.id)).toContain("mem_relevant");
  });
});

describe("recallKnownEvents", () => {
  it("returns all canKnowEvent events for the speaker", () => {
    const s = createInitialState({ calendar: { month: 3 } });
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    // realm event → everyone knows it
    s.chronicle.push(evt({ id: "evt_000001", publicity: { scope: "realm", persistence: "institutional" }, occurredAt: makeGameTime(1, 2, "early") }));
    // palace institutional → a knows it (entered before)
    s.chronicle.push(evt({ id: "evt_000002", publicity: { scope: "palace", persistence: "institutional" }, occurredAt: makeGameTime(1, 2, "mid") }));

    const result = recallKnownEvents(s, "a");
    expect(result.map((e) => e.id)).toContain("evt_000001");
    expect(result.map((e) => e.id)).toContain("evt_000002");
  });

  it("includes events where speakerId is a participant", () => {
    const s = createInitialState({ calendar: { month: 3 } });
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    // circle event that includes "a"
    s.chronicle.push(evt({
      id: "evt_000001",
      participants: [{ charId: "a", role: "target" }],
      publicity: { scope: "circle", circleIds: ["a"] },
      occurredAt: makeGameTime(1, 2, "early"),
    }));

    const result = recallKnownEvents(s, "a");
    expect(result.map((e) => e.id)).toContain("evt_000001");
  });

  it("excludes events the speaker cannot know (contemporaneous, entered after)", () => {
    const s = createInitialState({ calendar: { month: 3 } });
    // newcomer entered in month 2
    s.standing["newcomer"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 2, "early") };
    // palace contemporaneous event from month 1 — newcomer was not in palace
    s.chronicle.push(evt({
      id: "evt_000001",
      occurredAt: makeGameTime(1, 1, "early"),
      publicity: { scope: "palace", persistence: "contemporaneous" },
    }));

    const result = recallKnownEvents(s, "newcomer");
    expect(result.map((e) => e.id)).not.toContain("evt_000001");
  });

  it("no salience quota — returns all qualifying events without cap", () => {
    const s = createInitialState({ calendar: { month: 6 } });
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    // push 25 realm events (more than any typical limit)
    for (let i = 1; i <= 25; i++) {
      s.chronicle.push(evt({
        id: `evt_${String(i).padStart(6, "0")}`,
        occurredAt: makeGameTime(1, 2, "early"),
        publicity: { scope: "realm", persistence: "institutional" },
        publicSalience: i,
      }));
    }

    const result = recallKnownEvents(s, "a");
    expect(result.length).toBe(25);
  });
});

// ── selectPromptEvents ────────────────────────────────────────────────────────

describe("selectPromptEvents", () => {
  const e1 = evt({ id: "evt_000001", publicSalience: 80, occurredAt: makeGameTime(1, 2, "early") });
  const e2 = evt({ id: "evt_000002", publicSalience: 60, occurredAt: makeGameTime(1, 2, "mid") });
  const e3 = evt({ id: "evt_000003", publicSalience: 60, occurredAt: makeGameTime(1, 2, "late") });
  const e4 = evt({ id: "evt_000004", publicSalience: 40, occurredAt: makeGameTime(1, 1, "early") });

  it("throws when limit < 1", () => {
    expect(() => selectPromptEvents({ events: [e1], limit: 0 })).toThrow();
    expect(() => selectPromptEvents({ events: [e1], limit: -5 })).toThrow();
  });

  it("throws when pinnedEventId not found in events", () => {
    expect(() => selectPromptEvents({ events: [e1, e2], pinnedEventId: "evt_999999", limit: 3 })).toThrow();
  });

  it("always includes pinnedEventId first when valid", () => {
    const result = selectPromptEvents({ events: [e1, e2, e3, e4], pinnedEventId: "evt_000004", limit: 3 });
    expect(result[0]!.id).toBe("evt_000004");
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("fills remaining by publicSalience desc → occurredAt desc → id asc", () => {
    // limit=3, no pin; e1 salience=80 → first; e2 & e3 both salience=60
    // e3 has later occurredAt → e3 second, e2 third
    const result = selectPromptEvents({ events: [e1, e2, e3, e4], limit: 3 });
    expect(result[0]!.id).toBe("evt_000001"); // highest salience
    expect(result[1]!.id).toBe("evt_000003"); // salience tie, later occurredAt
    expect(result[2]!.id).toBe("evt_000002"); // salience tie, earlier occurredAt
    expect(result).toHaveLength(3);
  });

  it("result.length <= limit", () => {
    const result = selectPromptEvents({ events: [e1, e2], limit: 10 });
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result.length).toBe(2); // only 2 events available
  });

  it("is deterministic (id asc tiebreak for same salience+date)", () => {
    const ea = evt({ id: "evt_000010", publicSalience: 50, occurredAt: makeGameTime(1, 1, "early") });
    const eb = evt({ id: "evt_000020", publicSalience: 50, occurredAt: makeGameTime(1, 1, "early") });
    const r1 = selectPromptEvents({ events: [ea, eb], limit: 2 });
    const r2 = selectPromptEvents({ events: [eb, ea], limit: 2 });
    expect(r1.map((e) => e.id)).toEqual(["evt_000010", "evt_000020"]);
    expect(r2.map((e) => e.id)).toEqual(["evt_000010", "evt_000020"]);
  });
});

// ── buildMemoryContext extended ───────────────────────────────────────────────

describe("buildMemoryContext extended", () => {
  it("5th opts optional — 4-arg callers unchanged (knownEventsAll present)", () => {
    const s = createInitialState({ calendar: { month: 2 } });
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    s.memories["a"] = { nextSeq: 2, entries: [mem({ id: "mem_a_1", ownerId: "a" })] };
    const ctx = { now: makeGameTime(1, 2, "early"), topicTags: ["t"], subjectIds: [], presentCharacterIds: [], audienceId: "player", speakerId: "a" };
    // 4-arg call — must still compile and return knownEventsAll
    const out = buildMemoryContext(s, { speakerId: "a", topicTags: ["t"] }, ctx, 5);
    expect(out).toHaveProperty("knownEventsAll");
    expect(Array.isArray(out.knownEventsAll)).toBe(true);
  });

  it("opts.topEvents (default 3) controls how many events in knownEvents", () => {
    const s = createInitialState({ calendar: { month: 6 } });
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    // 5 realm events
    for (let i = 1; i <= 5; i++) {
      s.chronicle.push(evt({
        id: `evt_${String(i).padStart(6, "0")}`,
        occurredAt: makeGameTime(1, 2, "early"),
        publicity: { scope: "realm", persistence: "institutional" },
        publicSalience: i * 10,
      }));
    }
    const ctx = { now: makeGameTime(1, 6, "early"), topicTags: [], subjectIds: [], presentCharacterIds: [], audienceId: "player", speakerId: "a" };
    // default topEvents=3
    const out3 = buildMemoryContext(s, { speakerId: "a" }, ctx, 5);
    expect(out3.knownEvents.length).toBeLessThanOrEqual(3);
    // explicit topEvents=2
    const out2 = buildMemoryContext(s, { speakerId: "a" }, ctx, 5, { topEvents: 2 });
    expect(out2.knownEvents.length).toBeLessThanOrEqual(2);
  });

  it("knownEventsAll is unquota'd — returns all known events regardless of topEvents", () => {
    const s = createInitialState({ calendar: { month: 6 } });
    s.standing["a"] = { rank: "meiren", favor: 50, peakFavor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    for (let i = 1; i <= 10; i++) {
      s.chronicle.push(evt({
        id: `evt_${String(i).padStart(6, "0")}`,
        occurredAt: makeGameTime(1, 2, "early"),
        publicity: { scope: "realm", persistence: "institutional" },
        publicSalience: i * 5,
      }));
    }
    const ctx = { now: makeGameTime(1, 6, "early"), topicTags: [], subjectIds: [], presentCharacterIds: [], audienceId: "player", speakerId: "a" };
    const out = buildMemoryContext(s, { speakerId: "a" }, ctx, 5, { topEvents: 3 });
    // knownEventsAll must include all 10 events
    expect(out.knownEventsAll.length).toBe(10);
    // knownEvents capped at topEvents
    expect(out.knownEvents.length).toBeLessThanOrEqual(3);
  });
});

// ── selectPromptEventsByActivation (PR-A item 9) ─────────────────────────────

describe("selectPromptEventsByActivation", () => {
  const actCtx = (over = {}) => ({
    now: makeGameTime(5, 1, "early"),
    topicTags: [] as string[],
    subjectIds: [] as string[],
    presentCharacterIds: [] as string[],
    audienceId: "player",
    speakerId: "a",
    ...over,
  });

  it("a relevant, fresh event outranks an old high-salience irrelevant one", () => {
    const s = createInitialState();
    const oldHigh = evt({
      id: "evt_old_high",
      publicSalience: 95,
      retention: "fast",
      occurredAt: makeGameTime(1, 1, "early"),
      tags: ["court_history"],
    });
    const freshRelevant = evt({
      id: "evt_fresh_topic",
      publicSalience: 50,
      retention: "fast",
      occurredAt: makeGameTime(5, 1, "early"),
      tags: ["today"],
    });
    const out = selectPromptEventsByActivation({
      state: s,
      events: [oldHigh, freshRelevant],
      ctx: actCtx({ topicTags: ["today"] }),
      limit: 1,
    });
    expect(out.map((e) => e.id)).toEqual(["evt_fresh_topic"]);
  });

  it("pins the reaction source event first regardless of its activation score", () => {
    const s = createInitialState();
    const big = evt({ id: "evt_big", publicSalience: 99, occurredAt: makeGameTime(5, 1, "early") });
    const tiny = evt({ id: "evt_tiny", publicSalience: 1, occurredAt: makeGameTime(1, 1, "early") });
    const out = selectPromptEventsByActivation({
      state: s,
      events: [big, tiny],
      ctx: actCtx(),
      pinnedEventId: "evt_tiny",
      limit: 2,
    });
    expect(out[0]!.id).toBe("evt_tiny");
  });

  it("respects the limit", () => {
    const s = createInitialState();
    const events = Array.from({ length: 5 }, (_, i) => evt({ id: `evt_${i}`, publicSalience: i * 10 }));
    const out = selectPromptEventsByActivation({ state: s, events, ctx: actCtx(), limit: 3 });
    expect(out.length).toBe(3);
  });
});

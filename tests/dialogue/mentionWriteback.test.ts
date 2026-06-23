import { describe, it, expect } from "vitest";
import { recordMentionedContext } from "../../src/engine/dialogue/mentionWriteback";
import { createNewGameState } from "../../src/engine/state/newGame";
import { recentMentionPenalty } from "../../src/engine/dialogue/mention";
import type { ProposedClaim, ContextRef } from "../../src/engine/dialogue/claims";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const now = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

const memRef = (id: string): ContextRef => ({ kind: "memory", id });
const evtRef = (id: string): ContextRef => ({ kind: "event", id });
// offeredRefKeys uses contextRefKey format: "kind:id"
const memKey = (id: string) => `memory:${id}`;
const evtKey = (id: string) => `event:${id}`;

const accepted = (sourceRefs: ContextRef[]): ProposedClaim => ({
  claim: { id: "c", predicate: "resides_at", subjectId: "x", object: "y", modality: "assert" },
  sourceRefs,
  modality: "assert",
  certainty: 90,
});

describe("recordMentionedContext", () => {
  it("writes a mention for each offered memory sourceRef and raises that memory's penalty", () => {
    const s0 = createNewGameState(db);
    const offered = new Set([memKey("mem_1")]);
    const s1 = recordMentionedContext(
      s0,
      [accepted([memRef("mem_1")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
    );
    expect(s1.mentionLog.length).toBeGreaterThan(s0.mentionLog.length);
    const p = recentMentionPenalty(s1, {
      speakerId: "shen_zhibai",
      audienceId: "player",
      memoryId: "mem_1",
      now,
    });
    expect(p).toBeGreaterThan(0);
  });

  it("writes MemoryMentionRecord for kind='memory' only", () => {
    const s0 = createNewGameState(db);
    const offered = new Set([memKey("mem_1"), evtKey("evt_001")]);
    // One memory ref + one event ref — only memory should be written
    const s1 = recordMentionedContext(
      s0,
      [accepted([memRef("mem_1"), evtRef("evt_001")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
    );
    // Only mem_1 is a memory → only 1 mention written
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length + 1);
  });

  it("ignores kind='event' sourceRef (no mention written)", () => {
    const s0 = createNewGameState(db);
    const offered = new Set([evtKey("evt_001")]);
    const s1 = recordMentionedContext(
      s0,
      [accepted([evtRef("evt_001")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
    );
    // event ref → not written to mentionLog
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("never writes a source id that was not offered (defense in depth)", () => {
    const s0 = createNewGameState(db);
    const s1 = recordMentionedContext(
      s0,
      [accepted([memRef("mem_X")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      new Set([memKey("mem_1")]),
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("dedupes repeated source ids across accepted claims", () => {
    const s0 = createNewGameState(db);
    const offered = new Set([memKey("mem_1")]);
    const s1 = recordMentionedContext(
      s0,
      [accepted([memRef("mem_1")]), accepted([memRef("mem_1")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length + 1);
  });

  it("returns unchanged state when acceptedClaims is empty", () => {
    const s0 = createNewGameState(db);
    const s1 = recordMentionedContext(
      s0,
      [],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      new Set([memKey("mem_1")]),
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("returns unchanged state when offeredRefKeys is empty", () => {
    const s0 = createNewGameState(db);
    const s1 = recordMentionedContext(
      s0,
      [accepted([memRef("mem_1")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      new Set(),
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("writes mentions for multiple distinct offered memory source ids", () => {
    const s0 = createNewGameState(db);
    const offered = new Set([memKey("mem_1"), memKey("mem_2")]);
    const s1 = recordMentionedContext(
      s0,
      [accepted([memRef("mem_1"), memRef("mem_2")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length + 2);
  });

  it("filters out ids not in offered even when mixed with valid ids", () => {
    const s0 = createNewGameState(db);
    const offered = new Set([memKey("mem_1")]);
    // sourceRefs has memory refs both offered and non-offered
    const s1 = recordMentionedContext(
      s0,
      [accepted([memRef("mem_1"), memRef("mem_X"), memRef("mem_Y")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
    );
    // only mem_1 is offered → only 1 mention
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length + 1);
  });

  it("does not confuse memory ref with event ref sharing the same bare id", () => {
    const s0 = createNewGameState(db);
    // only an event ref offered, not a memory ref — must NOT write mention
    const offered = new Set([evtKey("shared_id")]);
    const s1 = recordMentionedContext(
      s0,
      [accepted([memRef("shared_id")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("does not mutate the original state", () => {
    const s0 = createNewGameState(db);
    const original = s0.mentionLog.length;
    recordMentionedContext(
      s0,
      [accepted([memRef("mem_1")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      new Set([memKey("mem_1")]),
    );
    expect(s0.mentionLog.length).toBe(original);
  });
});

// ── PR-A item 6: mentionedContextRefs decouples cooldown from claims ──────────

describe("recordMentionedContext — mentionedContextRefs (no claim required)", () => {
  it("logs a mention for a memory the model referenced even with NO accepted claim", () => {
    const s0 = createNewGameState(db);
    const offered = new Set([memKey("mem_1")]);
    const s1 = recordMentionedContext(
      s0,
      [], // no claims at all
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
      [memRef("mem_1")],
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length + 1);
    const p = recentMentionPenalty(s1, {
      speakerId: "shen_zhibai",
      audienceId: "player",
      memoryId: "mem_1",
      now,
    });
    expect(p).toBeGreaterThan(0);
  });

  it("ignores event-kind mentionedContextRefs (only memories cool down)", () => {
    const s0 = createNewGameState(db);
    const offered = new Set([evtKey("evt_001")]);
    const s1 = recordMentionedContext(
      s0,
      [],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
      [evtRef("evt_001")],
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("never logs a mentionedContextRef that was not offered (defense in depth)", () => {
    const s0 = createNewGameState(db);
    const s1 = recordMentionedContext(
      s0,
      [],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      new Set([memKey("mem_1")]),
      [memRef("mem_hallucinated")],
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("dedupes a memory referenced both as a claim source and a mentionedContextRef", () => {
    const s0 = createNewGameState(db);
    const offered = new Set([memKey("mem_1")]);
    const s1 = recordMentionedContext(
      s0,
      [accepted([memRef("mem_1")])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
      [memRef("mem_1")],
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length + 1);
  });
});

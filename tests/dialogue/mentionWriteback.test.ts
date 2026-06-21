import { describe, it, expect } from "vitest";
import { recordMentionedContext } from "../../src/engine/dialogue/mentionWriteback";
import { createNewGameState } from "../../src/engine/state/newGame";
import { recentMentionPenalty } from "../../src/engine/dialogue/mention";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const now = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

const accepted = (sourceContextIds: string[]): ProposedClaim => ({
  claim: { id: "c", predicate: "resides_at", subjectId: "x", object: "y", modality: "assert" },
  sourceContextIds,
  modality: "assert",
  certainty: 90,
});

describe("recordMentionedContext", () => {
  it("writes a mention for each offered sourceContextId and raises that memory's penalty", () => {
    const s0 = createNewGameState(db);
    const offered = new Set(["mem_1"]);
    const s1 = recordMentionedContext(
      s0,
      [accepted(["mem_1"])],
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

  it("never writes a source id that was not offered (defense in depth)", () => {
    const s0 = createNewGameState(db);
    const s1 = recordMentionedContext(
      s0,
      [accepted(["mem_X"])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      new Set(["mem_1"]),
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("dedupes repeated source ids across accepted claims", () => {
    const s0 = createNewGameState(db);
    const offered = new Set(["mem_1"]);
    const s1 = recordMentionedContext(
      s0,
      [accepted(["mem_1"]), accepted(["mem_1"])],
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
      new Set(["mem_1"]),
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("returns unchanged state when offeredContextIds is empty", () => {
    const s0 = createNewGameState(db);
    const s1 = recordMentionedContext(
      s0,
      [accepted(["mem_1"])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      new Set(),
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length);
  });

  it("writes mentions for multiple distinct offered source ids", () => {
    const s0 = createNewGameState(db);
    const offered = new Set(["mem_1", "mem_2"]);
    const s1 = recordMentionedContext(
      s0,
      [accepted(["mem_1", "mem_2"])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
    );
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length + 2);
  });

  it("filters out ids not in offered even when mixed with valid ids", () => {
    const s0 = createNewGameState(db);
    const offered = new Set(["mem_1"]);
    // sourceContextIds has both offered and non-offered
    const s1 = recordMentionedContext(
      s0,
      [accepted(["mem_1", "mem_X", "mem_Y"])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      offered,
    );
    // only mem_1 is offered → only 1 mention
    expect(s1.mentionLog.length).toBe(s0.mentionLog.length + 1);
  });

  it("does not mutate the original state", () => {
    const s0 = createNewGameState(db);
    const original = s0.mentionLog.length;
    recordMentionedContext(
      s0,
      [accepted(["mem_1"])],
      { speakerId: "shen_zhibai", audienceId: "player", now },
      new Set(["mem_1"]),
    );
    expect(s0.mentionLog.length).toBe(original);
  });
});

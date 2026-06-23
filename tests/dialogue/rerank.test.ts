import { describe, expect, it } from "vitest";
import { rankCandidates } from "../../src/engine/dialogue/rerank";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { MemoryEntry } from "../../src/engine/state/types";

const m = (id: string, over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id, ownerId: "a", kind: "impression", subjectIds: ["x"], perspective: "witness",
  summary: "x", strength: 80, retention: "slow", emotions: {}, triggerTags: [], unresolved: false,
  createdAt: makeGameTime(1, 1, "early"), ...over,
});
const ctx = { now: makeGameTime(1, 2, "early"), topicTags: [], subjectIds: [], presentCharacterIds: [], audienceId: "player", speakerId: "a" };

describe("rankCandidates", () => {
  it("过门槛者按分降序、top-N、确定性；低于门槛被剔", () => {
    const s = createInitialState();
    const recalled = { memories: [m("mem_a_1", { strength: 90 }), m("mem_a_2", { strength: 5, retention: "fast", createdAt: makeGameTime(1, 1, "early") })], events: [] };
    const ranked = rankCandidates(s, ctx, recalled, 5);
    expect(ranked[0]!.kind).toBe("memory");
    expect(ranked.map((c) => c.kind === "memory" && c.memory.id)).toContain("mem_a_1");
    expect(ranked.every((c) => c.score >= 25 || (c.kind === "memory" && c.memory.retention === "permanent"))).toBe(true);
    expect(rankCandidates(s, ctx, recalled, 5)).toEqual(rankCandidates(s, ctx, recalled, 5));
  });
  it("permanent 永过门槛（即便有效强度低）", () => {
    const s = createInitialState();
    const recalled = { memories: [m("mem_a_3", { strength: 1, retention: "permanent" })], events: [] };
    expect(rankCandidates(s, ctx, recalled, 5).some((c) => c.kind === "memory" && c.memory.id === "mem_a_3")).toBe(true);
  });
});

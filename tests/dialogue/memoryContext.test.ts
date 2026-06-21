import { describe, expect, it } from "vitest";
import { buildMemoryContext } from "../../src/engine/dialogue/memoryContext";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { MemoryEntry } from "../../src/engine/state/types";

describe("buildMemoryContext", () => {
  it("召回→精排→产出 activatedMemories（高分在前，确定性）", () => {
    const s = createInitialState({ calendar: { month: 2 } });
    s.standing["a"] = { rank: "meiren", favor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    const m = (id: string, strength: number): MemoryEntry => ({
      id, ownerId: "a", kind: "impression", subjectIds: ["x"], perspective: "witness", summary: "x",
      strength, retention: "slow", emotions: {}, triggerTags: ["t"], unresolved: false, createdAt: makeGameTime(1, 1, "early"),
    });
    s.memories["a"] = { nextSeq: 3, entries: [m("mem_a_1", 90), m("mem_a_2", 80)] };
    const ctx = { now: makeGameTime(1, 2, "early"), topicTags: ["t"], presentCharacterIds: [], audienceId: "player", speakerId: "a" };
    const out = buildMemoryContext(s, { speakerId: "a", topicTags: ["t"] }, ctx, 5);
    expect(out.activatedMemories.length).toBeGreaterThan(0);
    expect(out.activatedMemories[0]!.strength).toBeGreaterThanOrEqual(out.activatedMemories.at(-1)!.strength);
    expect(buildMemoryContext(s, { speakerId: "a", topicTags: ["t"] }, ctx, 5)).toEqual(out);
  });
});

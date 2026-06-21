import { describe, expect, it } from "vitest";
import { recallCandidates } from "../../src/engine/dialogue/recall";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { MemoryEntry } from "../../src/engine/state/types";

function mem(over: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "mem_a_000001", ownerId: "a", kind: "impression", subjectIds: ["player"], perspective: "witness",
    summary: "x", strength: 50, retention: "slow", emotions: {}, triggerTags: [], unresolved: false,
    createdAt: makeGameTime(1, 1, "early"), ...over,
  };
}

describe("recallCandidates", () => {
  it("召回说话人高 strength 私人记忆（确定性、限量）", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.standing["a"] = { rank: "meiren", favor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    s.memories["a"] = { nextSeq: 4, entries: [
      mem({ id: "mem_a_000001", strength: 90, triggerTags: ["heir"] }),
      mem({ id: "mem_a_000002", strength: 20 }),
      mem({ id: "mem_a_000003", strength: 80, subjectIds: ["consort_gu"] }),
    ]};
    const out = recallCandidates(s, { speakerId: "a", topicTags: ["heir"] }, 20);
    expect(out.memories.map((m) => m.id)).toContain("mem_a_000001"); // 命中 topic
    expect(out.memories[0]!.strength).toBeGreaterThanOrEqual(out.memories.at(-1)!.strength); // strength desc
    expect(recallCandidates(s, { speakerId: "a" })).toEqual(recallCandidates(s, { speakerId: "a" })); // 确定性
  });
  it("只召回说话人【可知】的 chronicle 事件", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.standing["newcomer"] = { rank: "meiren", favor: 50, palaceEnteredAt: makeGameTime(1, 6, "mid") };
    s.chronicle.push({
      id: "evt_000001", type: "rank_changed", occurredAt: makeGameTime(1, 3, "mid"),
      participants: [{ charId: "consort_gu", role: "subject" }], payload: {},
      publicity: { scope: "palace", persistence: "contemporaneous" }, publicSalience: 60, retention: "slow", tags: ["demotion"],
    });
    // newcomer 三月之后才入宫 + contemporaneous → 不可知
    const out = recallCandidates(s, { speakerId: "newcomer", topicTags: ["demotion"] });
    expect(out.events).toHaveLength(0);
  });
});

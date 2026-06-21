import { describe, expect, it } from "vitest";
import { retrievalScore } from "../../src/engine/dialogue/retrievalScore";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { MemoryEntry } from "../../src/engine/state/types";

const trauma = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: "mem_a_1", ownerId: "a", kind: "trauma", subjectIds: ["heir_7"], perspective: "parent",
  summary: "夭折", strength: 100, retention: "permanent", emotions: { grief: 95 },
  triggerTags: ["death", "heir", "anniversary"], unresolved: true, createdAt: makeGameTime(1, 5, "mid"), ...over,
});
const ctx = (over = {}) => ({ now: makeGameTime(3, 1, "early"), topicTags: [], presentCharacterIds: [], audienceId: "player", speakerId: "a", ...over });

describe("retrievalScore 乘加混合", () => {
  it("permanent 创伤：日常问安（无任何 match）得低分；忌辰得高分（加项独立抬分，不被 topic=0 清零）", () => {
    const s = createInitialState();
    const idle = retrievalScore(s, trauma(), ctx({ topicTags: ["greeting"] }));
    const anniv = retrievalScore(s, trauma(), ctx({ now: makeGameTime(3, 5, "mid"), topicTags: ["greeting"] })); // 同月→忌辰
    expect(anniv).toBeGreaterThan(idle);
  });
  it("话题命中放大有效强度", () => {
    const s = createInitialState();
    const noTopic = retrievalScore(s, trauma(), ctx());
    const onTopic = retrievalScore(s, trauma(), ctx({ topicTags: ["heir"] }));
    expect(onTopic).toBeGreaterThan(noTopic);
  });
  it("在场当事人加分", () => {
    const s = createInitialState();
    const base = retrievalScore(s, trauma(), ctx());
    const present = retrievalScore(s, trauma(), ctx({ presentCharacterIds: ["heir_7"] }));
    expect(present).toBeGreaterThan(base);
  });
  it("确定性", () => {
    const s = createInitialState();
    expect(retrievalScore(s, trauma(), ctx())).toBe(retrievalScore(s, trauma(), ctx()));
  });
});

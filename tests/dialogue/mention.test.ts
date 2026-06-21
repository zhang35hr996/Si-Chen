import { describe, expect, it } from "vitest";
import { appendMention, recentMentionPenalty, MENTION_BOUNDS } from "../../src/engine/dialogue/mention";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";

const now = makeGameTime(2, 1, "early");
const rec = (over = {}) => ({ speakerId: "a", audienceId: "player", memoryId: "mem_a_1", mentionedAt: now, ...over });

describe("mention 冷却", () => {
  it("刚对同一人提过同一记忆 → 高罚；对别人 → 低罚；没提过 → 0", () => {
    const s = appendMention(createInitialState(), rec());
    const samePerson = recentMentionPenalty(s, { speakerId: "a", audienceId: "player", memoryId: "mem_a_1", now });
    const otherPerson = recentMentionPenalty(s, { speakerId: "a", audienceId: "consort_b", memoryId: "mem_a_1", now });
    expect(samePerson).toBeGreaterThan(otherPerson);
    expect(recentMentionPenalty(s, { speakerId: "a", audienceId: "player", memoryId: "mem_other", now })).toBe(0);
  });
  it("超窗口的旧提及不再罚", () => {
    const old = makeGameTime(1, 1, "early"); // 远早于 now
    const s = appendMention(createInitialState(), rec({ mentionedAt: old }));
    expect(recentMentionPenalty(s, { speakerId: "a", audienceId: "player", memoryId: "mem_a_1", now })).toBe(0);
  });
  it("有界裁剪：每 speaker 不超过 MAX", () => {
    let s = createInitialState();
    for (let i = 0; i < MENTION_BOUNDS.MAX_MENTIONS_PER_CHARACTER + 30; i++) {
      s = appendMention(s, rec({ memoryId: `mem_a_${i}`, mentionedAt: { ...now, dayIndex: now.dayIndex + i } }));
    }
    expect(s.mentionLog.filter((m) => m.speakerId === "a").length).toBeLessThanOrEqual(MENTION_BOUNDS.MAX_MENTIONS_PER_CHARACTER);
  });
});

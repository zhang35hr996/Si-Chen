import { describe, expect, it } from "vitest";
import { retrievalScore } from "../../src/engine/dialogue/retrievalScore";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import { appendMention } from "../../src/engine/dialogue/mention";
import type { CourtEvent, GameState, MemoryEntry } from "../../src/engine/state/types";

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

describe("retrievalScore 补充覆盖", () => {
  // ── 1. Tag-gate 负例：无 "anniversary" tag 时忌辰月不加分 ──────────────
  it("无 anniversary tag 的记忆：忌辰月与非忌辰月得分相同（tag-gate 守门）", () => {
    const s = createInitialState();
    // 创建一个 createdAt 月=5、但 triggerTags 里没有 "anniversary" 的记忆
    const noAnnivTag = trauma({ triggerTags: ["death", "heir"] }); // 无 "anniversary"
    const sameTopics = { topicTags: ["death"] };
    const scoreAtAnnivMonth = retrievalScore(s, noAnnivTag, ctx({ now: makeGameTime(3, 5, "mid"), ...sameTopics }));
    const scoreAtOtherMonth = retrievalScore(s, noAnnivTag, ctx({ now: makeGameTime(3, 7, "early"), ...sameTopics }));
    // 无 tag → 两个时刻分数完全相同，anniversary 加项为 0
    expect(scoreAtAnnivMonth).toBe(scoreAtOtherMonth);
  });

  it("有 anniversary tag 的记忆：忌辰月得分严格高于非忌辰月（正例对照）", () => {
    const s = createInitialState();
    const withAnnivTag = trauma(); // 默认含 "anniversary"
    const sameTopics = { topicTags: ["death"] };
    const scoreAtAnnivMonth = retrievalScore(s, withAnnivTag, ctx({ now: makeGameTime(3, 5, "mid"), ...sameTopics }));
    const scoreAtOtherMonth = retrievalScore(s, withAnnivTag, ctx({ now: makeGameTime(3, 7, "early"), ...sameTopics }));
    expect(scoreAtAnnivMonth).toBeGreaterThan(scoreAtOtherMonth);
  });

  // ── 2. conditionMatch 正例：ownerId + sourceEventId 同时命中才加分 ─────
  it("emotionalCondition 完全命中（ownerId + sourceEventId）时得分更高", () => {
    const sourceEventId = "evt_000005";
    const mem = trauma({ sourceEventId });
    const sBase = createInitialState();
    const sWithCond = {
      ...sBase,
      emotionalConditions: [
        {
          id: "cond_a_000001",
          ownerId: "a",           // 与 mem.ownerId 相同
          type: "acute_grief" as const,
          sourceEventId,          // 与 mem.sourceEventId 相同
          severity: 80,
          startedAt: makeGameTime(1, 1, "early"),
          recoveryProfile: "normal" as const,
        },
      ],
    };
    const scoreNoMatch = retrievalScore(sBase, mem, ctx());
    const scoreMatch = retrievalScore(sWithCond, mem, ctx());
    expect(scoreMatch).toBeGreaterThan(scoreNoMatch);
  });

  it("emotionalCondition ownerId 不同时不触发 conditionMatch（单字段差异即无效）", () => {
    const sourceEventId = "evt_000005";
    const mem = trauma({ sourceEventId });
    const sBase = createInitialState();
    const sWrongOwner = {
      ...sBase,
      emotionalConditions: [
        {
          id: "cond_b_000001",
          ownerId: "b",           // 与 mem.ownerId "a" 不同
          type: "acute_grief" as const,
          sourceEventId,
          severity: 80,
          startedAt: makeGameTime(1, 1, "early"),
          recoveryProfile: "normal" as const,
        },
      ],
    };
    expect(retrievalScore(sWrongOwner, mem, ctx())).toBe(retrievalScore(sBase, mem, ctx()));
  });

  it("emotionalCondition sourceEventId 不同时不触发 conditionMatch（单字段差异即无效）", () => {
    const mem = trauma({ sourceEventId: "evt_000005" });
    const sBase = createInitialState();
    const sWrongEvent = {
      ...sBase,
      emotionalConditions: [
        {
          id: "cond_a_000002",
          ownerId: "a",           // ownerId 匹配
          type: "acute_grief" as const,
          sourceEventId: "evt_999999", // sourceEventId 不匹配
          severity: 80,
          startedAt: makeGameTime(1, 1, "early"),
          recoveryProfile: "normal" as const,
        },
      ],
    };
    expect(retrievalScore(sWrongEvent, mem, ctx())).toBe(retrievalScore(sBase, mem, ctx()));
  });

  // ── 3. recentMentionPenalty：近期提及降分 ─────────────────────────────
  it("近期提及（同 speaker/audience）令该记忆得分降低", () => {
    const s = createInitialState();
    const now = makeGameTime(3, 1, "early");
    // 在 now 之前 5 个 period（同一 MENTION_LOOKBACK_DAYS 窗口内）提及该记忆
    const mentionedAt = makeGameTime(2, 11, "late"); // dayIndex = now.dayIndex - 5
    const sWithMention = appendMention(s, {
      speakerId: "a",
      audienceId: "player",
      memoryId: "mem_a_1",
      mentionedAt,
    });
    const ctxNow = ctx({ now });
    const scoreNoMention = retrievalScore(s, trauma(), ctxNow);
    const scoreWithMention = retrievalScore(sWithMention, trauma(), ctxNow);
    expect(scoreWithMention).toBeLessThan(scoreNoMention);
  });
});

// ── PR-A item 7: location match keyed to the source event's location ─────────

const stateWith = (chronicle: CourtEvent[]): GameState => ({ ...createInitialState(), chronicle });

const courtEvent = (over: Partial<CourtEvent> = {}): CourtEvent => ({
  id: "evt_loc_1",
  type: "rank_changed",
  occurredAt: makeGameTime(1, 5, "mid"),
  participants: [{ charId: "a", role: "subject" }],
  locationId: "lengong",
  payload: {},
  publicity: { scope: "palace", persistence: "contemporaneous" },
  publicSalience: 40,
  retention: "slow",
  tags: [],
  ...over,
});

describe("retrievalScore location match (item 7)", () => {
  it("location bonus applies only when current location matches the source event's location", () => {
    const s = stateWith([courtEvent({ locationId: "lengong" })]);
    const mem = trauma({ sourceEventId: "evt_loc_1", triggerTags: ["residence"], subjectIds: ["a"] });
    const here = retrievalScore(s, mem, ctx({ locationId: "lengong" }));
    const elsewhere = retrievalScore(s, mem, ctx({ locationId: "zichendian" }));
    expect(here).toBeGreaterThan(elsewhere);
  });

  it("standing in an unrelated location adds NO location bonus (old residence-tag bug)", () => {
    const s = stateWith([courtEvent({ locationId: "lengong" })]);
    const mem = trauma({ sourceEventId: "evt_loc_1", triggerTags: ["residence"], subjectIds: ["a"] });
    const elsewhere = retrievalScore(s, mem, ctx({ locationId: "zichendian" }));
    const noLocation = retrievalScore(s, mem, ctx({ locationId: undefined }));
    expect(elsewhere).toBe(noLocation);
  });

  it("a residence move grants the bonus at either the from or the to location", () => {
    const s = stateWith([
      courtEvent({
        id: "evt_move",
        type: "residence_changed",
        participants: [{ charId: "a", role: "mover" }],
        locationId: undefined,
        payload: { from: "zichendian", to: "lengong" },
      }),
    ]);
    const mem = trauma({ sourceEventId: "evt_move", triggerTags: ["residence"], subjectIds: ["a"] });
    const atTo = retrievalScore(s, mem, ctx({ locationId: "lengong" }));
    const atFrom = retrievalScore(s, mem, ctx({ locationId: "zichendian" }));
    const atOther = retrievalScore(s, mem, ctx({ locationId: "yanxidian" }));
    expect(atTo).toBeGreaterThan(atOther);
    expect(atFrom).toBeGreaterThan(atOther);
  });
});

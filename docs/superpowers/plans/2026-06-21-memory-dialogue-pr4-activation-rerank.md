# 记忆/对话系统 PR4：激活 / 精排 / 冷却 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让「记一辈子 ≠ 每句都提」成立：`strength`（牢固度）与 `activation`（这次是否想起）分离——有效强度按 retention 半衰；`retrievalScore` 用**乘加混合**（衰减底分×话题放大器 + 忌辰/旧居/在场/未决/情绪**加项** − 近期提及罚分）精排 PR3 召回的候选；`MemoryMentionRecord`（有界）承担冷却；产出结构化 `DialogueMemoryContext` 并填入 `DialogueRequest.relevantMemories`。

**Architecture:** 全部纯函数、确定性（state 纯函数；需抖动用 `stableNoise(saveSeed, …)`，禁 `Math.random()`）。`permanent` 不随时间衰减但**不**必进 top-N、不绕冷却——靠加项缺席与罚分被压下。`MemoryMentionRecord` 是有界当前状态（只在**实际提及**时写，非检索时）。本 PR 把 PR3 的 `recallCandidates` 两数组统一为判别联合 `RecallCandidate` 精排；接 `DialogueRequest`，PR5 再接 audience/gate/LLM。

**Tech Stack:** TypeScript, Zod, Vitest。新代码集中在 `src/engine/dialogue/`，少量 state/schema 改动。

## Global Constraints

- 纯函数 / 确定性（同 state 同输入同输出）；**禁 `Math.random()`/`Date`**；需抖动用 `stableNoise(saveSeed, speakerId, turnId, candidateId)`。
- **禁纯乘积**：触发/语境是**加项**（可独立抬分），不被「话题=0」清零。
- `MemoryMentionRecord` 只在实际提及时写（非检索时写）；有界裁剪 `MAX_MENTIONS_PER_CHARACTER=100`、`MENTION_LOOKBACK_DAYS=180`。
- `MEMORY_CONFIG = { halfLifeDays: { fast: 75, slow: 720 }, minimumRetrievalSalience: 25 }`；`minimumRetrievalSalience` 是**候选门槛**，排名靠 `retrievalScore`。`permanent`：`effectiveStrength = strength`（不衰减），但仍受加项/罚分/门槛与 top-N 约束。
- 复用 PR1–3：`memoryAgeDays`（inspect）、`recallCandidates`（PR3）、`emotionalConditions`/`MemoryEntry`/`CourtEvent`（PR2）。
- 预发布不做旧档迁移（[[no-save-backcompat]]）。基线：PR3 已并入本分支（669 green, tsc clean）。

## File Structure

- `src/engine/dialogue/decay.ts` — `effectiveStrength`（半衰）。
- `src/engine/dialogue/mention.ts` — `MemoryMentionRecord`（state）+ `appendMention`（有界）+ `recentMentionPenalty`。
- `src/engine/dialogue/retrievalScore.ts` — `retrievalScore`（乘加混合）+ `ActivationContext`。
- `src/engine/dialogue/rerank.ts` — `RecallCandidate` 判别联合 + `rankCandidates`（门槛 + 精排 + top-N，确定性）。
- `src/engine/dialogue/memoryContext.ts` — `DialogueMemoryContext` + `buildMemoryContext`（接 recall→rank→结构化）。
- 改 `src/engine/dialogue/orchestrator.ts`：`assembleDialogueRequest` 用 `buildMemoryContext` 填 `relevantMemories`（不再恒 `[]`）。

---

### Task 1: `effectiveStrength`（按 retention 半衰，permanent 不衰减）

**Files:**
- Create: `src/engine/dialogue/decay.ts`
- Test: `tests/dialogue/decay.test.ts`（新建）

**Interfaces:**
- Consumes：`MemoryEntry`（strength/retention/createdAt）、`memoryAgeDays`（memory/inspect）、`GameTime`。
- Produces:
  - `const MEMORY_CONFIG = { halfLifeDays: { fast: 75, slow: 720 }, minimumRetrievalSalience: 25 } as const`
  - `effectiveStrength(entry: MemoryEntry, now: GameTime): number` — `permanent → strength`；否则 `strength * 0.5 ** (ageDays / halfLife[retention])`，clamp 0–100。

- [ ] **Step 1: 写失败测试**

新建 `tests/dialogue/decay.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { effectiveStrength, MEMORY_CONFIG } from "../../src/engine/dialogue/decay";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { MemoryEntry } from "../../src/engine/state/types";

function mem(over: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: "m", ownerId: "a", kind: "impression", subjectIds: ["x"], perspective: "witness",
    summary: "x", strength: 80, retention: "slow", emotions: {}, triggerTags: [], unresolved: false,
    createdAt: makeGameTime(1, 1, "early"), ...over,
  };
}

describe("effectiveStrength", () => {
  it("permanent 不随时间衰减", () => {
    const m = mem({ retention: "permanent", strength: 100, createdAt: makeGameTime(1, 1, "early") });
    expect(effectiveStrength(m, makeGameTime(5, 1, "early"))).toBe(100);
  });
  it("fast 一个半衰期后约减半（75 天≈25 行动日）", () => {
    // dayIndex: 1 行动日 = 1/3 月? 见 calendar：1 月=3 行动日。75 天 ≈ 取 ageDays 直接用 dayIndex 差。
    const m = mem({ retention: "fast", strength: 80, createdAt: makeGameTime(1, 1, "early") });
    const halfLifeDays = MEMORY_CONFIG.halfLifeDays.fast;
    // 构造 age ≈ halfLife 的 now：用 makeGameTime 选一个 dayIndex 差 ≈ halfLifeDays 的时刻
    const now = makeGameTime(1, 1, "early");
    const future = { ...now, dayIndex: now.dayIndex + halfLifeDays };
    expect(effectiveStrength(m, future)).toBeCloseTo(40, 0);
  });
  it("当下（age 0）= strength", () => {
    const m = mem({ retention: "slow", strength: 60 });
    expect(effectiveStrength(m, makeGameTime(1, 1, "early"))).toBe(60);
  });
  it("确定性", () => {
    const m = mem({ retention: "slow" });
    const now = makeGameTime(2, 1, "early");
    expect(effectiveStrength(m, now)).toBe(effectiveStrength(m, now));
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现**

Run: `npx vitest run tests/dialogue/decay.test.ts` → FAIL。新建 `src/engine/dialogue/decay.ts`：

```ts
/** 有效强度（spec：strength 牢固度 与 activation 分离）。permanent 不衰减；其余按 retention 半衰。 */
import { memoryAgeDays } from "../memory/inspect";
import type { GameTime } from "../calendar/time";
import type { MemoryEntry } from "../state/types";

export const MEMORY_CONFIG = {
  halfLifeDays: { fast: 75, slow: 720 },
  minimumRetrievalSalience: 25,
} as const;

export function effectiveStrength(entry: MemoryEntry, now: GameTime): number {
  if (entry.retention === "permanent") return entry.strength;
  const halfLife = MEMORY_CONFIG.halfLifeDays[entry.retention];
  const age = memoryAgeDays(entry, now); // 行动日差（dayIndex）
  const decayed = entry.strength * Math.pow(0.5, age / halfLife);
  return Math.min(100, Math.max(0, decayed));
}
```

> `memoryAgeDays(entry, now)` = `max(0, now.dayIndex − entry.createdAt.dayIndex)`（PR1 既有）。半衰期单位与 ageDays 同为 dayIndex 行动日（数值校准实现期可调）。

- [ ] **Step 3: 运行测试 + 提交**

Run: `npx vitest run tests/dialogue/decay.test.ts` → PASS；`npx vitest run` 全绿。

```bash
git add src/engine/dialogue/decay.ts tests/dialogue/decay.test.ts
git commit -m "feat: effectiveStrength（retention 半衰，permanent 不衰减）+ MEMORY_CONFIG"
```

---

### Task 2: `MemoryMentionRecord` 状态 + `appendMention`（有界）+ `recentMentionPenalty`

**Files:**
- Modify: `src/engine/state/types.ts`（`MemoryMentionRecord`；`GameState.mentionLog`）
- Modify: `src/engine/save/stateSchema.ts`（schema）
- Modify: `src/engine/state/initialState.ts`、`src/engine/state/newGame.ts`（`mentionLog: []`）
- Create: `src/engine/dialogue/mention.ts`（`appendMention` + `recentMentionPenalty`）
- Test: `tests/dialogue/mention.test.ts`、`tests/state/mentionLogSchema.test.ts`（新建）

**Interfaces:**
- Produces:
  - `interface MemoryMentionRecord { speakerId: string; audienceId: string; memoryId: string; mentionedAt: GameTime }`
  - `GameState.mentionLog: MemoryMentionRecord[]`
  - `appendMention(state, rec: MemoryMentionRecord): GameState` — 追加 + **有界裁剪**（每 speaker 至多 `MAX_MENTIONS_PER_CHARACTER`，且丢弃早于 `MENTION_LOOKBACK_DAYS` 的）。
  - `recentMentionPenalty(state, opts: { speakerId; audienceId; memoryId; now }): number` — 0–100：该 speaker→audience 刚提过同一记忆→高罚；对不同 audience→低罚；越近越高。
- 说明：**只在实际提及时调 `appendMention`**（PR5 对话提交后），检索时只读 `recentMentionPenalty`。

- [ ] **Step 1: 写失败测试**

新建 `tests/dialogue/mention.test.ts`：

```ts
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
```

新建 `tests/state/mentionLogSchema.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";

describe("mentionLog schema", () => {
  it("初始空 + 合法条目通过", () => {
    const s = createInitialState();
    expect(s.mentionLog).toEqual([]);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
    s.mentionLog.push({ speakerId: "a", audienceId: "player", memoryId: "m", mentionedAt: makeGameTime(1, 1, "early") });
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败 → 实现**

Run: `npx vitest run tests/dialogue/mention.test.ts tests/state/mentionLogSchema.test.ts` → FAIL。

`types.ts`：`MemoryMentionRecord` 接口 + `GameState.mentionLog: MemoryMentionRecord[]`（`chronicle`/`emotionalConditions` 附近）。
`stateSchema.ts`：在 `emotionalConditions` schema 后加：

```ts
  mentionLog: z.array(z.strictObject({
    speakerId: idSchema, audienceId: idSchema, memoryId: z.string().min(1), mentionedAt: gameTimeSchema,
  })),
```

`initialState.ts`/`newGame.ts`：各加 `mentionLog: []`。
新建 `src/engine/dialogue/mention.ts`：

```ts
import { compareGameTime } from "../calendar/time";
import type { GameTime } from "../calendar/time";
import type { GameState, MemoryMentionRecord } from "../state/types";

export const MENTION_BOUNDS = { MAX_MENTIONS_PER_CHARACTER: 100, MENTION_LOOKBACK_DAYS: 180 } as const;

export function appendMention(state: GameState, rec: MemoryMentionRecord): GameState {
  const cutoff = rec.mentionedAt.dayIndex - MENTION_BOUNDS.MENTION_LOOKBACK_DAYS;
  const kept = [...state.mentionLog, rec].filter((m) => m.mentionedAt.dayIndex >= cutoff);
  // 每 speaker 至多 MAX：按 speaker 分组保留最近 MAX
  const perSpeaker = new Map<string, MemoryMentionRecord[]>();
  for (const m of kept) (perSpeaker.get(m.speakerId) ?? perSpeaker.set(m.speakerId, []).get(m.speakerId)!).push(m);
  const trimmed: MemoryMentionRecord[] = [];
  for (const list of perSpeaker.values()) {
    list.sort((x, y) => x.mentionedAt.dayIndex - y.mentionedAt.dayIndex);
    trimmed.push(...list.slice(-MENTION_BOUNDS.MAX_MENTIONS_PER_CHARACTER));
  }
  trimmed.sort((x, y) => x.mentionedAt.dayIndex - y.mentionedAt.dayIndex || (x.memoryId < y.memoryId ? -1 : 1));
  return { ...state, mentionLog: trimmed };
}

export function recentMentionPenalty(
  state: GameState,
  opts: { speakerId: string; audienceId: string; memoryId: string; now: GameTime },
): number {
  let penalty = 0;
  for (const m of state.mentionLog) {
    if (m.speakerId !== opts.speakerId || m.memoryId !== opts.memoryId) continue;
    const age = opts.now.dayIndex - m.mentionedAt.dayIndex;
    if (age < 0 || age > MENTION_BOUNDS.MENTION_LOOKBACK_DAYS) continue;
    const recency = 1 - age / MENTION_BOUNDS.MENTION_LOOKBACK_DAYS;       // 越近越接近 1
    const sameAudience = m.audienceId === opts.audienceId ? 1 : 0.3;     // 对同一人重复更扣
    penalty = Math.max(penalty, Math.round(80 * recency * sameAudience));
  }
  return Math.min(100, penalty);
}
```

- [ ] **Step 3: 运行测试 + 回归 + tsc + 提交**

Run: `npx vitest run tests/dialogue/mention.test.ts tests/state/mentionLogSchema.test.ts` → PASS；`npx vitest run` 全绿；`npx tsc --noEmit` clean（旧严格-形状夹具如破，补 `mentionLog: []`）。

```bash
git add -A
git commit -m "feat: MemoryMentionRecord 状态 + appendMention（有界裁剪）+ recentMentionPenalty"
```

---

### Task 3: `retrievalScore`（乘加混合，禁纯乘积）

**Files:**
- Create: `src/engine/dialogue/retrievalScore.ts`
- Test: `tests/dialogue/retrievalScore.test.ts`（新建）

**Interfaces:**
- Consumes（Task 1/2）：`effectiveStrength`、`recentMentionPenalty`；`MemoryEntry`、`EmotionalCondition`、`GameState`。
- Produces:
  - `interface ActivationContext { now: GameTime; topicTags: string[]; presentCharacterIds: string[]; locationId?: string; audienceId: string; speakerId: string }`
  - `retrievalScore(state, memory: MemoryEntry, ctx: ActivationContext): number`
- 公式（**乘加混合**，归一化 match ∈[0,1]）：

```
score = effectiveStrength × (BASE_RELEVANCE + TOPIC_WEIGHT × topicMatch)
      + ANNIVERSARY_WEIGHT × anniversaryMatch
      + LOCATION_WEIGHT    × locationMatch
      + SUBJECT_WEIGHT     × subjectPresentMatch
      + UNRESOLVED_WEIGHT  × (memory.unresolved ? 1 : 0)
      + CONDITION_WEIGHT   × conditionMatch
      − recentMentionPenalty
```
- 触发加分**要求记忆声明对应 triggerTag**：`anniversaryMatch` 需 `triggerTags.includes("anniversary") && isAnniversary(memory.createdAt, now)`；`locationMatch` 需 `triggerTags` 命中地点类 tag 且 `ctx.locationId` 相关；`subjectPresentMatch` = 记忆 `subjectIds` 与 `presentCharacterIds` 交集；`conditionMatch` = 该 owner 有 `emotionalConditions` 且 `sourceEventId === memory.sourceEventId`（同源情绪）。

- [ ] **Step 1: 写失败测试（锁住「日常不冒头、忌辰冒头」）**

新建 `tests/dialogue/retrievalScore.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行确认失败 → 实现**

Run: `npx vitest run tests/dialogue/retrievalScore.test.ts` → FAIL。新建 `src/engine/dialogue/retrievalScore.ts`：

```ts
import { effectiveStrength } from "./decay";
import { recentMentionPenalty } from "./mention";
import { monthOrdinal } from "../calendar/time";
import type { GameTime } from "../calendar/time";
import type { GameState, MemoryEntry } from "../state/types";

const W = {
  BASE_RELEVANCE: 0.4, TOPIC_WEIGHT: 0.6,
  ANNIVERSARY_WEIGHT: 60, LOCATION_WEIGHT: 30, SUBJECT_WEIGHT: 35, UNRESOLVED_WEIGHT: 15, CONDITION_WEIGHT: 40,
} as const;

export interface ActivationContext {
  now: GameTime; topicTags: string[]; presentCharacterIds: string[];
  locationId?: string; audienceId: string; speakerId: string;
}

function isAnniversary(origin: GameTime, now: GameTime): boolean {
  return origin.month === now.month && now.year > origin.year; // 同月、跨年=忌辰
}

export function retrievalScore(state: GameState, memory: MemoryEntry, ctx: ActivationContext): number {
  const eff = effectiveStrength(memory, ctx.now);
  const topicMatch = ctx.topicTags.length && memory.triggerTags.some((t) => ctx.topicTags.includes(t)) ? 1 : 0;
  const anniversaryMatch = memory.triggerTags.includes("anniversary") && isAnniversary(memory.createdAt, ctx.now) ? 1 : 0;
  const locationMatch = ctx.locationId && memory.triggerTags.includes("residence") && memory.subjectIds.includes(ctx.speakerId) ? 1 : 0;
  const subjectPresentMatch = memory.subjectIds.some((s) => ctx.presentCharacterIds.includes(s)) ? 1 : 0;
  const conditionMatch = state.emotionalConditions.some(
    (c) => c.ownerId === memory.ownerId && memory.sourceEventId !== undefined && c.sourceEventId === memory.sourceEventId,
  ) ? 1 : 0;
  const penalty = recentMentionPenalty(state, { speakerId: ctx.speakerId, audienceId: ctx.audienceId, memoryId: memory.id, now: ctx.now });
  return (
    eff * (W.BASE_RELEVANCE + W.TOPIC_WEIGHT * topicMatch)
    + W.ANNIVERSARY_WEIGHT * anniversaryMatch
    + W.LOCATION_WEIGHT * locationMatch
    + W.SUBJECT_WEIGHT * subjectPresentMatch
    + W.UNRESOLVED_WEIGHT * (memory.unresolved ? 1 : 0)
    + W.CONDITION_WEIGHT * conditionMatch
    - penalty
  );
}
```

> 系数实现期可校准；关键是**加项独立**、纯函数、可复现。`monthOrdinal` 仅示意（这里用 month/year 判忌辰）。

- [ ] **Step 3: 运行测试 + 提交**

Run: `npx vitest run tests/dialogue/retrievalScore.test.ts` → PASS；`npx vitest run` 全绿。

```bash
git add src/engine/dialogue/retrievalScore.ts tests/dialogue/retrievalScore.test.ts
git commit -m "feat: retrievalScore 乘加混合（衰减底分×话题 + 忌辰/旧居/在场/未决/情绪加项 − 提及罚分）"
```

---

### Task 4: `RecallCandidate` 判别联合 + `rankCandidates`（门槛 + 精排 + top-N）

**Files:**
- Create: `src/engine/dialogue/rerank.ts`
- Test: `tests/dialogue/rerank.test.ts`（新建）

**Interfaces:**
- Consumes（PR3 Task 5 / 本 PR Task 3）：`recallCandidates`、`retrievalScore`、`ActivationContext`、`MEMORY_CONFIG`；`CourtEvent`。
- Produces:
  - `type RecallCandidate = { kind: "memory"; memory: MemoryEntry; score: number } | { kind: "event"; event: CourtEvent; score: number }`
  - `rankCandidates(state, ctx: ActivationContext, recalled: { memories; events }, topN?): RecallCandidate[]`
- 规则：记忆按 `retrievalScore` 评分，**候选门槛** `score`（或 permanent）须 ≥ `minimumRetrievalSalience`；事件按 `publicSalience`（PR5 再细化）。合并、降序、稳定 tie-break（score desc, kind, id asc），取 `topN`（默认 5）。`permanent` 记忆永过门槛但仍按分排名（不必进 top-N）。确定性。

- [ ] **Step 1: 写失败测试**

新建 `tests/dialogue/rerank.test.ts`：

```ts
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
const ctx = { now: makeGameTime(1, 2, "early"), topicTags: [], presentCharacterIds: [], audienceId: "player", speakerId: "a" };

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
```

- [ ] **Step 2: 运行确认失败 → 实现**

Run: `npx vitest run tests/dialogue/rerank.test.ts` → FAIL。新建 `src/engine/dialogue/rerank.ts`：

```ts
import { retrievalScore, type ActivationContext } from "./retrievalScore";
import { MEMORY_CONFIG } from "./decay";
import type { CourtEvent, GameState, MemoryEntry } from "../state/types";

export type RecallCandidate =
  | { kind: "memory"; memory: MemoryEntry; score: number }
  | { kind: "event"; event: CourtEvent; score: number };

export function rankCandidates(
  state: GameState,
  ctx: ActivationContext,
  recalled: { memories: MemoryEntry[]; events: CourtEvent[] },
  topN = 5,
): RecallCandidate[] {
  const mem: RecallCandidate[] = recalled.memories
    .map((memory) => ({ kind: "memory" as const, memory, score: retrievalScore(state, memory, ctx) }))
    .filter((c) => c.memory.retention === "permanent" || c.score >= MEMORY_CONFIG.minimumRetrievalSalience);
  const evt: RecallCandidate[] = recalled.events.map((event) => ({ kind: "event" as const, event, score: event.publicSalience }));
  const idOf = (c: RecallCandidate) => (c.kind === "memory" ? c.memory.id : c.event.id);
  return [...mem, ...evt]
    .sort((a, b) => (b.score - a.score) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0))
    .slice(0, topN);
}
```

- [ ] **Step 3: 运行测试 + 提交**

Run: `npx vitest run tests/dialogue/rerank.test.ts` → PASS；`npx vitest run` 全绿。

```bash
git add src/engine/dialogue/rerank.ts tests/dialogue/rerank.test.ts
git commit -m "feat: RecallCandidate 判别联合 + rankCandidates（门槛+精排+top-N，确定性）"
```

---

### Task 5: `DialogueMemoryContext` + 接入 `assembleDialogueRequest`（填 relevantMemories）

**Files:**
- Create: `src/engine/dialogue/memoryContext.ts`
- Modify: `src/engine/dialogue/orchestrator.ts`（`assembleDialogueRequest` 用 `buildMemoryContext`）
- Test: `tests/dialogue/memoryContext.test.ts`（新建）；改 `tests/dialogue/orchestrator.test.ts` 中断言 `relevantMemories: []` 处

**Interfaces:**
- Consumes：`recallCandidates`（PR3）、`rankCandidates`（Task 4）、`MemoryEntry`/`CourtEvent`。
- Produces:
  - `interface DialogueMemoryContext { activatedMemories: MemoryEntry[]; knownEvents: CourtEvent[] }`（PR5 再加 currentFacts/relationshipSummaries/reactionPlans）
  - `buildMemoryContext(state, query: RecallQuery, ctx: ActivationContext, topN?): DialogueMemoryContext`（recall → rank → 拆回 memories/events）
- 接入：`assembleDialogueRequest` 把 `relevantMemories: []` 改为 `buildMemoryContext(...).activatedMemories`（topicTags/presentCharacterIds 暂从既有信号取，缺则空——PR5 接真实 audience/topic）。

- [ ] **Step 1: 写失败测试**

新建 `tests/dialogue/memoryContext.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行确认失败 → 实现**

Run: `npx vitest run tests/dialogue/memoryContext.test.ts` → FAIL。新建 `src/engine/dialogue/memoryContext.ts`：

```ts
import { recallCandidates, type RecallQuery } from "./recall";
import { rankCandidates } from "./rerank";
import type { ActivationContext } from "./retrievalScore";
import type { CourtEvent, GameState, MemoryEntry } from "../state/types";

export interface DialogueMemoryContext {
  activatedMemories: MemoryEntry[];
  knownEvents: CourtEvent[];
}

export function buildMemoryContext(
  state: GameState, query: RecallQuery, ctx: ActivationContext, topN = 5,
): DialogueMemoryContext {
  const recalled = recallCandidates(state, query);
  const ranked = rankCandidates(state, ctx, recalled, topN);
  return {
    activatedMemories: ranked.flatMap((c) => (c.kind === "memory" ? [c.memory] : [])),
    knownEvents: ranked.flatMap((c) => (c.kind === "event" ? [c.event] : [])),
  };
}
```

- [ ] **Step 3: 接入 orchestrator.ts**

在 `assembleDialogueRequest` 里，把 `relevantMemories: []` 改为：

```ts
relevantMemories: buildMemoryContext(
  state,
  { speakerId },
  { now: toGameTime(state.calendar), topicTags: [], presentCharacterIds: [], audienceId: "player", speakerId },
).activatedMemories,
```

import `buildMemoryContext`。topicTags/presentCharacterIds 暂空（PR5 接真实 audience/topic 后填）。改 `tests/dialogue/orchestrator.test.ts` 中断言 `relevantMemories` 恒空之处（新游戏初期 memories 多空，仍应为 []；若个别角色有授定记忆而上分，按实际调整断言）。

- [ ] **Step 4: 运行测试 + 全量回归 + tsc + 提交**

Run: `npx vitest run tests/dialogue/memoryContext.test.ts` → PASS；`npx vitest run` 全绿；`npx tsc --noEmit` clean。

```bash
git add -A
git commit -m "feat: DialogueMemoryContext + buildMemoryContext，接入 assembleDialogueRequest 填 relevantMemories"
```

---

## Self-Review

**Spec coverage:** `effectiveStrength`（strength/activation 分离、permanent 不衰减）→T1；`MemoryMentionRecord` 有界 + 冷却（只在实际提及时写）→T2；`retrievalScore` 乘加混合（禁纯乘积、加项独立、忌辰可冒头）→T3；门槛 + 精排 + top-N（permanent 不必进）→T4；`DialogueMemoryContext` + 接 `relevantMemories`→T5。两阶段「召回→规划→精排」闭合（规划=PR3）。

**Placeholder scan:** 无 TBD；每步含完整代码/命令/预期。

**Type consistency:** `MEMORY_CONFIG`/`effectiveStrength`（T1）→ T3/T4；`MemoryMentionRecord`/`recentMentionPenalty`（T2）→ T3；`ActivationContext`/`retrievalScore`（T3）→ T4/T5；`RecallCandidate`/`rankCandidates`（T4）→ T5；`recallCandidates`/`RecallQuery`（PR3）→ T5。

**已知实现期决策:**
1. 半衰单位 = `dayIndex` 行动日；`halfLifeDays` 数值与 spec 同名但单位为行动日，校准实现期可调（spec 已注「测试写明多少天跌出」）。
2. `recentMentionPenalty` 只读、`appendMention` 只在 PR5 对话实际提及后调用（本 PR 不自动调用——避免「检索即冷却」）。
3. 系数（W.*、penalty 80、sameAudience 0.3）首版，table/常量集中，PR5 校准。
4. T5 接入用空 topicTags/presentCharacterIds 占位；PR5 用真实 `AudienceContext`（PR3 已定义）+ 话题标签填充，并把 `reactionPlans`/`currentFacts`/`relationshipSummaries` 补进 `DialogueMemoryContext`。
5. 忌辰判定 MVP = 同月跨年；更精细（同月同旬）留后续。

## 后续

PR5（对话装配 + gates + LLM）：`AudienceContext` 全量装配、结构化 `DialogueClaim` + 自动派生事实冲突 forbiddenClaims、gate 经 `BeliefProjection` 校验、把 `planReaction`/`buildMemoryContext` 接入 LLM 前置、对话实际提及后 `appendMention` 写回。emotions schema 收紧（PR2 遗留 follow-up）宜在本阶段消费 emotions 前完成。

# 记忆/对话系统 PR1：事件 / 状态 / 知情资格 — 实现计划（修订版）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为「活人感」记忆系统铺设最底层：不可变（严格 append-only）的客观事件编年史 `chronicle`、角色入宫时刻 `palaceEnteredAt`、知情资格 `canKnowEvent`、信念投影接口 `BeliefProjection`（**非全知**）、时间比较器 `compareGameTime`。

**Architecture:** 新增 `GameState.chronicle: CourtEvent[]`（append-only，**独立于** `eventLog` 的触发记账）。`CourtEvent` 用**判别联合** publicity（`circle|palace|realm`）+ `participants[{charId,role}]`（角色显式，不靠数组位置）+ `retention`（公共事件也参与衰减）。`canKnowEvent` 拒绝未知角色与「尚未入宫的未来角色」，`realm+contemporaneous` 在 schema 层禁止。`BeliefProjection` 经 `CurrentFactVisibility` 读取角色**可见**的 ground truth（v1 无谣言/错信）。全部纯函数 / 纯数据，确定性可复现。

**Tech Stack:** TypeScript, Zod, Vitest。

## Global Constraints

- 预发布阶段不做旧档迁移（state 形状变更不写迁移代码）。见 [[no-save-backcompat]]。
- **严格 append-only**：`CourtEvent` 与私人记忆永不回写「失效」；更正用新事件（`claim_corrected`）。故 `CourtEvent` **无** `invalidatedAt`/`supersededBy`。
- 不引入「写而不读的死属性」：本 PR 新增字段的消费者在本 PR 内。
- 数值属性 0–100 截断；时间戳一律 `GameTime`（不带 AP）。
- 确定性：纯函数同输入同输出；排序用稳定多键排序；禁 `Math.random()`。
- 称谓避用「郎」「卿」等男性向字（见 [[official-naming-rule]]）；本 PR 不涉新称谓。
- 测试框架 Vitest；运行单测 `npx vitest run <path>`；真实内容夹具 `tests/helpers/contentFixture` 的 `loadRealContent()`。
- `chronicle` 事件 id `evt_NNNNNN`，由**现有最大序号 +1** 派生（非 `length+1`）。

## 修订版 DoD（执行前须全部满足，逐条对应 Task）

- [ ] `CourtEvent` 含 `retention`（Task 2）
- [ ] `CourtEvent` **无** `invalidatedAt`/`supersededBy`；`claim_corrected` 不在 PR1（延后 PR5）（Task 2）
- [ ] `publicity` 为判别联合，schema 拒绝 `realm+contemporaneous` / `circle` 缺 `circleIds` / `palace` 带 `circleIds`（Task 2）
- [ ] `participants[{charId,role}]` 取代 `actorIds`/`subjectIds`（Task 2）
- [ ] 存档 schema 用 `courtEventIdSchema`（`/^evt_\d{6}$/`）**落实 `evt_NNNNNN` 不变量**，拒绝 `legacy_*` 等 id（Task 2）
- [ ] `appendCourtEvent` id 由**最大序号**派生（正则校验 id 格式），空洞不重号；**拒绝未来事件**（Task 3）
- [ ] `palaceEnteredAt` 播种**不覆盖** authored 值（Task 4）
- [ ] `gameTimeShape` 与 `gameTimeSchema` 等价性测试（Task 4）
- [ ] `canKnowEvent`：两条时间闸（未来入宫者 / 未来事件）在 scope 分支**之前**；拒绝未知角色；删除 `existedAt`（Task 5）
- [ ] `BeliefProjection` v1 经 `CurrentFactVisibility` 读**可见**真相，非全知；viewer 与 subject 均须**此刻在场**；仅 `resides_at`/`holds_rank`（`alive` 留待皇嗣生命周期）（Task 6）

---

### Task 1: `compareGameTime` 时间比较器

**Files:**
- Modify: `src/engine/calendar/time.ts`（`dayIndexOf` 之后新增 `compareGameTime`）
- Test: `tests/calendar/compareGameTime.test.ts`（新建）

**Interfaces:**
- Produces: `compareGameTime(a: Pick<GameTime,"dayIndex">, b: Pick<GameTime,"dayIndex">): number` — `a<b`→<0，相等 0，`a>b`→>0。
- Consumes: 现有 `GameTime`。

- [ ] **Step 1: 写失败测试**

新建 `tests/calendar/compareGameTime.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { compareGameTime, makeGameTime } from "../../src/engine/calendar/time";

describe("compareGameTime", () => {
  it("早于→负，晚于→正，相等→0（按 dayIndex）", () => {
    const early = makeGameTime(1, 1, "early");
    const mid = makeGameTime(1, 1, "mid");
    const nextYear = makeGameTime(2, 1, "early");
    expect(compareGameTime(early, mid)).toBeLessThan(0);
    expect(compareGameTime(nextYear, mid)).toBeGreaterThan(0);
    expect(compareGameTime(early, early)).toBe(0);
  });

  it("可用于排序（升序）", () => {
    const times = [makeGameTime(2, 3, "late"), makeGameTime(1, 1, "early"), makeGameTime(1, 12, "mid")];
    const sorted = [...times].sort(compareGameTime).map((t) => t.dayIndex);
    expect(sorted).toEqual([...sorted].sort((a, b) => a - b));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/calendar/compareGameTime.test.ts`
Expected: FAIL（`compareGameTime` 未导出）。

- [ ] **Step 3: 实现**

在 `src/engine/calendar/time.ts` 的 `dayIndexOf` 函数之后插入：

```ts
/** Chronological order by action-day index. <0 if a<b, 0 if equal, >0 if a>b. */
export function compareGameTime(
  a: Pick<GameTime, "dayIndex">,
  b: Pick<GameTime, "dayIndex">,
): number {
  return a.dayIndex - b.dayIndex;
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/calendar/compareGameTime.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/engine/calendar/time.ts tests/calendar/compareGameTime.test.ts
git commit -m "feat: compareGameTime 时间比较器（按 dayIndex）"
```

---

### Task 2: `CourtEvent` 类型 + `GameState.chronicle` 状态/schema/持久化/init

**Files:**
- Modify: `src/engine/state/types.ts`（`CourtEventType`/`KnowledgePersistence`/`CourtEventPublicity`/`CourtEventParticipant`/`CourtEvent`/`MemoryRetention`；`GameState.chronicle`）
- Modify: `src/engine/save/stateSchema.ts`（`courtEventSchema` + `chronicle` 字段）
- Modify: `src/engine/state/newGame.ts`（`chronicle: []`）
- Modify: `src/engine/state/initialState.ts`（`chronicle: []`）
- Test: `tests/state/chronicleSchema.test.ts`（新建）

**Interfaces:**
- Produces:
  - `type MemoryRetention = "fast" | "slow" | "permanent";`
  - `CourtEvent`（见下，**无** invalidatedAt/supersededBy；`participants`；`retention`；判别联合 `publicity`）。
  - `GameState.chronicle: CourtEvent[]`。

- [ ] **Step 1: 写失败测试**

新建 `tests/state/chronicleSchema.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent } from "../../src/engine/state/types";

const heirBorn: CourtEvent = {
  id: "evt_000001",
  type: "heir_born",
  occurredAt: makeGameTime(1, 5, "mid"),
  participants: [
    { charId: "consort_gu", role: "birth_father" },
    { charId: "player", role: "sovereign_parent" },
    { charId: "heir_000007", role: "newborn" },
  ],
  payload: { birthOrder: 7 },
  publicity: { scope: "palace", persistence: "institutional" },
  publicSalience: 85,
  retention: "slow",
  tags: ["birth"],
};

describe("chronicle schema", () => {
  it("初始 state 带空 chronicle 且通过 schema", () => {
    const s = createInitialState();
    expect(s.chronicle).toEqual([]);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });

  it("合法 CourtEvent 通过 schema", () => {
    const s = createInitialState();
    s.chronicle.push(heirBorn);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });

  it("circle 必须带 circleIds", () => {
    const s = createInitialState();
    s.chronicle.push({
      ...heirBorn,
      // @ts-expect-error 故意缺 circleIds
      publicity: { scope: "circle" },
    });
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });

  it("realm + contemporaneous 被 schema 拒绝", () => {
    const s = createInitialState();
    s.chronicle.push({
      ...heirBorn,
      // @ts-expect-error 故意非法组合
      publicity: { scope: "realm", persistence: "contemporaneous" },
    });
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });

  it("非 evt_NNNNNN 格式的事件 id 被拒（落实不变量）", () => {
    const s = createInitialState();
    s.chronicle.push({ ...heirBorn, id: "legacy_999999" });
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/state/chronicleSchema.test.ts`
Expected: FAIL（`chronicle` / `CourtEvent` 不存在）。

- [ ] **Step 3: 加类型（types.ts）**

在 `src/engine/state/types.ts` 的 `EventLogEntry` 接口之后、`GameState` 接口之前插入：

```ts
// ── 客观事件编年史（严格 append-only；独立于 eventLog 的事件触发记账）─────
export type CourtEventType =
  | "residence_changed"
  | "heir_born"
  | "heir_died"
  | "rank_changed"
  | "punished"
  | "rewarded"
  | "conflict"
  | "promise"
  | "secret_discovered";
// claim_corrected 延后到【首个有错误信念/可证伪 claim 的 PR】，而非承诺 PR5——它需生产者+消费者；
// 加入即死类型。

/** 公共/私人记忆共用的衰减档位。 */
export type MemoryRetention = "fast" | "slow" | "permanent";

/** contemporaneous=仅事发时在范围内者默认知道；institutional=后来进入者也默认知道。 */
export type KnowledgePersistence = "contemporaneous" | "institutional";

/** 判别联合：无效组合在数据入口即失败。v1 不允许 realm+contemporaneous。 */
export type CourtEventPublicity =
  | { scope: "circle"; circleIds: string[] }
  | { scope: "palace"; persistence: KnowledgePersistence }
  | { scope: "realm"; persistence: "institutional" };

export interface CourtEventParticipant {
  charId: string;
  /** 显式角色，不靠数组位置：birth_father / adoptive_father / sovereign_parent / newborn / demoted / … */
  role: string;
}

/** 一条不可变的「曾经发生过什么」。append-only，永不回写；更正用 claim_corrected 新事件。 */
export interface CourtEvent {
  /** "evt_000001"，由现有最大序号 +1 派生。 */
  id: string;
  type: CourtEventType;
  occurredAt: GameTime;
  participants: CourtEventParticipant[];
  locationId?: string;
  /** 仅非角色标量（birthOrder/sex/from-to rank …）。 */
  payload: Record<string, unknown>;
  publicity: CourtEventPublicity;
  /** 0–100 公共显著度。 */
  publicSalience: number;
  /** 公共事件也参与有效强度衰减（与私人记忆同一检索公式）。 */
  retention: MemoryRetention;
  tags: string[];
}
```

在 `GameState` 接口里、`eventLog: EventLogEntry[];` 之后加一行：

```ts
  /** 客观事件编年史（append-only，剧情事实；与 eventLog 的触发记账分离）。 */
  chronicle: CourtEvent[];
```

- [ ] **Step 4: 加 schema（stateSchema.ts）**

在 `src/engine/save/stateSchema.ts` 顶部（与其它 schema 常量同处）先定义并导出 `CourtEvent.id` 的格式 schema，**落实 `evt_NNNNNN` 不变量**（`idSchema` 是通用实体 id，不够约束）：

```ts
export const courtEventIdSchema = z.string().regex(/^evt_\d{6}$/);
```

再在 `eventLog:` 那行之后插入 chronicle schema（`id` 用 `courtEventIdSchema`）：

```ts
  chronicle: z.array(
    z.strictObject({
      id: courtEventIdSchema,
      type: z.enum([
        "residence_changed", "heir_born", "heir_died", "rank_changed",
        "punished", "rewarded", "conflict", "promise", "secret_discovered",
      ]),
      occurredAt: gameTimeSchema,
      participants: z.array(z.strictObject({ charId: idSchema, role: z.string().min(1) })),
      locationId: idSchema.optional(),
      payload: z.record(z.string(), z.unknown()),
      publicity: z.discriminatedUnion("scope", [
        z.strictObject({ scope: z.literal("circle"), circleIds: z.array(idSchema) }),
        z.strictObject({ scope: z.literal("palace"), persistence: z.enum(["contemporaneous", "institutional"]) }),
        z.strictObject({ scope: z.literal("realm"), persistence: z.literal("institutional") }),
      ]),
      publicSalience: percent,
      retention: z.enum(["fast", "slow", "permanent"]),
      tags: z.array(z.string()),
    }),
  ),
```

> `percent`/`idSchema`/`gameTimeSchema` 已在 `stateSchema.ts` 顶部定义/导入，沿用。

- [ ] **Step 5: 初始化两处 state**

`src/engine/state/initialState.ts`：在 `eventLog: [],` 之后加一行 `chronicle: [],`。
`src/engine/state/newGame.ts`：在 `return { ... }` 的 `eventLog: [],` 之后加一行 `chronicle: [],`。

- [ ] **Step 6: 运行测试**

Run: `npx vitest run tests/state/chronicleSchema.test.ts`
Expected: PASS。

- [ ] **Step 7: 全量回归**

Run: `npx vitest run`
Expected: 全绿（若旧测试断言 `gameStateSchema` 严格形状，因新增必填 `chronicle` 失败的，就地补 `chronicle: []`）。

- [ ] **Step 8: 提交**

```bash
git add src/engine/state/types.ts src/engine/save/stateSchema.ts src/engine/state/initialState.ts src/engine/state/newGame.ts tests/state/chronicleSchema.test.ts
git commit -m "feat: CourtEvent 编年史（判别联合 publicity + participants + retention，严格 append-only）"
```

---

### Task 3: `appendCourtEvent` 写入助手（最大序号派生 id）

**Files:**
- Create: `src/engine/chronicle/append.ts`
- Test: `tests/chronicle/append.test.ts`（新建）

**Interfaces:**
- Consumes（Task 2）：`GameState.chronicle`、`CourtEvent`。
- Produces:
  - `courtEventId(seq: number): string` — `"evt_000001"`。
  - `appendCourtEvent(state: GameState, draft: Omit<CourtEvent, "id">): { state: GameState; event: CourtEvent }` — 新 state（不可变），id = 现有**最大序号 +1**（正则校验已有 id）；`draft.occurredAt > now` 抛错（编年史只记已发生）。

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/append.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { appendCourtEvent, courtEventId } from "../../src/engine/chronicle/append";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent } from "../../src/engine/state/types";

const draft: Omit<CourtEvent, "id"> = {
  type: "rank_changed",
  occurredAt: makeGameTime(1, 1, "early"), // = createInitialState 的 now（非未来）
  participants: [{ charId: "consort_gu", role: "demoted" }],
  payload: { from: "chengyi", to: "meiren" },
  publicity: { scope: "palace", persistence: "contemporaneous" },
  publicSalience: 60,
  retention: "slow",
  tags: ["demotion"],
};

describe("appendCourtEvent", () => {
  it("单调 id 且不改入参", () => {
    expect(courtEventId(1)).toBe("evt_000001");
    const s0 = createInitialState();
    const { state: s1, event: e1 } = appendCourtEvent(s0, draft);
    expect(e1.id).toBe("evt_000001");
    expect(s1.chronicle).toHaveLength(1);
    expect(s0.chronicle).toHaveLength(0);

    const { event: e2 } = appendCourtEvent(s1, draft);
    expect(e2.id).toBe("evt_000002");
  });

  it("从最大序号派生（空洞不重号；忽略非 evt_ id）", () => {
    const s = createInitialState();
    s.chronicle.push({ ...draft, id: "evt_000005" }); // 人为留洞
    s.chronicle.push({ ...draft, id: "legacy_999999" }); // 非法前缀须被忽略，不参与 max
    const { event } = appendCourtEvent(s, draft);
    expect(event.id).toBe("evt_000006"); // 不是 evt_000002，也不受 legacy_999999 影响
  });

  it("拒绝未来事件（occurredAt > now）", () => {
    const s = createInitialState(); // 开局 元年一月上旬
    const future = { ...draft, occurredAt: makeGameTime(5, 1, "early") };
    expect(() => appendCourtEvent(s, future)).toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/append.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `src/engine/chronicle/append.ts`：

```ts
/**
 * 编年史写入：append-only，永不回写。id 由现有最大序号 +1 派生（正则校验，空洞/异常 id 不影响）。
 * 拒绝未来事件——编年史只记「已发生」。返回新 state，不改入参。
 */
import { compareGameTime, toGameTime } from "../calendar/time";
import type { CourtEvent, GameState } from "../state/types";

const ID_RE = /^evt_(\d{6})$/;

export function courtEventId(seq: number): string {
  return `evt_${String(seq).padStart(6, "0")}`;
}

function maxSeq(chronicle: readonly CourtEvent[]): number {
  let max = 0;
  for (const e of chronicle) {
    const m = ID_RE.exec(e.id); // 仅识别 evt_NNNNNN，忽略其它前缀
    if (!m) continue;
    const n = Number(m[1]);
    if (n > max) max = n;
  }
  return max;
}

export function appendCourtEvent(
  state: GameState,
  draft: Omit<CourtEvent, "id">,
): { state: GameState; event: CourtEvent } {
  if (compareGameTime(draft.occurredAt, toGameTime(state.calendar)) > 0) {
    throw new Error(`appendCourtEvent: 拒绝未来事件 occurredAt=${JSON.stringify(draft.occurredAt)}`);
  }
  const event: CourtEvent = { id: courtEventId(maxSeq(state.chronicle) + 1), ...draft };
  return { state: { ...state, chronicle: [...state.chronicle, event] }, event };
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/chronicle/append.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/engine/chronicle/append.ts tests/chronicle/append.test.ts
git commit -m "feat: appendCourtEvent（最大序号派生 id、不可变、append-only）"
```

---

### Task 4: `CharacterStanding.palaceEnteredAt` 字段（不覆盖 authored）+ gameTimeShape 等价性

**Files:**
- Modify: `src/engine/state/types.ts`（`CharacterStanding.palaceEnteredAt?`）
- Modify: `src/engine/content/schemas.ts`（导出 `gameTimeShape`；`characterStandingSchema` 加 `palaceEnteredAt`）
- Modify: `src/engine/state/newGame.ts`（导出纯函数 `consortStandingExtras`；循环改用它）
- Test: `tests/state/palaceEnteredAt.test.ts`（新建）
- Test: `tests/state/gameTimeShapeParity.test.ts`（新建）

**Interfaces:**
- Produces:
  - `CharacterStanding.palaceEnteredAt?: GameTime`。
  - `consortStandingExtras(character, startTime: GameTime): Partial<CharacterStanding>` — 仅侍君返回 `{ affection?, palaceEnteredAt }`；`palaceEnteredAt = initialStanding.palaceEnteredAt ?? startTime`（**不覆盖** authored）。
  - 导出 `gameTimeShape`（content schema 的本地 GameTime 形状）。
- Consumes（Task 1）：`GameTime` 形状。

- [ ] **Step 1: 写失败测试（不覆盖 authored 是核心断言）**

新建 `tests/state/palaceEnteredAt.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { consortStandingExtras } from "../../src/engine/state/newGame";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

describe("palaceEnteredAt 播种", () => {
  const startTime = makeGameTime(1, 1, "early");

  it("无 authored 值 → 回退开局时刻", () => {
    const extras = consortStandingExtras(
      { kind: "consort", hidden: { affection: 40 }, initialStanding: { rank: "meiren", favor: 50 } },
      startTime,
    );
    expect(extras.palaceEnteredAt).toEqual(startTime);
    expect(extras.affection).toBe(40);
  });

  it("有 authored 值 → 不被覆盖", () => {
    const authored = makeGameTime(0 + 1, 3, "late"); // 元年三月下旬（authored 历史入宫）
    const extras = consortStandingExtras(
      { kind: "consort", initialStanding: { rank: "meiren", favor: 50, palaceEnteredAt: authored } },
      startTime,
    );
    expect(extras.palaceEnteredAt).toEqual(authored);
  });

  it("非侍君 → 不播种", () => {
    expect(consortStandingExtras({ kind: "official", initialStanding: { rank: "x", favor: 0 } }, startTime)).toEqual({});
  });

  it("真实内容：侍君 palaceEnteredAt = 开局时刻，通过 schema", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    const consort = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    expect(s.standing[consort.id]!.palaceEnteredAt!.dayIndex).toBe(s.calendar.dayIndex);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/state/palaceEnteredAt.test.ts`
Expected: FAIL（`consortStandingExtras` 未导出 / `palaceEnteredAt` 缺）。

- [ ] **Step 3: 加类型（types.ts）**

在 `CharacterStanding` 接口内、`affection?: number;` 之后加：

```ts
  /** 入宫时刻（知情资格用）；非常住者 undefined。所有入宫流程必须写此字段。 */
  palaceEnteredAt?: GameTime;
```

- [ ] **Step 4: 加 schema（schemas.ts）**

在 `src/engine/content/schemas.ts` 的 `characterStandingSchema` 定义**之前**加并导出本地 GameTime 形状：

```ts
/** GameTime 形状（与 save/stateSchema 的 gameTimeSchema 对齐；本地定义避免跨模块循环依赖）。 */
export const gameTimeShape = z.strictObject({
  year: z.number().int().min(1),
  month: z.number().int().min(1).max(12),
  period: z.enum(["early", "mid", "late"]),
  dayIndex: z.number().int().min(0),
});
```

在 `characterStandingSchema` 内、`affection: percent.optional(),` 之后加：

```ts
  palaceEnteredAt: gameTimeShape.optional(),
```

> `characterStandingSchema` 同时用于 authored `initialStanding` 与持久化 standing（`stateSchema.ts` 复用它），此一处即覆盖校验与存档。

- [ ] **Step 5: newGame 改用纯函数 `consortStandingExtras`**

在 `src/engine/state/newGame.ts` 顶部 import 增补类型，并新增导出函数（放在 `memoryEntryId` 附近）：

```ts
import type { GameTime } from "../calendar/time";
// …

/**
 * 侍君 standing 的运行时补充：affection 初值 + 入宫时刻（不覆盖 authored）。
 * initialStanding 复用真实 `CharacterStanding`（Partial），避免手写缩窄形状导致
 * 测试对象字面量触发 excess-property error / 平行类型漂移。
 */
export function consortStandingExtras(
  character: { kind: string; hidden?: { affection: number }; initialStanding?: Partial<CharacterStanding> },
  startTime: GameTime,
): Partial<CharacterStanding> {
  if (character.kind !== "consort") return {};
  return {
    ...(character.hidden ? { affection: character.hidden.affection } : {}),
    palaceEnteredAt: character.initialStanding?.palaceEnteredAt ?? startTime,
  };
}
```

把循环里的

```ts
    if (character.initialStanding) {
      standing[character.id] = {
        ...character.initialStanding,
        ...(character.kind === "consort" && character.hidden
          ? { affection: character.hidden.affection }
          : {}),
      };
    }
```

替换为：

```ts
    if (character.initialStanding) {
      standing[character.id] = {
        ...character.initialStanding,
        ...consortStandingExtras(character, startTime),
      };
    }
```

- [ ] **Step 6: gameTimeShape 等价性测试**

新建 `tests/state/gameTimeShapeParity.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { gameTimeShape } from "../../src/engine/content/schemas";
import { gameTimeSchema } from "../../src/engine/save/stateSchema";

const valid = { year: 1, month: 5, period: "mid", dayIndex: 13 };
const invalids = [
  { year: 0, month: 5, period: "mid", dayIndex: 13 },
  { year: 1, month: 13, period: "mid", dayIndex: 13 },
  { year: 1, month: 5, period: "noon", dayIndex: 13 },
  { year: 1, month: 5, period: "mid" }, // 缺 dayIndex
];

describe("gameTimeShape ≡ gameTimeSchema（防漂移）", () => {
  it("同样接受合法样本", () => {
    expect(gameTimeShape.safeParse(valid).success).toBe(true);
    expect(gameTimeSchema.safeParse(valid).success).toBe(true);
  });
  it("同样拒绝非法样本", () => {
    for (const bad of invalids) {
      expect(gameTimeShape.safeParse(bad).success).toBe(gameTimeSchema.safeParse(bad).success);
      expect(gameTimeShape.safeParse(bad).success).toBe(false);
    }
  });
});
```

> 若 `gameTimeSchema` 未从 `stateSchema.ts` 导出，本步骤同时为其补 `export`。

- [ ] **Step 7: 运行测试**

Run: `npx vitest run tests/state/palaceEnteredAt.test.ts tests/state/gameTimeShapeParity.test.ts`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/engine/state/types.ts src/engine/content/schemas.ts src/engine/state/newGame.ts tests/state/palaceEnteredAt.test.ts tests/state/gameTimeShapeParity.test.ts
git commit -m "feat: palaceEnteredAt（不覆盖 authored）+ gameTimeShape 等价性"
```

---

### Task 5: `canKnowEvent` 知情资格（删除 existedAt）

**Files:**
- Create: `src/engine/chronicle/awareness.ts`
- Test: `tests/chronicle/awareness.test.ts`（新建）

**Interfaces:**
- Consumes（Task 1）：`compareGameTime`、`toGameTime`。
- Consumes（Task 2）：`CourtEvent`。
- Consumes（Task 4）：`standing[charId].palaceEnteredAt`。
- Produces: `canKnowEvent(state: GameState, charId: string, event: CourtEvent): boolean`。
- 不导出 `existedAt`（错误抽象，已删）。

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/awareness.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { canKnowEvent } from "../../src/engine/chronicle/awareness";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { CourtEvent, GameState } from "../../src/engine/state/types";

/** now = 元年八月上旬，便于让「事发→后入宫」「未来事件」都落在合法时间线上。 */
function nowState(): GameState {
  return createInitialState({ calendar: { month: 8 } });
}
const entered = (m: number) => ({ rank: "meiren", favor: 50, palaceEnteredAt: makeGameTime(1, m, "early") });
function evt(over: Partial<CourtEvent> = {}): CourtEvent {
  return {
    id: "evt_000001", type: "rank_changed",
    occurredAt: makeGameTime(1, 3, "mid"), // 元年三月（过去，相对 now=八月）
    participants: [], payload: {},
    publicity: { scope: "palace", persistence: "contemporaneous" },
    publicSalience: 50, retention: "slow", tags: [],
    ...over,
  };
}

describe("canKnowEvent", () => {
  it("未知角色（无 standing）一律不知道", () => {
    const s = nowState();
    expect(canKnowEvent(s, "ghost", evt())).toBe(false);
    expect(canKnowEvent(s, "ghost", evt({ publicity: { scope: "realm", persistence: "institutional" } }))).toBe(false);
  });

  it("circle：仅白名单", () => {
    const s = nowState();
    s.standing["a"] = entered(1);
    s.standing["b"] = entered(1);
    const e = evt({ publicity: { scope: "circle", circleIds: ["a"] } });
    expect(canKnowEvent(s, "a", e)).toBe(true);
    expect(canKnowEvent(s, "b", e)).toBe(false);
  });

  it("palace + contemporaneous：事发后入宫的新人不知道", () => {
    const s = nowState();
    s.standing["veteran"] = entered(1);
    s.standing["newcomer"] = entered(6); // 三月事件之后入宫
    expect(canKnowEvent(s, "veteran", evt())).toBe(true);
    expect(canKnowEvent(s, "newcomer", evt())).toBe(false);
  });

  it("palace + institutional：事发后入宫的新人也知道（宫史）", () => {
    const s = nowState();
    s.standing["newcomer"] = entered(6);
    const inst = evt({ type: "heir_died", publicity: { scope: "palace", persistence: "institutional" } });
    expect(canKnowEvent(s, "newcomer", inst)).toBe(true);
  });

  it("palace：无 palaceEnteredAt（官员等）不知道宫内事", () => {
    const s = nowState();
    s.standing["official_x"] = { rank: "shangshu", favor: 50 };
    expect(canKnowEvent(s, "official_x", evt())).toBe(false);
  });

  it("尚未入宫的未来角色：对所有 scope 都不知情（含 circle / realm）", () => {
    const s = nowState(); // now = 元年八月
    s.standing["future"] = { rank: "meiren", favor: 50, palaceEnteredAt: makeGameTime(2, 1, "early") }; // 明年入宫
    expect(canKnowEvent(s, "future", evt({ type: "heir_died", publicity: { scope: "palace", persistence: "institutional" } }))).toBe(false);
    expect(canKnowEvent(s, "future", evt({ publicity: { scope: "circle", circleIds: ["future"] } }))).toBe(false);
    expect(canKnowEvent(s, "future", evt({ publicity: { scope: "realm", persistence: "institutional" } }))).toBe(false);
  });

  it("未来事件：谁都不知道（occurredAt > now）", () => {
    const s = nowState(); // now = 元年八月
    s.standing["a"] = entered(1);
    const future = evt({ occurredAt: makeGameTime(1, 12, "late") }); // 年底，晚于八月
    expect(canKnowEvent(s, "a", future)).toBe(false);
    expect(canKnowEvent(s, "a", evt({ occurredAt: makeGameTime(1, 12, "late"), publicity: { scope: "realm", persistence: "institutional" } }))).toBe(false);
  });

  it("realm + institutional：在场者知道", () => {
    const s = nowState();
    s.standing["a"] = entered(1);
    expect(canKnowEvent(s, "a", evt({ publicity: { scope: "realm", persistence: "institutional" } }))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/awareness.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `src/engine/chronicle/awareness.ts`：

```ts
/**
 * 知情资格（spec 第 3 类）：谁「默认知道」一条 CourtEvent。
 * 不为每人复制记忆——palace/realm 走规则，circle 走白名单。
 * v1：realm 必为 institutional（schema 已保证）；不含 rumor/certainty。
 *
 * 两条时间闸必须在 scope 分支【之前】：否则未来入宫者经 circle/realm 仍偷知，
 * 且谁都能「预知」尚未发生的事件。
 */
import { compareGameTime, toGameTime } from "../calendar/time";
import type { CourtEvent, GameState } from "../state/types";

export function canKnowEvent(state: GameState, charId: string, event: CourtEvent): boolean {
  const standing = state.standing[charId];
  if (!standing) return false; // 未知/不存在角色：一律不知道

  const now = toGameTime(state.calendar);
  // 闸1：尚未入宫的未来角色 → 对所有 scope 都不知情
  if (standing.palaceEnteredAt && compareGameTime(standing.palaceEnteredAt, now) > 0) return false;
  // 闸2：编年史只载已发生；未来事件谁都不知道
  if (compareGameTime(event.occurredAt, now) > 0) return false;

  const p = event.publicity;
  if (p.scope === "circle") return p.circleIds.includes(charId);
  if (p.scope === "realm") return true; // v1: realm 必为 institutional

  // palace：须在宫
  const enteredAt = standing.palaceEnteredAt;
  if (!enteredAt) return false;
  return p.persistence === "institutional" || compareGameTime(enteredAt, event.occurredAt) <= 0;
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/chronicle/awareness.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/engine/chronicle/awareness.ts tests/chronicle/awareness.test.ts
git commit -m "feat: canKnowEvent 知情资格（两时间闸:拒未来入宫者/未来事件;拒未知;删 existedAt）"
```

---

### Task 6: `BeliefProjection` + `CurrentFactVisibility` + `GroundTruthBeliefProjection`（非全知）

**Files:**
- Create: `src/engine/chronicle/belief.ts`
- Test: `tests/chronicle/belief.test.ts`（新建）

**Interfaces:**
- Produces:
  - `type FactPredicate = "resides_at" | "holds_rank";`（`alive` 留待皇嗣生命周期建模）。
  - `interface FactKey { predicate: FactPredicate; subjectId: string }`。
  - `interface BelievedFact { value: string; certainty: number }`。
  - `interface CurrentFactVisibility { canSee(state, viewerId, key): boolean }`。
  - `isCurrentlyPresent(state, charId): boolean`（有 standing 且 `palaceEnteredAt ≤ now`）。
  - `const courtMemberVisibility: CurrentFactVisibility`（viewer 与 subject **均须此刻在场**）。
  - `interface BeliefProjection { getFact(charId, key): BelievedFact | undefined }`。
  - `class GroundTruthBeliefProjection implements BeliefProjection`（构造须传 `visibility`，默认 `courtMemberVisibility`）。
- 说明：v1 读**可见**的 ground truth，**非全知**；接 rumor 后替换实现，接口不变。

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/belief.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { GroundTruthBeliefProjection } from "../../src/engine/chronicle/belief";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";

function stateWithCourt() {
  const s = createInitialState();
  s.standing["viewer"] = { rank: "meiren", favor: 50 };
  s.standing["consort_gu"] = { rank: "meiren", favor: 50, residence: "xianfu_palace" };
  return s;
}

describe("GroundTruthBeliefProjection (v1, 非全知)", () => {
  it("朝廷成员可见他人当前位分/住处（certainty 100）", () => {
    const bp = new GroundTruthBeliefProjection(stateWithCourt());
    expect(bp.getFact("viewer", { predicate: "holds_rank", subjectId: "consort_gu" }))
      .toEqual({ value: "meiren", certainty: 100 });
    expect(bp.getFact("viewer", { predicate: "resides_at", subjectId: "consort_gu" }))
      .toEqual({ value: "xianfu_palace", certainty: 100 });
  });

  it("未知 viewer（无 standing）→ undefined（非全知）", () => {
    const bp = new GroundTruthBeliefProjection(stateWithCourt());
    expect(bp.getFact("ghost", { predicate: "holds_rank", subjectId: "consort_gu" })).toBeUndefined();
  });

  it("未知 subject → undefined", () => {
    const bp = new GroundTruthBeliefProjection(stateWithCourt());
    expect(bp.getFact("viewer", { predicate: "holds_rank", subjectId: "nobody" })).toBeUndefined();
  });

  it("subject 无 residence → resides_at undefined", () => {
    const s = stateWithCourt();
    delete s.standing["consort_gu"]!.residence;
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("viewer", { predicate: "resides_at", subjectId: "consort_gu" })).toBeUndefined();
  });

  it("尚未入宫的未来 viewer / subject → undefined（非在场不可见）", () => {
    const s = stateWithCourt(); // now = 元年一月
    s.standing["future_viewer"] = { rank: "meiren", favor: 50, palaceEnteredAt: makeGameTime(2, 1, "early") };
    s.standing["future_subject"] = { rank: "meiren", favor: 50, residence: "x", palaceEnteredAt: makeGameTime(2, 1, "early") };
    const bp = new GroundTruthBeliefProjection(s);
    // 未来 viewer 看不到现任
    expect(bp.getFact("future_viewer", { predicate: "holds_rank", subjectId: "consort_gu" })).toBeUndefined();
    // 在场者也看不到尚未入宫的未来 subject
    expect(bp.getFact("viewer", { predicate: "holds_rank", subjectId: "future_subject" })).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/belief.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `src/engine/chronicle/belief.ts`：

```ts
/**
 * 信念投影（spec §信念投影）：gate 与对话装配读取「角色相信的事实」的统一边界。
 * v1 = GroundTruthBeliefProjection：读角色【可见】的 ground truth（非全知）。
 * 必经 CurrentFactVisibility；接入 rumor/certainty 后只替换实现，本接口不变。
 * 系统效果（applyEffects）永远只用 ground truth，不经此处。
 */
import { compareGameTime, toGameTime } from "../calendar/time";
import type { GameState } from "../state/types";

export type FactPredicate = "resides_at" | "holds_rank";
export interface FactKey {
  predicate: FactPredicate;
  subjectId: string;
}
export interface BelievedFact {
  value: string;
  certainty: number; // 0–100
}

export interface CurrentFactVisibility {
  canSee(state: GameState, viewerId: string, key: FactKey): boolean;
}

/** 「此刻在场」：有 standing 且 palaceEnteredAt ≤ now（尚未入宫的未来角色不算）。 */
export function isCurrentlyPresent(state: GameState, charId: string): boolean {
  const st = state.standing[charId];
  if (!st) return false;
  if (st.palaceEnteredAt && compareGameTime(st.palaceEnteredAt, toGameTime(state.calendar)) > 0) return false;
  return true;
}

/** MVP：当前位分/住处是宫廷公开事实——viewer 与 subject 均须【此刻在场】。 */
export const courtMemberVisibility: CurrentFactVisibility = {
  canSee(state, viewerId, key) {
    return isCurrentlyPresent(state, viewerId) && isCurrentlyPresent(state, key.subjectId);
  },
};

export interface BeliefProjection {
  getFact(charId: string, key: FactKey): BelievedFact | undefined;
}

export class GroundTruthBeliefProjection implements BeliefProjection {
  constructor(
    private readonly state: GameState,
    private readonly visibility: CurrentFactVisibility = courtMemberVisibility,
  ) {}

  getFact(charId: string, key: FactKey): BelievedFact | undefined {
    if (!this.visibility.canSee(this.state, charId, key)) return undefined;
    const st = this.state.standing[key.subjectId];
    if (!st) return undefined;
    switch (key.predicate) {
      case "holds_rank":
        return { value: st.rank, certainty: 100 };
      case "resides_at":
        return st.residence ? { value: st.residence, certainty: 100 } : undefined;
    }
  }
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/chronicle/belief.test.ts`
Expected: PASS。

- [ ] **Step 5: 全量回归 + 类型检查**

Run: `npx vitest run`
Expected: 全绿。
Run: `npx tsc --noEmit`（若项目用 tsc）
Expected: 无类型错误。

- [ ] **Step 6: 提交**

```bash
git add src/engine/chronicle/belief.ts tests/chronicle/belief.test.ts
git commit -m "feat: BeliefProjection + CurrentFactVisibility（v1 可见真相，非全知）"
```

---

## Self-Review

**修订版 DoD 覆盖:** 全部 9 条逐一落到 Task 2/3/4/5/6（见顶部 DoD 清单与各 Task）。

**Spec coverage（PR1 范围）:** `compareGameTime`→T1；`CourtEvent`+`chronicle`（判别联合/participants/retention/无失效字段）→T2；`appendCourtEvent`（最大序号）→T3；`palaceEnteredAt`（不覆盖 authored）+ gameTimeShape 等价性→T4；`canKnowEvent`（删 existedAt）→T5；`BeliefProjection`（非全知）→T6。

**PR1 明确不含（spec 已注）:** `TemporalFact` 派生器与「自动事实冲突 claim」（消费者是 PR5 gate）；`EventAwareness` 落行；`MemoryEntry` 演进（PR2）；`alive` 谓词（皇嗣生命周期建模后）；`commitCourtEvent`/`EventMemoryRule`（PR2）。

**已记录的 PR1 限制（不阻塞，PR2 处理）:** `canKnowEvent`/`isCurrentlyPresent` 以 `state.standing[charId]` 判角色存在，故皇嗣（只存于 `bloodline.heirs`、无 standing）会被当未知角色。皇嗣 lifecycle 落地时一并扩展（见 spec PR2 硬前置）。

**Placeholder scan:** 无 TBD/TODO；每代码步骤含完整代码与确切命令/预期。

**Type consistency:**
- `MemoryRetention`/`CourtEvent`/`CourtEventPublicity`/`CourtEventParticipant` 在 T2 定义，T3/T5 一致引用。
- `compareGameTime`（T1）被 T5 使用（`Pick<GameTime,"dayIndex">` 兼容完整 `GameTime`）。
- `palaceEnteredAt`（T4）被 T5 读取，类型 `GameTime` 一致。
- `consortStandingExtras`（T4）返回 `Partial<CharacterStanding>`，与循环里 standing 装配一致。
- `GroundTruthBeliefProjection`（T6）只读 `standing.rank`/`.residence`，均 `CharacterStanding` 既有字段。

**已知实现期决策（已在步骤标注）:**
1. T4：`gameTimeShape` 在 content `schemas.ts` 本地定义并**导出**，与 `save/stateSchema` 的 `gameTimeSchema` 由 T4 Step6 等价性测试守护（若后者未导出则补 `export`）。
2. T6：`courtMemberVisibility` 为 MVP 可见性策略（viewer 与 subject 均须 `isCurrentlyPresent`，即有 standing 且已入宫）；rumor 版替换 `CurrentFactVisibility` 实现，接口不变。后续官员/离宫角色需更细可见性时,把 `isCurrentlyPresent` 演进为统一生命周期/在场判定。
3. T2 Step7 全量回归若撞旧夹具，按已带 `chronicle: []` 就地修正。

## 后续 PR

PR2–5 各自单独成稿（接口依赖本 PR 落地后的真实 shape）。下一份：`plans/2026-06-20-memory-dialogue-pr2-memory-evolution.md`（演进 `MemoryEntry` + `EventMemoryRule` 注册表 + `commitCourtEvent` + 四条事件规则 + `EmotionalCondition` 仅存储）。

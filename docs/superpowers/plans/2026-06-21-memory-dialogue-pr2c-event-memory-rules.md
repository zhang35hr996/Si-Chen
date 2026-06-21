# 记忆/对话系统 PR2c：事件→记忆规则引擎 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用统一注册表把「客观事件」自动编译为「编年史条目 + 亲历者私人记忆 + 情绪状态 + 关系增量」，落地 `EmotionalCondition` 状态、`EventMemoryRule` 注册表、`record/executeCourtEvent` 原子提交，及四条事件规则（rank_changed / residence_changed / heir_born / heir_died）。

**Architecture:** `record/executeCourtEvent` 的两入口（record_after / execute）都在 `appendCourtEvent`（PR1，本 PR 改 `Result`）之上：append 不可变事件后，把规则产出的**记忆/关系效果**（复用既有 `EventEffect` 漏斗，`sourceEventId` 指向本事件）与**情绪状态**应用到 state。知情资格沿用 PR1 的规则式 `canKnowEvent`（无需写 awareness 行）。规则只为「有记忆库的角色」（侍君）建记忆——player/sovereign 无记忆库，不建。

**Tech Stack:** TypeScript, Zod, Vitest。

## Global Constraints

- 预发布不做旧档迁移（见 [[no-save-backcompat]]）。**事件（chronicle）与私人记忆严格 append-only**。
- **`EmotionalCondition` 仅「create-only-for-now」**，非严格 append-only：本 PR 只提供创建；它是**可演进的当前状态**，severity 下降 / acute→prolonged 转化 / 结束（关闭）等恢复操作**延后实现**，故不把它写进 append-only 不变量，免得后续推翻。
- 记忆/关系/世界状态写入仍只经 `applyEffects` 漏斗（规则产出 `EventEffect[]`）；`EmotionalCondition` 经专用 append 助手。
- 规则**只为有记忆库的角色建记忆**（`state.memories[char]` 存在，即侍君）；目标不存在则跳过，不报错。
- **单一契约**：事件类型（规则）决定其世界状态变化（`rule.worldEffects`）与前置校验（`rule.validate`），调用者只传 `draft`，**不能漏传/传错** world effect。
- `record/executeCourtEvent` 原子：validate 失败或任一子步失败则整批回退，调用方保留原 state（沿用 funnel 的 reject-all 语义）；**领域校验走 `Result`，不混用异常**（`appendCourtEvent` 改返 `Result`）。
- 数值 0–100 截断；时间戳 `GameTime`；确定性（无 `Math.random()`）。
- 称谓避「郎」「卿」等（见 [[official-naming-rule]]）。
- 依赖：PR2a（`heir_died` 效果、`alive` 谓词、presence）+ PR2b（新 `MemoryEntry`、effect 草稿可 permanent）均已并入。

---

### Task 1: `EmotionalCondition` 状态 + 助手

**Files:**
- Modify: `src/engine/state/types.ts`（`EmotionalCondition`/`EmotionalConditionType`；`GameState.emotionalConditions`）
- Modify: `src/engine/save/stateSchema.ts`（schema）
- Modify: `src/engine/state/initialState.ts`、`src/engine/state/newGame.ts`（`emotionalConditions: []`）
- Create: `src/engine/chronicle/conditions.ts`（`conditionId` + `appendCondition`）
- Test: `tests/chronicle/conditions.test.ts`、`tests/state/emotionalConditionSchema.test.ts`（新建）

**Interfaces:**
- Produces:
  - `type EmotionalConditionType = "acute_grief"|"prolonged_grief"|"resentment"|"anxiety"|"infatuation"|"humiliation";`
  - `EmotionalCondition { id; ownerId; type; sourceEventId; severity; startedAt: GameTime; recoveryProfile: "fast"|"normal"|"slow"|"stuck" }`
  - `GameState.emotionalConditions: EmotionalCondition[]`
  - `conditionId(ownerId, seq): string` → `"cond_<ownerId>_000001"`
  - `appendCondition(state, draft: Omit<EmotionalCondition,"id">): GameState`（id 由该 owner 现有最大序号+1；不可变）

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/conditions.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { appendCondition, conditionId } from "../../src/engine/chronicle/conditions";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";

describe("appendCondition", () => {
  it("按 owner 单调 id，不改入参", () => {
    expect(conditionId("gu", 1)).toBe("cond_gu_000001");
    const s0 = createInitialState();
    const s1 = appendCondition(s0, { ownerId: "gu", type: "acute_grief", sourceEventId: "evt_000001", severity: 90, startedAt: makeGameTime(1,5,"mid"), recoveryProfile: "slow" });
    expect(s1.emotionalConditions[0]!.id).toBe("cond_gu_000001");
    expect(s0.emotionalConditions).toHaveLength(0);
    const s2 = appendCondition(s1, { ownerId: "gu", type: "anxiety", sourceEventId: "evt_000002", severity: 40, startedAt: makeGameTime(1,6,"mid"), recoveryProfile: "normal" });
    expect(s2.emotionalConditions[1]!.id).toBe("cond_gu_000002");
  });
});
```

新建 `tests/state/emotionalConditionSchema.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";

describe("emotionalConditions schema", () => {
  it("初始空数组通过；合法 condition 通过；非法 type 拒绝", () => {
    const s = createInitialState();
    expect(s.emotionalConditions).toEqual([]);
    expect(gameStateSchema.safeParse(s).success).toBe(true);
    s.emotionalConditions.push({ id: "cond_gu_000001", ownerId: "gu", type: "acute_grief", sourceEventId: "evt_000001", severity: 90, startedAt: makeGameTime(1,5,"mid"), recoveryProfile: "slow" });
    expect(gameStateSchema.safeParse(s).success).toBe(true);
    s.emotionalConditions.push({ ...s.emotionalConditions[0]!, id: "cond_gu_000002", type: "boredom" as never });
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/conditions.test.ts tests/state/emotionalConditionSchema.test.ts`
Expected: FAIL。

- [ ] **Step 3: 加类型（types.ts）**

在 `MemoryEntry`/`CharacterMemoryStore` 附近加：

```ts
export type EmotionalConditionType =
  | "acute_grief" | "prolonged_grief" | "resentment" | "anxiety" | "infatuation" | "humiliation";

export interface EmotionalCondition {
  id: string;                 // "cond_<ownerId>_000001"
  ownerId: string;
  type: EmotionalConditionType;
  sourceEventId: string;
  severity: number;           // 0–100
  startedAt: GameTime;
  recoveryProfile: "fast" | "normal" | "slow" | "stuck";
}
```

`GameState` 接口加（`chronicle` 之后）：

```ts
  /** 角色情绪状态（与永久创伤记忆分离；PR2c 只存储，自动恢复留待后续）。 */
  emotionalConditions: EmotionalCondition[];
```

- [ ] **Step 4: 加 schema（stateSchema.ts）**

在 `chronicle` schema 之后加：

```ts
  emotionalConditions: z.array(
    z.strictObject({
      id: z.string().min(1),
      ownerId: idSchema,
      type: z.enum(["acute_grief","prolonged_grief","resentment","anxiety","infatuation","humiliation"]),
      sourceEventId: z.string().min(1),
      severity: percent,
      startedAt: gameTimeSchema,
      recoveryProfile: z.enum(["fast","normal","slow","stuck"]),
    }),
  ),
```

- [ ] **Step 5: 初始化（initialState.ts + newGame.ts）**

两处 `return { ... }` 在 `chronicle: [],` 之后各加 `emotionalConditions: [],`。

- [ ] **Step 6: 实现助手（chronicle/conditions.ts）**

新建 `src/engine/chronicle/conditions.ts`：

```ts
/** 情绪状态写入：append-only，按 owner 单调 id。 */
import type { EmotionalCondition, GameState } from "../state/types";

export function conditionId(ownerId: string, seq: number): string {
  return `cond_${ownerId}_${String(seq).padStart(6, "0")}`;
}

export function appendCondition(state: GameState, draft: Omit<EmotionalCondition, "id">): GameState {
  const re = new RegExp(`^cond_${draft.ownerId}_(\\d{6})$`);
  let max = 0;
  for (const c of state.emotionalConditions) {
    const m = re.exec(c.id);
    if (m && Number(m[1]) > max) max = Number(m[1]);
  }
  const cond: EmotionalCondition = { id: conditionId(draft.ownerId, max + 1), ...draft };
  return { ...state, emotionalConditions: [...state.emotionalConditions, cond] };
}
```

- [ ] **Step 7: 运行测试 + 回归**

Run: `npx vitest run tests/chronicle/conditions.test.ts tests/state/emotionalConditionSchema.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿（新必填 `emotionalConditions` 若破坏旧严格-形状夹具，就地补 `[]`）。

- [ ] **Step 8: 提交**

```bash
git add src/engine/state/types.ts src/engine/save/stateSchema.ts src/engine/state/initialState.ts src/engine/state/newGame.ts src/engine/chronicle/conditions.ts tests/chronicle/conditions.test.ts tests/state/emotionalConditionSchema.test.ts
git commit -m "feat: EmotionalCondition 状态 + appendCondition（仅存储，自动恢复留后续）"
```

---

### Task 2: `appendCourtEvent`→Result + `EventMemoryRule`（判别联合）+ `recordCourtEvent`/`executeCourtEvent` + rank_changed

**Files:**
- Modify: `src/engine/chronicle/append.ts`（`appendCourtEvent` 改返 `Result`，不再 throw）
- Modify: `tests/chronicle/append.test.ts`（PR1 测试随签名更新）
- Create: `src/engine/chronicle/rules.ts`（`EventMemoryRule` 类型 + helper + 注册表 + `rank_changed` 规则）
- Create: `src/engine/chronicle/commit.ts`（`record/executeCourtEvent`）
- Test: `tests/chronicle/commit.test.ts`（新建）

**Interfaces:**
- Consumes：`appendCourtEvent`（本任务改 Result）、`applyEffects`（funnel）、`appendCondition`（Task 1）、`stateError`/`GameError`（infra/errors）、`EventEffect`、`CourtEvent`/`CourtEventType`。
- Produces:
  - `appendCourtEvent(state, draft): Result<{ state; event }, GameError[]>`（未来事件→err，不 throw）
  - `type EventMemoryDraft = Omit<CourtEvent, "id">;` `type EmotionalConditionDraft = Omit<EmotionalCondition, "id">;`
  - **判别联合 rule**（两种事务语义不混淆）：
    - `BaseEventMemoryRule { createPersonalMemories(state, event); applyRelationshipEffects(state, event); applyConditions?(state, event) }`
    - `RecordAfterEventRule extends Base { mode: "record_after"; validateTransition(before, after, draft): GameError[] }`
    - `ExecuteEventRule extends Base { mode: "execute"; validate(state, draft): GameError[]; worldEffects(state, draft): EventEffect[] }`
    - `type EventMemoryRule = RecordAfterEventRule | ExecuteEventRule;`
  - `const eventMemoryRules: Partial<Record<CourtEventType, EventMemoryRule>>`
  - `participantId(event, role): string | undefined`
  - **两个入口**（按 mode 分流，模式不符即 err）：
    - `recordCourtEvent(db, before, after, draft): Result<{ state; event }, GameError[]>`（用于 record_after：调用者已改好状态，传**前后两态**，`validateTransition` 证明变化真发生；记忆从 after 派生）
    - `executeCourtEvent(db, state, draft): Result<{ state; event }, GameError[]>`（用于 execute：规则自带 `worldEffects` 做变化）

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/commit.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { recordCourtEvent } from "../../src/engine/chronicle/commit";
import { makeGameTime, toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { CourtEvent } from "../../src/engine/state/types";

function rankDraft(state: ReturnType<typeof createNewGameState>, subject: string, from: string, to: string, over: Partial<Omit<CourtEvent,"id">> = {}): Omit<CourtEvent,"id"> {
  return {
    type: "rank_changed", occurredAt: toGameTime(state.calendar),
    participants: [{ charId: subject, role: "subject" }],
    payload: { from, to, direction: "demote" },
    publicity: { scope: "palace", persistence: "contemporaneous" },
    publicSalience: 60, retention: "slow", tags: ["demotion"], ...over,
  };
}

function setup() {
  const db = loadRealContent();
  const before = createNewGameState(db);
  const c = Object.values(db.characters).find((x) => x.kind === "consort" && x.initialStanding && x.initialStanding.rank !== "fenghou")!;
  return { db, before, id: c.id, from: before.standing[c.id]!.rank };
}

describe("recordCourtEvent + rank_changed（record_after，前后态验证）", () => {
  it("降位：validateTransition 通过 + 落编年史 + 被降者 target grievance 记忆；入参不变", () => {
    const { db, before, id, from } = setup();
    const after = structuredClone(before);
    after.standing[id]!.rank = "meiren"; // 上游 set_rank 已发生
    const r = recordCourtEvent(db, before, after, rankDraft(after, id, from, "meiren"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.event.id).toBe("evt_000001");
    expect(after.chronicle).toHaveLength(0); // 入参不变
    const mem = r.value.state.memories[id]!.entries.at(-1)!;
    expect(mem.perspective).toBe("target");
    expect(mem.kind).toBe("grievance");
    expect(mem.unresolved).toBe(true);
    expect(mem.sourceEventId).toBe(r.value.event.id);
  });

  it("声称的 from 与 before 不符 → validateTransition 拒绝（终态一致不够）", () => {
    const { db, before, id } = setup();
    const after = structuredClone(before);
    after.standing[id]!.rank = "meiren";
    const r = recordCourtEvent(db, before, after, rankDraft(after, id, "__not_real_from__", "meiren"));
    expect(r.ok).toBe(false);
  });

  it("after 未真正改位分（after.rank !== to）→ 拒绝", () => {
    const { db, before, id, from } = setup();
    const after = structuredClone(before); // 未改
    const r = recordCourtEvent(db, before, after, rankDraft(after, id, from, "meiren"));
    expect(r.ok).toBe(false);
    expect(after.chronicle).toHaveLength(0);
  });

  it("未来事件 → err", () => {
    const { db, before, id, from } = setup();
    const after = structuredClone(before);
    after.standing[id]!.rank = "meiren";
    const r = recordCourtEvent(db, before, after, rankDraft(after, id, from, "meiren", { occurredAt: makeGameTime(5, 1, "early") }));
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/commit.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: `appendCourtEvent` 改返 Result（append.ts）+ 更新其 PR1 测试**

把 `src/engine/chronicle/append.ts` 的 `appendCourtEvent` 改为返回 `Result`（删 `throw`）：

```ts
import { compareGameTime, toGameTime } from "../calendar/time";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { CourtEvent, GameState } from "../state/types";

// courtEventId / maxSeq / ID_RE 保持不变（见 PR1）

export function appendCourtEvent(
  state: GameState,
  draft: Omit<CourtEvent, "id">,
): Result<{ state: GameState; event: CourtEvent }, GameError[]> {
  if (compareGameTime(draft.occurredAt, toGameTime(state.calendar)) > 0) {
    return err([stateError("FUTURE_EVENT", `cannot append a future CourtEvent`, { context: { occurredAt: draft.occurredAt } })]);
  }
  const event: CourtEvent = { id: courtEventId(maxSeq(state.chronicle) + 1), ...draft };
  return ok({ state: { ...state, chronicle: [...state.chronicle, event] }, event });
}
```

在 `tests/chronicle/append.test.ts` 中，把直接解构改为经 `Result`，并把「拒绝未来事件」由 `toThrow` 改为 `.ok===false`：

```ts
// happy-path：const r = appendCourtEvent(s0, draft); expect(r.ok).toBe(true); if(!r.ok) return; const { state: s1, event: e1 } = r.value; …
// 未来事件：expect(appendCourtEvent(s, future).ok).toBe(false);
```

（逐处把 `const { state, event } = appendCourtEvent(...)` 改为先取 `r`、断言 `r.ok`、再用 `r.value`。）

- [ ] **Step 4: 实现注册表 + rank_changed（rules.ts）**

新建 `src/engine/chronicle/rules.ts`：

```ts
/**
 * 事件→记忆 编译规则（判别联合，两种事务语义显式分开）：
 * - record_after：变化由上游动作（set_rank/relocate/birth）完成；规则 validateTransition(before, after)
 *   证明「变化真发生」（不只验终态一致）；记忆从 after 派生。
 * - execute：无独立上游动作（heir_died）；规则 validate + worldEffects 由提交执行变化。
 * 规则只为有记忆库的角色（侍君）建记忆。
 */
import type { EventEffect } from "../content/schemas";
import { stateError, type GameError } from "../infra/errors";
import type { CourtEvent, CourtEventType, EmotionalCondition, GameState } from "../state/types";

export type EventMemoryDraft = Omit<CourtEvent, "id">;
export type EmotionalConditionDraft = Omit<EmotionalCondition, "id">;

interface BaseEventMemoryRule {
  createPersonalMemories(state: GameState, event: CourtEvent): EventEffect[];
  applyRelationshipEffects(state: GameState, event: CourtEvent): EventEffect[];
  applyConditions?(state: GameState, event: CourtEvent): EmotionalConditionDraft[];
}
export interface RecordAfterEventRule extends BaseEventMemoryRule {
  mode: "record_after";
  validateTransition(before: GameState, after: GameState, draft: EventMemoryDraft): GameError[];
}
export interface ExecuteEventRule extends BaseEventMemoryRule {
  mode: "execute";
  validate(state: GameState, draft: EventMemoryDraft): GameError[];
  worldEffects(state: GameState, draft: EventMemoryDraft): EventEffect[];
}
export type EventMemoryRule = RecordAfterEventRule | ExecuteEventRule;

function roleId(participants: { charId: string; role: string }[], role: string): string | undefined {
  return participants.find((p) => p.role === role)?.charId;
}
export function participantId(event: CourtEvent, role: string): string | undefined {
  return roleId(event.participants, role);
}

const rankChanged: RecordAfterEventRule = {
  mode: "record_after",
  // 证明降/晋位真的发生：before.rank===from ∧ after.rank===to ∧ from!==to。
  validateTransition(before, after, draft) {
    const errs: GameError[] = [];
    const subject = roleId(draft.participants, "subject");
    const { from, to, direction } = draft.payload;
    if (!subject || !before.standing[subject] || !after.standing[subject]) errs.push(stateError("RULE_BAD", "rank_changed needs 'subject' with standing in both states"));
    if (direction !== "demote" && direction !== "promote") errs.push(stateError("RULE_BAD", "rank_changed direction must be demote|promote"));
    if (typeof from !== "string" || typeof to !== "string") errs.push(stateError("RULE_BAD", "rank_changed payload.from/to missing"));
    else if (from === to) errs.push(stateError("RULE_BAD", "rank_changed from === to"));
    else if (subject && before.standing[subject] && after.standing[subject]) {
      if (before.standing[subject]!.rank !== from) errs.push(stateError("RULE_BAD", "before.rank !== payload.from"));
      if (after.standing[subject]!.rank !== to) errs.push(stateError("RULE_BAD", "after.rank !== payload.to"));
    }
    return errs;
  },
  createPersonalMemories(state, event) {
    const subject = participantId(event, "subject")!;
    if (!state.memories[subject]) return [];
    const demote = event.payload.direction === "demote";
    return [{
      type: "memory", char: subject,
      entry: {
        kind: demote ? "grievance" : "episodic",
        summary: demote ? "位分见黜，心有不甘。" : "蒙恩晋位。",
        strength: demote ? 70 : 55, retention: "slow",
        subjectIds: [subject], perspective: "target",
        triggerTags: demote ? ["rank", "demotion"] : ["rank", "promotion"],
        unresolved: demote, emotions: demote ? { shame: 60, anger: 50 } : { joy: 40 },
        sourceEventId: event.id,
      },
    }];
  },
  applyRelationshipEffects: () => [],
};

export const eventMemoryRules: Partial<Record<CourtEventType, EventMemoryRule>> = {
  rank_changed: rankChanged,
};
```

> 复位（promote）生成另一条 `episodic` 记忆，**不修改**旧 grievance——append-only。

- [ ] **Step 5: 实现 record/executeCourtEvent（commit.ts）**

新建 `src/engine/chronicle/commit.ts`：

```ts
/**
 * 客观事件提交（原子，全程 Result）。两种入口对应两种事务语义：
 * - recordCourtEvent：record_after 规则。调用者已用上游动作改好状态，传 before/after 两态；
 *   validateTransition 证明变化真发生 → append（到 after）→ 派生记忆/情绪。
 * - executeCourtEvent：execute 规则。validate → worldEffects（执行变化）→ append → 派生。
 * 任一子步失败整批回退，调用方保留原 state。
 */
import { appendCourtEvent } from "./append";
import { appendCondition } from "./conditions";
import { eventMemoryRules, type EventMemoryDraft } from "./rules";
import type { EventMemoryRule } from "./rules";
import type { ContentDB } from "../content/loader";
import { applyEffects } from "../effects/funnel";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { CourtEvent, GameState } from "../state/types";

/** append 之后：把规则的记忆/关系效果经漏斗应用，再 append 情绪状态。 */
function deriveMemoriesAndConditions(
  db: ContentDB, state: GameState, event: CourtEvent, rule: EventMemoryRule,
): Result<GameState, GameError[]> {
  let cur = state;
  const effects = [...rule.createPersonalMemories(cur, event), ...rule.applyRelationshipEffects(cur, event)];
  if (effects.length > 0) {
    const a = applyEffects(db, cur, effects);
    if (!a.ok) return err(a.error);
    cur = a.value;
  }
  for (const cd of rule.applyConditions?.(cur, event) ?? []) cur = appendCondition(cur, cd);
  return ok(cur);
}

export function recordCourtEvent(
  db: ContentDB, before: GameState, after: GameState, draft: EventMemoryDraft,
): Result<{ state: GameState; event: CourtEvent }, GameError[]> {
  const rule = eventMemoryRules[draft.type];
  if (!rule || rule.mode !== "record_after") return err([stateError("RULE_MODE", `${draft.type} is not a record_after event`)]);
  const vErrs = rule.validateTransition(before, after, draft);
  if (vErrs.length > 0) return err(vErrs);
  const appended = appendCourtEvent(after, draft);
  if (!appended.ok) return err(appended.error);
  const derived = deriveMemoriesAndConditions(db, appended.value.state, appended.value.event, rule);
  return derived.ok ? ok({ state: derived.value, event: appended.value.event }) : err(derived.error);
}

export function executeCourtEvent(
  db: ContentDB, state: GameState, draft: EventMemoryDraft,
): Result<{ state: GameState; event: CourtEvent }, GameError[]> {
  const rule = eventMemoryRules[draft.type];
  if (!rule || rule.mode !== "execute") return err([stateError("RULE_MODE", `${draft.type} is not an execute event`)]);
  const vErrs = rule.validate(state, draft);
  if (vErrs.length > 0) return err(vErrs);
  let cur = state;
  const we = rule.worldEffects(state, draft);
  if (we.length > 0) {
    const a = applyEffects(db, cur, we);
    if (!a.ok) return err(a.error);
    cur = a.value;
  }
  const appended = appendCourtEvent(cur, draft);
  if (!appended.ok) return err(appended.error);
  const derived = deriveMemoriesAndConditions(db, appended.value.state, appended.value.event, rule);
  return derived.ok ? ok({ state: derived.value, event: appended.value.event }) : err(derived.error);
}
```

- [ ] **Step 6: 运行测试 + 回归**

Run: `npx vitest run tests/chronicle/commit.test.ts tests/chronicle/append.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 7: 提交**

```bash
git add src/engine/chronicle/append.ts tests/chronicle/append.test.ts src/engine/chronicle/rules.ts src/engine/chronicle/commit.ts tests/chronicle/commit.test.ts
git commit -m "feat: record/executeCourtEvent（rule 判别联合 + 前后态验证）+ appendCourtEvent 改 Result + rank_changed 被降者 target 记忆"
```

---

### Task 3: `residence_changed` 规则（编年史 fast + 同宫者低强度记忆）

**Files:**
- Modify: `src/engine/chronicle/rules.ts`（加 `residenceChanged` 规则 + 注册）
- Test: `tests/chronicle/residenceRule.test.ts`（新建）

**Interfaces:**
- Consumes（Task 2）：`RecordAfterEventRule`、`participantId`、`recordCourtEvent`、`stateError`。
- Produces: `residence_changed` 规则——**record_after**（搬迁是上游 relocate 动作；`validateTransition` 证明 `before.residence===from ∧ after.residence===to`）；为搬入者建 `kind:"impression"`、`retention:"fast"` 低强度记忆，不预存评价（「如今热闹」走派生）。

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/residenceRule.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { recordCourtEvent } from "../../src/engine/chronicle/commit";
import { toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("recordCourtEvent + residence_changed（record_after）", () => {
  it("迁居：前后住处一致才通过 + 为搬入者建 fast impression 记忆", () => {
    const db = loadRealContent();
    const before = createNewGameState(db);
    const mover = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    before.standing[mover.id]!.residence = "qixiagong";
    const after = structuredClone(before);
    after.standing[mover.id]!.residence = "xianfu_palace"; // 上游 relocate 已发生
    const r = recordCourtEvent(db, before, after, {
      type: "residence_changed", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: mover.id, role: "mover" }],
      locationId: "xianfu_palace", payload: { from: "qixiagong", to: "xianfu_palace" },
      publicity: { scope: "palace", persistence: "contemporaneous" },
      publicSalience: 40, retention: "fast", tags: ["residence"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mem = r.value.state.memories[mover.id]!.entries.at(-1)!;
    expect(mem.kind).toBe("impression");
    expect(mem.retention).toBe("fast");
    expect(mem.sourceEventId).toBe(r.value.event.id);
    expect(mem.subjectIds).toContain(mover.id);
  });

  it("after 未真正迁居（after.residence !== to）→ validateTransition 拒绝", () => {
    const db = loadRealContent();
    const before = createNewGameState(db);
    const mover = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    before.standing[mover.id]!.residence = "qixiagong";
    const after = structuredClone(before); // 未迁
    const r = recordCourtEvent(db, before, after, {
      type: "residence_changed", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: mover.id, role: "mover" }],
      payload: { from: "qixiagong", to: "xianfu_palace" },
      publicity: { scope: "palace", persistence: "contemporaneous" },
      publicSalience: 40, retention: "fast", tags: ["residence"],
    });
    expect(r.ok).toBe(false);
    expect(after.chronicle).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/residenceRule.test.ts`
Expected: FAIL（`residence_changed` 未注册）。

- [ ] **Step 3: 实现规则（rules.ts）**

在 `rules.ts` 加（并注册 `residence_changed`）：

```ts
const residenceChanged: RecordAfterEventRule = {
  mode: "record_after",
  validateTransition(before, after, draft) {
    const errs: GameError[] = [];
    const mover = roleId(draft.participants, "mover");
    const { from, to } = draft.payload;
    if (!mover || !before.standing[mover] || !after.standing[mover]) errs.push(stateError("RULE_BAD", "residence_changed needs 'mover' with standing in both states"));
    if (typeof to !== "string") errs.push(stateError("RULE_BAD", "residence_changed payload.to missing"));
    else if (mover && before.standing[mover] && after.standing[mover]) {
      if (before.standing[mover]!.residence !== from) errs.push(stateError("RULE_BAD", "before.residence !== payload.from"));
      if (after.standing[mover]!.residence !== to) errs.push(stateError("RULE_BAD", "after.residence !== payload.to"));
    }
    return errs;
  },
  createPersonalMemories(state, event) {
    const mover = participantId(event, "mover");
    if (!mover || !state.memories[mover]) return [];
    const to = typeof event.payload.to === "string" ? event.payload.to : (event.locationId ?? "");
    return [{
      type: "memory", char: mover,
      entry: {
        kind: "impression", summary: `迁居${to}。`, strength: 35, retention: "fast",
        subjectIds: [mover], perspective: "actor", triggerTags: ["residence"],
        unresolved: false, emotions: {}, sourceEventId: event.id,
      },
    }];
  },
  applyRelationshipEffects: () => [],
};
```

并在 `eventMemoryRules` 加 `residence_changed: residenceChanged,`。

- [ ] **Step 4: 运行测试 + 回归**

Run: `npx vitest run tests/chronicle/residenceRule.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/engine/chronicle/rules.ts tests/chronicle/residenceRule.test.ts
git commit -m "feat: residence_changed 规则（搬入者 fast impression 记忆）"
```

---

### Task 4: `heir_born` 规则（编年史 institutional + 生父 permanent 喜悦记忆）

**Files:**
- Modify: `src/engine/chronicle/rules.ts`
- Test: `tests/chronicle/heirBornRule.test.ts`（新建）

**Interfaces:**
- Consumes（Task 2）：`RecordAfterEventRule`、`participantId`、`recordCourtEvent`、`stateError`；PR2a 的 birth/heir 状态。
- Produces: `heir_born` 规则——**record_after**（出生由上游 birth 流程完成；`validateTransition` 证明 heirId **before 不在 / after 在** `bloodline.heirs`，且与 `newborn` participant 一致）；为生父（`birth_father`）与养父（`adoptive_father`）建 `kind:"episodic"`、`retention:"permanent"`、`emotions.joy` 记忆。**父母按 charId 去重**；`sovereign_parent`（player，无记忆库）跳过。

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/heirBornRule.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { recordCourtEvent } from "../../src/engine/chronicle/commit";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { EventEffect } from "../../src/engine/content/schemas";

/** before=出生前（无嗣）；after=帝王自孕→生产后（有嗣）。applyEffects 不改入参，故 before 保持洁净。 */
function bornStates(db = loadRealContent()) {
  const before = createNewGameState(db);
  let after = before;
  for (const e of [{ type: "pregnancy", op: "begin" }, { type: "pregnancy", op: "carry" }] as EventEffect[]) {
    after = (applyEffects(db, after, [e]) as { value: typeof after }).value;
  }
  after = (applyEffects(db, after, [{ type: "birth", bearer: "sovereign", fatherId: null, sex: "daughter", legitimate: true, favor: 50, bearerOutcome: "safe" }]) as { value: typeof after }).value;
  const father = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
  return { db, before, after, heirId: after.resources.bloodline.heirs[0]!.id, fatherId: father.id };
}

describe("recordCourtEvent + heir_born（record_after）", () => {
  it("生父 permanent 喜悦记忆；sovereign 跳过；before 无 heir、after 有", () => {
    const { db, before, after, heirId, fatherId } = bornStates();
    const r = recordCourtEvent(db, before, after, {
      type: "heir_born", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: fatherId, role: "birth_father" }, { charId: "player", role: "sovereign_parent" }, { charId: heirId, role: "newborn" }],
      payload: { heirId, birthOrder: 7 },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 85, retention: "slow", tags: ["birth"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mem = r.value.state.memories[fatherId]!.entries.at(-1)!;
    expect(mem.kind).toBe("episodic");
    expect(mem.retention).toBe("permanent");
    expect((mem.emotions.joy ?? 0)).toBeGreaterThan(0);
    expect(mem.subjectIds).toContain(heirId);
    expect(mem.sourceEventId).toBe(r.value.event.id);
    expect(r.value.state.memories["player"]).toBeUndefined();
  });

  it("同一人兼生父+养父：仅一条记忆（按 charId 去重）", () => {
    const { db, before, after, heirId, fatherId } = bornStates();
    const r = recordCourtEvent(db, before, after, {
      type: "heir_born", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: fatherId, role: "birth_father" }, { charId: fatherId, role: "adoptive_father" }, { charId: heirId, role: "newborn" }],
      payload: { heirId },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 85, retention: "slow", tags: ["birth"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.memories[fatherId]!.entries).toHaveLength(1); // 不是 2
  });

  it("before 已含该 heir（非真正新生）→ validateTransition 拒绝", () => {
    const { db, after, heirId, fatherId } = bornStates();
    const r = recordCourtEvent(db, after, after, { // before===after：heir 已在 before
      type: "heir_born", occurredAt: toGameTime(after.calendar),
      participants: [{ charId: fatherId, role: "birth_father" }, { charId: heirId, role: "newborn" }],
      payload: { heirId },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 85, retention: "slow", tags: ["birth"],
    });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/heirBornRule.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现规则（rules.ts）**

在 `rules.ts` 加去重 helper + 规则（并注册 `heir_born`）：

```ts
/** 取事件中给定 roles 的不重复父母 charId（保持首次出现顺序）。 */
export function uniqueParentIds(event: CourtEvent, roles: string[]): string[] {
  const seen = new Set<string>();
  for (const role of roles) {
    const id = participantId(event, role);
    if (id) seen.add(id);
  }
  return [...seen];
}

const heirBorn: RecordAfterEventRule = {
  mode: "record_after",
  validateTransition(before, after, draft) {
    const errs: GameError[] = [];
    const heirId = draft.payload.heirId;
    if (typeof heirId !== "string") errs.push(stateError("RULE_BAD", "heir_born payload.heirId missing"));
    else {
      if (before.resources.bloodline.heirs.some((h) => h.id === heirId)) errs.push(stateError("RULE_BAD", "heir_born: heir already existed before"));
      if (!after.resources.bloodline.heirs.some((h) => h.id === heirId)) errs.push(stateError("RULE_BAD", "heir_born: heir not present after"));
    }
    const newborn = roleId(draft.participants, "newborn");
    if (newborn && typeof heirId === "string" && newborn !== heirId) errs.push(stateError("RULE_BAD", "heir_born newborn participant must match payload.heirId"));
    return errs;
  },
  createPersonalMemories(state, event) {
    const heirId = typeof event.payload.heirId === "string" ? event.payload.heirId : "";
    return uniqueParentIds(event, ["birth_father", "adoptive_father"])
      .filter((id) => state.memories[id])
      .map((id) => ({
        type: "memory", char: id,
        entry: {
          kind: "episodic", summary: `诞下皇嗣，喜不自胜。`, strength: 85, retention: "permanent",
          subjectIds: [heirId], perspective: "parent", triggerTags: ["heir", "birth", "anniversary"],
          unresolved: false, emotions: { joy: 80 }, sourceEventId: event.id,
        },
      }));
  },
  applyRelationshipEffects: () => [],
};
```

并在 `eventMemoryRules` 加 `heir_born: heirBorn,`。

- [ ] **Step 4: 运行测试 + 回归**

Run: `npx vitest run tests/chronicle/heirBornRule.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/engine/chronicle/rules.ts tests/chronicle/heirBornRule.test.ts
git commit -m "feat: heir_born 规则（生父/养父 permanent 喜悦记忆）"
```

---

### Task 5: `heir_died` 规则（heir_died 效果 + 编年史 + 养父 permanent 创伤 + acute_grief）

**Files:**
- Modify: `src/engine/chronicle/rules.ts`
- Test: `tests/chronicle/heirDiedRule.test.ts`（新建）

**Interfaces:**
- Consumes：PR2a 的 `heir_died` 效果（由 **`rule.worldEffects` 自带**，经 `executeCourtEvent`）；Task 1 的 `appendCondition`。
- Produces: `heir_died` 规则——**execute**（`mode:"execute"`、`worldEffects=[{type:"heir_died",heirId}]` 做生死转移；`validate` 强制 heirId 在 `bloodline.heirs` 且**当前 alive**、`deceased` participant 与之一致）；为养父/生父（侍君）各一条 `kind:"trauma"`、`retention:"permanent"`、`emotions.grief` 高记忆；**父母按 charId 去重，guilt 取 `max`**（同一人兼养父+生父 → 一条记忆、guilt=90）；每位建 `acute_grief`。

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/heirDiedRule.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { executeCourtEvent } from "../../src/engine/chronicle/commit";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { EventEffect } from "../../src/engine/content/schemas";

function stateWithHeirAndFosterFather(db = loadRealContent()) {
  let state = createNewGameState(db);
  for (const e of [{ type: "pregnancy", op: "begin" }, { type: "pregnancy", op: "carry" }] as EventEffect[]) {
    state = (applyEffects(db, state, [e]) as { value: typeof state }).value;
  }
  state = (applyEffects(db, state, [{ type: "birth", bearer: "sovereign", fatherId: null, sex: "daughter", legitimate: true, favor: 50, bearerOutcome: "safe" }]) as { value: typeof state }).value;
  const heirId = state.resources.bloodline.heirs[0]!.id;
  const foster = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
  return { db, state, heirId, fosterId: foster.id };
}

describe("heir_died 规则", () => {
  it("worldEffects 标记皇嗣 deceased + 养父 permanent 创伤 + acute_grief（无需传 worldEffects）", () => {
    const { db, state, heirId, fosterId } = stateWithHeirAndFosterFather();
    const r = executeCourtEvent(db, state, {
      type: "heir_died", occurredAt: toGameTime(state.calendar),
      participants: [{ charId: fosterId, role: "adoptive_father" }, { charId: heirId, role: "deceased" }],
      payload: { heirId },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 100, retention: "slow", tags: ["death", "heir"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.resources.bloodline.heirs.find((h) => h.id === heirId)!.lifecycle).toBe("deceased");
    const mem = r.value.state.memories[fosterId]!.entries.at(-1)!;
    expect(mem.kind).toBe("trauma");
    expect(mem.retention).toBe("permanent");
    expect((mem.emotions.grief ?? 0)).toBeGreaterThan(50);
    expect(r.value.state.emotionalConditions.find((c) => c.ownerId === fosterId)!.type).toBe("acute_grief");
  });

  it("同一人兼养父+生父：仅一条创伤、一个 condition，guilt 取 max(=90)", () => {
    const { db, state, heirId, fosterId } = stateWithHeirAndFosterFather();
    const r = executeCourtEvent(db, state, {
      type: "heir_died", occurredAt: toGameTime(state.calendar),
      participants: [{ charId: fosterId, role: "adoptive_father" }, { charId: fosterId, role: "birth_father" }, { charId: heirId, role: "deceased" }],
      payload: { heirId },
      publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 100, retention: "slow", tags: ["death", "heir"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.memories[fosterId]!.entries.filter((m) => m.kind === "trauma")).toHaveLength(1);
    expect(r.value.state.emotionalConditions.filter((c) => c.ownerId === fosterId)).toHaveLength(1);
    expect(r.value.state.memories[fosterId]!.entries.at(-1)!.emotions.guilt).toBe(90);
  });

  it("已夭折皇嗣再 commit heir_died → validate 拒绝", () => {
    const { db, state, heirId, fosterId } = stateWithHeirAndFosterFather();
    const once = executeCourtEvent(db, state, {
      type: "heir_died", occurredAt: toGameTime(state.calendar),
      participants: [{ charId: fosterId, role: "adoptive_father" }, { charId: heirId, role: "deceased" }],
      payload: { heirId }, publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 100, retention: "slow", tags: ["death"],
    });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const again = executeCourtEvent(db, once.value.state, {
      type: "heir_died", occurredAt: toGameTime(state.calendar),
      participants: [{ charId: fosterId, role: "adoptive_father" }, { charId: heirId, role: "deceased" }],
      payload: { heirId }, publicity: { scope: "palace", persistence: "institutional" },
      publicSalience: 100, retention: "slow", tags: ["death"],
    });
    expect(again.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/heirDiedRule.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现规则（rules.ts）**

在 `rules.ts` 加去重-取-max helper + 规则（并注册 `heir_died`）：

```ts
/** 丧亲父母：按 charId 去重，guilt 取各角色最大值（adoptive 90 / birth 40）。 */
function bereavedParents(event: CourtEvent): Map<string, number> {
  const byRole: Record<string, number> = { adoptive_father: 90, birth_father: 40 };
  const map = new Map<string, number>();
  for (const [role, guilt] of Object.entries(byRole)) {
    const id = participantId(event, role);
    if (id) map.set(id, Math.max(map.get(id) ?? 0, guilt));
  }
  return map;
}

const heirDied: ExecuteEventRule = {
  mode: "execute",
  validate(state, draft) {
    const errs: GameError[] = [];
    const heirId = draft.payload.heirId;
    if (typeof heirId !== "string") errs.push(stateError("RULE_BAD", "heir_died payload.heirId missing"));
    else {
      const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
      if (!heir) errs.push(stateError("RULE_BAD", "heir_died heirId not in bloodline.heirs"));
      else if (heir.lifecycle === "deceased") errs.push(stateError("RULE_BAD", "heir already deceased"));
    }
    const dec = roleId(draft.participants, "deceased");
    if (dec && typeof heirId === "string" && dec !== heirId) errs.push(stateError("RULE_BAD", "heir_died deceased participant must match payload.heirId"));
    return errs;
  },
  worldEffects(state, draft) {
    return [{ type: "heir_died", heirId: String(draft.payload.heirId) }];
  },
  createPersonalMemories(state, event) {
    const heirId = typeof event.payload.heirId === "string" ? event.payload.heirId : "";
    const out: EventEffect[] = [];
    for (const [id, guilt] of bereavedParents(event)) {
      if (!state.memories[id]) continue;
      out.push({
        type: "memory", char: id,
        entry: {
          kind: "trauma", summary: `皇嗣夭折，痛失骨血。`, strength: 100, retention: "permanent",
          subjectIds: [heirId], perspective: "parent",
          triggerTags: ["death", "heir", "anniversary"], unresolved: true,
          emotions: { grief: 95, guilt }, sourceEventId: event.id,
        },
      });
    }
    return out;
  },
  applyRelationshipEffects: () => [],
  applyConditions(state, event) {
    const out: EmotionalConditionDraft[] = [];
    for (const [id] of bereavedParents(event)) {
      if (state.memories[id]) out.push({ ownerId: id, type: "acute_grief", sourceEventId: event.id, severity: 95, startedAt: event.occurredAt, recoveryProfile: "slow" });
    }
    return out;
  },
};
```

并在 `eventMemoryRules` 加 `heir_died: heirDied,`。

> `bereavedParents` 同时驱动记忆与 condition，保证二者父母集合一致且去重。

- [ ] **Step 4: 运行测试 + 回归 + 类型检查**

Run: `npx vitest run tests/chronicle/heirDiedRule.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿。
Run: `npx tsc --noEmit`（若项目用 tsc）
Expected: 无类型错误。

- [ ] **Step 5: 提交**

```bash
git add src/engine/chronicle/rules.ts tests/chronicle/heirDiedRule.test.ts
git commit -m "feat: heir_died 规则（heir_died 效果 + 养父/生父 permanent 创伤 + acute_grief）"
```

---

## Self-Review

**Spec coverage:** `EmotionalCondition`（含 id/ownerId）仅存储→T1；`EventMemoryRule` 注册表 + `record/executeCourtEvent`→T2；四规则 rank_changed→T2、residence_changed→T3、heir_born→T4、heir_died→T5。`heir_died` 经 worldEffects 复用 PR2a 效果；记忆经漏斗、`sourceEventId` 指向事件；`acute_grief` 与 permanent 创伤记忆分离（spec「记一辈子≠每句都哭」）。

**Placeholder scan:** 无 TBD；每步含完整代码/命令/预期。

**Type consistency:** `EmotionalCondition`/`emotionalConditions`（T1）→ commit conditions 路径（T2）、heir_died（T5）一致；`EventMemoryRule`（validate/worldEffects/createPersonalMemories(state,event)/…）+ `EventMemoryDraft`/`EmotionalConditionDraft`/`participantId`/`uniqueParentIds`/`eventMemoryRules`/`record/executeCourtEvent`（T2）→ T3/T4/T5 一致引用；规则产 memory `EventEffect` 用 PR2b 新草稿字段；`appendCourtEvent` 改 Result 后 commit 与其 PR1 测试一致。

**已知实现期决策:**
1. **单一契约**：world 变化由 `rule.worldEffects` 决定，调用者只传 draft。**执行型**仅 `heir_died`（`worldEffects=[heir_died]`，无独立「皇嗣夭折」玩家动作，故由规则 apply 生死转移）。**记录型** `rank_changed`/`residence_changed`/`heir_born`（变化由上游 set_rank/relocate/birth 完成）`worldEffects=[]` 但 `rule.validate` 强制状态一致（位分==to / 住处==to / heirId∈heirs），同样杜绝「记录与状态脱节」，并避免对 db.ranks 等内容的脆弱依赖。
2. commit 顺序：validate → worldEffects(apply) → appendCourtEvent(Result) → 规则记忆/关系(apply) → conditions(append)。`sourceEventId=event.id` 在 append 之后可知，故记忆在 append 之后产；world 变化在 append 之前（确保「皇嗣已 deceased」与「编年史记其夭折」同一原子提交）。
3. **领域校验全程 Result**：`appendCourtEvent` 由 throw 改 Result（更新其 PR1 测试），异常不再穿透 commit 的 `Result`。
4. **父母按 charId 去重**：`uniqueParentIds`（heir_born）/ `bereavedParents`（heir_died，guilt 取 max）避免同人双角色重复记忆/condition；记忆与 condition 共用同一父母集合。
5. `applyRelationshipEffects` 四规则均空（关系数值模型属 PR3）；保留接口位。
6. 规则只为 `state.memories[char]` 存在者建记忆（侍君）；player/sovereign 无库跳过不报错。
7. `EmotionalCondition` 仅本 PR 创建；恢复/转化/关闭延后（见 Global Constraints），故未纳入严格 append-only。
8. 降位生成被降者 `target` POV `grievance`（shame/anger、unresolved）；复位生成另一条 `episodic`，不改旧记忆（append-only）。

## 完成

至此 PR2a/2b/2c 三份 plan 齐备：PR2a 皇嗣生命周期（前置）、PR2b `MemoryEntry` 演进、PR2c 事件→记忆规则引擎。执行顺序 2a→2b→2c（2c 依赖前两者）。后续 PR3（候选召回 + ReactionPlanner）、PR4（激活/精排/冷却）、PR5（对话装配 + gates）各自单独成稿。

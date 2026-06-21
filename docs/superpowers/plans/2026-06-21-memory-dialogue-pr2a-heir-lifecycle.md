# 记忆/对话系统 PR2a：皇嗣生命周期 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给皇嗣加权威生死状态（`Heir.lifecycle`/`deceasedAt`）+ `heir_died` 状态转移效果，并把知情/在场判断扩展到皇嗣，从而恢复 `alive` 谓词——这是 PR2c `heir_died` 规则与对话事实校验的硬前置。

**Architecture:** `Heir` 现无生死字段、`heir_died` 仅是 `CourtEventType`（无状态转移）。本 PR 加 `Heir.lifecycle: "alive" | "deceased"` + `deceasedAt?`，出生时置 `"alive"`，新增 `heir_died` 效果做转移（不删数组、标记死亡）。新增 `chronicle/presence.ts` 统一「角色入场时刻 / 此刻在场」判断（侍君按 `palaceEnteredAt`，皇嗣按 `birthAt` 且未夭折），`canKnowEvent`、belief 可见性、`alive` 谓词都改走它——皇嗣不再被当未知角色。

**Tech Stack:** TypeScript, Zod, Vitest。

## Global Constraints

- 预发布阶段不做旧档迁移（state 形状变更不写迁移代码）。见 [[no-save-backcompat]]。
- 数值属性 0–100 截断；时间戳一律 `GameTime`。`lifecycle` **必填**（不迁移旧档，无需缺省）；跨字段不变量：`alive ⇒ 无 deceasedAt`、`deceased ⇒ 有 deceasedAt`（schema superRefine 强制）。
- 效果只经 `applyEffects` 漏斗写入（与既有 effect 同闸：schema 校验 + target 存在性）。
- 严格 append-only：`heir_died` **不删** `bloodline.heirs` 条目，只标 `lifecycle:"deceased"` + `deceasedAt`。
- 纯函数 / 确定性；测试 Vitest（`npx vitest run <path>`）。
- 称谓避用「郎」「卿」等男性向字（见 [[official-naming-rule]]）。
- 基线：PR1 已并入（589 测试绿）。

---

### Task 1: `Heir.lifecycle` + `deceasedAt` 字段（类型/schema/出生置 alive）

**Files:**
- Modify: `src/engine/state/types.ts`（`HeirLifecycle` 类型；`Heir.lifecycle`/`deceasedAt`）
- Modify: `src/engine/save/stateSchema.ts`（heir schema 加 `lifecycle` + `deceasedAt`）
- Modify: `src/engine/effects/funnel.ts`（birth apply 推入的 heir 加 `lifecycle: "alive"`）
- Test: `tests/state/heirLifecycle.test.ts`（新建）

**Interfaces:**
- Produces: `type HeirLifecycle = "alive" | "deceased";` `Heir.lifecycle: HeirLifecycle;` `Heir.deceasedAt?: GameTime;`
- Consumes: 既有 `Heir`、`birth` 效果。

- [ ] **Step 1: 写失败测试**

新建 `tests/state/heirLifecycle.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import type { EventEffect } from "../../src/engine/content/schemas";

/** 造一个帝王自孕→生产的最小路径，使 bloodline.heirs 落一胎。 */
function stateWithOneHeir() {
  const db = loadRealContent();
  let state = createNewGameState(db);
  const seq: EventEffect[] = [
    { type: "pregnancy", op: "begin" },
    { type: "pregnancy", op: "carry" },
  ];
  for (const e of seq) {
    const r = applyEffects(db, state, [e]);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    state = r.value;
  }
  const birth = applyEffects(db, state, [
    { type: "birth", bearer: "sovereign", fatherId: null, sex: "daughter", legitimate: true, favor: 50, bearerOutcome: "safe" },
  ]);
  if (!birth.ok) throw new Error(JSON.stringify(birth.error));
  return { db, state: birth.value };
}

describe("Heir.lifecycle", () => {
  it("出生的皇嗣 lifecycle 为 alive，且通过 schema", () => {
    const { state } = stateWithOneHeir();
    const heir = state.resources.bloodline.heirs[0]!;
    expect(heir.lifecycle).toBe("alive");
    expect(heir.deceasedAt).toBeUndefined();
    expect(gameStateSchema.safeParse(state).success).toBe(true);
  });

  it("跨字段不变量：alive+deceasedAt / deceased 无 deceasedAt 被 schema 拒绝", () => {
    const { state } = stateWithOneHeir();
    const bad1 = structuredClone(state);
    bad1.resources.bloodline.heirs[0]!.deceasedAt = makeGameTime(1, 3, "mid"); // alive + deceasedAt
    expect(gameStateSchema.safeParse(bad1).success).toBe(false);
    const bad2 = structuredClone(state);
    bad2.resources.bloodline.heirs[0]!.lifecycle = "deceased"; // deceased 无 deceasedAt
    expect(gameStateSchema.safeParse(bad2).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/state/heirLifecycle.test.ts`
Expected: FAIL（`heir.lifecycle` 为 undefined / schema 无此字段）。

- [ ] **Step 3: 加类型（types.ts）**

在 `src/engine/state/types.ts` 的 `HeirSex` 定义之后加：

```ts
export type HeirLifecycle = "alive" | "deceased";
```

在 `Heir` 接口内、`faction: HeirFaction;` 之后加：

```ts
  /** 生死状态（出生置 alive；heir_died 转 deceased）。 */
  lifecycle: HeirLifecycle;
  /** 夭折时刻；存活时 undefined。 */
  deceasedAt?: GameTime;
```

- [ ] **Step 4: 加 schema（stateSchema.ts）**

在 `src/engine/save/stateSchema.ts` 的 heir `z.strictObject({...})` 内、`faction: z.enum([...])` 之后加两字段：

```ts
          lifecycle: z.enum(["alive", "deceased"]),
          deceasedAt: gameTimeSchema.optional(),
```

并给该 heir `z.strictObject({...})` **整体**追加跨字段不变量（在 `})` 之后、`)` 之前链式 `.superRefine`）：

```ts
        }).superRefine((h, ctx) => {
          if (h.lifecycle === "alive" && h.deceasedAt !== undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "alive heir must not have deceasedAt", path: ["deceasedAt"] });
          }
          if (h.lifecycle === "deceased" && h.deceasedAt === undefined) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: "deceased heir must have deceasedAt", path: ["deceasedAt"] });
          }
        }),
```

> 即 `heirs: z.array( z.strictObject({...}).superRefine(...) )`。

- [ ] **Step 5: 出生 apply 置 alive（funnel.ts）**

在 `src/engine/effects/funnel.ts` 的 `birth` 分支 `bl.heirs.push({ ... })` 对象里、`faction: "none",` 之后加一行：

```ts
            lifecycle: "alive",
```

- [ ] **Step 6: 运行测试 + 全量回归**

Run: `npx vitest run tests/state/heirLifecycle.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿（若有断言 heir 完整形状的旧测试因新必填 `lifecycle` 失败，就地补 `lifecycle: "alive"`）。

- [ ] **Step 7: 提交**

```bash
git add src/engine/state/types.ts src/engine/save/stateSchema.ts src/engine/effects/funnel.ts tests/state/heirLifecycle.test.ts
git commit -m "feat: Heir.lifecycle + deceasedAt（出生置 alive，schema/持久化）"
```

---

### Task 2: `heir_died` 效果（生死转移，append-only 标记）

**Files:**
- Modify: `src/engine/content/schemas.ts`（`eventEffectSchema` union 加 `heir_died`）
- Modify: `src/engine/effects/funnel.ts`（`validateEffects` + `applyEffects` 处理 `heir_died`）
- Test: `tests/effects/heirDied.test.ts`（新建）

**Interfaces:**
- Consumes（Task 1）：`Heir.lifecycle`/`deceasedAt`。
- Produces: `EventEffect` 新成员 `{ type: "heir_died"; heirId: string }`；apply 后该 heir `lifecycle:"deceased"` + `deceasedAt = now`，数组不删元素。

- [ ] **Step 1: 写失败测试**

新建 `tests/effects/heirDied.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { EventEffect } from "../../src/engine/content/schemas";

function stateWithOneHeir() {
  const db = loadRealContent();
  let state = createNewGameState(db);
  for (const e of [{ type: "pregnancy", op: "begin" }, { type: "pregnancy", op: "carry" }] as EventEffect[]) {
    state = (applyEffects(db, state, [e]) as { value: typeof state }).value;
  }
  state = (applyEffects(db, state, [{ type: "birth", bearer: "sovereign", fatherId: null, sex: "daughter", legitimate: true, favor: 50, bearerOutcome: "safe" }]) as { value: typeof state }).value;
  return { db, state, heirId: state.resources.bloodline.heirs[0]!.id };
}

describe("heir_died 效果", () => {
  it("标记 deceased + deceasedAt，不删数组，通过 schema 不变量", () => {
    const { db, state, heirId } = stateWithOneHeir();
    const r = applyEffects(db, state, [{ type: "heir_died", heirId }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const heir = r.value.resources.bloodline.heirs.find((h) => h.id === heirId)!;
    expect(heir.lifecycle).toBe("deceased");
    expect(heir.deceasedAt).toEqual(toGameTime(state.calendar));
    expect(r.value.resources.bloodline.heirs).toHaveLength(1); // 不删
    expect(gameStateSchema.safeParse(r.value).success).toBe(true); // deceased⇒有 deceasedAt 满足
  });

  it("未知皇嗣 / 已死皇嗣 → 拒绝（reject-all）", () => {
    const { db, state, heirId } = stateWithOneHeir();
    expect(applyEffects(db, state, [{ type: "heir_died", heirId: "heir_999999" }]).ok).toBe(false);
    const once = applyEffects(db, state, [{ type: "heir_died", heirId }]) as { value: typeof state };
    expect(applyEffects(db, once.value, [{ type: "heir_died", heirId }]).ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/effects/heirDied.test.ts`
Expected: FAIL（`heir_died` 不是合法 effect）。

- [ ] **Step 3: 加 effect schema（content/schemas.ts）**

在 `src/engine/content/schemas.ts` 的 `eventEffectSchema = z.union([ ... ])` 里、`child_favor` 那条之后加：

```ts
  z.strictObject({ type: z.literal("heir_died"), heirId: nonEmpty }),
```

- [ ] **Step 4: 加校验（funnel.ts `validateEffects`）**

在 `validateEffects` 的 `switch (e.type)` 里、`child_favor` case 之后加：

```ts
      case "heir_died": {
        const heir = state.resources.bloodline.heirs.find((h) => h.id === e.heirId);
        if (!heir) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        } else if (heir.lifecycle === "deceased") {
          bad(index, "BAD_EFFECT", `heir "${e.heirId}" already deceased`, { heir: e.heirId });
        }
        break;
      }
```

- [ ] **Step 5: 加 apply（funnel.ts `applyEffects`）**

在 `applyEffects` 的 `switch (effect.type)` 里、`child_favor` case 之后加：

```ts
      case "heir_died": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        heir.lifecycle = "deceased";
        heir.deceasedAt = now;
        break;
      }
```

> `now`（`toGameTime(state.calendar)`）已在 `applyEffects` 顶部定义。

- [ ] **Step 6: 运行测试 + 全量回归**

Run: `npx vitest run tests/effects/heirDied.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 7: 提交**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/heirDied.test.ts
git commit -m "feat: heir_died 效果（生死转移，append-only 标记 deceased+deceasedAt）"
```

---

### Task 3: 皇嗣感知化 `chronicle/presence.ts`（入场/在场统一判断）

**Files:**
- Create: `src/engine/chronicle/presence.ts`
- Modify: `src/engine/chronicle/awareness.ts`（`canKnowEvent` 改用 presence 助手，皇嗣不再被当未知角色）
- Modify: `src/engine/chronicle/belief.ts`（删本地 `isCurrentlyPresent`，改从 presence.ts 引入）
- Test: `tests/chronicle/presence.test.ts`（新建）

**Interfaces:**
- Consumes（Task 1）：`Heir.lifecycle`/`birthAt`；既有 `CharacterStanding.lifecycle`/`palaceEnteredAt`、`compareGameTime`/`toGameTime`。
- Produces（三者语义严格区分）：
  - `characterExists(state, charId): boolean` — 在状态中**可寻址**（有 standing，或 id 在 `bloodline.heirs` 内）。**死者仍存在**（薨逝侍君、夭折皇嗣都 true）。
  - `characterEntryTime(state, charId): GameTime | undefined` — 侍君取 `palaceEnteredAt`；皇嗣取 `birthAt`（任何 lifecycle）；否则 undefined。
  - `isDeceased(state, charId): boolean` — 侍君 `standing.lifecycle==="deceased"` 或皇嗣 `lifecycle==="deceased"`。
  - `isCurrentlyPresent(state, charId): boolean` — **可作为当前对话参与者**：存在 ∧ 未逝 ∧ 入场时刻 ≤ now（无入场时刻的官员视作素来在场）。死者为 false。
- 说明：`belief.ts` 原有 `isCurrentlyPresent` 移到此处并扩展皇嗣；`canKnowEvent` 的 `!standing` 早退改为 `!isCurrentlyPresent`（死者/未来/未知都不知情）。**「死者不存在」与「死者当前不在场」必须用不同函数**——`alive` 谓词依赖 `characterExists`（死者可被查到 alive:false），其余谓词依赖 `isCurrentlyPresent`。

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/presence.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { characterExists, isCurrentlyPresent, isDeceased, characterEntryTime } from "../../src/engine/chronicle/presence";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { Heir } from "../../src/engine/state/types";

function heir(over: Partial<Heir>): Heir {
  return {
    id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 2, "early"), favor: 50, legitimate: true, petName: "",
    education: { scholarship: 5, martial: 5, virtue: 5 },
    health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20,
    faction: "none", lifecycle: "alive", ...over,
  };
}

describe("presence（皇嗣感知化）", () => {
  it("在世皇嗣：存在、入场=birthAt、出生后在场、未逝", () => {
    const s = createInitialState({ calendar: { month: 8 } }); // now=元年八月
    s.resources.bloodline.heirs.push(heir({}));
    expect(characterExists(s, "heir_000001")).toBe(true);
    expect(characterEntryTime(s, "heir_000001")).toEqual(makeGameTime(1, 2, "early"));
    expect(isCurrentlyPresent(s, "heir_000001")).toBe(true);
    expect(isDeceased(s, "heir_000001")).toBe(false);
  });

  it("夭折皇嗣：仍【存在】（可寻址），但【不在场】且 isDeceased", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.resources.bloodline.heirs.push(heir({ lifecycle: "deceased", deceasedAt: makeGameTime(1, 5, "mid") }));
    expect(characterExists(s, "heir_000001")).toBe(true);   // 死者仍存在
    expect(isDeceased(s, "heir_000001")).toBe(true);
    expect(isCurrentlyPresent(s, "heir_000001")).toBe(false); // 不在场
  });

  it("薨逝侍君：存在、不在场、isDeceased", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.standing["b"] = { rank: "meiren", favor: 50, lifecycle: "deceased", palaceEnteredAt: makeGameTime(1, 1, "early") };
    expect(characterExists(s, "b")).toBe(true);
    expect(isCurrentlyPresent(s, "b")).toBe(false);
    expect(isDeceased(s, "b")).toBe(true);
  });

  it("尚未出生的未来皇嗣：存在但不在场", () => {
    const s = createInitialState(); // now=元年一月
    s.resources.bloodline.heirs.push(heir({ birthAt: makeGameTime(2, 1, "early") }));
    expect(isCurrentlyPresent(s, "heir_000001")).toBe(false);
  });

  it("侍君：仍按 palaceEnteredAt", () => {
    const s = createInitialState({ calendar: { month: 8 } });
    s.standing["c"] = { rank: "meiren", favor: 50, palaceEnteredAt: makeGameTime(1, 1, "early") };
    expect(isCurrentlyPresent(s, "c")).toBe(true);
    expect(characterExists(s, "c")).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/presence.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 presence.ts**

新建 `src/engine/chronicle/presence.ts`：

```ts
/**
 * 角色「存在 / 在场 / 生死」三态严格区分（皇嗣感知化）。
 * - characterExists：可寻址（死者仍存在），供 alive 谓词等需查询死者者。
 * - isCurrentlyPresent：可作当前对话参与者（死者/未来/未知为 false）。
 * 供 canKnowEvent / belief 可见性共用，让皇嗣不再被当未知角色。
 */
import { compareGameTime, toGameTime } from "../calendar/time";
import type { GameTime } from "../calendar/time";
import type { GameState } from "../state/types";

function heirOf(state: GameState, charId: string) {
  return state.resources.bloodline.heirs.find((h) => h.id === charId); // 任何 lifecycle
}

/** 在状态中可寻址：有 standing，或 id 在 bloodline.heirs 内。死者仍存在 → true。 */
export function characterExists(state: GameState, charId: string): boolean {
  return state.standing[charId] !== undefined || heirOf(state, charId) !== undefined;
}

/** 生死：薨逝侍君 / 夭折皇嗣 → true。 */
export function isDeceased(state: GameState, charId: string): boolean {
  const st = state.standing[charId];
  if (st) return st.lifecycle === "deceased";
  return heirOf(state, charId)?.lifecycle === "deceased";
}

/** 侍君=palaceEnteredAt；皇嗣=birthAt（任何 lifecycle）；否则 undefined（官员无入场时刻）。 */
export function characterEntryTime(state: GameState, charId: string): GameTime | undefined {
  const st = state.standing[charId];
  if (st) return st.palaceEnteredAt;
  return heirOf(state, charId)?.birthAt;
}

/** 可作当前对话参与者：存在 ∧ 未逝 ∧ 入场时刻 ≤ now。 */
export function isCurrentlyPresent(state: GameState, charId: string): boolean {
  if (!characterExists(state, charId) || isDeceased(state, charId)) return false;
  const entry = characterEntryTime(state, charId);
  if (entry && compareGameTime(entry, toGameTime(state.calendar)) > 0) return false;
  return true;
}
```

- [ ] **Step 4: `canKnowEvent` 改用 presence（awareness.ts）**

在 `src/engine/chronicle/awareness.ts`：import 改为 `import { isCurrentlyPresent, characterEntryTime } from "./presence";`，把函数体改为（皇嗣作为在世 viewer 也能知情；死者/未来不知情）：

```ts
export function canKnowEvent(state: GameState, charId: string, event: CourtEvent): boolean {
  // 闸1：不存在 / 已逝 / 尚未入场 → 一律不知情（isCurrentlyPresent 三者皆拦）
  if (!isCurrentlyPresent(state, charId)) return false;
  const now = toGameTime(state.calendar);
  // 闸2：编年史只载已发生；未来事件谁都不知道
  if (compareGameTime(event.occurredAt, now) > 0) return false;

  const p = event.publicity;
  if (p.scope === "circle") return p.circleIds.includes(charId);
  if (p.scope === "realm") return true;
  // palace：须有入场时刻（官员无 → 宫内事不在可知范围）
  const entry = characterEntryTime(state, charId);
  if (!entry) return false;
  return p.persistence === "institutional" || compareGameTime(entry, event.occurredAt) <= 0;
}
```

> 行为对既有侍君不变（在世侍君 `isCurrentlyPresent` 为真、`entry` = `palaceEnteredAt`）；新增在世皇嗣 viewer 支持；薨逝/夭折/未来角色一律不知情。`compareGameTime`/`toGameTime` 仍需 import（既有）。

- [ ] **Step 5: `belief.ts` 复用 presence 的 isCurrentlyPresent**

在 `src/engine/chronicle/belief.ts`：删除本地 `isCurrentlyPresent` 定义，改为 `import { isCurrentlyPresent } from "./presence";`。`courtMemberVisibility` 不变（仍调用 `isCurrentlyPresent`）。

- [ ] **Step 6: 运行测试 + 回归（awareness/belief 测试须仍绿）**

Run: `npx vitest run tests/chronicle/presence.test.ts tests/chronicle/awareness.test.ts tests/chronicle/belief.test.ts`
Expected: PASS（既有 awareness/belief 用例对侍君行为不变）。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 7: 提交**

```bash
git add src/engine/chronicle/presence.ts src/engine/chronicle/awareness.ts src/engine/chronicle/belief.ts tests/chronicle/presence.test.ts
git commit -m "feat: chronicle/presence 皇嗣感知化（canKnowEvent/belief 统一入场判断）"
```

---

### Task 4: 恢复 `alive` 谓词 + predicate-aware 可见性（belief，覆盖侍君 + 皇嗣）

**Files:**
- Modify: `src/engine/chronicle/belief.ts`（`FactPredicate` 加 `alive`；`courtMemberVisibility` 改 predicate-aware；`getFact` 实现）
- Test: `tests/chronicle/beliefAlive.test.ts`（新建）

**Interfaces:**
- Consumes（Task 1/3）：`Heir.lifecycle`、`standing.lifecycle`、`isCurrentlyPresent`、`characterExists`。
- Produces:
  - `FactPredicate` 增 `"alive"`；`BelievedFact.value: string | boolean`。
  - `alive` 谓词对**任何 characterExists 的 subject**（含死者）返回 `{ value: boolean, certainty: 100 }`（在世 true / 薨逝或夭折 **false，不是 undefined**）。
  - `resides_at`/`holds_rank` 仍要求 subject `isCurrentlyPresent`（死者 → undefined）。
- **核心**：可见性按谓词分流——「死者不存在」与「死者不在场」是不同问题：`alive` 能查死者（得 false），现状类谓词查不到死者（undefined）。

- [ ] **Step 1: 写失败测试**

新建 `tests/chronicle/beliefAlive.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { GroundTruthBeliefProjection } from "../../src/engine/chronicle/belief";
import { createInitialState } from "../../src/engine/state/initialState";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { Heir } from "../../src/engine/state/types";

function heir(over: Partial<Heir>): Heir {
  return {
    id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"), favor: 50, legitimate: true, petName: "",
    education: { scholarship: 5, martial: 5, virtue: 5 },
    health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 50, support: 20,
    faction: "none", lifecycle: "alive", ...over,
  };
}

describe("alive 谓词（belief）", () => {
  it("侍君：在世 true，薨逝(deceased) → false（非 undefined）", () => {
    const s = createInitialState();
    s.standing["viewer"] = { rank: "meiren", favor: 50 };
    s.standing["a"] = { rank: "meiren", favor: 50 };
    s.standing["b"] = { rank: "meiren", favor: 50, lifecycle: "deceased" };
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("viewer", { predicate: "alive", subjectId: "a" })).toEqual({ value: true, certainty: 100 });
    expect(bp.getFact("viewer", { predicate: "alive", subjectId: "b" })).toEqual({ value: false, certainty: 100 });
  });

  it("皇嗣：在世 alive=true；夭折 alive=false（可查死者，非 undefined）", () => {
    const s = createInitialState();
    s.standing["viewer"] = { rank: "meiren", favor: 50 };
    s.resources.bloodline.heirs.push(heir({}));                                   // 在世
    s.resources.bloodline.heirs.push(heir({ id: "heir_000002", lifecycle: "deceased", deceasedAt: makeGameTime(1, 5, "mid") }));
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("viewer", { predicate: "alive", subjectId: "heir_000001" })).toEqual({ value: true, certainty: 100 });
    expect(bp.getFact("viewer", { predicate: "alive", subjectId: "heir_000002" })).toEqual({ value: false, certainty: 100 });
  });

  it("现状类谓词（resides_at）查死者 → undefined（死者不在场）", () => {
    const s = createInitialState();
    s.standing["viewer"] = { rank: "meiren", favor: 50 };
    s.standing["b"] = { rank: "meiren", favor: 50, residence: "x", lifecycle: "deceased" };
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("viewer", { predicate: "resides_at", subjectId: "b" })).toBeUndefined();
  });

  it("已逝 viewer 查 alive → undefined（viewer 须在场）", () => {
    const s = createInitialState();
    s.standing["deadViewer"] = { rank: "meiren", favor: 50, lifecycle: "deceased" };
    s.standing["a"] = { rank: "meiren", favor: 50 };
    const bp = new GroundTruthBeliefProjection(s);
    expect(bp.getFact("deadViewer", { predicate: "alive", subjectId: "a" })).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/chronicle/beliefAlive.test.ts`
Expected: FAIL（`alive` 非法 / 死者 subject 被 canSee 拦为 undefined）。

- [ ] **Step 3: 实现（belief.ts）**

在 `src/engine/chronicle/belief.ts`：
1. import 增 `characterExists`：`import { isCurrentlyPresent, characterExists } from "./presence";`。
2. `FactPredicate` 改为 `"resides_at" | "holds_rank" | "alive"`；`BelievedFact.value` 放宽为 `string | boolean`。
3. `courtMemberVisibility` 改为 **predicate-aware**：

```ts
export const courtMemberVisibility: CurrentFactVisibility = {
  canSee(state, viewerId, key) {
    if (!isCurrentlyPresent(state, viewerId)) return false; // viewer 须在场
    // alive 可查死者（死者仍存在）；现状类谓词只查在场者
    return key.predicate === "alive"
      ? characterExists(state, key.subjectId)
      : isCurrentlyPresent(state, key.subjectId);
  },
};
```

4. `getFact` 的 `switch` 增 `alive`（放在 `holds_rank` 后）：

```ts
      case "alive": {
        const st = this.state.standing[key.subjectId];
        if (st) return { value: st.lifecycle !== "deceased", certainty: 100 };
        const heir = this.state.resources.bloodline.heirs.find((h) => h.id === key.subjectId);
        return heir ? { value: heir.lifecycle !== "deceased", certainty: 100 } : undefined;
      }
```

> 这样 `alive(死者)` = false（gate 可校验「七皇子仍然活着」这类错误断言）；`resides_at/holds_rank(死者)` = undefined（死者无当前住处/位分可言）。

- [ ] **Step 4: 运行测试 + 回归**

Run: `npx vitest run tests/chronicle/beliefAlive.test.ts tests/chronicle/belief.test.ts`
Expected: PASS（PR1 belief 用例对在世侍君行为不变）。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add src/engine/chronicle/belief.ts tests/chronicle/beliefAlive.test.ts
git commit -m "feat: alive 谓词 + predicate-aware 可见性（死者可查 alive=false，现状谓词不可见）"
```

---

## Self-Review

**Spec coverage（PR2a = spec PR2 硬前置）:** `Heir.lifecycle`/`deceasedAt`→T1；`heir_died` 转移→T2；`canKnowEvent`/`isCurrentlyPresent` 扩展到皇嗣→T3；`alive` 谓词恢复→T4。解决「chronicle/私人记忆说皇嗣已夭折但 `bloodline.heirs` 仍当活人」的状态分裂。

**Placeholder scan:** 无 TBD/TODO；每步含完整代码与命令/预期。

**Type consistency:** `HeirLifecycle`/`lifecycle`/`deceasedAt`（T1）→ T2 apply、T3 presence、T4 alive 一致引用；`characterEntryTime`/`characterExists`/`isCurrentlyPresent`（T3）→ T4 经可见性间接依赖；`heir_died` effect 形状（T2）一致。

**已知实现期决策:**
1. T2：`heir_died` 是引擎 `EventEffect`（状态转移），与 PR1 的 `CourtEventType "heir_died"`（编年史事实）是两回事——PR2c 的 `heir_died` 规则会同时 fire 二者。
2. T3：三态严格区分——`characterExists`（可寻址，死者仍 true）/ `isDeceased` / `isCurrentlyPresent`（当前可参与，死者 false）。`canKnowEvent` 用 `isCurrentlyPresent`（死者/未来/未知一律不知情）；官员（有 standing、无 entry）仍在场但宫内事 `!entry → false`，行为不变。
3. T4：可见性 **predicate-aware**——`alive` 用 `characterExists`（死者可被查到 `alive:false`，故 gate 能校验「七皇子仍活着」这类错误断言）；`resides_at/holds_rank` 用 `isCurrentlyPresent`（死者无当前住处/位分 → undefined）。「死者不存在」与「死者不在场」**不再共用同一函数**。

## 后续

PR2b（`MemoryEntry` 破坏式演进）与 PR2c（`EventMemoryRule`/`commitCourtEvent`/四规则）见同目录 `...-pr2b-memory-evolution.md`、`...-pr2c-event-memory-rules.md`。PR2c 的 `heir_died` 规则依赖本 PR 的 `heir_died` 效果与 `alive` 谓词。

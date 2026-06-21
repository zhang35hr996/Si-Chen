# 记忆/对话系统 PR2b：MemoryEntry 破坏式演进 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `MemoryEntry` 从 v0 形状（salience/protected/tags/participants/source）破坏式演进到「活人感」形状（ownerId/strength/retention/triggerTags/subjectIds/perspective/emotions/unresolved/sourceEventId），并一次性迁移全部消费者与草稿 schema。

**Architecture:** 这是一次**原子重塑**——字段重命名（salience→strength、protected→retention、tags→triggerTags、participants→subjectIds）+ `memoryKindSchema` 改 7 值，跨 type/state-schema/content-草稿/funnel/newGame/inspect/conditions/UI 必须**同批落地**：effect 写入要先过 `effectMemoryDraftSchema` 校验，故草稿/kind schema 与运行路径不可分步。利好：8 个授定角色的 `initialMemories` **全为空数组**，无授定数据需重写。`MemoryRetention` 已在 PR1 存在，复用。Task 1 做整体重塑，Task 2 补草稿 schema 的边界用例测试（schema 已在 Task 1 落地，Task 2 仅加覆盖）。

**Tech Stack:** TypeScript, React, Zod, Vitest。

## Global Constraints

- 预发布不做旧档迁移（见 [[no-save-backcompat]]）；破坏式改 shape，**不保留** v0 字段别名。
- 私人记忆 **append-only**：无 `invalidatedAt`/`supersededBy`；`retention:"permanent"` 取代旧 `protected`（不随时间衰减）。**取消** v0「effect 记忆永不 protected」约束——`heir_died` 等创伤须能经效果写 `retention:"permanent"`。
- 不引入死属性：strength/retention/triggerTags/summary/kind 在本 PR 即有读者；emotions/perspective/subjectIds/sourceEventId/unresolved 落位供 PR2c/PR4（spec 已声明消费者）。
- `strength` 0–100 截断；时间戳 `GameTime`。effect 仍只经 `applyEffects` 漏斗。
- 测试 Vitest（`npx vitest run <path>`）；基线 PR2a 已并入。

## 迁移地图（Task 1 同批迁移）

| 文件 | v0 用法 | 迁移 |
|---|---|---|
| `state/types.ts` | `MemoryEntry`+`MemoryKind` | 重写新形状 + 新增 `MemoryPerspective`/`MemoryEmotion` |
| `content/schemas.ts` | `memoryKindSchema`(旧7) + 草稿 | 新7值 + 草稿重写（kind/summary/subjectIds/perspective/strength/retention/triggerTags/unresolved/emotions/sourceEventId?） |
| `save/stateSchema.ts` | `memoryEntrySchema` | 重写新形状 |
| `effects/funnel.ts` | memory apply 写旧字段 | 写新字段（ownerId=effect.char） |
| `state/newGame.ts` | 种子写旧字段 | 写新字段（ownerId=char.id；授定空数组实际不产元素） |
| `memory/inspect.ts` | `source`/`protected`/`createdAt` | source→`sourceEventId` 标签；protected→`retention==="permanent"` |
| `events/conditions.ts` | `entry.tags` | `entry.triggerTags` |
| `ui/debug/DebugPanel.tsx` | `salience`/`protected` + 造假记忆 | `strength`/`retention` + 补全新必填 |
| `ui/components/CharacterProfileDrawer.tsx` | 排序 `m.salience` | `m.strength` |

---

### Task 1: 原子重塑 `MemoryEntry` + 草稿/kind schema + 全消费者迁移

**Files:**
- Modify: `src/engine/state/types.ts`、`src/engine/content/schemas.ts`、`src/engine/save/stateSchema.ts`、`src/engine/effects/funnel.ts`、`src/engine/state/newGame.ts`、`src/engine/memory/inspect.ts`、`src/engine/events/conditions.ts`、`src/ui/debug/DebugPanel.tsx`、`src/ui/components/CharacterProfileDrawer.tsx`
- Test: `tests/state/memoryEntryShape.test.ts`（新建）；就地修正 `tests/effects/funnel.test.ts`、`tests/state/newGame.test.ts` 中触及 memory 形状处

**Interfaces:**
- Consumes（PR1）：`MemoryRetention = "fast"|"slow"|"permanent"`（已存在 types.ts）。
- Produces（新 `MemoryEntry`，PR2c/PR4 依赖）：见 Step 3 的类型定义。

- [ ] **Step 1: 写失败测试（端到端新形状）**

新建 `tests/state/memoryEntryShape.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import { listMemories } from "../../src/engine/memory/inspect";
import { loadRealContent } from "../helpers/contentFixture";

describe("MemoryEntry 新形状（端到端）", () => {
  it("memory 效果写出新形状条目，含 ownerId/strength/retention/triggerTags，通过 schema", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const charId = Object.keys(state.memories)[0]!;
    const r = applyEffects(db, state, [{
      type: "memory", char: charId,
      entry: {
        kind: "impression", summary: "侍身记下了一桩小事。", strength: 40, retention: "fast",
        subjectIds: ["player"], perspective: "witness", triggerTags: ["daily"], unresolved: false,
        emotions: { joy: 20 },
      },
    }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const m = listMemories(r.value, charId).at(-1)!;
    expect(m.ownerId).toBe(charId);
    expect(m.strength).toBe(40);
    expect(m.retention).toBe("fast");
    expect(m.triggerTags).toEqual(["daily"]);
    expect(m.subjectIds).toEqual(["player"]);
    expect(gameStateSchema.safeParse(r.value).success).toBe(true);
    expect((m as unknown as { salience?: number }).salience).toBeUndefined();
    expect((m as unknown as { protected?: boolean }).protected).toBeUndefined();
  });

  it("effect 可写 permanent 创伤（取消 v0 protected 禁令）", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const charId = Object.keys(state.memories)[0]!;
    const r = applyEffects(db, state, [{
      type: "memory", char: charId,
      entry: { kind: "trauma", summary: "怀中夭折。", strength: 100, retention: "permanent",
        subjectIds: ["heir_000007"], perspective: "parent", triggerTags: ["anniversary"], unresolved: true,
        emotions: { grief: 95, guilt: 90 } },
    }]);
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/state/memoryEntryShape.test.ts`
Expected: FAIL（草稿 schema 拒绝新字段 / 写出仍旧形状）。

- [ ] **Step 3: 重写类型（types.ts）**

把 `src/engine/state/types.ts` 的 `MemoryKind` 与 `MemoryEntry` 替换为：

```ts
export type MemoryKind =
  | "episodic" | "trauma" | "grievance" | "gratitude" | "promise" | "secret" | "impression";
export type MemoryPerspective =
  | "actor" | "target" | "witness" | "parent" | "ally" | "enemy" | "relative";
export type MemoryEmotion =
  | "joy" | "grief" | "fear" | "anger" | "envy" | "shame" | "guilt" | "relief";

export interface MemoryEntry {
  id: string;
  ownerId: string;
  kind: MemoryKind;
  /** 关联 chronicle CourtEvent（可空）。 */
  sourceEventId?: string;
  /** 涉及的当事人（取代 participants）。 */
  subjectIds: string[];
  perspective: MemoryPerspective;
  /** ≤240，POV。 */
  summary: string;
  /** 0–100，记忆牢固度（取代 salience）。 */
  strength: number;
  /** permanent 取代 protected。 */
  retention: MemoryRetention;
  emotions: Partial<Record<MemoryEmotion, number>>;
  /** 取代 tags（≤5）。 */
  triggerTags: string[];
  unresolved: boolean;
  createdAt: GameTime;
}
```

`CharacterMemoryStore` 不变。删除 v0 字段（source/protected/originSceneId/salience/tags/participants/locationId）。

- [ ] **Step 4: 重写草稿 + kind schema（content/schemas.ts）**

把 `memoryKindSchema` 与三个草稿 schema 替换为：

```ts
export const memoryKindSchema = z.enum([
  "episodic", "trauma", "grievance", "gratitude", "promise", "secret", "impression",
]);
const memoryEmotionSchema = z.enum(["joy","grief","fear","anger","envy","shame","guilt","relief"]);
const memoryPerspectiveSchema = z.enum(["actor","target","witness","parent","ally","enemy","relative"]);

const memoryDraftBase = z.strictObject({
  kind: memoryKindSchema,
  summary: z.string().min(1).max(240),
  subjectIds: z.array(participantSchema).min(1),
  perspective: memoryPerspectiveSchema,
  strength: percent,
  triggerTags: z.array(tagSchema).max(5),
  unresolved: z.boolean().default(false),
  emotions: z.record(memoryEmotionSchema, z.number()).default({}),
  sourceEventId: z.string().regex(/^evt_\d{6}$/).optional(), // 格式 evt_NNNNNN（content 层不能 import 上层 courtEventIdSchema，内联同正则）
});

export const initialMemoryDraftSchema = memoryDraftBase.extend({
  retention: z.enum(["fast", "slow", "permanent"]).default("slow"),
});
export const effectMemoryDraftSchema = memoryDraftBase.extend({
  retention: z.enum(["fast", "slow", "permanent"]),
});
```

> `participantSchema`/`tagSchema`/`percent` 已在文件内定义。`InitialMemoryDraft`/`EffectMemoryDraft` 的 `z.infer` 导出随之更新。

- [ ] **Step 5: 重写 memoryEntrySchema（stateSchema.ts）**

把 `memoryEntrySchema` 替换为（`memoryKindSchema` 经 import 已是新 7 值）：

```ts
const memoryEntrySchema = z.strictObject({
  id: z.string().min(1),
  ownerId: idSchema,
  kind: memoryKindSchema,
  sourceEventId: courtEventIdSchema.optional(), // PR1 已在本文件定义并导出

  subjectIds: z.array(z.string()).min(1),
  perspective: z.enum(["actor","target","witness","parent","ally","enemy","relative"]),
  summary: z.string().min(1).max(240),
  strength: percent,
  retention: z.enum(["fast", "slow", "permanent"]),
  emotions: z.record(z.enum(["joy","grief","fear","anger","envy","shame","guilt","relief"]), z.number()),
  triggerTags: z.array(z.string()).max(5),
  unresolved: z.boolean(),
  createdAt: gameTimeSchema,
});
```

- [ ] **Step 6: 重写 funnel memory apply（funnel.ts）**

把 `case "memory"` 块替换为（`ownerId = effect.char`）：

```ts
      case "memory": {
        const store = next.memories[effect.char]!;
        const d = effect.entry;
        store.entries.push({
          id: memoryEntryId(effect.char, store.nextSeq),
          ownerId: effect.char,
          kind: d.kind,
          ...(d.sourceEventId !== undefined ? { sourceEventId: d.sourceEventId } : {}),
          subjectIds: [...d.subjectIds],
          perspective: d.perspective,
          summary: d.summary,
          strength: d.strength,
          retention: d.retention,
          emotions: { ...d.emotions },
          triggerTags: [...d.triggerTags],
          unresolved: d.unresolved,
          createdAt: now,
        });
        store.nextSeq += 1;
        break;
      }
```

- [ ] **Step 7: 重写 newGame 种子（newGame.ts）**

把 `entries: character.initialMemories.map(...)` 替换为新形状（`ownerId: character.id`）：

```ts
      entries: character.initialMemories.map((draft, index) => ({
        id: memoryEntryId(character.id, index + 1),
        ownerId: character.id,
        kind: draft.kind,
        ...(draft.sourceEventId !== undefined ? { sourceEventId: draft.sourceEventId } : {}),
        subjectIds: [...draft.subjectIds],
        perspective: draft.perspective,
        summary: draft.summary,
        strength: draft.strength,
        retention: draft.retention,
        emotions: { ...draft.emotions },
        triggerTags: [...draft.triggerTags],
        unresolved: draft.unresolved,
        createdAt: startTime,
      })),
```

- [ ] **Step 8: 迁移 inspect.ts**

`src/engine/memory/inspect.ts`：
- `memoryOverview`：`protectedCount` 改名 `permanentCount`，统计 `e.retention === "permanent"`。
- `memoryOriginLabel`：

```ts
export function memoryOriginLabel(entry: MemoryEntry): string {
  return entry.sourceEventId ? `事件 ${entry.sourceEventId}` : "授定/直写";
}
```

`memoryAgeDays`/`listMemories` 不变。

- [ ] **Step 9: 迁移 conditions.ts + UI**

- `src/engine/events/conditions.ts` `hasMemoryTag`：`entry.tags.includes(tag)` → `entry.triggerTags.includes(tag)`。
- `src/ui/debug/DebugPanel.tsx`：`显著 {entry.salience}` → `强度 {entry.strength}`；`entry.protected ? " · 🔒"` → `entry.retention === "permanent" ? " · 🔒"`；造假记忆对象（原 `salience:10`）补全为新必填：`{ id:"mem_x_000001", ownerId:"x", kind:"impression", subjectIds:["player"], perspective:"witness", summary:"…", strength:10, retention:"fast", emotions:{}, triggerTags:[], unresolved:false, createdAt: now }`（沿用该处上下文的 `now`）。
- `src/ui/components/CharacterProfileDrawer.tsx`：`.sort((a, b) => b.salience - a.salience)` → `.sort((a, b) => b.strength - a.strength)`。

- [ ] **Step 10: 改既有受影响测试 + 全量回归 + 类型检查**

Run: `npx vitest run tests/effects/funnel.test.ts tests/state/newGame.test.ts`
就地把构造/断言 memory v0 形状处改为新字段，至绿。
Run: `npx vitest run tests/state/memoryEntryShape.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿。
Run: `npx tsc --noEmit`（若项目用 tsc）
Expected: 无类型错误（v0 字段引用已全清）。

- [ ] **Step 11: 提交**

```bash
git add -A
git commit -m "refactor!: MemoryEntry 演进为活人感形状（strength/retention/triggerTags/subjectIds/perspective/emotions/unresolved/ownerId + kind 7 值），迁移全部消费者与草稿 schema"
```

---

### Task 2: 草稿 schema 边界用例（默认值 / 拒绝旧形状）

**Files:**
- Test: `tests/content/memoryDraft.test.ts`（新建）

**Interfaces:**
- Consumes（Task 1）：`initialMemoryDraftSchema`/`effectMemoryDraftSchema`（已实现）。
- Produces: 无新代码——仅锁定草稿 schema 的默认与拒绝行为（防回归）。

- [ ] **Step 1: 写测试**

新建 `tests/content/memoryDraft.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { effectMemoryDraftSchema, initialMemoryDraftSchema } from "../../src/engine/content/schemas";

const ok = {
  kind: "trauma", summary: "怀中夭折。", subjectIds: ["heir_000007"], perspective: "parent",
  strength: 100, retention: "permanent", triggerTags: ["anniversary"], unresolved: true,
  emotions: { grief: 95, guilt: 90 },
};

describe("memory draft schema 边界", () => {
  it("effect 接受 permanent 创伤", () => {
    expect(effectMemoryDraftSchema.safeParse(ok).success).toBe(true);
  });
  it("initial：retention 缺省 slow，emotions/unresolved 有默认", () => {
    const parsed = initialMemoryDraftSchema.parse({
      kind: "impression", summary: "旧事一桩。", subjectIds: ["player"], perspective: "witness", strength: 30, triggerTags: [],
    });
    expect(parsed.retention).toBe("slow");
    expect(parsed.unresolved).toBe(false);
    expect(parsed.emotions).toEqual({});
  });
  it("拒绝旧 kind / 缺 subjectIds", () => {
    expect(effectMemoryDraftSchema.safeParse({ ...ok, kind: "event" }).success).toBe(false);
    const { subjectIds, ...noSubj } = ok;
    expect(effectMemoryDraftSchema.safeParse(noSubj).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试（应直接通过——schema 已在 Task 1 落地）**

Run: `npx vitest run tests/content/memoryDraft.test.ts`
Expected: PASS。

> 这是覆盖加固任务：若任一断言失败，说明 Task 1 的草稿 schema 与意图不符——回到 Task 1 修正后再跑。

- [ ] **Step 3: 提交**

```bash
git add tests/content/memoryDraft.test.ts
git commit -m "test: 记忆草稿 schema 边界用例（默认值/拒绝旧形状）"
```

---

## Self-Review

**Spec coverage:** `MemoryEntry` 演进（strength/retention/emotions/perspective/triggerTags/unresolved/ownerId/sourceEventId，删 protected/salience，kind 7 值）→ Task 1；草稿默认与拒绝行为锁定 → Task 2。

**Placeholder scan:** 无 TBD；每步含完整代码/命令/预期。

**Type consistency:** `MemoryEntry`（T1 Step3）与 `memoryEntrySchema`（Step5）、草稿（Step4）、funnel/newGame 构造（Step6/7）逐字段一致；`memoryKindSchema` 7 值在 Step4 定义、stateSchema 经 import 复用；`retention`/`strength`/`triggerTags`/`subjectIds` 全程一致。

**已知实现期决策:**
1. 原子性：Task 1 单提交。重命名跨 9 文件无法分步保持绿；尤其 effect 写入要先过 `effectMemoryDraftSchema`，故草稿/kind schema 必须与运行路径同批（Step4 在 funnel Step6 之前）。Task 2 为纯覆盖任务（schema 已实现），故其测试应即绿。
2. 授定 `initialMemories` 全空，loader 不构造草稿，无授定数据受影响（Step10 全量回归即证）。
3. `sourceEventId`/`emotions`/`perspective`/`subjectIds`/`unresolved` 的下游消费者在 PR2c（规则派生）与 PR4（检索激活），spec 已声明，非死属性。

## 后续

PR2c（`EmotionalCondition` + `EventMemoryRule` 注册表 + `commitCourtEvent` + 四规则）见 `...-pr2c-event-memory-rules.md`，依赖本 PR 的新 `MemoryEntry` 与 effect 草稿（permanent 创伤）+ PR2a 的 `heir_died`/`alive`。

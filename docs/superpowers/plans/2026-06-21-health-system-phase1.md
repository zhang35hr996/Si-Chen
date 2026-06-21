# 健康系统 Phase 1（数据结构 / migration / UI）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为皇帝/太后/侍君/皇嗣引入可变数值健康 + 病情状态枚举的数据结构、确定性随机与年龄工具、统一健康结算/身后事 funnel 效果（仅落地不调用），并在面板分两个独立 chip 显示「健康状态」与「孕情」。**本阶段任何角色都不会掉血或死亡。**

**Architecture:** 纯逻辑优先（types → schemas → 初始化 → 随机/年龄 → funnel 效果 → resolveHealthChange → UI）。所有健康变更未来都经 `resolveHealthChange`（本阶段仅落地 + 单测，不接入 tick/事务）。状态枚举 `HealthStatus` 与数值 `health` 独立存储。

**Tech Stack:** TypeScript、Zod（content/save schema）、React、Vitest（`*.test.ts`）。确定性哈希 `fnv1a64Hex`（`src/engine/save/canonical.ts`）。

## Global Constraints

- 数值健康 0–100，`percent` schema（`z.number().int().min(0).max(100)`）。
- `HealthStatus = "healthy" | "sick" | "critical"`；与 `health` 数值**独立存储**，不由阈值派生。
- `DeathCause = "illness" | "critical_sudden" | "pregnancy" | "childbirth" | "scripted"`。
- 皇帝当前年龄 = `world.sovereign.startingAge + (year − 1)`；皇帝默认 `startingAge = 18`，**做成 world config，不硬编码**。
- 太后初始 `health = 70`；侍君初始 `health = attributes.health`（无则 100）；皇嗣沿用现有出生健康。
- 不复用 `gestationRoll`；用新建 `healthRoll`（独立命名空间，读档重算结果一致）。
- pre-release：**不迁移旧存档**，只更新 schema/init 引入新字段（见 [[no-save-backcompat]]）。
- `CharacterStanding`（`types.ts`）与 `characterStandingSchema`（`content/schemas.ts`，`satisfies z.ZodType<CharacterStanding>`）**必须同步**，否则编译报错。
- 本阶段 funnel 新效果与 `resolveHealthChange` **仅落地 + 单测，不被任何 tick/事务调用**。
- 测试命令：`npx vitest run <file>`；类型检查：`npx tsc --noEmit`。

---

### Task 1: `HealthStatus` / `DeathCause` 类型与 `isIll` 辅助

**Files:**
- Modify: `src/engine/state/types.ts`（在 `PregnancyStatus` 附近，约 line 58–60 之后）
- Create: `src/engine/characters/health.ts`
- Test: `src/engine/characters/health.test.ts`

**Interfaces:**
- Produces: `type HealthStatus = "healthy" | "sick" | "critical"`；`type DeathCause = "illness" | "critical_sudden" | "pregnancy" | "childbirth" | "scripted"`（导出于 `types.ts`）。`isIll(status: HealthStatus): boolean`（导出于 `characters/health.ts`）。

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/characters/health.test.ts
import { describe, expect, it } from "vitest";
import { isIll } from "./health";

describe("isIll", () => {
  it("healthy is not ill", () => {
    expect(isIll("healthy")).toBe(false);
  });
  it("sick and critical are ill", () => {
    expect(isIll("sick")).toBe(true);
    expect(isIll("critical")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/characters/health.test.ts`
Expected: FAIL（`isIll` / module not found）。

- [ ] **Step 3: Add types + helper**

In `src/engine/state/types.ts`, after `export type PregnancyStatus = ...;`:

```ts
/** 病情状态（与数值 health 独立存储）。 */
export type HealthStatus = "healthy" | "sick" | "critical";

/** 死因（写入 deathRecord / decease 效果）。 */
export type DeathCause =
  | "illness"
  | "critical_sudden"
  | "pregnancy"
  | "childbirth"
  | "scripted";
```

Create `src/engine/characters/health.ts`:

```ts
/** 健康状态小工具。病情状态与数值 health 独立。 */
import type { HealthStatus } from "../state/types";

/** sick / critical 皆视为「病中」，供旧布尔调用方（太后侍疾/敲打）使用。 */
export function isIll(status: HealthStatus): boolean {
  return status !== "healthy";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/characters/health.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/state/types.ts src/engine/characters/health.ts src/engine/characters/health.test.ts
git commit -m "feat: HealthStatus/DeathCause 类型与 isIll 辅助"
```

---

### Task 2: 确定性随机 `healthRoll`

**Files:**
- Create: `src/engine/characters/healthRoll.ts`
- Test: `src/engine/characters/healthRoll.test.ts`

**Interfaces:**
- Produces: `healthRoll(seedKey: string): number`（0–99）；`healthRollRange(seedKey: string, lo: number, hi: number): number`（含端点 `[lo,hi]`）。

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/characters/healthRoll.test.ts
import { describe, expect, it } from "vitest";
import { healthRoll, healthRollRange } from "./healthRoll";

describe("healthRoll", () => {
  it("is deterministic for the same seed", () => {
    expect(healthRoll("a:1")).toBe(healthRoll("a:1"));
  });
  it("is in [0,99]", () => {
    for (const k of ["a", "b", "c", "d", "e"]) {
      const v = healthRoll(k);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(99);
    }
  });
  it("differs across seeds (not all equal)", () => {
    const set = new Set(["a", "b", "c", "d", "e", "f"].map(healthRoll));
    expect(set.size).toBeGreaterThan(1);
  });
});

describe("healthRollRange", () => {
  it("stays within [lo,hi] inclusive", () => {
    for (const k of ["x", "y", "z", "w", "v"]) {
      const v = healthRollRange(k, 3, 8);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(8);
    }
  });
  it("is deterministic", () => {
    expect(healthRollRange("k", 1, 100)).toBe(healthRollRange("k", 1, 100));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/characters/healthRoll.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement**

```ts
// src/engine/characters/healthRoll.ts
/**
 * 健康系统专用确定性随机（独立于 gestationRoll 命名空间）。
 * fnv1a64Hex 取模，读档重算结果不变。seedKey 应含 rngSeed + 时间 + 角色 + 用途。
 */
import { fnv1a64Hex } from "../save/canonical";

/** 0–99。 */
export function healthRoll(seedKey: string): number {
  return parseInt(fnv1a64Hex(`health:${seedKey}`).slice(0, 12), 16) % 100;
}

/** 含端点 [lo, hi]（lo ≤ hi）。 */
export function healthRollRange(seedKey: string, lo: number, hi: number): number {
  const span = hi - lo + 1;
  return lo + (parseInt(fnv1a64Hex(`health:${seedKey}`).slice(0, 12), 16) % span);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/characters/healthRoll.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/healthRoll.ts src/engine/characters/healthRoll.test.ts
git commit -m "feat: healthRoll 确定性随机"
```

---

### Task 3: 年龄工具 `aging`

**Files:**
- Create: `src/engine/characters/aging.ts`
- Test: `src/engine/characters/aging.test.ts`

**Interfaces:**
- Produces:
  - `ageOver35(age: number): number` → `max(0, age − 35)`。
  - `presetAge(profileAge: number, year: number): number` → `profileAge + (year − 1)`（皇帝传 startingAge、太后/预置侍君传 profile.age）。
  - `heirAge(birthAt: { year: number }, now: { year: number }): number` → `now.year − birthAt.year`。
  - `dynamicConsortAge(ageAtEntry: number, enteredAtYear: number, year: number): number` → `ageAtEntry + (year − enteredAtYear)`。

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/characters/aging.test.ts
import { describe, expect, it } from "vitest";
import { ageOver35, presetAge, heirAge, dynamicConsortAge } from "./aging";

describe("aging", () => {
  it("ageOver35 floors at 0", () => {
    expect(ageOver35(20)).toBe(0);
    expect(ageOver35(35)).toBe(0);
    expect(ageOver35(52)).toBe(17);
  });
  it("presetAge advances with game year", () => {
    expect(presetAge(18, 1)).toBe(18); // 元年
    expect(presetAge(18, 3)).toBe(20);
    expect(presetAge(52, 5)).toBe(56);
  });
  it("heirAge uses birth year, not game start", () => {
    expect(heirAge({ year: 3 }, { year: 3 })).toBe(0);
    expect(heirAge({ year: 3 }, { year: 7 })).toBe(4);
  });
  it("dynamicConsortAge uses entry year", () => {
    expect(dynamicConsortAge(16, 4, 4)).toBe(16);
    expect(dynamicConsortAge(16, 4, 7)).toBe(19);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/characters/aging.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement**

```ts
// src/engine/characters/aging.ts
/**
 * 角色当前年龄算法（各类不同，禁止一律 profile.age + year - 1）：
 *   皇帝 = startingAge + (year-1)；太后/预置侍君 = profile.age + (year-1)；
 *   皇嗣 = 由出生年计算；动态入宫侍君 = ageAtEntry + (year - enteredAtYear)。
 */
export function ageOver35(age: number): number {
  return Math.max(0, age - 35);
}

export function presetAge(profileAge: number, year: number): number {
  return profileAge + (year - 1);
}

export function heirAge(birthAt: { year: number }, now: { year: number }): number {
  return now.year - birthAt.year;
}

export function dynamicConsortAge(
  ageAtEntry: number,
  enteredAtYear: number,
  year: number,
): number {
  return ageAtEntry + (year - enteredAtYear);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/characters/aging.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/aging.ts src/engine/characters/aging.test.ts
git commit -m "feat: 角色年龄工具 aging"
```

---

### Task 4: world config `sovereign.startingAge`

**Files:**
- Modify: `src/engine/content/schemas.ts:507-544`（`worldSchema`，在 `startingLocation` 之后加 `sovereign`）
- Modify: `content/world.json`（顶层加 `"sovereign": { "startingAge": 18 }`）
- Test: `src/engine/content/world-sovereign.test.ts`

**Interfaces:**
- Produces: `db.world.sovereign.startingAge: number`（≥0）。

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/content/world-sovereign.test.ts
import { describe, expect, it } from "vitest";
import { worldSchema } from "./schemas";
import rawWorld from "../../../content/world.json";

describe("world.sovereign.startingAge", () => {
  it("world.json parses with sovereign.startingAge", () => {
    const parsed = worldSchema.parse(rawWorld);
    expect(parsed.sovereign.startingAge).toBe(18);
  });
  it("rejects missing sovereign", () => {
    const { sovereign, ...rest } = worldSchema.parse(rawWorld) as Record<string, unknown> & {
      sovereign: unknown;
    };
    void sovereign;
    expect(worldSchema.safeParse(rest).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/content/world-sovereign.test.ts`
Expected: FAIL（`sovereign` 未在 schema / world.json）。

- [ ] **Step 3: Implement**

In `src/engine/content/schemas.ts`, inside `worldSchema = z.strictObject({ ... })`, right after `startingLocation: idSchema,` (line 517):

```ts
  sovereign: z.strictObject({
    startingAge: z.number().int().min(0),
  }),
```

In `content/world.json`, add a top-level key (e.g. right after `"startingLocation": ...,`):

```json
  "sovereign": { "startingAge": 18 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/engine/content/world-sovereign.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/content/schemas.ts content/world.json src/engine/content/world-sovereign.test.ts
git commit -m "feat: world config sovereign.startingAge"
```

---

### Task 5: 状态类型 — 健康/状态/身后事字段（types.ts）

**Files:**
- Modify: `src/engine/state/types.ts`（`SovereignState` 加 `healthStatus`；`CharacterStanding` 去 `ill` 加 health 字段；新增 `DeathRecord` / `PendingAftermath`；`TaihouState` 扩展；`Heir` 加 `healthStatus`/死亡标记；`GameState` 加 `pendingAftermath`）

**Interfaces:**
- Produces（供后续任务消费）：
  - `SovereignState.healthStatus: HealthStatus`
  - `CharacterStanding.health: number`、`.healthStatus: HealthStatus`、`.ageAtEntry?: number`、`.enteredAtYear?: number`、`.deathRecord?: DeathRecord`（去除 `.ill`）
  - `TaihouState.health: number`、`.healthStatus: HealthStatus`、`.deceased?: boolean`、`.diedAt?: GameTime`、`.posthumousName?: string`、`.mourningUntilDayExclusive?: number`
  - `Heir.healthStatus: HealthStatus`、`.deceased?: boolean`、`.diedAt?: GameTime`
  - `interface DeathRecord { diedAt: GameTime; cause: DeathCause; originalRankId: string; originalTitle?: string; posthumousRankId?: string; posthumousEpithet?: string }`
  - `interface PendingAftermath { id: string; kind: "taihou" | "consort" | "heir"; subjectId: string; at: GameTime; resolved: boolean }`
  - `GameState.pendingAftermath: PendingAftermath[]`

- [ ] **Step 1: Edit `SovereignState`**

In `interface SovereignState`, after `health: number;`:

```ts
  /** 病情状态（与 health 数值独立）。 */
  healthStatus: HealthStatus;
```

- [ ] **Step 2: Edit `CharacterStanding`** — 删除 `ill?: boolean;`，新增字段

Replace the `/** 凤体违和（病）。 */ ill?: boolean;` line with:

```ts
  /** 运行时数值健康 0–100（侍君；初始取 attributes.health）。 */
  health: number;
  /** 病情状态（健康/生病/重病）。 */
  healthStatus: HealthStatus;
  /** 动态入宫侍君的入宫年龄（选秀用）；预置侍君用 profile.age。 */
  ageAtEntry?: number;
  /** 动态入宫侍君的入宫年份。 */
  enteredAtYear?: number;
  /** 身后事记录（死后写入，绝不覆盖生前 rank/title）。 */
  deathRecord?: DeathRecord;
```

- [ ] **Step 3: Add `DeathRecord` + `PendingAftermath` + edit `TaihouState`/`Heir`/`GameState`**

Add near `TaihouState`:

```ts
export interface DeathRecord {
  diedAt: GameTime;
  cause: DeathCause;
  /** 生前位分/封号快照。 */
  originalRankId: string;
  originalTitle?: string;
  /** 追封位分/谥号（生前数据不动）。 */
  posthumousRankId?: string;
  posthumousEpithet?: string;
}

export interface PendingAftermath {
  /** 稳定 id：death:{kind}:{subjectId}:{deathDayIndex}（幂等去重）。 */
  id: string;
  kind: "taihou" | "consort" | "heir";
  subjectId: string;
  at: GameTime;
  resolved: boolean;
}
```

Replace `export interface TaihouState { /** 太后是否卧病。 */ ill: boolean; }` with:

```ts
export interface TaihouState {
  /** 运行时数值健康 0–100（初始 70）。 */
  health: number;
  /** 病情状态。 */
  healthStatus: HealthStatus;
  /** 是否已薨。 */
  deceased?: boolean;
  /** 薨逝时刻。 */
  diedAt?: GameTime;
  /** 谥号（1–2 字）。 */
  posthumousName?: string;
  /** 服丧截止 dayIndex（独占上界 = deathDayIndex + 3，含死亡当日）。 */
  mourningUntilDayExclusive?: number;
}
```

In `interface Heir`, after `health: number;` (around line 134) add:

```ts
  /** 病情状态。 */
  healthStatus: HealthStatus;
  /** 是否夭折。 */
  deceased?: boolean;
  /** 夭折时刻。 */
  diedAt?: GameTime;
```

In `GameState` (the authoritative state interface), add alongside the other arrays:

```ts
  /** 持久化身后事队列（皇帝不入队）。 */
  pendingAftermath: PendingAftermath[];
```

Ensure `HealthStatus` / `DeathCause` are in scope (defined in this file from Task 1).

- [ ] **Step 4: Verify type-check fails loudly where init/schema not yet updated**

Run: `npx tsc --noEmit`
Expected: errors in `initialState.ts` / `newGame.ts` / `stateSchema.ts` / `taihou.ts` (missing new required fields). These are fixed in Tasks 6–8. This step only confirms the type surface compiles where defined.

- [ ] **Step 5: Commit**

```bash
git add src/engine/state/types.ts
git commit -m "feat: 健康/病情/身后事状态类型（types）"
```

---

### Task 6: save schema + content standing schema 同步

**Files:**
- Modify: `src/engine/save/stateSchema.ts:64-159`（sovereign / heir / taihou / 新增 `pendingAftermath`）
- Modify: `src/engine/content/schemas.ts:39-52`（`characterStandingSchema`：去 `ill`，加新字段；新增 `deathRecordSchema`）
- Test: `src/engine/save/stateSchema-health.test.ts`

**Interfaces:**
- Consumes: Task 5 类型。
- Produces: 校验通过的新存档形状（含 health/status/deathRecord/pendingAftermath）。

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/save/stateSchema-health.test.ts
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../state/newGame";
import { gameStateSchema } from "./stateSchema";
import { loadContent } from "../content/loader";
import { viteContentSource } from "../content/viteSource";

describe("stateSchema health fields", () => {
  it("new game state parses with health/status/pendingAftermath", () => {
    const db = loadContent(viteContentSource());
    if (!db.ok) throw new Error("content load failed");
    const state = createNewGameState(db.value);
    const parsed = gameStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
    expect(state.resources.sovereign.healthStatus).toBe("healthy");
    expect(state.taihou.health).toBe(70);
    expect(Array.isArray(state.pendingAftermath)).toBe(true);
  });
});
```

> Note: confirm the content-load helper name (`loadContent` / `viteContentSource`) against an existing test in `src/engine/content/`; match whatever the repo's other state tests use.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/save/stateSchema-health.test.ts`
Expected: FAIL（schema 未含新字段 / newGame 未赋值）。

- [ ] **Step 3: Update `characterStandingSchema`** (`content/schemas.ts`)

Add above it:

```ts
export const deathRecordSchema = z.strictObject({
  diedAt: gameTimeShape,
  cause: z.enum(["illness", "critical_sudden", "pregnancy", "childbirth", "scripted"]),
  originalRankId: idSchema,
  originalTitle: nonEmpty.optional(),
  posthumousRankId: idSchema.optional(),
  posthumousEpithet: z.string().min(1).max(2).optional(),
});
```

In `characterStandingSchema`, remove `ill: z.boolean().optional(),` and add:

```ts
  health: percent,
  healthStatus: z.enum(["healthy", "sick", "critical"]),
  ageAtEntry: z.number().int().min(0).optional(),
  enteredAtYear: z.number().int().min(1).optional(),
  deathRecord: deathRecordSchema.optional(),
```

- [ ] **Step 4: Update `stateSchema.ts`**

In `resources.sovereign` strictObject, after `health: percent,`:

```ts
      healthStatus: z.enum(["healthy", "sick", "critical"]),
```

In the heir strictObject, after `health: percent,`:

```ts
          healthStatus: z.enum(["healthy", "sick", "critical"]),
          deceased: z.boolean().optional(),
          diedAt: gameTimeSchema.optional(),
```

Replace `taihou: z.strictObject({ ill: z.boolean() }),` with:

```ts
  taihou: z.strictObject({
    health: percent,
    healthStatus: z.enum(["healthy", "sick", "critical"]),
    deceased: z.boolean().optional(),
    diedAt: gameTimeSchema.optional(),
    posthumousName: z.string().min(1).max(2).optional(),
    mourningUntilDayExclusive: z.number().int().min(0).optional(),
  }),
```

Add a top-level `pendingAftermath` field to `gameStateSchema` (alongside `eventLog`/`chronicle`):

```ts
  pendingAftermath: z.array(
    z.strictObject({
      id: nonEmpty,
      kind: z.enum(["taihou", "consort", "heir"]),
      subjectId: idSchema,
      at: gameTimeSchema,
      resolved: z.boolean(),
    }),
  ),
```

> Confirm `nonEmpty` / `idSchema` / `gameTimeSchema` / `gameTimeShape` import names already used in each file; reuse the existing import.

- [ ] **Step 5: Run test (expected still FAIL until Task 7 seeds values), then commit schema**

Run: `npx vitest run src/engine/save/stateSchema-health.test.ts`
Expected: FAIL only on missing seeded values (newGame) — proceed to Task 7. Commit schema now:

```bash
git add src/engine/content/schemas.ts src/engine/save/stateSchema.ts src/engine/save/stateSchema-health.test.ts
git commit -m "feat: save/content schema 同步健康字段"
```

---

### Task 7: 初始化播种（newGame + initialState）

**Files:**
- Modify: `src/engine/state/newGame.ts:30-110`（consort standing 健康播种；taihou；sovereign healthStatus；pendingAftermath；heir 出生健康在现有出生逻辑，另行核对）
- Modify: `src/engine/state/initialState.ts`（placeholder 构造器同步新字段）

**Interfaces:**
- Consumes: Task 5 类型、Task 6 schema。
- Produces: `createNewGameState` 输出满足 `gameStateSchema`。

- [ ] **Step 1: Seed consort standing health in `newGame.ts`**

In `consortStandingExtras` return object, add health seeding:

```ts
  return {
    ...(character.hidden ? { affection: character.hidden.affection } : {}),
    palaceEnteredAt: character.initialStanding?.palaceEnteredAt ?? startTime,
    health: (character as { attributes?: { health: number } }).attributes?.health ?? 100,
    healthStatus: "healthy",
  };
```

> `consortStandingExtras` currently only runs for `kind === "consort"`. Non-consort standing (officials) do **not** get health (they have no health system) — leave them as-is.

- [ ] **Step 2: Seed sovereign/taihou/pendingAftermath in the returned state object**

In the `return { ... }` of `createNewGameState`:
- change `sovereign: { ...db.world.startingResources.sovereign }` → add status:

```ts
        sovereign: { ...db.world.startingResources.sovereign, healthStatus: "healthy" as const },
```

- replace `taihou: { ill: false },` →

```ts
    taihou: { health: 70, healthStatus: "healthy" },
```

- add `pendingAftermath: [],` alongside `eventLog: []` / `chronicle: []`.

- [ ] **Step 3: Mirror in `initialState.ts`**

In `createInitialState`:
- `sovereign: { health: 70, healthStatus: "healthy", diligence: 50, ... }`
- `taihou: { health: 70, healthStatus: "healthy" },`
- add `pendingAftermath: [],` to the returned object.

- [ ] **Step 4: Heir birth health-status** —核对 `src/engine/characters/birth.ts` / heir 创建处

Find where new heirs are constructed (the `birth` effect handler in `funnel.ts` and/or `characters/birth.ts`). Add `healthStatus: "healthy"` to the heir object literal so it satisfies the `Heir` type. (Heirs already set numeric `health`.)

- [ ] **Step 5: Run state test + type-check**

Run: `npx vitest run src/engine/save/stateSchema-health.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: remaining errors only in `taihou.ts` consumers (`.ill`) → fixed in Task 8; and funnel new effects (Task 8). If heir construction compiles, proceed.

- [ ] **Step 6: Commit**

```bash
git add src/engine/state/newGame.ts src/engine/state/initialState.ts src/engine/characters/birth.ts
git commit -m "feat: 新游戏初始化播种健康字段"
```

---

### Task 8: 退役 `ill` 消费方（taihou.ts + App 旧旬 tick）

**Files:**
- Modify: `src/store/taihou.ts`（删除 `buildTaihouIllnessTick`；`buildShizhiEncounter`/`buildTaihouRebuke` 改读 `isIll(state.taihou.healthStatus)`；`set_taihou_illness` 效果改 `set_taihou_health`）
- Modify: `src/ui/App.tsx`（移除 `rollTaihouIllness` 与其调用、`buildTaihouIllnessTick` import）
- Test: `src/store/taihou.test.ts`（若已存在则更新断言；否则新增最小回归）

**Interfaces:**
- Consumes: `isIll`（Task 1）、`set_taihou_health`（Task 8 funnel，见下）。

> 本阶段「不启用 tick」：删除旧每旬太后生病 tick 后，太后在 Phase 1 不会生病（统一月度 tick 在 Phase 2）。`buildShizhiEncounter`（需病中）在 Phase 1 自然不触发；`buildTaihouRebuke`（需非病）照常。属预期暂时行为。

- [ ] **Step 1: Update `taihou.ts`**

- Delete `TAIHOU_BASE_ILL_CHANCE`/`TAIHOU_ILL_CHANCE_CAP`/`TAIHOU_RECOVER_CHANCE`、`taihouIllnessChance`、`buildTaihouIllnessTick`（整段）。
- In `buildShizhiEncounter`: replace `if (!state.taihou.ill) return null;` with `if (!isIll(state.taihou.healthStatus)) return null;` and its heal effect `{ type: "set_taihou_illness", ill: false }` with `{ type: "set_taihou_health", healthStatus: "healthy" }`.
- In `buildTaihouRebuke`: replace `if (state.taihou.ill) return null;` with `if (isIll(state.taihou.healthStatus)) return null;`.
- Add `import { isIll } from "../engine/characters/health";`.

- [ ] **Step 2: Update `App.tsx`**

- Remove the `rollTaihouIllness` function (App.tsx ~403–413) and its call in `spendAp` (`if (spend.ok && spend.value.rolledOver) decreeBeats = [...decreeBeats, ...rollTaihouIllness()];`).
- Remove `buildTaihouIllnessTick` from the `../store/taihou` import.

> Keep `tickedPeriods` ref if still referenced elsewhere; if it becomes unused, remove it. Search `tickedPeriods` first.

- [ ] **Step 3: Add `set_taihou_health` (and siblings) — see Task 9 funnel**

Task 9 adds the funnel effects. Sequence note: implement Task 9's `set_taihou_health` case before running the full type-check here. For commit ordering, Tasks 8 and 9 may be committed together if the build is otherwise red.

- [ ] **Step 4: Run taihou tests + type-check**

Run: `npx vitest run src/store/taihou.test.ts`
Expected: PASS (after Task 9 lands `set_taihou_health`).
Run: `npx tsc --noEmit` → no remaining `.ill` errors.

- [ ] **Step 5: Commit**

```bash
git add src/store/taihou.ts src/ui/App.tsx src/store/taihou.test.ts
git commit -m "refactor: 退役太后 ill 布尔，改用 healthStatus"
```

---

### Task 9: funnel 底层健康/身后事效果

**Files:**
- Modify: `src/engine/content/schemas.ts:116-213`（`eventEffectSchema` 增分支）
- Modify: `src/engine/effects/funnel.ts`（switch 增 case）
- Test: `src/engine/effects/funnel-health.test.ts`

**Interfaces:**
- Produces effects（落地，本阶段不被 gameplay 调用）：
  - `set_consort_health { type, char, healthStatus?, healthDelta? }`
  - `set_taihou_health { type, healthStatus?, healthDelta? }`
  - `set_heir_health { type, heirId, healthStatus?, healthDelta? }`
  - `set_consort_posthumous { type, char, posthumousRankId?, posthumousEpithet? }`
  - `consort_decease { type, char, at, cause }` / `heir_decease { type, heirId, at, cause }` / `taihou_decease { type, at, cause }`
  - `enqueue_aftermath { type, id, kind, subjectId, at }`（幂等：同 id 不重复 push）

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/effects/funnel-health.test.ts
import { describe, expect, it } from "vitest";
import { applyEffects } from "./funnel";
import { createNewGameState } from "../state/newGame";
import { loadContent } from "../content/loader";
import { viteContentSource } from "../content/viteSource";

function freshState() {
  const db = loadContent(viteContentSource());
  if (!db.ok) throw new Error("content");
  return { db: db.value, state: createNewGameState(db.value) };
}

describe("health funnel effects", () => {
  it("set_taihou_health clamps and sets status", () => {
    const { db, state } = freshState();
    const r = applyEffects(db, state, [
      { type: "set_taihou_health", healthDelta: -200, healthStatus: "critical" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.taihou.health).toBe(0);
      expect(r.value.taihou.healthStatus).toBe("critical");
    }
  });

  it("enqueue_aftermath is idempotent on id", () => {
    const { db, state } = freshState();
    const ev = {
      type: "enqueue_aftermath" as const,
      id: "death:taihou:taihou:99",
      kind: "taihou" as const,
      subjectId: "taihou",
      at: state.calendar,
    };
    const r = applyEffects(db, state, [ev, ev]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pendingAftermath.filter((a) => a.id === ev.id)).toHaveLength(1);
  });
});
```

> Match the `at` shape to `gameTimeSchema` (year/month/period/dayIndex). If the calendar object includes `ap`, pass `toGameTime(state.calendar)` instead — mirror what other effect tests pass.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/effects/funnel-health.test.ts`
Expected: FAIL（effects 未定义）。

- [ ] **Step 3: Add schema branches** (`content/schemas.ts`, inside `eventEffectSchema` union)

```ts
  z.strictObject({
    type: z.literal("set_consort_health"),
    char: idSchema,
    healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
    healthDelta: z.number().int().optional(),
  }),
  z.strictObject({
    type: z.literal("set_taihou_health"),
    healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
    healthDelta: z.number().int().optional(),
  }),
  z.strictObject({
    type: z.literal("set_heir_health"),
    heirId: nonEmpty,
    healthStatus: z.enum(["healthy", "sick", "critical"]).optional(),
    healthDelta: z.number().int().optional(),
  }),
  z.strictObject({
    type: z.literal("set_consort_posthumous"),
    char: idSchema,
    posthumousRankId: idSchema.optional(),
    posthumousEpithet: z.string().min(1).max(2).optional(),
  }),
  z.strictObject({ type: z.literal("consort_decease"), char: idSchema, at: gameTimeShape, cause: deathCauseSchema }),
  z.strictObject({ type: z.literal("heir_decease"), heirId: nonEmpty, at: gameTimeShape, cause: deathCauseSchema }),
  z.strictObject({ type: z.literal("taihou_decease"), at: gameTimeShape, cause: deathCauseSchema }),
  z.strictObject({
    type: z.literal("enqueue_aftermath"),
    id: nonEmpty,
    kind: z.enum(["taihou", "consort", "heir"]),
    subjectId: idSchema,
    at: gameTimeShape,
  }),
```

Add once near the top of the effects section:

```ts
const deathCauseSchema = z.enum(["illness", "critical_sudden", "pregnancy", "childbirth", "scripted"]);
```

Remove the retired `set_taihou_illness` branch (line ~206).

- [ ] **Step 4: Add funnel `case`s** (`funnel.ts`, in the `switch (effect.type)`)

```ts
      case "set_consort_health": {
        const st = next.standing[effect.char]!;
        if (effect.healthDelta !== undefined) st.health = clampPct(st.health + effect.healthDelta);
        if (effect.healthStatus !== undefined) st.healthStatus = effect.healthStatus;
        break;
      }
      case "set_taihou_health": {
        if (effect.healthDelta !== undefined) next.taihou.health = clampPct(next.taihou.health + effect.healthDelta);
        if (effect.healthStatus !== undefined) next.taihou.healthStatus = effect.healthStatus;
        break;
      }
      case "set_heir_health": {
        const h = next.resources.bloodline.heirs.find((x) => x.id === effect.heirId);
        if (h) {
          if (effect.healthDelta !== undefined) h.health = clampPct(h.health + effect.healthDelta);
          if (effect.healthStatus !== undefined) h.healthStatus = effect.healthStatus;
        }
        break;
      }
      case "set_consort_posthumous": {
        const st = next.standing[effect.char]!;
        if (st.deathRecord) {
          if (effect.posthumousRankId !== undefined) st.deathRecord.posthumousRankId = effect.posthumousRankId;
          if (effect.posthumousEpithet !== undefined) st.deathRecord.posthumousEpithet = effect.posthumousEpithet;
        }
        break;
      }
      case "consort_decease": {
        const st = next.standing[effect.char]!;
        const rank = st.rank;
        st.lifecycle = "deceased";
        st.deathRecord = {
          diedAt: effect.at,
          cause: effect.cause,
          originalRankId: rank,
          ...(st.title !== undefined ? { originalTitle: st.title } : {}),
        };
        break;
      }
      case "heir_decease": {
        const h = next.resources.bloodline.heirs.find((x) => x.id === effect.heirId);
        if (h) { h.deceased = true; h.diedAt = effect.at; }
        break;
      }
      case "taihou_decease": {
        next.taihou.deceased = true;
        next.taihou.diedAt = effect.at;
        break;
      }
      case "enqueue_aftermath": {
        if (!next.pendingAftermath.some((a) => a.id === effect.id)) {
          next.pendingAftermath.push({
            id: effect.id,
            kind: effect.kind,
            subjectId: effect.subjectId,
            at: effect.at,
            resolved: false,
          });
        }
        break;
      }
```

Remove the retired `case "set_taihou_illness":` handler. Confirm `clampPct` helper exists in `funnel.ts` (it's used for sovereign resources); if it's named differently there, reuse that name.

- [ ] **Step 5: Run test + type-check, then commit**

Run: `npx vitest run src/engine/effects/funnel-health.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean (all `.ill` / `set_taihou_illness` references gone).

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts src/engine/effects/funnel-health.test.ts
git commit -m "feat: funnel 底层健康/身后事效果（仅落地）"
```

---

### Task 10: `resolveHealthChange` 纯结算函数（仅落地 + 单测）

**Files:**
- Create: `src/store/health.ts`
- Test: `src/store/health.test.ts`

**Interfaces:**
- Consumes: Task 9 funnel 效果、Task 1 类型。
- Produces:
  - `type HealthSubject = { kind: "sovereign" } | { kind: "taihou" } | { kind: "consort"; id: string } | { kind: "heir"; id: string }`
  - `interface HealthChangeInput { subject: HealthSubject; healthDelta?: number; healthStatus?: HealthStatus; cause: DeathCause; at: GameTime }`
  - `interface HealthChangeOutcome { previousHealth: number; nextHealth: number; previousStatus: HealthStatus; nextStatus: HealthStatus; died: boolean; deathCause?: DeathCause; sovereignDied?: boolean; aftermathId?: string }`
  - `planHealthChange(state: GameState, input: HealthChangeInput): { effects: EventEffect[]; outcome: HealthChangeOutcome }`

> 本阶段只产出「effects + outcome」纯函数，**不接入任何事务/tick**（Phase 2 才在 tick/转胎/生产里调用并 `applyEffects`）。孕期断胎/存嗣的具体清胎效果留 Phase 2（此处 outcome 标记 `died`，effects 仅含 health/decease/enqueue）。

- [ ] **Step 1: Write the failing test**

```ts
// src/store/health.test.ts
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../engine/state/newGame";
import { loadContent } from "../engine/content/loader";
import { viteContentSource } from "../engine/content/viteSource";
import { applyEffects } from "../engine/effects/funnel";
import { planHealthChange } from "./health";
import { toGameTime } from "../engine/calendar/time";

function fresh() {
  const db = loadContent(viteContentSource());
  if (!db.ok) throw new Error("content");
  return { db: db.value, state: createNewGameState(db.value) };
}

describe("planHealthChange", () => {
  it("non-lethal taihou delta: not died, applies cleanly", () => {
    const { db, state } = fresh();
    const at = toGameTime(state.calendar);
    const { effects, outcome } = planHealthChange(state, {
      subject: { kind: "taihou" }, healthDelta: -5, cause: "illness", at,
    });
    expect(outcome.died).toBe(false);
    expect(outcome.nextHealth).toBe(65);
    const r = applyEffects(db, state, effects);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.taihou.health).toBe(65);
  });

  it("lethal taihou delta: died + enqueues aftermath (not sovereign)", () => {
    const { db, state } = fresh();
    const at = toGameTime(state.calendar);
    const { effects, outcome } = planHealthChange(state, {
      subject: { kind: "taihou" }, healthDelta: -100, cause: "illness", at,
    });
    expect(outcome.died).toBe(true);
    expect(outcome.sovereignDied).toBeFalsy();
    expect(outcome.aftermathId).toBeDefined();
    const r = applyEffects(db, state, effects);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.taihou.deceased).toBe(true);
      expect(r.value.pendingAftermath).toHaveLength(1);
    }
  });

  it("lethal sovereign delta: sovereignDied, no aftermath entry", () => {
    const { db, state } = fresh();
    const at = toGameTime(state.calendar);
    const { effects, outcome } = planHealthChange(state, {
      subject: { kind: "sovereign" }, healthDelta: -100, cause: "illness", at,
    });
    expect(outcome.died).toBe(true);
    expect(outcome.sovereignDied).toBe(true);
    const r = applyEffects(db, state, effects);
    if (r.ok) expect(r.value.pendingAftermath).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/store/health.test.ts`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement `planHealthChange`**

```ts
// src/store/health.ts
/**
 * 统一健康结算（纯函数）：clamp → 状态 → 死亡判定 → 身后事入队（皇帝除外）。
 * 本阶段仅产出 effects + outcome，不接入 tick/事务（Phase 2 才调用）。
 */
import type { EventEffect } from "../engine/content/schemas";
import type { GameTime } from "../engine/calendar/time";
import type { DeathCause, GameState, HealthStatus } from "../engine/state/types";

export type HealthSubject =
  | { kind: "sovereign" }
  | { kind: "taihou" }
  | { kind: "consort"; id: string }
  | { kind: "heir"; id: string };

export interface HealthChangeInput {
  subject: HealthSubject;
  healthDelta?: number;
  healthStatus?: HealthStatus;
  cause: DeathCause;
  at: GameTime;
}

export interface HealthChangeOutcome {
  previousHealth: number;
  nextHealth: number;
  previousStatus: HealthStatus;
  nextStatus: HealthStatus;
  died: boolean;
  deathCause?: DeathCause;
  sovereignDied?: boolean;
  aftermathId?: string;
}

const clamp = (n: number) => Math.min(100, Math.max(0, n));

function currentOf(state: GameState, s: HealthSubject): { health: number; status: HealthStatus } | null {
  switch (s.kind) {
    case "sovereign":
      return { health: state.resources.sovereign.health, status: state.resources.sovereign.healthStatus };
    case "taihou":
      return { health: state.taihou.health, status: state.taihou.healthStatus };
    case "consort": {
      const st = state.standing[s.id];
      return st ? { health: st.health, status: st.healthStatus } : null;
    }
    case "heir": {
      const h = state.resources.bloodline.heirs.find((x) => x.id === s.id);
      return h ? { health: h.health, status: h.healthStatus } : null;
    }
  }
}

function setHealthEffect(s: HealthSubject, delta: number, status?: HealthStatus): EventEffect {
  switch (s.kind) {
    case "sovereign":
      // sovereign 走通用 resource funnel 加减 health；状态用 flag 由调用方另设（Phase 2）。
      return { type: "resource", pillar: "sovereign", field: "health", delta };
    case "taihou":
      return { type: "set_taihou_health", ...(delta !== 0 ? { healthDelta: delta } : {}), ...(status ? { healthStatus: status } : {}) };
    case "consort":
      return { type: "set_consort_health", char: s.id, ...(delta !== 0 ? { healthDelta: delta } : {}), ...(status ? { healthStatus: status } : {}) };
    case "heir":
      return { type: "set_heir_health", heirId: s.id, ...(delta !== 0 ? { healthDelta: delta } : {}), ...(status ? { healthStatus: status } : {}) };
  }
}

function deceaseEffects(s: HealthSubject, at: GameTime, cause: DeathCause): { effects: EventEffect[]; aftermathId?: string } {
  if (s.kind === "sovereign") return { effects: [] }; // 皇帝不入队
  const subjectId = s.kind === "taihou" ? "taihou" : s.id;
  const aftermathId = `death:${s.kind}:${subjectId}:${at.dayIndex}`;
  const decease: EventEffect =
    s.kind === "taihou" ? { type: "taihou_decease", at, cause }
    : s.kind === "consort" ? { type: "consort_decease", char: s.id, at, cause }
    : { type: "heir_decease", heirId: s.id, at, cause };
  return {
    effects: [decease, { type: "enqueue_aftermath", id: aftermathId, kind: s.kind, subjectId, at }],
    aftermathId,
  };
}

export function planHealthChange(
  state: GameState,
  input: HealthChangeInput,
): { effects: EventEffect[]; outcome: HealthChangeOutcome } {
  const cur = currentOf(state, input.subject);
  if (!cur) {
    return {
      effects: [],
      outcome: {
        previousHealth: 0, nextHealth: 0, previousStatus: "healthy", nextStatus: "healthy", died: false,
      },
    };
  }
  const delta = input.healthDelta ?? 0;
  const nextHealth = clamp(cur.health + delta);
  const nextStatus = input.healthStatus ?? cur.status;
  const died = nextHealth <= 0;
  const effects: EventEffect[] = [setHealthEffect(input.subject, delta, input.healthStatus)];
  const outcome: HealthChangeOutcome = {
    previousHealth: cur.health,
    nextHealth,
    previousStatus: cur.status,
    nextStatus,
    died,
  };
  if (died) {
    outcome.deathCause = input.cause;
    if (input.subject.kind === "sovereign") {
      outcome.sovereignDied = true;
    } else {
      const { effects: ds, aftermathId } = deceaseEffects(input.subject, input.at, input.cause);
      effects.push(...ds);
      outcome.aftermathId = aftermathId;
    }
  }
  return { effects, outcome };
}
```

> `setHealthEffect` 对 sovereign 复用现有 `resource` 效果（health 字段）；sovereign 的 `healthStatus` 更新留 Phase 2 处理（本阶段 sovereign 不会死/不会改状态，测试只验 delta 与 sovereignDied）。

- [ ] **Step 4: Run test + type-check**

Run: `npx vitest run src/store/health.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/health.ts src/store/health.test.ts
git commit -m "feat: resolveHealthChange 纯结算（planHealthChange，仅落地）"
```

---

### Task 11: 面板「健康状态」chip 组件 + 接入

**Files:**
- Create: `src/ui/components/HealthStatusChip.tsx`
- Modify: `src/ui/components/CharacterCard.tsx`（侍君卡加健康状态 chip）
- Modify: `src/ui/components/ConsortListModal.tsx`（详情面板加 chip）
- Modify: `src/ui/components/HeirListModal.tsx`（皇嗣详情：状态 chip 与现有「健康」数值并存）
- Modify: `src/ui/components/ResourcePanel.tsx`（皇帝健康旁加状态 chip）
- Modify: `src/ui/styles.css`（`.health-chip` 样式）
- Test: `src/ui/components/HealthStatusChip.test.tsx`

**Interfaces:**
- Produces: `HealthStatusChip({ status, health }: { status: HealthStatus; health: number })` → 渲染「健康/生病/重病」+ 数值，`data-status` 属性。

- [ ] **Step 1: Write the failing test**

```tsx
// src/ui/components/HealthStatusChip.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { HealthStatusChip } from "./HealthStatusChip";

describe("HealthStatusChip", () => {
  it("labels each status and shows the number", () => {
    const { getByText, rerender } = render(<HealthStatusChip status="healthy" health={88} />);
    expect(getByText(/健康/)).toBeTruthy();
    expect(getByText(/88/)).toBeTruthy();
    rerender(<HealthStatusChip status="sick" health={40} />);
    expect(getByText(/生病/)).toBeTruthy();
    rerender(<HealthStatusChip status="critical" health={10} />);
    expect(getByText(/重病/)).toBeTruthy();
  });
});
```

> Confirm the repo's React test setup (`@testing-library/react` + jsdom). If component tests aren't configured, instead unit-test a pure `healthStatusLabel(status)` helper exported from the same file and skip rendering.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ui/components/HealthStatusChip.test.tsx`
Expected: FAIL（module not found）。

- [ ] **Step 3: Implement chip**

```tsx
// src/ui/components/HealthStatusChip.tsx
/** 健康状态 chip：健康/生病/重病 + 数值。与孕情 chip 分开显示。 */
import type { HealthStatus } from "../../engine/state/types";

export function healthStatusLabel(status: HealthStatus): string {
  return status === "healthy" ? "健康" : status === "sick" ? "生病" : "重病";
}

export function HealthStatusChip({ status, health }: { status: HealthStatus; health: number }) {
  return (
    <span className="health-chip" data-status={status}>
      {healthStatusLabel(status)}　{health}
    </span>
  );
}
```

- [ ] **Step 4: Wire into the four panels**

- `CharacterCard.tsx`: import `HealthStatusChip`; for consorts with standing, render below `char-card__rank`:

```tsx
      {isConsort && standing && (
        <p className="char-card__health">
          <HealthStatusChip status={standing.healthStatus} health={standing.health} />
        </p>
      )}
```

- `ConsortListModal.tsx` `renderDetail`: after the 位分 line, add `<p className="consort-detail__field"><HealthStatusChip status={st.healthStatus} health={st.health} /></p>` (import the chip; `st` is the standing already in scope).
- `HeirListModal.tsx`: near the existing `健康：{describe("health", h.health)}` line, add `<HealthStatusChip status={h.healthStatus} health={h.health} />` (separate from pregnancy/lifecycle text).
- `ResourcePanel.tsx`: find the sovereign `health` display and add `<HealthStatusChip status={state.resources.sovereign.healthStatus} health={state.resources.sovereign.health} />` beside it. (Read the file to match its prop shape.)

- [ ] **Step 5: Add CSS**

In `src/ui/styles.css`:

```css
.health-chip {
  display: inline-block;
  padding: 0.05rem 0.5rem;
  border-radius: 0.6rem;
  font-size: 0.85em;
  border: 1px solid #5c4d3a;
}
.health-chip[data-status="healthy"] { color: #8fd18f; }
.health-chip[data-status="sick"] { color: #d6c07a; }
.health-chip[data-status="critical"] { color: #d98a8a; }
```

- [ ] **Step 6: Run test + type-check + build**

Run: `npx vitest run src/ui/components/HealthStatusChip.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/HealthStatusChip.tsx src/ui/components/HealthStatusChip.test.tsx src/ui/components/CharacterCard.tsx src/ui/components/ConsortListModal.tsx src/ui/components/HeirListModal.tsx src/ui/components/ResourcePanel.tsx src/ui/styles.css
git commit -m "feat: 面板健康状态 chip（与孕情分开显示）"
```

---

### Task 12: `ChildReactionScreen` → `CharacterReactionScreen` 重命名 + manifest 官员立绘

**Files:**
- Rename: `src/ui/screens/ChildReactionScreen.tsx` → `src/ui/screens/CharacterReactionScreen.tsx`（组件、export、内部注释改名）
- Modify: `src/ui/App.tsx:45,1353`（import 与 JSX 标签改名；`childReaction`/`setChildReaction` 变量可保留）
- Modify: `assets/manifest.json`（增 `portrait.official1.neutral`–`portrait.official8.neutral`）
- Test: `src/engine/assets/manifest-officials.test.ts`

**Interfaces:**
- Produces: `CharacterReactionScreen`（同 props：`db, store, registry, portraitSet, speakerName, lines, onDone`）；manifest 含 official1–8 立绘 key。

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/assets/manifest-officials.test.ts
import { describe, expect, it } from "vitest";
import { assetManifestSchema } from "./manifest";
import raw from "../../../assets/manifest.json";

describe("official portraits", () => {
  it("registers official1..official8 neutral portraits", () => {
    const m = assetManifestSchema.parse(raw);
    for (let i = 1; i <= 8; i++) {
      expect(m.entries[`portrait.official${i}.neutral`]).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/assets/manifest-officials.test.ts`
Expected: FAIL（official entries 缺失）。

- [ ] **Step 3: Add manifest entries**

In `assets/manifest.json` `entries`, add (after the existing official lines):

```json
    "portrait.official1.neutral": { "path": "portraits/official/official1.png", "kind": "portrait", "placeholder": false },
    "portrait.official2.neutral": { "path": "portraits/official/official2.png", "kind": "portrait", "placeholder": false },
    "portrait.official3.neutral": { "path": "portraits/official/official3.png", "kind": "portrait", "placeholder": false },
    "portrait.official4.neutral": { "path": "portraits/official/official4.png", "kind": "portrait", "placeholder": false },
    "portrait.official5.neutral": { "path": "portraits/official/official5.png", "kind": "portrait", "placeholder": false },
    "portrait.official6.neutral": { "path": "portraits/official/official6.png", "kind": "portrait", "placeholder": false },
    "portrait.official7.neutral": { "path": "portraits/official/official7.png", "kind": "portrait", "placeholder": false },
    "portrait.official8.neutral": { "path": "portraits/official/official8.png", "kind": "portrait", "placeholder": false },
```

- [ ] **Step 4: Rename component**

```bash
git mv src/ui/screens/ChildReactionScreen.tsx src/ui/screens/CharacterReactionScreen.tsx
```

In the renamed file: change `export function ChildReactionScreen` → `export function CharacterReactionScreen`, update the leading doc comment to be generic ("通用立绘+台词台词页：立绘由 portraitSet 显式给出").
In `App.tsx`: change `import { ChildReactionScreen } from "./screens/ChildReactionScreen";` → `import { CharacterReactionScreen } from "./screens/CharacterReactionScreen";` and the JSX `<ChildReactionScreen ...>` → `<CharacterReactionScreen ...>`.

- [ ] **Step 5: Run test + type-check + build**

Run: `npx vitest run src/engine/assets/manifest-officials.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit` → clean.
Run: `npx vitest run` (full suite) → all green.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: 通用 CharacterReactionScreen + 注册官员立绘 official1-8"
```

---

## Phase 1 完成验收

- [ ] `npx tsc --noEmit` 全绿；`npx vitest run` 全绿。
- [ ] 新游戏可正常进入，皇帝/太后/侍君/皇嗣面板显示「健康状态」chip（与孕情分开）。
- [ ] 全程无角色掉血/死亡（tick 未接入）。
- [ ] `git log` 一阶段一组小提交。

> Phases 2–4（统一 tick / 太医看诊 / 怀孕成本与重病 gating / 死亡与身后事 UI）在 Phase 1 落地后，按 spec `§11` 各自单独出 plan（届时 `planHealthChange` 接入 tick/转胎/生产，并补 sovereign 状态更新与孕期断胎效果）。

## Self-Review notes

- Spec 覆盖：本 plan 对应 spec §1（数据模型/年龄/字段）、§2（healthRoll）、§4.4（manifest）、§9（面板双状态）、§11 Phase 1。tick(§3)、太医(§4)、孕期(§5)、死亡/身后事(§6–8)、奉先殿(§10) 属 Phase 2–4，不在本 plan。
- `planHealthChange`（本阶段仅落地）与 spec 的 `resolveHealthChange` 同义；Phase 2 接入事务时再加 sovereign 状态更新与孕期断胎效果，命名以本 plan 为准。
- 已知顺序依赖：Task 8（去 `.ill`）与 Task 9（加 `set_taihou_health`）需同批使 build 转绿，执行时若中途 red 属预期，按各 Task 末尾 commit。

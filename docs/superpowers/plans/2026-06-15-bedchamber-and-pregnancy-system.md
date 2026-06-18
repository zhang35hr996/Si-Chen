# 侍寝系统 + 孕育系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侍君宫殿/御书房召侍君侍寝（耗 1 行动点、模板化体验），由侍寝频率派生受宠程度取代恩宠条，激情侍寝按概率受孕、次月提示并由玩家挑选 1–3 生父使帝王转「怀胎」。

**Architecture:** 侍寝是运行时的引擎/store 流程（如位分操作），所有状态变更走效果漏斗新增的 `bedchamber`/`pregnancy` 两个 effect type。受宠程度与受孕判定是纯函数（不存储、确定性）。孕育提示由 App 层拦截渲染，不经事件 DSL。

**Tech Stack:** TypeScript（strict）、React、Zod（content/state schema）、Vitest（单测）。引擎层禁止 import React。

参考规格：[`../specs/2026-06-15-bedchamber-and-pregnancy-system-design.md`](../specs/2026-06-15-bedchamber-and-pregnancy-system-design.md)

---

## 文件结构

**引擎纯逻辑（新建）**
- `src/engine/characters/favorTier.ts` — 受宠程度 + 次数统计（纯函数）
- `src/engine/characters/conception.ts` — 确定性受孕判定（纯函数）

**引擎改动**
- `src/engine/state/types.ts` — 新增 `BedchamberMode/Encounter/Record`、`PregnancyState`，挂到 `GameState`/`BloodlineState`
- `src/engine/calendar/time.ts` — 导出 `monthOrdinal`
- `src/engine/content/schemas.ts` — `eventEffectSchema` 加 `bedchamber`/`pregnancy`；`worldSchema` 加 `bedchamber`/`bedchamberScript`
- `src/engine/effects/funnel.ts` — 校验 + 应用两个新效果
- `src/engine/state/newGame.ts` / `initialState.ts` — 初始化空 bedchamber + pregnancy
- `src/engine/save/stateSchema.ts` — 持久化新字段

**store 编排（新建）**
- `src/store/bedchamber.ts` — `buildBedchamber`（组装 effects + 体验台词 + 初夜/受孕标记）+ 配置读取

**内容**
- `content/world.json` — `bedchamber` 配置 + `bedchamberScript` 模板

**UI 改动 / 新建**
- `src/ui/components/CharacterCard.tsx` — consort 用受宠程度取代恩宠条 + 次数；新增 `onBedchamber`
- `src/ui/screens/LocationScreen.tsx` — 御书房「翻牌子」+ 宫殿侍寝按钮 + 怀胎徽标
- `src/ui/components/BedchamberModal.tsx`（新建）— 选激情/享受
- `src/ui/components/BedchamberPicker.tsx`（新建）— 翻牌子侍君列表
- `src/ui/screens/BedchamberScene.tsx`（新建）— 播放体验台词（基于 ReactionScreen 模式）
- `src/ui/components/PregnancyModal.tsx`（新建）— 多选 1–3 生父
- `src/ui/App.tsx` — 编排全流程

---

## Task 1: GameState 新增状态类型

**Files:**
- Modify: `src/engine/state/types.ts`

- [ ] **Step 1: 加类型到 types.ts**

在 `MenstrualStatus` 之后、`BloodlineState` 之前加孕育类型，并扩展 `BloodlineState`：

```ts
export type PregnancyStatus = "none" | "pending" | "expecting";

export interface PregnancyState {
  /** none=未受孕; pending=已受孕未告知（玩家不可见）; expecting=怀胎 */
  status: PregnancyStatus;
  conceivedAt?: GameTime;
  /** 玩家选定的生父候选（1–3），confirm 后写入 */
  fatherIds: string[];
}
```

把 `BloodlineState` 改成（新增 `pregnancy`）：

```ts
export interface BloodlineState {
  /** 宗嗣合法性 */
  legitimacy: number;
  /** 经血状态 */
  menstrualStatus: MenstrualStatus;
  /** 经血祭仪 scaffold */
  lastRiteAt?: GameTime;
  /** 帝王孕育状态（本期只到「怀胎」） */
  pregnancy: PregnancyState;
  /** Reserved (DESIGN §3.8) — always [] in the skeleton. */
  heirs: unknown[];
}
```

在 `CharacterMemoryStore` 之后加侍寝日志类型：

```ts
export type BedchamberMode = "passion" | "pleasure";

export interface BedchamberEncounter {
  /** 侍寝发生时刻（纯 GameTime，不带 AP） */
  at: GameTime;
  mode: BedchamberMode;
}

export interface BedchamberRecord {
  /** append-only */
  encounters: BedchamberEncounter[];
}
```

在 `GameState` 接口里 `memories` 行之后加：

```ts
  /** 每名侍君（含皇后）的侍寝日志；非侍君无条目。 */
  bedchamber: Record<string, BedchamberRecord>;
```

- [ ] **Step 2: typecheck（预期会因后续未初始化而暂时报错，本步只验证类型本身无语法错）**

Run: `npx tsc --noEmit src/engine/state/types.ts 2>&1 | head -5`
Expected: 无该文件自身的语法错误（types.ts 是纯类型，独立编译应通过）。

- [ ] **Step 3: Commit**

```bash
git add src/engine/state/types.ts
git commit -m "feat: bedchamber + pregnancy state types"
```

---

## Task 2: 初始化新字段（newGame / initialState）

**Files:**
- Modify: `src/engine/state/newGame.ts`
- Modify: `src/engine/state/initialState.ts`
- Test: `tests/state/newGame.bedchamber.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/state/newGame.bedchamber.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";

describe("newGame bedchamber + pregnancy init", () => {
  const content = loadGameContent();
  if (!content.ok) throw new Error("content failed to load in test fixture");
  const db = content.value;

  it("gives every consort an empty bedchamber record and officials none", () => {
    const state = createNewGameState(db);
    for (const c of Object.values(db.characters)) {
      if (c.kind === "consort") {
        expect(state.bedchamber[c.id]).toEqual({ encounters: [] });
      } else {
        expect(state.bedchamber[c.id]).toBeUndefined();
      }
    }
  });

  it("starts pregnancy at none", () => {
    const state = createNewGameState(db);
    expect(state.resources.bloodline.pregnancy).toEqual({ status: "none", fatherIds: [] });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/state/newGame.bedchamber.test.ts`
Expected: FAIL（`state.bedchamber` 为 undefined / pregnancy 缺失）。

- [ ] **Step 3: 实现 newGame.ts**

在 `newGame.ts` 的 `for (const character of Object.values(db.characters))` 循环之前加：

```ts
  const bedchamber: Record<string, import("./types").BedchamberRecord> = {};
```

在循环体内（`memories[character.id] = {...}` 之后）加：

```ts
    if (character.kind === "consort") {
      bedchamber[character.id] = { encounters: [] };
    }
```

把 `return {...}` 里的 `bloodline` 行与新增 `bedchamber` 改为：

```ts
      bloodline: {
        ...db.world.startingResources.bloodline,
        pregnancy: { status: "none", fatherIds: [] },
        heirs: [],
      },
```

并在 `memories,` 行之后加一行 `bedchamber,`。

- [ ] **Step 4: 实现 initialState.ts**

把 `bloodline` 行改为并新增 `bedchamber`：

```ts
      bloodline: {
        legitimacy: 60,
        menstrualStatus: "normal",
        pregnancy: { status: "none", fatherIds: [] },
        heirs: [],
      },
```

在 `memories: {},` 之后加：

```ts
    bedchamber: {},
```

- [ ] **Step 5: 运行测试，确认通过**

Run: `npx vitest run tests/state/newGame.bedchamber.test.ts`
Expected: PASS（2 个用例）。

- [ ] **Step 6: 全量 typecheck**

Run: `npm run typecheck`
Expected: PASS（无报错）。

- [ ] **Step 7: Commit**

```bash
git add src/engine/state/newGame.ts src/engine/state/initialState.ts tests/state/newGame.bedchamber.test.ts
git commit -m "feat: init bedchamber + pregnancy in new/initial state"
```

---

## Task 3: monthOrdinal 工具

**Files:**
- Modify: `src/engine/calendar/time.ts`
- Test: `tests/calendar/monthOrdinal.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/calendar/monthOrdinal.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";

describe("monthOrdinal", () => {
  it("counts months from 元年一月 = 1", () => {
    expect(monthOrdinal(makeGameTime(1, 1, "early"))).toBe(1);
    expect(monthOrdinal(makeGameTime(1, 4, "late"))).toBe(4);
    expect(monthOrdinal(makeGameTime(2, 1, "mid"))).toBe(13);
  });
  it("ignores period (month granularity)", () => {
    expect(monthOrdinal(makeGameTime(1, 3, "early"))).toBe(monthOrdinal(makeGameTime(1, 3, "late")));
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/calendar/monthOrdinal.test.ts`
Expected: FAIL（`monthOrdinal` 未导出）。

- [ ] **Step 3: 实现**

在 `time.ts` 的 `dayIndexOf` 函数之后加：

```ts
/** Month index from 元年一月 = 1 (period-agnostic) — drives 受宠 windows. */
export function monthOrdinal(time: Pick<GameTime, "year" | "month">): number {
  return (time.year - 1) * 12 + time.month;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/calendar/monthOrdinal.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/calendar/time.ts tests/calendar/monthOrdinal.test.ts
git commit -m "feat: monthOrdinal calendar helper"
```

---

## Task 4: 受宠程度纯函数（favorTier）

**Files:**
- Create: `src/engine/characters/favorTier.ts`
- Test: `tests/characters/favorTier.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/characters/favorTier.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import {
  DEFAULT_TIERS,
  computeFavorStats,
  type BedchamberThresholds,
} from "../../src/engine/characters/favorTier";
import type { BedchamberEncounter, BedchamberRecord } from "../../src/engine/state/types";

const th: BedchamberThresholds = DEFAULT_TIERS;

/** n encounters in (year=1, month, period=early, mode=passion). */
function visits(month: number, n: number): BedchamberEncounter[] {
  return Array.from({ length: n }, () => ({ at: makeGameTime(1, month, "early"), mode: "passion" as const }));
}
function record(...es: BedchamberEncounter[][]): BedchamberRecord {
  return { encounters: es.flat() };
}

describe("computeFavorStats", () => {
  it("empty log = 无宠, all counts 0", () => {
    const s = computeFavorStats(undefined, makeGameTime(1, 1, "early"), th);
    expect(s).toMatchObject({ tier: "none", lastMonth: 0, lastThreeMonths: 0, lastYear: 0 });
  });

  // 需求验收例: 一月4 二月3 三月3 四月0
  const rec = record(visits(1, 4), visits(2, 3), visits(3, 3));
  it("一月末 = 小宠 (n3=4)", () => {
    expect(computeFavorStats(rec, makeGameTime(1, 1, "late"), th).tier).toBe("small");
  });
  it("二月末 = 宠爱 (n3=7)", () => {
    expect(computeFavorStats(rec, makeGameTime(1, 2, "late"), th).tier).toBe("favored");
  });
  it("三月末 = 盛宠 (n3=10)", () => {
    expect(computeFavorStats(rec, makeGameTime(1, 3, "late"), th).tier).toBe("abundant");
  });
  it("四月 = 宠爱 (n3=6, 掉回)", () => {
    const s = computeFavorStats(rec, makeGameTime(1, 4, "early"), th);
    expect(s.tier).toBe("favored");
    expect(s.lastThreeMonths).toBe(6);
    expect(s.lastMonth).toBe(0);
  });

  it("失宠: 曾达宠爱+ 但近三月跌破小宠", () => {
    // 一月5次(宠爱), 此后五月空窗 → 六月看时 n3=0 但历史曾达 favored
    const r = record(visits(1, 5));
    const s = computeFavorStats(r, makeGameTime(1, 6, "early"), th);
    expect(s.lastThreeMonths).toBe(0);
    expect(s.tier).toBe("fallen");
  });

  it("无宠: 有过侍寝但从未达宠爱, 近三月跌破小宠", () => {
    const r = record(visits(1, 2)); // 峰值 n3=2 < favored
    const s = computeFavorStats(r, makeGameTime(1, 6, "early"), th);
    expect(s.tier).toBe("none");
  });

  it("近一年窗口 = 当前月+前11月", () => {
    const r = record(visits(1, 1), visits(2, 1)); // 第13月时一月已出窗
    const s = computeFavorStats(r, makeGameTime(2, 1, "early"), th); // monthOrdinal=13
    expect(s.lastYear).toBe(1); // 仅二月那次仍在 [2..13]
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/characters/favorTier.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 favorTier.ts**

```ts
/**
 * 受宠程度（盛宠/宠爱/小宠/失宠/无宠）+ 近一月/近三月/近一年次数 — 纯函数，
 * 由侍寝日志按月窗口实时派生（不存储）。窗口按月边界，结尾对齐当前月。
 */
import { monthOrdinal } from "../calendar/time";
import type { GameTime } from "../calendar/time";
import type { BedchamberRecord } from "../state/types";

export type FavorTier = "abundant" | "favored" | "small" | "fallen" | "none";

export const FAVOR_TIER_LABEL: Record<FavorTier, string> = {
  abundant: "盛宠",
  favored: "宠爱",
  small: "小宠",
  fallen: "失宠",
  none: "无宠",
};

export interface BedchamberThresholds {
  small: number;
  favored: number;
  abundant: number;
}

export const DEFAULT_TIERS: BedchamberThresholds = { small: 3, favored: 5, abundant: 10 };

export interface FavorStats {
  lastMonth: number;
  lastThreeMonths: number;
  lastYear: number;
  tier: FavorTier;
}

/** count encounters whose month is within `span` months ending at `cur`. */
function countWindow(record: BedchamberRecord, cur: number, span: number): number {
  let n = 0;
  for (const e of record.encounters) {
    const diff = cur - monthOrdinal(e.at);
    if (diff >= 0 && diff <= span - 1) n += 1;
  }
  return n;
}

/** Highest 3-month-window count over every month from first encounter to now. */
function peakThreeMonth(record: BedchamberRecord, cur: number): number {
  if (record.encounters.length === 0) return 0;
  const first = Math.min(...record.encounters.map((e) => monthOrdinal(e.at)));
  let peak = 0;
  for (let m = first; m <= cur; m++) {
    peak = Math.max(peak, countWindow(record, m, 3));
  }
  return peak;
}

export function computeFavorStats(
  record: BedchamberRecord | undefined,
  now: GameTime,
  th: BedchamberThresholds,
): FavorStats {
  if (!record || record.encounters.length === 0) {
    return { lastMonth: 0, lastThreeMonths: 0, lastYear: 0, tier: "none" };
  }
  const cur = monthOrdinal(now);
  const lastMonth = countWindow(record, cur, 1);
  const lastThreeMonths = countWindow(record, cur, 3);
  const lastYear = countWindow(record, cur, 12);

  let tier: FavorTier;
  if (lastThreeMonths >= th.abundant) tier = "abundant";
  else if (lastThreeMonths >= th.favored) tier = "favored";
  else if (lastThreeMonths >= th.small) tier = "small";
  else tier = peakThreeMonth(record, cur) >= th.favored ? "fallen" : "none";

  return { lastMonth, lastThreeMonths, lastYear, tier };
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/characters/favorTier.test.ts`
Expected: PASS（全部用例）。

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/favorTier.ts tests/characters/favorTier.test.ts
git commit -m "feat: favorTier — 受宠程度 from 侍寝 frequency"
```

---

## Task 5: 确定性受孕判定（conception）

**Files:**
- Create: `src/engine/characters/conception.ts`
- Test: `tests/characters/conception.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/characters/conception.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { conceives } from "../../src/engine/characters/conception";

describe("conceives (deterministic)", () => {
  it("is stable for identical inputs", () => {
    const a = conceives(1, 5, "shen_chenghui", 30);
    const b = conceives(1, 5, "shen_chenghui", 30);
    expect(a).toBe(b);
  });
  it("chance 0 never conceives", () => {
    for (const day of [1, 2, 3, 50]) expect(conceives(7, day, "chu_jun", 0)).toBe(false);
  });
  it("chance 100 always conceives", () => {
    for (const day of [1, 2, 3, 50]) expect(conceives(7, day, "chu_jun", 100)).toBe(true);
  });
  it("varies across inputs (not constant)", () => {
    const results = [1, 2, 3, 4, 5, 6, 7, 8].map((d) => conceives(1, d, "chu_jun", 50));
    expect(new Set(results).size).toBe(2); // both true and false appear
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/characters/conception.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 conception.ts**

```ts
/**
 * 确定性受孕判定：不引入随机种子变更，由 (rngSeed, 行动日序, 侍君) 哈希取模。
 * 同输入同结果 ⇒ 存档/重放稳定。仅激情侍寝调用、仅在未孕时调用（调用方负责）。
 */
import { fnv1a64Hex } from "../save/canonical";

export function conceives(rngSeed: number, dayIndex: number, charId: string, chancePercent: number): boolean {
  if (chancePercent <= 0) return false;
  if (chancePercent >= 100) return true;
  const roll = parseInt(fnv1a64Hex(`${rngSeed}:${dayIndex}:${charId}`).slice(0, 8), 16) % 100;
  return roll < chancePercent;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/characters/conception.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/conception.ts tests/characters/conception.test.ts
git commit -m "feat: deterministic conception roll"
```

---

## Task 6: schema 新效果 + world 配置

**Files:**
- Modify: `src/engine/content/schemas.ts`
- Test: `tests/content/effectSchema.bedchamber.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/content/effectSchema.bedchamber.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { eventEffectSchema } from "../../src/engine/content/schemas";

describe("eventEffectSchema: bedchamber + pregnancy", () => {
  it("accepts a bedchamber effect", () => {
    expect(eventEffectSchema.safeParse({ type: "bedchamber", char: "shen_chenghui", mode: "passion" }).success).toBe(true);
  });
  it("rejects unknown bedchamber mode", () => {
    expect(eventEffectSchema.safeParse({ type: "bedchamber", char: "x", mode: "lust" }).success).toBe(false);
  });
  it("accepts pregnancy begin/clear without fatherIds", () => {
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "begin" }).success).toBe(true);
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "clear" }).success).toBe(true);
  });
  it("accepts pregnancy confirm with 1–3 fatherIds", () => {
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "confirm", fatherIds: ["chu_jun"] }).success).toBe(true);
    expect(
      eventEffectSchema.safeParse({ type: "pregnancy", op: "confirm", fatherIds: ["a", "b", "c"] }).success,
    ).toBe(true);
  });
  it("rejects confirm with 0 or 4 fatherIds", () => {
    expect(eventEffectSchema.safeParse({ type: "pregnancy", op: "confirm", fatherIds: [] }).success).toBe(false);
    expect(
      eventEffectSchema.safeParse({ type: "pregnancy", op: "confirm", fatherIds: ["a", "b", "c", "d"] }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/content/effectSchema.bedchamber.test.ts`
Expected: FAIL（schema 还不认这些 type）。

- [ ] **Step 3: 实现 — eventEffectSchema 加两分支**

在 `schemas.ts` 的 `eventEffectSchema` union 里、`remove_title` 分支之后、`memory` 分支之前插入：

```ts
  z.strictObject({
    type: z.literal("bedchamber"),
    char: idSchema,
    mode: z.enum(["passion", "pleasure"]),
  }),
  z.strictObject({
    type: z.literal("pregnancy"),
    op: z.enum(["begin", "confirm", "clear"]),
    fatherIds: z.array(idSchema).min(1).max(3).optional(),
  }),
```

- [ ] **Step 4: 实现 — worldSchema 加 bedchamber 配置**

在 `worldSchema` 里 `rankChangeReactions: rankChangeReactionsSchema.optional(),` 之后加：

```ts
  /** 侍寝/受孕调参（缺省走引擎内置 fallback）。 */
  bedchamber: z
    .strictObject({
      conceptionChance: percent,
      tiers: z.strictObject({
        small: z.number().int().min(1),
        favored: z.number().int().min(1),
        abundant: z.number().int().min(1),
      }),
    })
    .optional(),
  /** 模板化侍寝体验台词（按 mode）。 */
  bedchamberScript: z
    .strictObject({
      passion: z.strictObject({ lines: z.array(nonEmpty).min(1).max(6) }),
      pleasure: z.strictObject({ lines: z.array(nonEmpty).min(1).max(6) }),
    })
    .optional(),
```

- [ ] **Step 5: 运行测试 + typecheck，确认通过**

Run: `npx vitest run tests/content/effectSchema.bedchamber.test.ts && npm run typecheck`
Expected: PASS（schema 用例全过；typecheck 因 funnel 的 switch 未穷尽新 type 可能报 `Property 'type' ... not all paths` —— 若报错，是预期的，Task 7 修复。先只看 schema 测试 PASS）。

> 说明：`eventEffectSchema` 改动会让 `funnel.ts` 的 `switch (effect.type)` 出现未处理分支。若 Step 5 的 typecheck 报 funnel 相关错误，继续 Task 7；schema 测试本身必须 PASS。

- [ ] **Step 6: Commit**

```bash
git add src/engine/content/schemas.ts tests/content/effectSchema.bedchamber.test.ts
git commit -m "feat: bedchamber/pregnancy effects + world bedchamber config schema"
```

---

## Task 7: 漏斗校验 + 应用新效果

**Files:**
- Modify: `src/engine/effects/funnel.ts`
- Test: `tests/effects/funnel.bedchamber.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/effects/funnel.bedchamber.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("funnel: bedchamber", () => {
  it("appends an encounter at current time", () => {
    const state = createNewGameState(db);
    const r = applyEffects(db, state, [{ type: "bedchamber", char: "shen_chenghui", mode: "passion" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const enc = r.value.bedchamber.shen_chenghui!.encounters;
    expect(enc).toHaveLength(1);
    expect(enc[0]!.mode).toBe("passion");
    expect(enc[0]!.at.month).toBe(state.calendar.month);
    // input state untouched
    expect(state.bedchamber.shen_chenghui!.encounters).toHaveLength(0);
  });

  it("rejects bedchamber for an official (no record)", () => {
    const state = createNewGameState(db);
    const errs = validateEffects(db, state, [{ type: "bedchamber", char: "sili_nvguan", mode: "passion" }]);
    expect(errs).toHaveLength(1);
  });
});

describe("funnel: pregnancy", () => {
  it("begin → pending with conceivedAt", () => {
    const state = createNewGameState(db);
    const r = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy.status).toBe("pending");
    expect(r.value.resources.bloodline.pregnancy.conceivedAt?.month).toBe(state.calendar.month);
  });

  it("confirm sets expecting + fatherIds and keeps conceivedAt", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const r = applyEffects(db, begun.value, [
      { type: "pregnancy", op: "confirm", fatherIds: ["shen_chenghui", "chu_jun"] },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.value.resources.bloodline.pregnancy;
    expect(p.status).toBe("expecting");
    expect(p.fatherIds).toEqual(["shen_chenghui", "chu_jun"]);
    expect(p.conceivedAt).toEqual(begun.value.resources.bloodline.pregnancy.conceivedAt);
  });

  it("rejects confirm with a non-consort fatherId", () => {
    const state = createNewGameState(db);
    const errs = validateEffects(db, state, [
      { type: "pregnancy", op: "confirm", fatherIds: ["sili_nvguan"] },
    ]);
    expect(errs).toHaveLength(1);
  });

  it("clear resets to none", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const r = applyEffects(db, begun.value, [{ type: "pregnancy", op: "clear" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy).toEqual({ status: "none", fatherIds: [] });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/effects/funnel.bedchamber.test.ts`
Expected: FAIL（校验/应用未处理新 type）。

- [ ] **Step 3: 实现 — validateEffects 加分支**

在 `funnel.ts` 的 `validateEffects` 的 `switch (e.type)` 里，`remove_title` case 之后加：

```ts
      case "bedchamber": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.bedchamber[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `bedchamber needs a consort with a record: "${e.char}"`, { char: e.char });
        }
        break;
      }
      case "pregnancy": {
        if (e.op === "confirm") {
          const ids = e.fatherIds ?? [];
          if (ids.length < 1 || ids.length > 3) {
            bad(index, "BAD_EFFECT", `pregnancy confirm needs 1–3 fatherIds`, { fatherIds: ids });
          } else {
            for (const id of ids) {
              if (!db.characters[id] || db.characters[id]!.kind !== "consort") {
                bad(index, "BAD_EFFECT_TARGET", `fatherId is not a consort: "${id}"`, { char: id });
              }
            }
          }
        }
        break;
      }
```

- [ ] **Step 4: 实现 — applyEffects 加分支**

在 `applyEffects` 的 `for (const effect of effects)` 的 `switch (effect.type)` 里，`memory` case 之前（或 `remove_title` case 之后）加：

```ts
      case "bedchamber": {
        next.bedchamber[effect.char]!.encounters.push({
          at: now, // GameTime — 侍寝当下，不带 AP
          mode: effect.mode,
        });
        break;
      }
      case "pregnancy": {
        const p = next.resources.bloodline.pregnancy;
        if (effect.op === "begin") {
          next.resources.bloodline.pregnancy = { status: "pending", conceivedAt: now, fatherIds: [] };
        } else if (effect.op === "confirm") {
          next.resources.bloodline.pregnancy = {
            status: "expecting",
            ...(p.conceivedAt !== undefined ? { conceivedAt: p.conceivedAt } : {}),
            fatherIds: [...(effect.fatherIds ?? [])],
          };
        } else {
          next.resources.bloodline.pregnancy = { status: "none", fatherIds: [] };
        }
        break;
      }
```

- [ ] **Step 5: 运行测试 + 全量 typecheck**

Run: `npx vitest run tests/effects/funnel.bedchamber.test.ts && npm run typecheck`
Expected: PASS（funnel switch 现已穷尽；typecheck 通过）。

- [ ] **Step 6: Commit**

```bash
git add src/engine/effects/funnel.ts tests/effects/funnel.bedchamber.test.ts
git commit -m "feat: funnel validate + apply for bedchamber/pregnancy"
```

---

## Task 8: 存档持久化新字段

**Files:**
- Modify: `src/engine/save/stateSchema.ts`
- Test: `tests/save/stateSchema.bedchamber.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/save/stateSchema.bedchamber.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("gameStateSchema persists bedchamber + pregnancy", () => {
  it("round-trips a state with encounters and an expecting pregnancy", () => {
    let state = createNewGameState(db);
    const a = applyEffects(db, state, [{ type: "bedchamber", char: "shen_chenghui", mode: "passion" }]);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "begin" }]);
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const c = applyEffects(db, b.value, [{ type: "pregnancy", op: "confirm", fatherIds: ["shen_chenghui"] }]);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    state = c.value;
    const parsed = gameStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
  });

  it("rejects a state missing pregnancy", () => {
    const state = createNewGameState(db) as Record<string, any>;
    delete (state.resources.bloodline as Record<string, unknown>).pregnancy;
    expect(gameStateSchema.safeParse(state).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/save/stateSchema.bedchamber.test.ts`
Expected: FAIL（bloodline 缺 `pregnancy`、顶层缺 `bedchamber` → strictObject 报未知键/缺键）。

- [ ] **Step 3: 实现 — stateSchema.ts**

在 `stateSchema.ts` 文件顶部 import 里把 `gameTimeSchema` 用上（已存在）。在 `gameStateSchema` 的 `bloodline: z.strictObject({...})` 里、`heirs:` 行之前加：

```ts
      pregnancy: z.strictObject({
        status: z.enum(["none", "pending", "expecting"]),
        conceivedAt: gameTimeSchema.optional(),
        fatherIds: z.array(idSchema),
      }),
```

在 `gameStateSchema` 的 `memories: z.record(...)` 块之后加（注意补逗号）：

```ts
  bedchamber: z.record(
    idSchema,
    z.strictObject({
      encounters: z.array(
        z.strictObject({ at: gameTimeSchema, mode: z.enum(["passion", "pleasure"]) }),
      ),
    }),
  ),
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `npx vitest run tests/save/stateSchema.bedchamber.test.ts`
Expected: PASS。

- [ ] **Step 5: 跑既有存档测试，确认无回归**

Run: `npx vitest run tests/save`
Expected: PASS（既有 save 用例不回归）。

- [ ] **Step 6: Commit**

```bash
git add src/engine/save/stateSchema.ts tests/save/stateSchema.bedchamber.test.ts
git commit -m "feat: persist bedchamber + pregnancy in save schema"
```

---

## Task 9: world.json 配置 + 体验台词

**Files:**
- Modify: `content/world.json`

- [ ] **Step 1: 加配置块**

在 `content/world.json` 顶层、`rankChangeReactions` 对象之后（保持合法 JSON，加逗号）加：

```json
  "bedchamber": {
    "conceptionChance": 30,
    "tiers": { "small": 3, "favored": 5, "abundant": 10 }
  },
  "bedchamberScript": {
    "passion": {
      "lines": [
        "{name}闻召，颊上飞红，敛衽称是，缓步上前服侍帝王。",
        "帐暖香浓，{self}屏息承欢，曲意逢迎，不敢有半分懈怠。",
        "云收雨歇，陛下倦极而眠，只觉通体舒泰、神清气爽。"
      ]
    },
    "pleasure": {
      "lines": [
        "{name}奉召近前，执扇研墨、抚琴奉茶，柔声为帝王解乏。",
        "一夕清谈相伴，陛下心绪舒展，只觉神清气爽，并无他事。"
      ]
    }
  }
```

- [ ] **Step 2: 校验内容**

Run: `npm run validate-content`
Expected: 退出码 0，无错误（world.json 仍合法）。

- [ ] **Step 3: Commit**

```bash
git add content/world.json
git commit -m "feat: bedchamber config + 体验台词 in world.json"
```

---

## Task 10: store 编排（buildBedchamber）

**Files:**
- Create: `src/store/bedchamber.ts`
- Test: `tests/store/bedchamber.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `tests/store/bedchamber.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildBedchamber, bedchamberConfig } from "../../src/store/bedchamber";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("bedchamberConfig", () => {
  it("reads world.json values", () => {
    const cfg = bedchamberConfig(db);
    expect(cfg.conceptionChance).toBe(db.world.bedchamber?.conceptionChance ?? 30);
    expect(cfg.tiers.favored).toBeGreaterThan(0);
  });
});

describe("buildBedchamber", () => {
  it("returns null for an official", () => {
    const state = createNewGameState(db);
    expect(buildBedchamber(db, state, "sili_nvguan", "passion")).toBeNull();
  });

  it("first night flag is set when no prior encounters", () => {
    const state = createNewGameState(db);
    const plan = buildBedchamber(db, state, "shen_chenghui", "pleasure");
    expect(plan).not.toBeNull();
    expect(plan!.isFirstNight).toBe(true);
    expect(plan!.lines.length).toBeGreaterThan(0);
    expect(plan!.effects[0]).toMatchObject({ type: "bedchamber", char: "shen_chenghui", mode: "pleasure" });
  });

  it("not first night after a prior encounter", () => {
    const state = createNewGameState(db);
    const a = applyEffects(db, state, [{ type: "bedchamber", char: "shen_chenghui", mode: "pleasure" }]);
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const plan = buildBedchamber(db, a.value, "shen_chenghui", "pleasure");
    expect(plan!.isFirstNight).toBe(false);
  });

  it("pleasure never conceives (no pregnancy effect)", () => {
    const state = createNewGameState(db);
    const plan = buildBedchamber(db, state, "shen_chenghui", "pleasure");
    expect(plan!.conceived).toBe(false);
    expect(plan!.effects.some((e) => e.type === "pregnancy")).toBe(false);
  });

  it("passion conceives iff conception roll hits, adds pregnancy begin", () => {
    const state = createNewGameState(db);
    const plan = buildBedchamber(db, state, "shen_chenghui", "passion");
    // determinism: conceived flag must match effect presence
    expect(plan!.effects.some((e) => e.type === "pregnancy" && (e as any).op === "begin")).toBe(plan!.conceived);
  });

  it("does not roll conception while already pregnant", () => {
    let state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    state = begun.value;
    const plan = buildBedchamber(db, state, "shen_chenghui", "passion");
    expect(plan!.conceived).toBe(false);
    expect(plan!.effects.some((e) => e.type === "pregnancy")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/store/bedchamber.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 bedchamber.ts**

```ts
/**
 * 把一次侍寝组装成（效果批 + 体验台词 + 初夜/受孕标记）供 UI 消费。返回 null
 * 表示对象不是侍君。效果走正常漏斗；台词经对话缝隙重放（与 rankOps 同构）。
 */
import { conceives } from "../engine/characters/conception";
import { DEFAULT_TIERS, type BedchamberThresholds } from "../engine/characters/favorTier";
import { renderSelfRef, resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { BedchamberMode, EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export const DEFAULT_CONCEPTION_CHANCE = 30;

const FALLBACK_SCRIPT: Record<BedchamberMode, string[]> = {
  passion: ["{name}敛衽称是，上前服侍帝王。承欢一夕，陛下只觉神清气爽。"],
  pleasure: ["{name}近前奉茶解乏，一夕清谈相伴，陛下神清气爽。"],
};

export interface BedchamberConfig {
  conceptionChance: number;
  tiers: BedchamberThresholds;
}

export function bedchamberConfig(db: ContentDB): BedchamberConfig {
  return {
    conceptionChance: db.world.bedchamber?.conceptionChance ?? DEFAULT_CONCEPTION_CHANCE,
    tiers: db.world.bedchamber?.tiers ?? DEFAULT_TIERS,
  };
}

export interface BedchamberPlan {
  charId: string;
  effects: EventEffect[];
  lines: string[];
  isFirstNight: boolean;
  conceived: boolean;
}

export function buildBedchamber(
  db: ContentDB,
  state: GameState,
  charId: string,
  mode: BedchamberMode,
): BedchamberPlan | null {
  const character = db.characters[charId];
  const record = state.bedchamber[charId];
  if (!character || character.kind !== "consort" || !record) return null;

  const isFirstNight = record.encounters.length === 0;
  const effects: EventEffect[] = [{ type: "bedchamber", char: charId, mode }];

  const cfg = bedchamberConfig(db);
  const conceived =
    mode === "passion" &&
    state.resources.bloodline.pregnancy.status === "none" &&
    conceives(state.rngSeed, state.calendar.dayIndex, charId, cfg.conceptionChance);
  if (conceived) effects.push({ type: "pregnancy", op: "begin" });

  const standing = state.standing[charId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = resolveDisplayName(character, standing, rank);
  const self = renderSelfRef(rank);
  const raw = db.world.bedchamberScript?.[mode]?.lines ?? FALLBACK_SCRIPT[mode];
  const lines = raw.map((s) => s.replaceAll("{name}", name).replaceAll("{self}", self));

  return { charId, effects, lines, isFirstNight, conceived };
}
```

- [ ] **Step 4: 加 `renderSelfRef` 到 standing.ts**

`buildBedchamber` 用到一个取自称的小工具。在 `src/engine/characters/standing.ts` 末尾加：

```ts
/** 侍君对帝王的主自称（封号/姓氏无关），无位分时退化为「臣」。 */
export function renderSelfRef(rank: CharacterRank | undefined): string {
  return rank?.selfRefs.toPlayer[0] ?? "臣";
}
```

- [ ] **Step 5: 运行测试 + typecheck，确认通过**

Run: `npx vitest run tests/store/bedchamber.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/store/bedchamber.ts src/engine/characters/standing.ts tests/store/bedchamber.test.ts
git commit -m "feat: buildBedchamber store orchestration"
```

---

## Task 11: 侍君卡片显示受宠程度 + 侍寝按钮

**Files:**
- Modify: `src/ui/components/CharacterCard.tsx`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: 改 CharacterCard.tsx**

在 import 区加：

```ts
import { computeFavorStats, FAVOR_TIER_LABEL } from "../../engine/characters/favorTier";
import { bedchamberConfig } from "../../store/bedchamber";
import { toGameTime } from "../../engine/calendar/time";
```

在组件 props 解构加 `onBedchamber`：

```tsx
export function CharacterCard({
  db,
  state,
  registry,
  character,
  onManage,
  onBedchamber,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  character: CharacterContent;
  onManage?: () => void;
  onBedchamber?: () => void;
}) {
```

在 `const portrait = ...` 之后加受宠程度计算：

```tsx
  const favor =
    isConsort
      ? computeFavorStats(state.bedchamber[character.id], toGameTime(state.calendar), bedchamberConfig(db).tiers)
      : null;
```

在 `<p className="char-card__role">...</p>` 之后、`{canManage && ...}` 之前插入受宠程度块（取代恩宠条；恩宠条本就不在卡上，这里是新增展示）：

```tsx
      {favor && (
        <div className="char-card__favor">
          <span className="char-card__favor-tier" data-tier={favor.tier}>
            {FAVOR_TIER_LABEL[favor.tier]}
          </span>
          <span className="char-card__favor-counts">
            侍寝　月{favor.lastMonth}·季{favor.lastThreeMonths}·年{favor.lastYear}
          </span>
        </div>
      )}
```

在 `{canManage && (...)}` 按钮块之后加侍寝按钮（皇后也可侍寝）：

```tsx
      {isConsort && onBedchamber && (
        <button type="button" className="char-card__bedchamber" onClick={onBedchamber}>
          侍寝
        </button>
      )}
```

- [ ] **Step 2: 加样式**

在 `src/ui/styles.css` 末尾加：

```css
.char-card__favor { display: flex; align-items: center; gap: 0.5rem; margin: 0.25rem 0; }
.char-card__favor-tier { font-weight: 700; padding: 0.05rem 0.4rem; border-radius: 0.25rem; background: #3a2233; color: #f3d9e6; }
.char-card__favor-tier[data-tier="abundant"] { background: #7a1f3d; color: #ffe6ef; }
.char-card__favor-tier[data-tier="favored"] { background: #8a3b1f; color: #ffe9d6; }
.char-card__favor-tier[data-tier="small"] { background: #4a4322; color: #f6efcf; }
.char-card__favor-tier[data-tier="fallen"] { background: #333; color: #b9a; }
.char-card__favor-tier[data-tier="none"] { background: #2a2a2a; color: #999; }
.char-card__favor-counts { font-size: 0.8rem; color: #c7b8c0; }
.char-card__bedchamber { margin-top: 0.35rem; }
```

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS（CharacterCard 是 UI，可 import store/engine）。

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/CharacterCard.tsx src/ui/styles.css
git commit -m "feat: 受宠程度 + 侍寝按钮 on character card"
```

---

## Task 12: 侍寝流程 UI 组件（Modal / Scene / Picker / Pregnancy）

**Files:**
- Create: `src/ui/components/BedchamberModal.tsx`
- Create: `src/ui/components/BedchamberPicker.tsx`
- Create: `src/ui/screens/BedchamberScene.tsx`
- Create: `src/ui/components/PregnancyModal.tsx`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: BedchamberModal（选激情/享受）**

新建 `src/ui/components/BedchamberModal.tsx`：

```tsx
/** 侍寝前选「激情/享受」。激情=纳入式（可能受孕）；享受=无受孕。 */
import type { BedchamberMode } from "../../engine/content/schemas";

export function BedchamberModal({
  name,
  onChoose,
  onClose,
}: {
  name: string;
  onChoose: (mode: BedchamberMode) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bedchamber-modal" onClick={(e) => e.stopPropagation()}>
        <h2>召{name}侍寝</h2>
        <p className="bedchamber-modal__hint">择侍寝之法：</p>
        <div className="bedchamber-modal__choices">
          <button type="button" onClick={() => onChoose("passion")}>
            激情<small>　恩泽承嗣，或有孕育之机</small>
          </button>
          <button type="button" onClick={() => onChoose("pleasure")}>
            享受<small>　怡情解乏，不涉子嗣</small>
          </button>
        </div>
        <button type="button" className="bedchamber-modal__close" onClick={onClose}>
          罢了
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: BedchamberPicker（御书房翻牌子）**

新建 `src/ui/components/BedchamberPicker.tsx`：

```tsx
/** 御书房「翻牌子」：列出全部侍君，选一人来御书房侍寝。 */
import { effectiveOrder, resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function BedchamberPicker({
  db,
  state,
  onPick,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  onPick: (charId: string) => void;
  onClose: () => void;
}) {
  const consorts = Object.values(db.characters)
    .filter((c) => c.kind === "consort")
    .sort((a, b) => {
      const ra = state.standing[a.id], rb = state.standing[b.id];
      return (
        effectiveOrder(db.ranks[rb!.rank]!, rb!.title !== undefined) -
        effectiveOrder(db.ranks[ra!.rank]!, ra!.title !== undefined)
      );
    });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bedchamber-picker" onClick={(e) => e.stopPropagation()}>
        <h2>翻牌子</h2>
        <ul className="bedchamber-picker__list">
          {consorts.map((c) => {
            const st = state.standing[c.id]!;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onPick(c.id)}>
                  {resolveDisplayName(c, st, db.ranks[st.rank])}
                  <span className="bedchamber-picker__rank">{db.ranks[st.rank]?.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="bedchamber-picker__close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: BedchamberScene（播放体验台词）**

新建 `src/ui/screens/BedchamberScene.tsx`（基于 ReactionScreen 的多行点击推进模式）：

```tsx
/** 播放模板化侍寝体验台词（经对话缝隙渲染），结束回调 onDone。 */
import { useEffect, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { assembleDialogueRequest, produceDialogueLine } from "../../engine/dialogue/orchestrator";
import { mockProvider } from "../../engine/dialogue/providers/mockProvider";
import type { DialogueLine } from "../../engine/dialogue/types";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function BedchamberScene({
  db,
  store,
  registry,
  speakerId,
  lines,
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  speakerId: string;
  lines: string[];
  onDone: () => void;
}) {
  const state = useGameState(store);
  const [index, setIndex] = useState(0);
  const [line, setLine] = useState<DialogueLine | null>(null);

  useEffect(() => {
    let alive = true;
    const text = lines[index];
    if (text === undefined) return;
    const req = assembleDialogueRequest(db, state, speakerId, state.playerLocation, { text });
    if (!req.ok) {
      onDone();
      return;
    }
    void produceDialogueLine(db, mockProvider, req.value).then((r) => {
      if (alive && r.ok) setLine(r.value);
      else if (alive) onDone();
    });
    return () => {
      alive = false;
    };
  }, [index]); // re-run only on index change

  if (!line) return null;

  const character = db.characters[speakerId];
  const portrait = registry.portrait(character?.portraitSet ?? speakerId, line.expression);
  const location = db.locations[state.playerLocation];
  const background = location
    ? registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background")
    : null;

  const next = () => (index + 1 < lines.length ? setIndex(index + 1) : onDone());

  return (
    <main
      className="dialogue-screen"
      style={background ? { backgroundImage: `url("${background.url}")` } : undefined}
    >
      <img
        className="dialogue-screen__portrait"
        src={portrait.url}
        alt={line.speakerName}
        data-fallback={portrait.isFallback || undefined}
      />
      <section className="dialogue-screen__box" onClick={next}>
        <p className="dialogue-screen__speaker">{line.speakerName}</p>
        <p className="dialogue-screen__line">{line.text}</p>
        <div className="dialogue-screen__choices">
          <button type="button" onClick={next}>
            （继续）
          </button>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 4: PregnancyModal（多选 1–3 生父）**

新建 `src/ui/components/PregnancyModal.tsx`：

```tsx
/** 次月提示：从受孕当月的激情侍寝侍君中挑选 1–3 名生父。 */
import { useState } from "react";
import { resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function PregnancyModal({
  db,
  state,
  candidateIds,
  onConfirm,
}: {
  db: ContentDB;
  state: GameState;
  candidateIds: string[];
  onConfirm: (fatherIds: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 3 ? [...cur, id] : cur,
    );

  return (
    <div className="modal-backdrop">
      <div className="pregnancy-modal" onClick={(e) => e.stopPropagation()}>
        <h2>陛下喜脉初成</h2>
        <p className="pregnancy-modal__hint">
          太医诊得陛下已有身孕。择上月承欢侍君 1–3 人，记为皇嗣之父。
        </p>
        <ul className="pregnancy-modal__list">
          {candidateIds.map((id) => {
            const c = db.characters[id]!;
            const st = state.standing[id];
            return (
              <li key={id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.includes(id)}
                    onChange={() => toggle(id)}
                  />
                  {resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined)}
                </label>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          disabled={picked.length < 1 || picked.length > 3}
          onClick={() => onConfirm(picked)}
        >
          钦定生父（{picked.length}/3）
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 加样式**

在 `src/ui/styles.css` 末尾加：

```css
.bedchamber-modal, .bedchamber-picker, .pregnancy-modal {
  background: #1f1620; color: #f0e6ec; padding: 1.25rem 1.5rem;
  border-radius: 0.5rem; max-width: 28rem; margin: auto;
}
.bedchamber-modal__choices { display: flex; gap: 0.75rem; margin: 0.75rem 0; }
.bedchamber-modal__choices button { flex: 1; padding: 0.6rem; display: flex; flex-direction: column; }
.bedchamber-modal__choices small { color: #c7b8c0; margin-top: 0.25rem; }
.bedchamber-picker__list, .pregnancy-modal__list { list-style: none; padding: 0; margin: 0.5rem 0; max-height: 16rem; overflow-y: auto; }
.bedchamber-picker__list button { width: 100%; text-align: left; display: flex; justify-content: space-between; padding: 0.5rem; }
.bedchamber-picker__rank { color: #c7b8c0; }
.pregnancy-modal__list label { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0; }
```

- [ ] **Step 6: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/ui/components/BedchamberModal.tsx src/ui/components/BedchamberPicker.tsx src/ui/screens/BedchamberScene.tsx src/ui/components/PregnancyModal.tsx src/ui/styles.css
git commit -m "feat: bedchamber + pregnancy UI components"
```

---

## Task 13: LocationScreen 接线（侍寝入口 + 翻牌子 + 怀胎徽标）

**Files:**
- Modify: `src/ui/screens/LocationScreen.tsx`

- [ ] **Step 1: 扩展 props**

把 `LocationScreen` 的 props 加 `onBedchamber` 与 `onFlipTablet`：

```tsx
export function LocationScreen({
  db,
  store,
  registry,
  onOpenMap,
  onOpenSave,
  onStartEvent,
  onManage,
  onBedchamber,
  onFlipTablet,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  onOpenMap: () => void;
  onOpenSave: () => void;
  onStartEvent: (eventId: string) => void;
  onManage?: (charId: string) => void;
  onBedchamber?: (charId: string) => void;
  onFlipTablet?: () => void;
}) {
```

- [ ] **Step 2: 怀胎徽标**

在 `<span className="hud__time">...</span>` 之后、`<span className="hud__group">` 之前加：

```tsx
        {state.resources.bloodline.pregnancy.status === "expecting" && (
          <span className="hud__pregnancy">怀胎</span>
        )}
```

- [ ] **Step 3: 计算是否可侍寝（AP ≥ 1）**

在 `const eligible = getEligibleEvents(...)` 之后加：

```tsx
  const canBedchamber = state.calendar.ap >= 1;
```

- [ ] **Step 4: 御书房翻牌子按钮**

把 `location.id === "yushufang"` 的 `<section className="location-screen__roster">` 块里的 `<h2>后宫名册</h2>` 改为带翻牌子按钮：

```tsx
          <h2>
            后宫名册
            {onFlipTablet && (
              <button
                type="button"
                className="location-screen__flip"
                disabled={!canBedchamber}
                title={canBedchamber ? "翻牌子" : "行动点不足"}
                onClick={onFlipTablet}
              >
                翻牌子{canBedchamber ? "" : "（行动点不足）"}
              </button>
            )}
          </h2>
```

- [ ] **Step 5: 在场侍君卡片透出侍寝入口**

把底部 `present.map((character) => (<CharacterCard ... />))` 改为给 consort 传 `onBedchamber`：

```tsx
          present.map((character) => (
            <CharacterCard
              key={character.id}
              db={db}
              state={state}
              registry={registry}
              character={character}
              onManage={onManage ? () => onManage(character.id) : undefined}
              onBedchamber={
                onBedchamber && character.kind === "consort" && canBedchamber
                  ? () => onBedchamber(character.id)
                  : undefined
              }
            />
          ))
```

- [ ] **Step 6: 样式**

在 `src/ui/styles.css` 末尾加：

```css
.hud__pregnancy { background: #7a1f3d; color: #ffe6ef; padding: 0.1rem 0.5rem; border-radius: 0.25rem; margin-left: 0.5rem; }
.location-screen__flip { margin-left: 0.75rem; font-size: 0.85rem; }
```

- [ ] **Step 7: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS（App 尚未传新 props，但都是可选的，不报错）。

- [ ] **Step 8: Commit**

```bash
git add src/ui/screens/LocationScreen.tsx src/ui/styles.css
git commit -m "feat: 侍寝入口 + 翻牌子 + 怀胎徽标 in LocationScreen"
```

---

## Task 14: App 编排全流程

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: import + 状态**

在 import 区加：

```tsx
import { monthOrdinal } from "../engine/calendar/time";
import { buildBedchamber, type BedchamberPlan } from "../store/bedchamber";
import { BedchamberModal } from "./components/BedchamberModal";
import { BedchamberPicker } from "./components/BedchamberPicker";
import { PregnancyModal } from "./components/PregnancyModal";
import { BedchamberScene } from "./screens/BedchamberScene";
import type { BedchamberMode } from "../engine/content/schemas";
```

在 `const [reaction, setReaction] = useState(...)` 之后加新状态：

```tsx
  // 侍寝流程：选人 → 选模式 → 播放体验 → 提交（→ 初夜晋升）
  const [flipOpen, setFlipOpen] = useState(false);
  const [bedchamberPickId, setBedchamberPickId] = useState<string | null>(null); // 已选人，待选模式
  const [bedchamberRun, setBedchamberRun] = useState<BedchamberPlan | null>(null); // 播放中
  const [firstNightPromptId, setFirstNightPromptId] = useState<string | null>(null);
```

- [ ] **Step 2: 侍寝处理函数**

在 `newGame` 函数定义之后、`return (` 之前加（放在此处确保 `runCheckpoints`/`doAutosave` 已声明）：

```tsx
  const beginBedchamber = (charId: string) => {
    setFlipOpen(false);
    setBedchamberPickId(charId);
  };

  const chooseBedchamberMode = (mode: BedchamberMode) => {
    const charId = bedchamberPickId;
    setBedchamberPickId(null);
    if (!charId) return;
    const plan = buildBedchamber(db, store.getState(), charId, mode);
    if (plan) setBedchamberRun(plan);
  };

  const commitBedchamber = (plan: BedchamberPlan) => {
    setBedchamberRun(null);
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    const spend = store.dispatch({ type: "SPEND_AP", amount: 1 });
    doAutosave();
    // 初夜晋升（皇后已是正宫，跳过）
    if (plan.isFirstNight && plan.charId !== "feng_hou") {
      setFirstNightPromptId(plan.charId);
    } else if (spend.ok && spend.value.rolledOver) {
      runCheckpoints(true);
    }
  };
```

> 注：初夜晋升与翻旬 checkpoint 不会同帧抢占——若有初夜提示先弹晋升；晋升流程结束后玩家自然回到地点，下一次行动前的 pending 拦截（Step 4）会处理跨月孕育提示。翻旬 checkpoint 仅在无初夜提示时立即跑，与旅行一致。

- [ ] **Step 3: 渲染侍寝 UI（在 `{reaction && ...}` 块之后加）**

```tsx
      {flipOpen && (
        <BedchamberPicker
          db={db}
          state={store.getState()}
          onPick={beginBedchamber}
          onClose={() => setFlipOpen(false)}
        />
      )}
      {bedchamberPickId && db.characters[bedchamberPickId] && (
        <BedchamberModal
          name={db.characters[bedchamberPickId]!.profile.name}
          onChoose={chooseBedchamberMode}
          onClose={() => setBedchamberPickId(null)}
        />
      )}
      {bedchamberRun && (
        <BedchamberScene
          db={db}
          store={store}
          registry={registry}
          speakerId={bedchamberRun.charId}
          lines={bedchamberRun.lines}
          onDone={() => commitBedchamber(bedchamberRun)}
        />
      )}
      {firstNightPromptId && (
        <div className="modal-backdrop">
          <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{db.characters[firstNightPromptId]!.profile.name}　初承恩泽</h2>
            <p>是否晋升以彰圣眷？</p>
            <button
              type="button"
              onClick={() => {
                const id = firstNightPromptId;
                setFirstNightPromptId(null);
                setManageCharId(id);
              }}
            >
              晋升
            </button>
            <button type="button" onClick={() => setFirstNightPromptId(null)}>
              暂且不必
            </button>
          </div>
        </div>
      )}
```

- [ ] **Step 4: 孕育拦截（pending 跨月 → PregnancyModal）**

在 `return (` 之前计算拦截，并在所有屏幕之上渲染。先在 `return (` 之前加：

```tsx
  const liveState = store.getState();
  const preg = liveState.resources.bloodline.pregnancy;
  const pregnancyDue =
    preg.status === "pending" &&
    preg.conceivedAt !== undefined &&
    monthOrdinal(liveState.calendar) > monthOrdinal(preg.conceivedAt);
  const fatherCandidates = pregnancyDue
    ? Object.values(db.characters)
        .filter(
          (c) =>
            c.kind === "consort" &&
            (liveState.bedchamber[c.id]?.encounters ?? []).some(
              (e) => e.mode === "passion" && monthOrdinal(e.at) === monthOrdinal(preg.conceivedAt!),
            ),
        )
        .map((c) => c.id)
    : [];

  const confirmPregnancy = (fatherIds: string[]) => {
    const r = store.applyEffects(db, [{ type: "pregnancy", op: "confirm", fatherIds }]);
    if (r.ok) doAutosave();
  };
```

在 JSX 最外层 `<DebugPanel ... />` 之前加（最高优先级、先于其它交互）：

```tsx
      {pregnancyDue && fatherCandidates.length > 0 && (
        <PregnancyModal
          db={db}
          state={liveState}
          candidateIds={fatherCandidates}
          onConfirm={confirmPregnancy}
        />
      )}
```

- [ ] **Step 5: 给 LocationScreen 传新 props**

把 `view === "location"` 的 `<LocationScreen ... />` 加：

```tsx
          onBedchamber={(id) => beginBedchamber(id)}
          onFlipTablet={() => setFlipOpen(true)}
```

- [ ] **Step 6: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: wire bedchamber flow + 初夜晋升 + pregnancy prompt in App"
```

---

## Task 15: 全量验收（DoD）

**Files:** 无（验证）

- [ ] **Step 1: 全套检查**

Run: `npm run typecheck && npm run lint && npm test && npm run validate-content && npm run validate-manifest && npm run build`
Expected: 全绿。

- [ ] **Step 2: 手动冒烟（dev）**

Run: `npm run dev`
手动验证（在浏览器）：
1. 新游戏 → 进咸福宫（沈承徽在场）→ 卡片显示「无宠　侍寝 月0·季0·年0」+「侍寝」按钮。
2. 点侍寝 → 选「享受」→ 播放 2 行体验 → 结束；因是初夜，弹「是否晋升」→ 选晋升打开位分选择器；选位分确认后侍君谢恩。
3. 再次进咸福宫，连续召沈承徽「激情」侍寝至近三月达 3 次 → 卡片转「小宠」。
4. 行动点耗尽自动翻旬，HUD 时间推进。
5. 御书房 → 「翻牌子」→ 列表选一人 → 走同一侍寝流程。
6. 若某月激情受孕，次月第一次进入地点时弹「陛下喜脉初成」→ 勾 1–3 名上月激情侍君 → 钦定 → HUD 出现「怀胎」徽标。

- [ ] **Step 3: 提交手动验收记录（可选）**

```bash
git commit --allow-empty -m "chore: bedchamber + pregnancy manual smoke verified"
```

---

## 自检对照（spec coverage）

- 进宫殿侍寝、耗 1 AP → Task 13/14（侍寝按钮 + SPEND_AP）。
- 受宠程度 5 档 + 次数三段 + 取代恩宠条 → Task 4/11。
- 验收例（一月4/二月3/三月3/四月0）→ Task 4 测试 fixture。
- 失宠（曾达宠爱+ 后空窗）→ Task 4。
- 每次侍寝体验提示 → Task 9/12（模板台词 + BedchamberScene）。
- 御书房翻牌子 → Task 12/13/14（Picker + 入口）。
- 初夜晋升询问 → Task 14。
- 激情/享受 选择 → Task 12/14（BedchamberModal）。
- 激情按概率受孕、概率配置 → Task 5/6/9/10。
- 次月第一次行动前提示 + 选 1–3 生父 → Task 14（pending 跨月拦截 + PregnancyModal）。
- 享受无受孕 → Task 10 测试。
- 帝王状态转怀胎 → Task 7/14（confirm → expecting + 徽标）。
- 存档持久化 → Task 8。

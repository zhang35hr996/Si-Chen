# 物品获取途径（五种）实现计划（Spec B）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为库房系统接入五种物品来源——属地进贡 / 大臣进献 / 秋猎 / 万宝楼 / 醉仙楼，全部复用 Spec A 的 grantItem/spendCoins/bestow。

**Architecture:** 纯逻辑放 `src/store/{tribute,autumnHunt,shop}.ts` 与时间槽辅助；乘风「报告+选择」用声明式 `ChengFengPrompt{speakerId,line,choices:[{label,action}]}`（`src/store/prompt.ts`），由新 `ChengFengPromptScreen` 呈现、App 解释 action；「赏赐」复用从 StorehouseScreen 抽出的 `BestowModal`；商铺为京城板新节点，进店扣 1AP 开 `ShopScreen`。

**Tech Stack:** TypeScript, React, Zod, Vitest。

## Global Constraints

- 复用 Spec A：`grantItem(state,itemId,count?)`、`spendCoins(state,amount)`、`bestow(state,db,itemId,recipient)`、`db.items`（category/tier）。
- 时间槽：一旬=一个行动日 6 槽（卯0/辰1/申2/酉/戌/子）；中午→下午(申/slot2)；属地进贡=上午(辰/slot1)。
- 进贡/进献**不耗 AP**；秋猎参加耗 1AP；进店耗 1AP（店内购买不再额外扣 AP）。
- 动态概率（0–100 属性，每点偏离 50 计 ±0.1%，夹 [3,40]，命中 `gestationRoll(seed)%100 < round(chance)`）：
  - `tributeChance` = clamp(10 + 0.1·((productivity−50)+(publicSupport−50)+(prestige−50)), 3, 40)
  - `ministerTributeChance` = clamp(10 + 0.1·((ministerLoyalty−50)+(corruption−50)+(prestige−50)), 3, 40)
- 商品定价按 tier 区间确定性随机，落 [10,500]：common 10–50 / fine 50–150 / treasure 150–350 / marvel 350–500。
- 货架每次进店随机轮替 6–10 件（`dayIndex+店id+seed` 确定性）。
- 秋猎武力分档：`<40`{兔毛,野雉尾羽} / `40–69`{貂皮,鹿皮,鹿茸} / `≥70`{狐皮,虎皮,银狼皮}；2–3 件；高档 25% 额外掉一件下档。每年一次（flag）。
- 物品池：属地进贡=妆品/香/绸缎/皮毛/文房/乐器/玩器；大臣进献=器玩/珍禽异兽；食物（点心/茶饮/珍味）只在醉仙楼买。
- 确定性随机一律用现成 `gestationRoll(seedKey: string): number`（来自 `src/engine/characters/gestation`）。
- 官职/称谓避用「郎」「卿」等男性向字（本计划文案不涉新称谓）。
- 测试 Vitest：`npx vitest run <path>`；提交前跑全量 `npx vitest run` + `npx tsc --noEmit`。
- **每个任务只 `git add` 自己改的文件**，绝不 `git add -A`（仓库可能有其他并行未跟踪文件）。

---

### Task 1: 时间槽辅助 isMorningSlot / isAfternoonSlot

**Files:**
- Modify: `src/engine/calendar/time.ts`
- Test: `tests/calendar/timeSlots.test.ts`

**Interfaces:**
- Produces: `MORNING_SLOT = 1`, `AFTERNOON_SLOT = 2`; `isMorningSlot(cal: CalendarState): boolean`, `isAfternoonSlot(cal: CalendarState): boolean`（基于现有 `shichenSlot`）。

- [ ] **Step 1: 写失败测试**

新建 `tests/calendar/timeSlots.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createCalendar, isMorningSlot, isAfternoonSlot, MORNING_SLOT, AFTERNOON_SLOT } from "../../src/engine/calendar/time";

describe("时间槽辅助", () => {
  it("上午=辰(slot1)、下午=申(slot2)", () => {
    expect([MORNING_SLOT, AFTERNOON_SLOT]).toEqual([1, 2]);
    const cal = createCalendar({ apMax: 6 }); // ap=6 → slot0
    const morning = { ...cal, ap: 5 }; // slot1
    const afternoon = { ...cal, ap: 4 }; // slot2
    expect(isMorningSlot(morning)).toBe(true);
    expect(isMorningSlot(afternoon)).toBe(false);
    expect(isAfternoonSlot(afternoon)).toBe(true);
    expect(isAfternoonSlot(cal)).toBe(false); // slot0
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/calendar/timeSlots.test.ts`
Expected: FAIL（导出不存在）。

- [ ] **Step 3: 实现**

在 `src/engine/calendar/time.ts` 末尾（`shichenSlot` 已定义）追加：

```ts
/** 触发用时辰槽常量：辰时(上午)=1，申时(下午)=2。 */
export const MORNING_SLOT = 1;
export const AFTERNOON_SLOT = 2;

/** 当前待用行动点是否落在上午(辰时)。 */
export function isMorningSlot(calendar: CalendarState): boolean {
  return shichenSlot(calendar) === MORNING_SLOT;
}

/** 当前待用行动点是否落在下午(申时)。 */
export function isAfternoonSlot(calendar: CalendarState): boolean {
  return shichenSlot(calendar) === AFTERNOON_SLOT;
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/calendar/timeSlots.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/engine/calendar/time.ts tests/calendar/timeSlots.test.ts
git commit -m "feat: 时间槽辅助 isMorningSlot/isAfternoonSlot（辰/申）"
```

---

### Task 2: 声明式乘风提示类型 ChengFengPrompt

**Files:**
- Create: `src/store/prompt.ts`
- Test: `tests/store/prompt.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type PromptAction =
    | { type: "stash"; itemId: string }
    | { type: "gift"; itemId: string }
    | { type: "huntJoin"; year: number }
    | { type: "huntDecline"; year: number };
  interface PromptChoice { label: string; action: PromptAction; }
  interface ChengFengPrompt { speakerId: string; line: string; choices: PromptChoice[]; }
  ```

- [ ] **Step 1: 写失败测试**

新建 `tests/store/prompt.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import type { ChengFengPrompt } from "../../src/store/prompt";
import { isPromptAction } from "../../src/store/prompt";

describe("ChengFengPrompt", () => {
  it("isPromptAction 判别合法 action", () => {
    expect(isPromptAction({ type: "stash", itemId: "x" })).toBe(true);
    expect(isPromptAction({ type: "gift", itemId: "x" })).toBe(true);
    expect(isPromptAction({ type: "huntJoin", year: 1 })).toBe(true);
    expect(isPromptAction({ type: "nope" })).toBe(false);
  });
  it("prompt 结构成型", () => {
    const p: ChengFengPrompt = {
      speakerId: "cheng_feng",
      line: "蜀地进贡了鸳鸯墨。",
      choices: [
        { label: "赏赐", action: { type: "gift", itemId: "yuanyang_mo" } },
        { label: "知道了，收进库房", action: { type: "stash", itemId: "yuanyang_mo" } },
      ],
    };
    expect(p.choices).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/store/prompt.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `src/store/prompt.ts`：

```ts
/** 乘风「报告+选择」的声明式数据；App 解释 action，纯函数不持有回调。 */
export type PromptAction =
  | { type: "stash"; itemId: string }        // 收进库房：grantItem
  | { type: "gift"; itemId: string }         // 赏赐：开选人弹窗 → grantItem+bestow
  | { type: "huntJoin"; year: number }       // 参加秋猎：扣 1AP + 掷皮毛
  | { type: "huntDecline"; year: number };   // 不参加：仅设年度 flag

export interface PromptChoice {
  label: string;
  action: PromptAction;
}

export interface ChengFengPrompt {
  speakerId: string;
  line: string;
  choices: PromptChoice[];
}

export function isPromptAction(x: unknown): x is PromptAction {
  if (typeof x !== "object" || x === null) return false;
  const t = (x as { type?: unknown }).type;
  return t === "stash" || t === "gift" || t === "huntJoin" || t === "huntDecline";
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/store/prompt.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/store/prompt.ts tests/store/prompt.test.ts
git commit -m "feat: 声明式乘风提示类型 ChengFengPrompt"
```

---

### Task 3: 进贡概率 + 物品池 + 报告生成（tribute.ts）

**Files:**
- Create: `src/store/tribute.ts`
- Test: `tests/store/tribute.test.ts`

**Interfaces:**
- Consumes（Task 2）：`ChengFengPrompt`。
- Consumes：`db.items`（category）；`state.officials`、`db.officialPosts`。
- Produces:
  - `tributeChance(state: GameState): number`
  - `ministerTributeChance(state: GameState): number`
  - `buildProvinceTribute(db: ContentDB, state: GameState, seedKey: string): ChengFengPrompt | null`
  - `buildMinisterTribute(db: ContentDB, state: GameState, seedKey: string): ChengFengPrompt | null`

- [ ] **Step 1: 写失败测试**

新建 `tests/store/tribute.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  tributeChance, ministerTributeChance, buildProvinceTribute, buildMinisterTribute,
} from "../../src/store/tribute";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("进贡概率", () => {
  it("中性 50 → 10；高属性更高；夹 [3,40]", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    s.resources.nation.productivity = 50; s.resources.nation.publicSupport = 50; s.resources.sovereign.prestige = 50;
    expect(tributeChance(s)).toBe(10);
    s.resources.nation.productivity = 100; s.resources.nation.publicSupport = 100; s.resources.sovereign.prestige = 100;
    expect(tributeChance(s)).toBe(25); // 10 + 0.1*150
    s.resources.nation.productivity = 0; s.resources.nation.publicSupport = 0; s.resources.sovereign.prestige = 0;
    expect(tributeChance(s)).toBe(3); // clamp floor
  });
  it("大臣进献随 忠心/贪腐/威望", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    s.resources.nation.ministerLoyalty = 50; s.resources.nation.corruption = 50; s.resources.sovereign.prestige = 50;
    expect(ministerTributeChance(s)).toBe(10);
  });
});

describe("进贡报告", () => {
  it("省贡命中时给非食物物品 + 两选项", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    s.resources.nation.productivity = 100; s.resources.nation.publicSupport = 100; s.resources.sovereign.prestige = 100;
    // 用确定性 seed 找一个命中的 key
    let prompt = null;
    for (let i = 0; i < 50 && !prompt; i++) prompt = buildProvinceTribute(db, s, `k${i}`);
    expect(prompt).not.toBeNull();
    expect(prompt!.speakerId).toBe("cheng_feng");
    expect(prompt!.choices.map((c) => c.action.type).sort()).toEqual(["gift", "stash"]);
    const itemId = (prompt!.choices[0]!.action as { itemId: string }).itemId;
    const food = ["点心", "茶饮", "珍味"];
    expect(food).not.toContain(db.items[itemId]!.category);
  });
  it("大臣进献命中具名官员 + 珍宝池；名册空不触发", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    s.resources.nation.ministerLoyalty = 100; s.resources.nation.corruption = 100; s.resources.sovereign.prestige = 100;
    let prompt = null;
    for (let i = 0; i < 50 && !prompt; i++) prompt = buildMinisterTribute(db, s, `m${i}`);
    expect(prompt).not.toBeNull();
    const itemId = (prompt!.choices[0]!.action as { itemId: string }).itemId;
    expect(["器玩", "珍禽异兽"]).toContain(db.items[itemId]!.category);
    const empty = { ...s, officials: {} };
    expect(buildMinisterTribute(db, empty, "m0")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/store/tribute.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `src/store/tribute.ts`：

```ts
/** 属地进贡 / 大臣进献：动态概率 + 物品池 + 乘风报告（声明式选择）。 */
import { gestationRoll } from "../engine/characters/gestation";
import type { ContentDB } from "../engine/content/loader";
import type { GameState } from "../engine/state/types";
import type { ChengFengPrompt } from "./prompt";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** 属地贡物类别（非食物非珍宝）。 */
const PROVINCE_CATEGORIES = ["妆品", "香", "绸缎", "皮毛", "文房", "乐器", "玩器"];
/** 大臣进献珍宝类别。 */
const MINISTER_CATEGORIES = ["器玩", "珍禽异兽"];
/** 属地名（确定性取）。 */
const PROVINCES = ["蜀地", "江南", "岭南", "西域", "闽地", "北地", "海疆", "山东"];

export function tributeChance(state: GameState): number {
  const { productivity, publicSupport } = state.resources.nation;
  const { prestige } = state.resources.sovereign;
  return clamp(Math.round(10 + 0.1 * ((productivity - 50) + (publicSupport - 50) + (prestige - 50))), 3, 40);
}

export function ministerTributeChance(state: GameState): number {
  const { ministerLoyalty, corruption } = state.resources.nation;
  const { prestige } = state.resources.sovereign;
  return clamp(Math.round(10 + 0.1 * ((ministerLoyalty - 50) + (corruption - 50) + (prestige - 50))), 3, 40);
}

function pick<T>(arr: T[], seed: string): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[gestationRoll(seed) % arr.length];
}

function itemsInCategories(db: ContentDB, cats: string[]): string[] {
  return Object.values(db.items).filter((i) => cats.includes(i.category)).map((i) => i.id);
}

function twoChoices(itemId: string): ChengFengPrompt["choices"] {
  return [
    { label: "赏赐", action: { type: "gift", itemId } },
    { label: "知道了，收进库房", action: { type: "stash", itemId } },
  ];
}

export function buildProvinceTribute(db: ContentDB, state: GameState, seedKey: string): ChengFengPrompt | null {
  if (gestationRoll(`prov:gate:${seedKey}`) % 100 >= tributeChance(state)) return null;
  const pool = itemsInCategories(db, PROVINCE_CATEGORIES);
  const itemId = pick(pool, `prov:item:${seedKey}`);
  if (!itemId) return null;
  const province = pick(PROVINCES, `prov:place:${seedKey}`)!;
  const name = db.items[itemId]!.name;
  return {
    speakerId: "cheng_feng",
    line: `陛下，${province}进贡了${name}，是否收进私库？`,
    choices: twoChoices(itemId),
  };
}

export function buildMinisterTribute(db: ContentDB, state: GameState, seedKey: string): ChengFengPrompt | null {
  if (gestationRoll(`min:gate:${seedKey}`) % 100 >= ministerTributeChance(state)) return null;
  const officials = Object.values(state.officials);
  if (officials.length === 0) return null;
  const pool = itemsInCategories(db, MINISTER_CATEGORIES);
  const itemId = pick(pool, `min:item:${seedKey}`);
  if (!itemId) return null;
  const official = officials[gestationRoll(`min:who:${seedKey}`) % officials.length]!;
  const postName = db.officialPosts[official.postId]?.name ?? "大臣";
  const name = db.items[itemId]!.name;
  return {
    speakerId: "cheng_feng",
    line: `陛下，${postName}${official.surname}${official.givenName}进献了${name}，是否收进私库？`,
    choices: twoChoices(itemId),
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/store/tribute.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/store/tribute.ts tests/store/tribute.test.ts
git commit -m "feat: 属地进贡/大臣进献 动态概率 + 物品池 + 报告生成"
```

---

### Task 4: 秋猎逻辑（autumnHunt.ts）

**Files:**
- Create: `src/store/autumnHunt.ts`
- Test: `tests/store/autumnHunt.test.ts`

**Interfaces:**
- Consumes（Task 2）：`ChengFengPrompt`。
- Produces:
  - `huntFurs(martial: number, seedKey: string): string[]`（按武力分档，2–3 件，高档 25% 额外掉下档；返回物品 id 数组）
  - `buildAutumnHuntPrompt(state: GameState, seedKey: string): ChengFengPrompt | null`（9月中旬下午、未问过当年；否则 null）

- [ ] **Step 1: 写失败测试**

新建 `tests/store/autumnHunt.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { huntFurs, buildAutumnHuntPrompt } from "../../src/store/autumnHunt";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const LOW = ["tumao", "yezhiwei"];
const MID = ["diaopi", "lupi", "lurong"];
const HIGH = ["hulipi", "hupi", "yinlangpi"];

describe("秋猎掉落", () => {
  it("低武力只掉低档；数量 2–3", () => {
    const furs = huntFurs(20, "s1");
    expect(furs.length).toBeGreaterThanOrEqual(2);
    expect(furs.length).toBeLessThanOrEqual(3 + 1);
    for (const f of furs) expect(LOW).toContain(f);
  });
  it("高武力掉高档（可含 25% 下档）", () => {
    const furs = huntFurs(90, "s2");
    for (const f of furs) expect([...HIGH, ...MID]).toContain(f);
    expect(furs.some((f) => HIGH.includes(f))).toBe(true);
  });
  it("确定性：同 seed 同结果", () => {
    expect(huntFurs(50, "x")).toEqual(huntFurs(50, "x"));
  });
});

describe("秋猎询问触发", () => {
  it("9月中旬下午未问过 → 出 prompt；否则 null", () => {
    const db = loadRealContent();
    const s = createNewGameState(db);
    const cal = { ...s.calendar, month: 9, period: "mid" as const, ap: s.calendar.apMax - 2 }; // slot2=申
    const s2 = { ...s, calendar: cal };
    const p = buildAutumnHuntPrompt(s2, "h1");
    expect(p).not.toBeNull();
    expect(p!.choices.map((c) => c.action.type).sort()).toEqual(["huntDecline", "huntJoin"]);
    const asked = { ...s2, flags: { ...s2.flags, [`autumnHunt:${cal.year}`]: true } };
    expect(buildAutumnHuntPrompt(asked, "h1")).toBeNull();
    const wrongMonth = { ...s2, calendar: { ...cal, month: 8 } };
    expect(buildAutumnHuntPrompt(wrongMonth, "h1")).toBeNull();
  });
});
```

> **注**：皮毛 id 已与 content/items.json 核对一致：兔毛=`tumao`、野雉尾羽=`yezhiwei`、貂皮=`diaopi`、鹿皮=`lupi`、鹿茸=`lurong`、虎皮=`hupi`、狐皮=`hulipi`、银狼皮=`yinlangpi`。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/store/autumnHunt.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

皮毛 id 已核对（见上注）。新建 `src/store/autumnHunt.ts`：

```ts
/** 秋猎：9月中旬下午年度事件；按武力分档掉皮毛。 */
import { gestationRoll } from "../engine/characters/gestation";
import { AFTERNOON_SLOT } from "../engine/calendar/time";
import { shichenSlot } from "../engine/calendar/time";
import type { GameState } from "../engine/state/types";
import type { ChengFengPrompt } from "./prompt";

const LOW = ["tumao", "yezhiwei"];               // 兔毛 / 野雉尾羽
const MID = ["diaopi", "lupi", "lurong"];        // 貂皮 / 鹿皮 / 鹿茸
const HIGH = ["hulipi", "hupi", "yinlangpi"];    // 狐皮 / 虎皮 / 银狼皮

/** 按武力分档掉 2–3 件皮毛；高档 25% 额外掉一件下档。 */
export function huntFurs(martial: number, seedKey: string): string[] {
  const tier = martial >= 70 ? HIGH : martial >= 40 ? MID : LOW;
  const count = 2 + (gestationRoll(`hunt:n:${seedKey}`) % 2); // 2 或 3
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(tier[gestationRoll(`hunt:${i}:${seedKey}`) % tier.length]!);
  // 高/中档 25% 额外掉一件下一档
  const lower = tier === HIGH ? MID : tier === MID ? LOW : null;
  if (lower && gestationRoll(`hunt:extra:${seedKey}`) % 100 < 25) {
    out.push(lower[gestationRoll(`hunt:el:${seedKey}`) % lower.length]!);
  }
  return out;
}

export function autumnHuntFlagKey(year: number): string {
  return `autumnHunt:${year}`;
}

/** 9月中旬下午、当年未问过 → 询问 prompt；否则 null。 */
export function buildAutumnHuntPrompt(state: GameState, _seedKey: string): ChengFengPrompt | null {
  const cal = state.calendar;
  if (cal.month !== 9 || cal.period !== "mid") return null;
  if (shichenSlot(cal) !== AFTERNOON_SLOT) return null;
  if (state.flags[autumnHuntFlagKey(cal.year)]) return null;
  return {
    speakerId: "cheng_feng",
    line: "陛下，今年的秋猎将至，可要参与？",
    choices: [
      { label: "参加", action: { type: "huntJoin", year: cal.year } },
      { label: "不必了", action: { type: "huntDecline", year: cal.year } },
    ],
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/store/autumnHunt.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/store/autumnHunt.ts tests/store/autumnHunt.test.ts
git commit -m "feat: 秋猎掉落（武力分档）+ 年度询问 prompt"
```

---

### Task 5: 商铺纯函数 priceOf + 货架轮替（shop.ts）

**Files:**
- Create: `src/store/shop.ts`
- Test: `tests/store/shop.test.ts`

**Interfaces:**
- Consumes：`db.items`（category/tier）。
- Produces:
  - `priceOf(item: ItemDef, seedKey: string): number`（按 tier 区间确定性随机，∈[10,500]）
  - `shopShelf(db: ContentDB, shopId: "wanbaolou" | "zuixianlou", dayIndex: number, seed: number): string[]`（6–10 件 id，确定性）

- [ ] **Step 1: 写失败测试**

新建 `tests/store/shop.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { priceOf, shopShelf } from "../../src/store/shop";
import { loadRealContent } from "../helpers/contentFixture";

describe("商铺定价", () => {
  it("按 tier 落区间且 ∈[10,500]", () => {
    const db = loadRealContent();
    const ranges: Record<string, [number, number]> = {
      common: [10, 50], fine: [50, 150], treasure: [150, 350], marvel: [350, 500],
    };
    for (const item of Object.values(db.items)) {
      const p = priceOf(item, "s");
      const [lo, hi] = ranges[item.tier]!;
      expect(p).toBeGreaterThanOrEqual(lo);
      expect(p).toBeLessThanOrEqual(hi);
      expect(p).toBeGreaterThanOrEqual(10);
      expect(p).toBeLessThanOrEqual(500);
    }
  });
  it("priceOf 确定性", () => {
    const db = loadRealContent();
    const item = Object.values(db.items)[0]!;
    expect(priceOf(item, "k")).toBe(priceOf(item, "k"));
  });
});

describe("货架轮替", () => {
  it("万宝楼只上非食物；6–10 件；同旬稳定，跨旬变化", () => {
    const db = loadRealContent();
    const food = ["点心", "茶饮", "珍味"];
    const shelf = shopShelf(db, "wanbaolou", 100, 1);
    expect(shelf.length).toBeGreaterThanOrEqual(6);
    expect(shelf.length).toBeLessThanOrEqual(10);
    for (const id of shelf) expect(food).not.toContain(db.items[id]!.category);
    expect(shopShelf(db, "wanbaolou", 100, 1)).toEqual(shelf); // 同参数稳定
    expect(shopShelf(db, "wanbaolou", 101, 1)).not.toEqual(shelf); // 跨旬变化（极大概率）
  });
  it("醉仙楼只上食物", () => {
    const db = loadRealContent();
    const food = ["点心", "茶饮", "珍味"];
    for (const id of shopShelf(db, "zuixianlou", 100, 1)) expect(food).toContain(db.items[id]!.category);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/store/shop.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

新建 `src/store/shop.ts`：

```ts
/** 京城商铺：按品阶定价 + 货架确定性轮替。 */
import { gestationRoll } from "../engine/characters/gestation";
import type { ContentDB } from "../engine/content/loader";
import type { ItemDef } from "../engine/content/schemas";

const TIER_RANGE: Record<ItemDef["tier"], [number, number]> = {
  common: [10, 50], fine: [50, 150], treasure: [150, 350], marvel: [350, 500],
};

export type ShopId = "wanbaolou" | "zuixianlou";
const FOOD = ["点心", "茶饮", "珍味"];

/** 区间内确定性随机定价。 */
export function priceOf(item: ItemDef, seedKey: string): number {
  const [lo, hi] = TIER_RANGE[item.tier];
  return lo + (gestationRoll(`price:${item.id}:${seedKey}`) % (hi - lo + 1));
}

function shopPool(db: ContentDB, shopId: ShopId): string[] {
  return Object.values(db.items)
    .filter((i) => (shopId === "zuixianlou" ? FOOD.includes(i.category) : !FOOD.includes(i.category)))
    .map((i) => i.id)
    .sort(); // 稳定基序
}

/** 6–10 件确定性抽样（dayIndex+shopId+seed）。 */
export function shopShelf(db: ContentDB, shopId: ShopId, dayIndex: number, seed: number): string[] {
  const pool = shopPool(db, shopId);
  if (pool.length === 0) return [];
  const base = `shelf:${shopId}:${dayIndex}:${seed}`;
  const size = Math.min(pool.length, 6 + (gestationRoll(`${base}:n`) % 5)); // 6–10
  // 确定性洗牌取前 size
  const idx = pool.map((id, i) => ({ id, r: gestationRoll(`${base}:${i}`) })).sort((a, b) => a.r - b.r);
  return idx.slice(0, size).map((x) => x.id);
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/store/shop.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/store/shop.ts tests/store/shop.test.ts
git commit -m "feat: 商铺品阶定价 priceOf + 货架确定性轮替 shopShelf"
```

---

### Task 6: GameStore 写入方法（grantItem / buyItem / autumnHunt / giftTribute）

**Files:**
- Modify: `src/store/gameStore.ts`
- Test: `tests/store/gameStoreAcquisition.test.ts`

**Interfaces:**
- Consumes（Spec A）：`grantItem`、`spendCoins`、`bestow`（treasury.ts）；`huntFurs`（Task 4）。
- Produces（GameStore 方法，均直接 set state + emit，参照既有 `applyBestow`/`setEraName`）：
  - `applyGrantItem(itemId: string, count?: number): void`
  - `buyItem(itemId: string, price: number): boolean`（钱不足返回 false 不改 state）
  - `applyAutumnHunt(seedKey: string): string[]`（按当前武力掷皮毛入库 + 设年度 flag；返回所得 id）
  - `declineAutumnHunt(): void`（仅设年度 flag）
  - `giftTribute(db: ContentDB, itemId: string, recipient: { kind: "consort" | "heir"; id: string }): boolean`（grantItem 后 bestow；失败返回 false）

- [ ] **Step 1: 写失败测试**

新建 `tests/store/gameStoreAcquisition.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { loadRealContent } from "../helpers/contentFixture";

function newStore() {
  const db = loadRealContent();
  const store = new GameStore();
  store.newGame(db);
  return { db, store };
}

describe("GameStore 获取方法", () => {
  it("applyGrantItem 入库", () => {
    const { store } = newStore();
    store.applyGrantItem("luozidai", 2);
    expect(store.getState().resources.storehouse.items["luozidai"]).toBeGreaterThanOrEqual(2);
  });
  it("buyItem 足额成功扣钱入库；不足失败", () => {
    const { store } = newStore();
    const before = store.getState().resources.nation.treasury;
    expect(store.buyItem("yunjin", 100)).toBe(true);
    expect(store.getState().resources.nation.treasury).toBe(before - 100);
    expect(store.buyItem("yunjin", 9_999_999)).toBe(false);
  });
  it("applyAutumnHunt 掷皮毛入库 + 设 flag；declineAutumnHunt 只设 flag", () => {
    const { store } = newStore();
    store.getState(); // martial 默认 50 → MID 档
    const got = store.applyAutumnHunt("h");
    expect(got.length).toBeGreaterThanOrEqual(2);
    const year = store.getState().calendar.year;
    expect(store.getState().flags[`autumnHunt:${year}`]).toBe(true);
  });
  it("giftTribute：库存净不变、目标 favor 升", () => {
    const { db, store } = newStore();
    const consort = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    const favor0 = store.getState().standing[consort.id]!.favor;
    const ok = store.giftTribute(db, "luozidai", { kind: "consort", id: consort.id });
    expect(ok).toBe(true);
    expect(store.getState().standing[consort.id]!.favor).toBeGreaterThan(favor0);
    expect(store.getState().resources.storehouse.items["luozidai"] ?? 0).toBe(0); // grant 后 bestow 扣回
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/store/gameStoreAcquisition.test.ts`
Expected: FAIL（方法不存在）。

- [ ] **Step 3: 实现**

在 `src/store/gameStore.ts` 顶部 import 增补：

```ts
import { grantItem, spendCoins, bestow, type RecipientKind } from "./treasury";
import { huntFurs, autumnHuntFlagKey } from "./autumnHunt";
```

（若 `ContentDB` 尚未 import，按文件既有方式补 `import type { ContentDB } from "../engine/content/loader";`。）

在 `GameStore` 类内、`applyBestow` 附近加方法（沿用 `this.state = ...; this.emit();`，`emit` 用文件里实际的私有通知方法名）：

```ts
applyGrantItem(itemId: string, count = 1): void {
  this.state = grantItem(this.state, itemId, count);
  this.emit();
}

buyItem(itemId: string, price: number): boolean {
  const paid = spendCoins(this.state, price);
  if (!paid.ok) return false;
  this.state = grantItem(paid.state, itemId, 1);
  this.emit();
  return true;
}

applyAutumnHunt(seedKey: string): string[] {
  const furs = huntFurs(this.state.resources.sovereign.martial, seedKey);
  let next = this.state;
  for (const id of furs) next = grantItem(next, id, 1);
  next = { ...next, flags: { ...next.flags, [autumnHuntFlagKey(next.calendar.year)]: true } };
  this.state = next;
  this.emit();
  return furs;
}

declineAutumnHunt(): void {
  const year = this.state.calendar.year;
  this.state = { ...this.state, flags: { ...this.state.flags, [autumnHuntFlagKey(year)]: true } };
  this.emit();
}

giftTribute(db: ContentDB, itemId: string, recipient: { kind: RecipientKind; id: string }): boolean {
  const granted = grantItem(this.state, itemId, 1);
  const result = bestow(granted, db, itemId, recipient);
  if (!result.ok) return false;
  this.state = result.state;
  this.emit();
  return true;
}
```

> 确认 `emit` 是文件里实际的通知方法名（`setEraName` 用的那个）。若是别名（如 `this.notify()`），统一替换。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/store/gameStoreAcquisition.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/store/gameStore.ts tests/store/gameStoreAcquisition.test.ts
git commit -m "feat: GameStore 获取/采买/秋猎/进贡赏赐 写入方法"
```

---

### Task 7: 抽出可复用 BestowModal（重构 StorehouseScreen）

**Files:**
- Create: `src/ui/components/BestowModal.tsx`
- Modify: `src/ui/screens/StorehouseScreen.tsx`
- Test: `tests/ui/storehouseFormat.test.ts`（更新 import，若 bestowTargets 移动）

**Interfaces:**
- Produces: `BestowModal` 组件 `{ db, store, itemId, onClose, onConfirmed? }`，内部含 3-tab 选人 + 确认（调用 `store.applyBestow(db, itemId, recipient)`，确认后 `onClose`/`onConfirmed`）。`bestowTargets`/`BestowTarget` 移到本组件并 re-export 给 StorehouseScreen 测试。
- Consumes（Spec A）：`store.applyBestow`、`resolveDisplayName`。

- [ ] **Step 1: 写测试（纯函数 bestowTargets 仍可测）**

更新/确认 `tests/ui/storehouseFormat.test.ts` 从新位置导入 `bestowTargets`：

```ts
import { bestowTargets } from "../../src/ui/components/BestowModal";
```

（`formatCoins` 仍从 `src/ui/format` 导入。）保留原断言：`bestowTargets(db, state)` 含 consorts、clan 为空。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ui/storehouseFormat.test.ts`
Expected: FAIL（新路径无导出）。

- [ ] **Step 3: 抽出 BestowModal**

把 `StorehouseScreen.tsx` 里的 `bestowTargets`、`BestowTarget`、3-tab 选人弹窗组件整体移到新文件 `src/ui/components/BestowModal.tsx`，导出 `bestowTargets`、`BestowTarget`、`BestowModal`。`BestowModal` props：

```tsx
export function BestowModal({ db, store, itemId, onClose, onConfirmed }: {
  db: ContentDB; store: GameStore; itemId: string;
  onClose: () => void; onConfirmed?: () => void;
}) { /* 3-tab 选人 + 确认调用 store.applyBestow(db, itemId, recipient)，成功后 onConfirmed?.(); onClose(); */ }
```

`StorehouseScreen.tsx` 改为 import 并使用 `BestowModal`（删除内联弹窗与 bestowTargets 定义，保留库房列表/铜钱）。其「赏赐」按钮打开 `<BestowModal itemId={rewardItem} ... />`。

- [ ] **Step 4: 运行测试 + tsc**

Run: `npx vitest run tests/ui/storehouseFormat.test.ts`
Expected: PASS。
Run: `npx tsc --noEmit`
Expected: 干净。

- [ ] **Step 5: 提交**

```bash
git add src/ui/components/BestowModal.tsx src/ui/screens/StorehouseScreen.tsx tests/ui/storehouseFormat.test.ts
git commit -m "refactor: 抽出可复用 BestowModal（库房与进贡共用选人弹窗）"
```

---

### Task 8: ChengFengPromptScreen（乘风提示+选择 UI）

**Files:**
- Create: `src/ui/screens/ChengFengPromptScreen.tsx`
- Modify: `src/ui/styles.css`
- Test: 无新单测（UI；纯展示）。tsc 验证。

**Interfaces:**
- Consumes（Task 2）：`ChengFengPrompt`、`PromptChoice`。
- Produces: `ChengFengPromptScreen` 组件 `{ registry, db, store, prompt, onChoose }`，渲染乘风立绘 + line + 每个 choice 一枚按钮，点击回调 `onChoose(action)`。

- [ ] **Step 1: 实现组件**

新建 `src/ui/screens/ChengFengPromptScreen.tsx`（参照 `ReactionScreen` 的立绘/背景，但用 prompt.line 原文、渲染 choices 按钮，不走 dialogue orchestrator）：

```tsx
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import type { ChengFengPrompt, PromptAction } from "../../store/prompt";

export function ChengFengPromptScreen({ registry, db, store, prompt, onChoose }: {
  registry: AssetRegistry; db: ContentDB; store: GameStore;
  prompt: ChengFengPrompt; onChoose: (action: PromptAction) => void;
}) {
  const state = useGameState(store);
  const character = db.characters[prompt.speakerId];
  const portrait = registry.portrait(character?.portraitSet ?? prompt.speakerId, "neutral");
  const location = db.locations[state.playerLocation];
  const bg = location?.backgroundKey
    ? registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background")
    : null;
  return (
    <main className="dialogue-screen" style={bg ? { backgroundImage: `url("${bg.url}")` } : undefined}>
      <img className="dialogue-screen__portrait" src={portrait.url} alt={character?.profile.name ?? "乘风"}
           data-fallback={portrait.isFallback || undefined} />
      <section className="dialogue-screen__box">
        <p className="dialogue-screen__speaker">{character?.profile.name ?? "乘风"}</p>
        <p className="dialogue-screen__line">{prompt.line}</p>
        <div className="dialogue-screen__choices">
          {prompt.choices.map((c, i) => (
            <button key={i} type="button" onClick={() => onChoose(c.action)}>{c.label}</button>
          ))}
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: 样式（可选微调）**

若 `.dialogue-screen__choices button` 已有样式则无需新增；否则在 `src/ui/styles.css` 复用既有选择样式确保多按钮排版正常。

- [ ] **Step 3: tsc 验证**

Run: `npx tsc --noEmit`
Expected: 干净。

- [ ] **Step 4: 提交**

```bash
git add src/ui/screens/ChengFengPromptScreen.tsx src/ui/styles.css
git commit -m "feat: ChengFengPromptScreen 乘风提示+选择 UI"
```

---

### Task 9: App 接线——进贡/秋猎 per-AP 触发 + prompt 解释

**Files:**
- Modify: `src/ui/App.tsx`
- Test: 无新单测（接线）；tsc + 全量 vitest 验证。

**Interfaces:**
- Consumes：`buildProvinceTribute`/`buildMinisterTribute`（Task 3）、`buildAutumnHuntPrompt`（Task 4）、`ChengFengPromptScreen`（Task 8）、`BestowModal`（Task 7）、GameStore 方法（Task 6）、`MORNING_SLOT`/`AFTERNOON_SLOT`（Task 1）。

- [ ] **Step 1: 加 prompt 状态 + 解释器**

在 `App.tsx`：
1. import：

```tsx
import { buildProvinceTribute, buildMinisterTribute } from "../store/tribute";
import { buildAutumnHuntPrompt } from "../store/autumnHunt";
import { ChengFengPromptScreen } from "./screens/ChengFengPromptScreen";
import { BestowModal } from "./components/BestowModal";
import { MORNING_SLOT, AFTERNOON_SLOT } from "../engine/calendar/time";
import type { ChengFengPrompt, PromptAction } from "../store/prompt";
```

2. 状态：

```tsx
const [prompt, setPrompt] = useState<ChengFengPrompt | null>(null);
const [giftItemId, setGiftItemId] = useState<string | null>(null);
```

3. action 解释器：

```tsx
const resolvePromptAction = (action: PromptAction) => {
  switch (action.type) {
    case "stash": store.applyGrantItem(action.itemId); setPrompt(null); break;
    case "gift": setGiftItemId(action.itemId); setPrompt(null); break; // 开 BestowModal
    case "huntJoin": store.applyAutumnHunt(`hunt:${store.getState().rngSeed}:${store.getState().calendar.year}`); setPrompt(null); break;
    case "huntDecline": store.declineAutumnHunt(); setPrompt(null); break;
  }
};
```

- [ ] **Step 2: per-AP 掷进贡（先于 gossip）**

在 `rollChengFeng` 之前加 `rollTribute`，并在 `spendAp` 里**先掷 tribute，命中则不再掷 gossip**。`rollTribute` 返回是否已弹出 prompt：

```tsx
const rollTribute = (before: { apMax: number; ap: number; dayIndex: number }, amount: number): boolean => {
  for (let i = 0; i < amount; i++) {
    const slot = before.apMax - before.ap + i;
    const key = `tribute:${store.getState().rngSeed}:${before.dayIndex}:${slot}`;
    if (rolledSlots.current.has(key)) continue;
    let p: ChengFengPrompt | null = null;
    if (slot === MORNING_SLOT) p = buildProvinceTribute(db, store.getState(), key);
    else if (slot === AFTERNOON_SLOT) {
      const dedupe = `tributeMinister:${before.dayIndex}`;
      if (!store.getState().flags[dedupe]) {
        p = buildMinisterTribute(db, store.getState(), key);
        if (p) store.dispatch({ type: "SET_FLAG", key: dedupe, value: true });
      }
    }
    if (p) { rolledSlots.current.add(key); setPrompt(p); return true; }
  }
  return false;
};
```

在 `spendAp` 里把乘风一段改为：

```tsx
if (spend.ok) {
  const tributeShown = rollTribute(before, amount);
  if (!tributeShown) decreeBeats = [...decreeBeats, ...rollChengFeng(before, amount)];
}
```

> 注：tribute 以独立全屏 prompt 呈现（非 beat 队列）。若同一行动同时有懿旨 beats 与 tribute prompt，先播 beats（既有 playReactions），tribute prompt 由其 `prompt` 状态在 beats 播完后再渲染——若实现冲突，最简策略：tribute 命中时仍正常返回 decreeBeats 给 playReactions，prompt 在 `reaction` 队列清空后展示（用 `view`/条件渲染优先级）。实现者按 App 现有 reaction 流选择最简不冲突的接法，并在报告里说明所选接法。

- [ ] **Step 3: 秋猎检查（进御书房/主地图时）**

在玩家进入主地图（goHome / map）或御书房后，检查一次：

```tsx
const maybeAutumnHunt = () => {
  const p = buildAutumnHuntPrompt(store.getState(), `hunt:${store.getState().rngSeed}`);
  if (p) { setPrompt(p); return true; }
  return false;
};
```

挂到回到主地图/进御书房的时机（与既有 `maybeShizhi` 同类位置）。

- [ ] **Step 4: 渲染 prompt 与 gift 弹窗**

在 App 渲染区加（置于较高优先级，prompt 存在时盖住当前 view）：

```tsx
{prompt && (
  <ChengFengPromptScreen registry={registry} db={db} store={store} prompt={prompt} onChoose={resolvePromptAction} />
)}
{giftItemId && (
  <BestowModal db={db} store={store} itemId={giftItemId}
    onClose={() => setGiftItemId(null)} onConfirmed={() => setGiftItemId(null)} />
)}
```

- [ ] **Step 5: tsc + 全量回归 + 构建**

Run: `npx tsc --noEmit` → 干净。
Run: `npx vitest run` → 全绿。
Run: `npm run build`（若有）→ 成功。

- [ ] **Step 6: 提交**

```bash
git add src/ui/App.tsx
git commit -m "feat: 进贡/大臣进献 per-AP 触发 + 秋猎询问 + prompt 解释接线"
```

---

### Task 10: 京城新地点 + 背景 manifest（万宝楼 / 醉仙楼）

**Files:**
- Create: `content/locations/wanbaolou.json`, `content/locations/zuixianlou.json`
- Modify: `assets/manifest.json`
- Test: 复用 `tests/assets/manifestCheck.test.ts`（应仍 0 错误）+ `tests/content/boot.test.ts`。

**Interfaces:**
- Produces: 两座 `zone: "jingcheng"` 地点；`bg.wanbaolou`/`bg.zuixianlou` manifest 条目（PNG 已在 `public/assets/backgrounds/`）。

- [ ] **Step 1: 建地点文件**

参照 `content/locations/simiao.json` 结构。新建 `content/locations/wanbaolou.json`：

```json
{
  "id": "wanbaolou",
  "name": "万宝楼",
  "description": "京城东市最负盛名的珍宝阁，珠翠绫罗、文玩奇珍琳琅满目，掌柜见来客气度不凡，含笑相迎。",
  "backgroundKey": "bg.wanbaolou",
  "ambience": ["市声", "算盘", "茶香"],
  "position": { "x": 0.35, "y": 0.55 },
  "zone": "jingcheng",
  "entry": "free"
}
```

新建 `content/locations/zuixianlou.json`：

```json
{
  "id": "zuixianlou",
  "name": "醉仙楼",
  "description": "京城最热闹的酒楼，楼上雅座临街，糕点茶饮、南北珍味样样齐全，小二吆喝声不绝于耳。",
  "backgroundKey": "bg.zuixianlou",
  "ambience": ["喧笑", "酒令", "饭菜香"],
  "position": { "x": 0.62, "y": 0.55 },
  "zone": "jingcheng",
  "entry": "free"
}
```

> `entry: "free"` 仅表示点击不走「旅行不可达」校验；进店扣 1AP 在 Task 11 的 map 接线里显式处理。

- [ ] **Step 2: 加 manifest 背景条目**

在 `assets/manifest.json` 的 `entries` 里加两行（路径对应已提交的 PNG）：

```json
"bg.wanbaolou": { "path": "backgrounds/wanbaolou.png", "kind": "background", "placeholder": false },
"bg.zuixianlou": { "path": "backgrounds/zuixianlou.png", "kind": "background", "placeholder": false }
```

- [ ] **Step 3: 运行内容/清单测试**

Run: `npx vitest run tests/assets/manifestCheck.test.ts tests/content/boot.test.ts`
Expected: PASS（real manifest + complete disk + real content = 0 错误；含新地点背景）。

> 若清单测试报「path missing on disk」，确认 `public/assets/backgrounds/wanbaolou.png`、`zuixianlou.png` 存在（已提交）。`manifest.json` 的 path 相对根；与 simiao 等现有条目写法一致即可。

- [ ] **Step 4: 提交**

```bash
git add content/locations/wanbaolou.json content/locations/zuixianlou.json assets/manifest.json
git commit -m "feat: 京城新增万宝楼/醉仙楼地点 + 背景 manifest 注册"
```

---

### Task 11: ShopScreen（货架 + 购买）

**Files:**
- Create: `src/ui/screens/ShopScreen.tsx`
- Modify: `src/ui/styles.css`
- Test: 无新单测（纯函数已在 Task 5 测）；tsc 验证。

**Interfaces:**
- Consumes：`shopShelf`/`priceOf`（Task 5）、`store.buyItem`（Task 6）、`formatCoins`（`src/ui/format`）、`db.items`。
- Produces: `ShopScreen` 组件 `{ db, store, registry, shopId, onClose }`。

- [ ] **Step 1: 实现组件**

新建 `src/ui/screens/ShopScreen.tsx`（复用库房屏风格）：

```tsx
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { shopShelf, priceOf, type ShopId } from "../../store/shop";
import { formatCoins } from "../format";

export function ShopScreen({ db, store, registry, shopId, onClose }: {
  db: ContentDB; store: GameStore; registry: AssetRegistry; shopId: ShopId; onClose: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations[shopId];
  const bg = location?.backgroundKey
    ? registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background")
    : null;
  const shelf = shopShelf(db, shopId, state.calendar.dayIndex, state.rngSeed);
  const coins = state.resources.nation.treasury;
  return (
    <main className="shop-screen" style={bg ? { backgroundImage: `url("${bg.url}")` } : undefined}>
      <header className="hud">
        <span className="hud__time">{location?.name} · 铜钱：{formatCoins(coins)} 两</span>
        <button type="button" className="hud__button" onClick={onClose}>返回</button>
      </header>
      <section className="shop-screen__shelf">
        {shelf.map((id) => {
          const item = db.items[id]!;
          const price = priceOf(item, `${shopId}:${state.calendar.dayIndex}`);
          const affordable = coins >= price;
          return (
            <div key={id} className="shop-screen__row">
              <span className="shop-screen__name">{item.name}</span>
              <span className="shop-screen__price">{formatCoins(price)} 两</span>
              <button type="button" disabled={!affordable} onClick={() => store.buyItem(id, price)}>购买</button>
            </div>
          );
        })}
      </section>
    </main>
  );
}
```

> `priceOf` 的 seedKey 用 `${shopId}:${dayIndex}`，保证同店同旬价格稳定且与货架同周期轮换。

- [ ] **Step 2: 样式**

`src/ui/styles.css` 加 `.shop-screen`, `.shop-screen__shelf`, `.shop-screen__row`, `.shop-screen__name`, `.shop-screen__price`（参照 `.storehouse` 风格，深色宫廷色板）。

- [ ] **Step 3: tsc 验证**

Run: `npx tsc --noEmit`
Expected: 干净。

- [ ] **Step 4: 提交**

```bash
git add src/ui/screens/ShopScreen.tsx src/ui/styles.css
git commit -m "feat: ShopScreen 京城商铺（货架轮替 + 购买）"
```

---

### Task 12: 商铺地图接线（进店扣 1AP → ShopScreen）

**Files:**
- Modify: `src/ui/App.tsx`
- Modify: `src/ui/screens/MapScreen.tsx`
- Test: tsc + 全量 vitest + 手动验证。

**Interfaces:**
- Consumes：`ShopScreen`（Task 11）、地点 `wanbaolou`/`zuixianlou`（Task 10）。

- [ ] **Step 1: View 与渲染**

`App.tsx`：
1. `type View` 加 `"shop"`；`import { ShopScreen } from "./screens/ShopScreen";`
2. 状态 `const [shopId, setShopId] = useState<"wanbaolou" | "zuixianlou" | null>(null);`
3. 渲染：

```tsx
{view === "shop" && shopId && (
  <ShopScreen db={db} store={store} registry={registry} shopId={shopId}
    onClose={() => { setShopId(null); setView("map"); }} />
)}
```

- [ ] **Step 2: 进店扣 AP 入口**

`App.tsx` 加处理（进店扣 1AP，不足则不进；扣点复用 spendAp 以触发既有结算）：

```tsx
const enterShop = (id: "wanbaolou" | "zuixianlou") => {
  if (store.getState().calendar.ap < 1) return;
  const { spend, decreeBeats } = spendAp(1);
  if (!spend.ok) return;
  setShopId(id); setView("shop");
  // 进店当点的乘风/懿旨 beats 照常串播（若有），不阻塞进店
  playReactions(decreeBeats, spend.value.rolledOver);
};
```

> 若 `playReactions` 会切走 view，调整顺序：先 `setShopId/​setView`，beats 播完返回后仍在 shop。实现者按 App 现有流择最简接法，报告里说明。

`MapScreen.tsx`：在 `onNodeActivate` 对两座商铺特判，调用透传的 `onEnterShop`：

```tsx
if (loc.id === "wanbaolou" || loc.id === "zuixianlou") { onEnterShop(loc.id); return; }
```

MapScreen props 加 `onEnterShop: (id: "wanbaolou" | "zuixianlou") => void;`，App 传 `onEnterShop={enterShop}`。

- [ ] **Step 3: tsc + 全量回归 + 构建**

Run: `npx tsc --noEmit` → 干净。
Run: `npx vitest run` → 全绿。
Run: `npm run build`（若有）→ 成功。

- [ ] **Step 4: 手动验证**

出宫 → 京城 → 点万宝楼（扣 1AP）→ 货架显示 6–10 件带价格 → 买一件（铜钱减、入库）→ 返回。醉仙楼同理只有食物。

- [ ] **Step 5: 提交**

```bash
git add src/ui/App.tsx src/ui/screens/MapScreen.tsx
git commit -m "feat: 京城商铺地图接线（进店扣 1AP → ShopScreen）"
```

---

## Self-Review

**Spec coverage:**
- 时间槽辅助 §1 → Task 1。
- 动态概率 + 进贡/进献报告 §2 → Task 3（+ prompt 类型 Task 2）。
- 秋猎 §3 → Task 4 + 接线 Task 9。
- 京城商铺 §4（定价/货架/地点/背景/购买）→ Task 5/10/11/12。
- prompt 交互 + 赏赐复用 §2/§6 → Task 2/6/7/8/9。
- 测试 §7 → 各任务内置（纯逻辑均有单测；UI 接线靠 tsc + 全量回归 + 手动）。

**已知实现期决策（已在步骤标注）：** ① Task 9 tribute prompt 与 beats 队列的呈现先后；② Task 12 enterShop 与 playReactions 的顺序；③ Task 4 皮毛真实 id 对齐；④ `emit` 私有方法实名。

**类型一致：** `ChengFengPrompt`/`PromptAction`（Task 2）在 3/4/8/9 一致引用；`ShopId`（Task 5）在 11/12 一致；GameStore 方法签名（Task 6）在 9/11/12 一致。

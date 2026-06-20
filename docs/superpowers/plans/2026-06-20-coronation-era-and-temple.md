# 登基年号 + 郊外寺庙 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 (1) 新游戏登基开场 + 年号（贯穿时间显示）；(2) 郊外寺庙地点及上香/求签两个动作。

**Architecture:** 年号存进 `CalendarState.eraName`，使 `formatGameTime(calendar)` 在所有显示处自动带年号（零 prop 透传）；登基为 `App` 在 `newGame()` 后插入的 `CoronationScreen` 视图，确认后写年号再进游戏。寺庙是 `jingjiao` 区一个新地点，两动作为 `store/temple.ts` 的确定性纯函数，`App` 用既有 `spendAp`+`playReactions` 串接。

**Tech Stack:** React 18, TypeScript, Vite, Zod, Vitest。

## Global Constraints

- 发布前，存档不做向后兼容迁移。
- 年号：输入**恰好 2 个中文字**（正则 `/^[一-鿿]{2}$/`）；显示 `第1年→{年号}元年`、`第2年起→{年号}{中文数字}年`；年号为空时退回原行为（`元年`/`X年`）。
- 登基封赏为**纯叙事文案**，不改任何游戏状态。
- 寺庙两动作各消耗 **1 行动点**。
- funnel `AXIS_CAP = 10`：单条资源轴每批增量被钳到 ±10，故所有寺庙 delta 量级 ≤ 10。
- 求签整体偏正：吉类净收益 > 凶类净损失。
- 属性字段：民心=`nation.publicSupport`，威望=`sovereign.prestige`，健康=`sovereign.health`，生产力=`nation.productivity`，谣言=`nation.rumor`，宗室不满=`nation.clanDiscontent`，国库=`nation.treasury`。
- 确定性随机用 `gestationRoll(seedString): number`（`src/engine/characters/gestation.ts`，返回 0–99）。
- 反应台词讲述者 `speakerId: "wei_sui"`（已有立绘 `portrait.wei_sui.neutral`）。
- 命令：`npm test`、`npm run typecheck`、`npm run validate-content`、`npm run validate-manifest`。
- 工作区有用户并行的未提交内容/素材改动；实现者只 `git add` 自己改的文件，绝不用 `git add -A`/`.`。已知 3 个预存失败测试（`manifestCheck`、`dialogue/gates`、`dialogue/provider`，源于用户内容）不要修，但不得新增失败。

---

## File Structure

- `src/engine/calendar/time.ts` — `CalendarState.eraName`；`createCalendar`/`advanceActionDay` 带 era；`formatYear(year, eraName?)`/`formatGameTime(time)` 读 era。
- `src/engine/save/stateSchema.ts` — calendar schema 增 `eraName`。
- `src/store/gameStore.ts` — `setEraName(name)`。
- `src/ui/screens/CoronationScreen.tsx`（新）— 登基画面 + `isValidEraName`。
- `src/ui/App.tsx` — `"coronation"` 视图 + 流程；寺庙两 handler。
- `assets/manifest.json` — `bg.dengji`、`bg.simiao`。
- `content/locations/simiao.json`（新）— 寺庙地点。
- `src/store/temple.ts`（新）— `buildIncense`/`buildFortune`/`fortuneTierFromRoll`。
- `src/ui/screens/LocationScreen.tsx` — simiao 专屏动作菜单。
- 测试：`tests/calendar/eraFormat.test.ts`、`tests/store/temple.test.ts`、`tests/ui/coronation.test.ts`。

---

## Task 1: 年号格式化 + CalendarState.eraName

**Files:**
- Modify: `src/engine/calendar/time.ts`、`src/engine/save/stateSchema.ts`
- Test: `tests/calendar/eraFormat.test.ts`

**Interfaces:**
- Produces: `CalendarState.eraName: string`；`formatYear(year: number, eraName?: string): string`；`formatGameTime(time: GameTime & { eraName?: string }): string`；`createCalendar(start)` 接受 `start.eraName`；`advanceActionDay` 保留 eraName。

- [ ] **Step 1: 写失败测试**

`tests/calendar/eraFormat.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { formatYear, formatGameTime, createCalendar, advanceActionDay } from "../../src/engine/calendar/time";

describe("年号格式化", () => {
  it("formatYear 带年号：元年/二年", () => {
    expect(formatYear(1, "甘露")).toBe("甘露元年");
    expect(formatYear(2, "甘露")).toBe("甘露二年");
  });
  it("formatYear 空年号退回原行为", () => {
    expect(formatYear(1)).toBe("元年");
    expect(formatYear(3)).toBe("三年");
  });
  it("formatGameTime 从 calendar.eraName 自动带年号", () => {
    const cal = createCalendar({ eraName: "甘露" });
    expect(formatGameTime(cal)).toBe("甘露元年一月上旬");
  });
  it("advanceActionDay 保留年号", () => {
    const cal = createCalendar({ eraName: "甘露" });
    expect(advanceActionDay(cal).eraName).toBe("甘露");
  });
  it("无 eraName 的 GameTime 不带年号", () => {
    expect(formatGameTime({ year: 1, month: 1, period: "early", dayIndex: 0 })).toBe("元年一月上旬");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/calendar/eraFormat.test.ts`
Expected: FAIL（`createCalendar` 不接受 eraName / formatYear 不接受第二参 / cal 无 eraName）。

- [ ] **Step 3: 改 time.ts**

在 `src/engine/calendar/time.ts`：

`CalendarState` 增 eraName：

```ts
export interface CalendarState extends GameTime {
  /** Remaining action points this action-day: apMax → 0. */
  readonly ap: number;
  readonly apMax: number;
  /** 年号（如「甘露」）；空串=未设，显示退回 元年/X年。 */
  readonly eraName: string;
}
```

`CalendarStart` 增 eraName，`createCalendar` 设默认：

```ts
export interface CalendarStart {
  year?: number;
  month?: number;
  period?: MonthPeriod;
  apMax?: number;
  eraName?: string;
}

export function createCalendar(start: CalendarStart = {}): CalendarState {
  const year = start.year ?? 1;
  const month = start.month ?? 1;
  const period = start.period ?? "early";
  const apMax = start.apMax ?? DEFAULT_AP_MAX;
  return { ...makeGameTime(year, month, period), ap: apMax, apMax, eraName: start.eraName ?? "" };
}
```

`advanceActionDay` 末行保留 eraName：

```ts
  return { ...makeGameTime(year, month, period), ap: calendar.apMax, apMax: calendar.apMax, eraName: calendar.eraName };
```

`formatYear` / `formatGameTime`：

```ts
export function formatYear(year: number, eraName = ""): string {
  const base = year === 1 ? "元年" : `${chineseNumeral(year)}年`;
  return `${eraName}${base}`;
}

/** e.g. 甘露元年一月上旬；无年号时 元年一月上旬. */
export function formatGameTime(time: GameTime & { eraName?: string }): string {
  return `${formatYear(time.year, time.eraName ?? "")}${chineseNumeral(time.month)}月${PERIOD_NAME[time.period]}`;
}
```

- [ ] **Step 4: 改 stateSchema.ts**

`src/engine/save/stateSchema.ts` 的 `calendarStateSchema`（`gameTimeSchema.extend({ ap, apMax })`）增 `eraName`：

```ts
const calendarStateSchema = gameTimeSchema
  .extend({
    ap: z.number().int().min(0),
    apMax: z.number().int().min(1),
    eraName: z.string().default(""),
  })
  .refine((cal) => calendarInvariantViolation(cal as CalendarState) === null, {
    message: "impossible calendar state",
  });
```

- [ ] **Step 5: 运行测试 + 全量校验**

Run: `npx vitest run tests/calendar/eraFormat.test.ts && npm run typecheck`
Expected: 新测试 PASS；typecheck 干净（`CalendarState` 加了必填 eraName，但 `createCalendar`/`advanceActionDay` 都已产出，且 reducer/newGame 经由它们构造，故无类型缺口；若 typecheck 报某处手工构造 CalendarState 缺 eraName，补 `eraName: ""`）。

Run: `npm test`
Expected: 仅 3 个已知预存失败；无新增失败。

- [ ] **Step 6: Commit**

```bash
git add src/engine/calendar/time.ts src/engine/save/stateSchema.ts tests/calendar/eraFormat.test.ts
git commit -m "feat: 年号 eraName 进 CalendarState，时间显示带年号"
```

---

## Task 2: 登基开场流程

**Files:**
- Modify: `src/store/gameStore.ts`、`src/ui/App.tsx`、`assets/manifest.json`
- Create: `src/ui/screens/CoronationScreen.tsx`
- Test: `tests/ui/coronation.test.ts`

**Interfaces:**
- Consumes: `formatYear`（Task 1）；`GameStore`。
- Produces: `GameStore.setEraName(name: string): void`；`CoronationScreen` props `{ registry: AssetRegistry; onConfirm: (era: string) => void }`；导出 `isValidEraName(s: string): boolean`。

- [ ] **Step 1: 写 isValidEraName 失败测试**

`tests/ui/coronation.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { isValidEraName } from "../../src/ui/screens/CoronationScreen";

describe("isValidEraName", () => {
  it("恰好两个中文字通过", () => {
    expect(isValidEraName("甘露")).toBe(true);
    expect(isValidEraName("永熙")).toBe(true);
  });
  it("非两字或非中文拒绝", () => {
    expect(isValidEraName("甘")).toBe(false);
    expect(isValidEraName("甘露露")).toBe(false);
    expect(isValidEraName("ab")).toBe(false);
    expect(isValidEraName("甘1")).toBe(false);
    expect(isValidEraName("")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ui/coronation.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 CoronationScreen**

`src/ui/screens/CoronationScreen.tsx`：

```tsx
/**
 * 登基开场（新游戏后、进入游戏前）。背景 cg/dengji；先输入年号（恰好两中文字），
 * 确认后播登基叙事（尊太后入慈宁宫·封皇后入坤宁宫·群臣高呼万岁·天下同庆），
 * 「开始」→ onConfirm(年号)。纯叙事，不改游戏状态。
 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";

export function isValidEraName(s: string): boolean {
  return /^[一-鿿]{2}$/.test(s);
}

export function CoronationScreen({
  registry,
  onConfirm,
}: {
  registry: AssetRegistry;
  onConfirm: (era: string) => void;
}) {
  const bg = registry.background("bg.dengji");
  const [phase, setPhase] = useState<"era" | "ceremony">("era");
  const [era, setEra] = useState("");
  const valid = isValidEraName(era);

  return (
    <main
      className="coronation"
      style={{ backgroundImage: `url("${bg.url}")` }}
      data-fallback={bg.isFallback || undefined}
    >
      {phase === "era" ? (
        <div className="coronation__panel">
          <p className="coronation__narrative">妘朝的第五位皇帝登基，改年号为——</p>
          <input
            className="coronation__input"
            value={era}
            maxLength={2}
            placeholder="请输入年号（两字）"
            onChange={(e) => setEra(e.target.value)}
          />
          <button type="button" disabled={!valid} onClick={() => setPhase("ceremony")}>
            确认年号
          </button>
        </div>
      ) : (
        <div className="coronation__panel">
          <p className="coronation__narrative">
            尊皇太后入慈宁宫，封皇后入坤宁宫。
            <br />
            群臣高呼万岁，行三跪九叩之礼。普天同庆，天下归心。
          </p>
          <p className="coronation__era">{`${era}元年正始`}</p>
          <button type="button" onClick={() => onConfirm(era)}>
            开始
          </button>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run tests/ui/coronation.test.ts`
Expected: PASS。

- [ ] **Step 5: GameStore.setEraName**

`src/store/gameStore.ts` 在 `loadState` 后加方法：

```ts
  /** 登基设定年号（写入 calendar.eraName）。 */
  setEraName(name: string): void {
    this.state = { ...this.state, calendar: { ...this.state.calendar, eraName: name } };
    this.emit();
  }
```

- [ ] **Step 6: manifest 注册 dengji**

`assets/manifest.json` 的 `entries` 内（紧随其他 bg 条目）加：

```json
    "bg.dengji": { "path": "cg/dengji.png", "kind": "background", "placeholder": false },
```

Run: `npm run validate-manifest`
Expected: 通过（`public/assets/cg/dengji.png` 存在）。

- [ ] **Step 7: App 接线登基视图**

`src/ui/App.tsx`：
- import：`import { CoronationScreen } from "./screens/CoronationScreen";`
- `View` 联合类型加 `"coronation"`。
- 把 `newGame` 改为进登基视图，并抽出收尾逻辑：

```tsx
  const proceedAfterNewGame = () => {
    const pick = pickNextEvent(db, store.getState(), "game_start");
    if (pick) startEvent(pick.id);
    else goHome();
  };

  const newGame = () => {
    store.newGame(db);
    resetRollGuards();
    setView("coronation");
  };
```

（删除原 `newGame` 里 `const pick = pickNextEvent(...); if (pick) startEvent(pick.id); else goHome();` 那段——它移入 `proceedAfterNewGame`。）

- 渲染登基视图（与其它 `view === ...` 并列）：

```tsx
      {view === "coronation" && (
        <CoronationScreen
          registry={registry}
          onConfirm={(era) => {
            store.setEraName(era);
            proceedAfterNewGame();
          }}
        />
      )}
```

- [ ] **Step 8: 登基样式**

`src/ui/styles.css` 追加：

```css
.coronation { position: fixed; inset: 0; z-index: 40; background-size: cover; background-position: center; display: flex; align-items: center; justify-content: center; }
.coronation__panel { background: rgba(20,14,11,.6); padding: 28px 32px; border-radius: 12px; color: #f4ead8; text-align: center; max-width: 620px; display: flex; flex-direction: column; gap: 16px; align-items: center; }
.coronation__narrative { font-size: 1.1rem; line-height: 1.9; }
.coronation__era { font-size: 1.3rem; letter-spacing: .2em; color: #f0d8a8; }
.coronation__input { font-size: 1.2rem; text-align: center; padding: 8px 12px; width: 8em; }
```

- [ ] **Step 9: 校验 + 手动**

Run: `npm run typecheck && npm test`
Expected: typecheck 干净；仅 3 个已知预存失败。
手动：`npm run dev` → 新游戏 → 登基画面（dengji 背景）→ 输入两字年号 → 确认 → 叙事 → 开始 → 顶栏显示「{年号}元年一月…」。

- [ ] **Step 10: Commit**

```bash
git add src/store/gameStore.ts src/ui/screens/CoronationScreen.tsx src/ui/App.tsx assets/manifest.json src/ui/styles.css tests/ui/coronation.test.ts
git commit -m "feat: 新游戏登基开场 + 年号输入"
```

---

## Task 3: 郊外寺庙地点

**Files:**
- Create: `content/locations/simiao.json`
- Modify: `assets/manifest.json`

**Interfaces:**
- Produces: 地点 `simiao`（zone `jingjiao`，bg `bg.simiao`）。

- [ ] **Step 1: 新建地点文件**

`content/locations/simiao.json`：

```json
{
  "id": "simiao",
  "name": "寺庙",
  "description": "古刹深藏郊野，松柏森森，香烟袅袅。钟声悠远，梵呗低回，红尘喧嚣到此皆息。",
  "backgroundKey": "bg.simiao",
  "ambience": ["钟声", "梵呗", "松风"],
  "position": { "x": 0.4, "y": 0.5 },
  "zone": "jingjiao",
  "connections": [],
  "travelCost": { "ap": 0 }
}
```

- [ ] **Step 2: manifest 注册 simiao**

`assets/manifest.json` 的 `entries` 内加：

```json
    "bg.simiao": { "path": "backgrounds/simiao.png", "kind": "background", "placeholder": false },
```

- [ ] **Step 3: 校验内容与 manifest**

Run: `npm run validate-content && npm run validate-manifest`
Expected: 均通过（`simiao` 通过地点 schema；`bg.simiao` 路径存在）。若 validate-content 报缺字段，对照 `content/locations/yuhuayuan.json` 补齐（字段集应一致）。

- [ ] **Step 4: typecheck + 测试**

Run: `npm run typecheck && npm test`
Expected: typecheck 干净；仅 3 个已知预存失败。

- [ ] **Step 5: Commit**

```bash
git add content/locations/simiao.json assets/manifest.json
git commit -m "feat: 郊外新增寺庙地点 simiao"
```

---

## Task 4: 寺庙动作逻辑 store/temple.ts

**Files:**
- Create: `src/store/temple.ts`
- Test: `tests/store/temple.test.ts`

**Interfaces:**
- Consumes: `gestationRoll`（`src/engine/characters/gestation.ts`）；`EventEffect`（`src/engine/content/schemas`）；`ContentDB`、`GameState`。
- Produces:
  - `interface TempleResult { effects: EventEffect[]; lines: string[]; }`
  - `buildIncense(db, state, key: string): TempleResult`
  - `type FortuneTier = "大吉" | "吉" | "中平" | "凶" | "大凶"`
  - `fortuneTierFromRoll(roll: number): FortuneTier`
  - `buildFortune(db, state, key: string): TempleResult & { tier: FortuneTier }`

- [ ] **Step 1: 写失败测试**

`tests/store/temple.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildIncense, buildFortune, fortuneTierFromRoll } from "../../src/store/temple";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;
const state = createNewGameState(db);

describe("fortuneTierFromRoll 分档边界", () => {
  it("0–9 大吉 / 10–34 吉 / 35–64 中平 / 65–89 凶 / 90–99 大凶", () => {
    expect(fortuneTierFromRoll(0)).toBe("大吉");
    expect(fortuneTierFromRoll(9)).toBe("大吉");
    expect(fortuneTierFromRoll(10)).toBe("吉");
    expect(fortuneTierFromRoll(34)).toBe("吉");
    expect(fortuneTierFromRoll(35)).toBe("中平");
    expect(fortuneTierFromRoll(64)).toBe("中平");
    expect(fortuneTierFromRoll(65)).toBe("凶");
    expect(fortuneTierFromRoll(89)).toBe("凶");
    expect(fortuneTierFromRoll(90)).toBe("大凶");
    expect(fortuneTierFromRoll(99)).toBe("大凶");
  });
});

describe("buildIncense", () => {
  it("三项 effects：民心/威望/健康，delta∈[0,5]", () => {
    const r = buildIncense(db, state, "k1");
    expect(r.effects).toHaveLength(3);
    const map = Object.fromEntries(r.effects.map((e: any) => [`${e.pillar}.${e.field}`, e.delta]));
    expect(map["nation.publicSupport"]).toBeGreaterThanOrEqual(0);
    expect(map["nation.publicSupport"]).toBeLessThanOrEqual(5);
    expect(map["sovereign.prestige"]).toBeGreaterThanOrEqual(0);
    expect(map["sovereign.prestige"]).toBeLessThanOrEqual(5);
    expect(map["sovereign.health"]).toBeGreaterThanOrEqual(0);
    expect(map["sovereign.health"]).toBeLessThanOrEqual(5);
    expect(r.lines.length).toBeGreaterThan(0);
  });
  it("同 key 确定性", () => {
    expect(buildIncense(db, state, "same")).toEqual(buildIncense(db, state, "same"));
  });
});

describe("buildFortune", () => {
  it("任意 key：含 publicSupport effect，所有 delta 量级≤10，有台词", () => {
    for (let i = 0; i < 60; i++) {
      const r = buildFortune(db, state, `key${i}`);
      expect(r.effects.some((e: any) => e.field === "publicSupport")).toBe(true);
      for (const e of r.effects as any[]) expect(Math.abs(e.delta)).toBeLessThanOrEqual(10);
      expect(r.lines.length).toBeGreaterThan(0);
    }
  });
  it("同 key 确定性", () => {
    expect(buildFortune(db, state, "fx")).toEqual(buildFortune(db, state, "fx"));
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/store/temple.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 temple.ts**

`src/store/temple.ts`：

```ts
/** 寺庙动作（上香/求签）：确定性纯逻辑，给定 state+key 输出确定。 */
import { gestationRoll } from "../engine/characters/gestation";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export interface TempleResult {
  effects: EventEffect[];
  lines: string[];
}

export type FortuneTier = "大吉" | "吉" | "中平" | "凶" | "大凶";

const sov = (field: string, delta: number): EventEffect =>
  ({ type: "resource", pillar: "sovereign", field, delta }) as EventEffect;
const nat = (field: string, delta: number): EventEffect =>
  ({ type: "resource", pillar: "nation", field, delta }) as EventEffect;

/** a..b 闭区间内的确定性取值。 */
const mag = (key: string, tag: string, a: number, b: number): number =>
  a + (gestationRoll(`${key}:${tag}`) % (b - a + 1));

/** 上香祈福：民心/威望/健康 各 +0..5。 */
export function buildIncense(_db: ContentDB, _state: GameState, key: string): TempleResult {
  return {
    effects: [
      nat("publicSupport", mag(key, "ps", 0, 5)),
      sov("prestige", mag(key, "pr", 0, 5)),
      sov("health", mag(key, "he", 0, 5)),
    ],
    lines: [
      "陛下亲临佛前，焚香祝祷，愿国泰民安、风调雨顺。",
      "钟磬声中香烟缭绕，陛下心绪渐宁，群臣称颂圣德。",
    ],
  };
}

/** roll(0–99) → 签档：0–9 大吉 / 10–34 吉 / 35–64 中平 / 65–89 凶 / 90–99 大凶。 */
export function fortuneTierFromRoll(roll: number): FortuneTier {
  if (roll < 10) return "大吉";
  if (roll < 35) return "吉";
  if (roll < 65) return "中平";
  if (roll < 90) return "凶";
  return "大凶";
}

const FORTUNE_LINES: Record<FortuneTier, string[]> = {
  大吉: ["签筒轻摇，落下一支上上签。住持合十贺曰：紫气东来，国运昌隆，万民咸服。"],
  吉: ["落签为吉。住持笑道：风调雨顺，仓廪渐丰，乃太平之兆。"],
  中平: ["得一中平签。住持曰：守成持重，无咎无誉，静待天时。"],
  凶: ["落签为凶。住持蹙眉：近日恐有微词流于市井，望陛下慎之。"],
  大凶: ["签落于地，赫然下下签。住持神色凝重：民怨暗生、流言四起，宜修德安民以解之。"],
};

/** 求签：先按 roll 分档，再档内取量级（均 ≤ AXIS_CAP=10）。整体偏正。 */
export function buildFortune(
  _db: ContentDB,
  _state: GameState,
  key: string,
): TempleResult & { tier: FortuneTier } {
  const tier = fortuneTierFromRoll(gestationRoll(`${key}:tier`));
  const effects: EventEffect[] = [];
  if (tier === "大吉") {
    effects.push(nat("publicSupport", mag(key, "ps", 8, 10)));
    effects.push(nat("productivity", mag(key, "pd", 8, 10)));
    effects.push(
      gestationRoll(`${key}:extra`) % 2 === 0
        ? sov("prestige", mag(key, "ex", 4, 6))
        : nat("treasury", mag(key, "ex", 4, 6)),
    );
  } else if (tier === "吉") {
    effects.push(nat("publicSupport", mag(key, "ps", 5, 7)));
    effects.push(nat("productivity", mag(key, "pd", 5, 7)));
  } else if (tier === "中平") {
    effects.push(nat("publicSupport", mag(key, "ps", 0, 2)));
  } else if (tier === "凶") {
    effects.push(nat("publicSupport", -mag(key, "ps", 2, 4)));
  } else {
    effects.push(nat("publicSupport", -mag(key, "ps", 6, 8)));
    effects.push(
      gestationRoll(`${key}:extra`) % 2 === 0
        ? nat("rumor", mag(key, "ex", 2, 4))
        : nat("clanDiscontent", mag(key, "ex", 2, 4)),
    );
  }
  return { tier, effects, lines: FORTUNE_LINES[tier] };
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run tests/store/temple.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/store/temple.ts tests/store/temple.test.ts
git commit -m "feat: 寺庙上香/求签逻辑（确定性，吉类净收益>凶类净损）"
```

---

## Task 5: 寺庙 UI 接线

**Files:**
- Modify: `src/ui/screens/LocationScreen.tsx`、`src/ui/App.tsx`、`src/ui/styles.css`

**Interfaces:**
- Consumes: `buildIncense`/`buildFortune`（Task 4）；`App` 既有 `spendAp`/`playReactions`/`doAutosave`。
- Produces: `LocationScreen` 新增可选 props `onOfferIncense?: () => void`、`onDrawFortune?: () => void`。

- [ ] **Step 1: App 加寺庙处理器**

`src/ui/App.tsx`：
- import：`import { buildIncense, buildFortune } from "../store/temple";`
- 加处理器（放在 `converse` 等其它行动附近）：

```tsx
  // 寺庙·上香/求签（各耗 1 行动点）：确定性随机 effects + 旁白，复用 spendAp/playReactions。
  const templeAction = (kind: "incense" | "fortune") => {
    const before = store.getState();
    if (before.calendar.ap < 1) return;
    const cal = before.calendar;
    const key = `temple:${kind}:${before.rngSeed}:${cal.dayIndex}:${cal.ap}`;
    const plan = kind === "incense" ? buildIncense(db, before, key) : buildFortune(db, before, key);
    const { spend, decreeBeats } = spendAp(1);
    if (!spend.ok) return;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    playReactions([{ speakerId: "wei_sui", lines: plan.lines }, ...decreeBeats], spend.value.rolledOver);
  };
```

- 给 `<LocationScreen ... />` 传两个回调：

```tsx
          onOfferIncense={() => templeAction("incense")}
          onDrawFortune={() => templeAction("fortune")}
```

- [ ] **Step 2: LocationScreen 加 simiao 菜单**

`src/ui/screens/LocationScreen.tsx`：
- props 类型加：

```ts
  onOfferIncense?: () => void;
  onDrawFortune?: () => void;
```
并在解构参数里加 `onOfferIncense, onDrawFortune,`。

- 在通用 stage 分支里（`location.id === "zichendian"` 那个 `yushufang-menu` 区块之后）加 simiao 专屏菜单：

```tsx
          {location.id === "simiao" && (
            <section className="temple-menu">
              <button type="button" disabled={state.calendar.ap < 1} onClick={onOfferIncense}>
                上香
              </button>
              <button type="button" disabled={state.calendar.ap < 1} onClick={onDrawFortune}>
                求签
              </button>
            </section>
          )}
```

（simiao 在 `jingjiao` 区、无在场侍君，会走通用 stage 分支，故该菜单会显示在地点描述下方。）

- [ ] **Step 3: 样式**

`src/ui/styles.css` 追加：

```css
.temple-menu { display: flex; gap: 12px; justify-content: center; padding: 12px; }
.temple-menu button { padding: 10px 22px; font-size: 1rem; }
```

- [ ] **Step 4: 校验 + 手动**

Run: `npm run typecheck && npm test`
Expected: typecheck 干净；仅 3 个已知预存失败。
手动：`npm run dev` → 出宫到京城 → 郊外 → 点寺庙进入 → 见「上香」「求签」；各耗 1 行动点并弹旁白；行动点不足时按钮禁用。

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/LocationScreen.tsx src/ui/App.tsx src/ui/styles.css
git commit -m "feat: 寺庙上香/求签 UI 接线"
```

---

## Self-Review

- **Spec 覆盖**：登基流程+年号输入→Task 2；年号显示/存档→Task 1；dengji 注册→Task 2；寺庙地点+simiao 注册→Task 3；上香/求签数值与确定性→Task 4；寺庙菜单+耗点串接→Task 5。全覆盖。
- **类型一致**：`eraName`、`formatYear(year, eraName?)`、`setEraName`、`isValidEraName`、`TempleResult`、`FortuneTier`、`fortuneTierFromRoll`、`buildIncense`/`buildFortune`、`onOfferIncense`/`onDrawFortune` 跨任务命名一致。
- **占位扫描**：无 TBD/TODO；代码块均完整。
- **数值≤AXIS_CAP**：求签各 delta 量级 ≤10（8–10/5–7/0–2/2–4/6–8、额外 4–6/2–4），上香 0–5。吉类净收益（大吉≈20+、吉≈10–14）> 凶类净损（凶 2–4、大凶 6–8+2–4）。
- **风险点**：①`CalendarState` 加必填 `eraName` 后，若有别处手工构造日历对象（非经 `createCalendar`/`advanceActionDay`），typecheck 会指出，补 `eraName: ""`；②`buildFortune` 的 `extra` 项字段名（rumor/clanDiscontent/treasury/prestige）须在对应 pillar 的 schema 枚举内（已对照：均在 nation/sovereign 枚举）。

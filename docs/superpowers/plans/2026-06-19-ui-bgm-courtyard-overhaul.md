# UI / BGM / 后宫院子 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地六项 UI/系统改动——删除三项属性、删主图事件红点、地图直接进入 + 后宫院子、翻牌子全屏、BGM 系统、右上角"设置"菜单。

**Architecture:** 纯前端改动（React + TS + Vite）。新增 `CourtyardScreen`、`SettingsMenu`、`AudioController` 三个独立单元；其余为现有屏幕/引擎/内容的定点修改。后宫导航复用 `MapScreen` 既有 travel/AP/结算链路，院子作为 `MapScreen` 的子视图存在，避免重复 travel 逻辑。

**Tech Stack:** React 18, TypeScript, Vite, Zod（schema/校验），Vitest（单测）。

## Global Constraints

- 存档不做向后兼容迁移（pre-release；见 memory `no-save-backcompat`）。
- `harem` 一词两义：要删的是**资源支柱** `resources.harem`（harmony/jealousy）；位分 `ranks[].domain:"harem"` 与 `bedchamber` 保留不动。
- 时段变体：`timeOfDay(calendar)` 返回 `"day" | "twilight" | "night"`；`registry.resolveVariant(baseKey, variant, kind)`，`"day"` 命中 base key（即 *_morning.png）。
- 资产路径前缀 `/assets/`（Vite public 目录 = `public/assets/`）。
- 测试命令：`npm test`（vitest run）、`npm run typecheck`、`npm run validate-manifest`、`npm run validate-content`。
- 提交信息用约定式（feat/fix/refactor/...），中文描述可。

---

## File Structure

新增：
- `src/ui/audio/AudioController.ts` — BGM 单例控制器（一个常驻循环 `<audio>`）。
- `src/ui/audio/trackFor.ts` — 纯函数：场景 → 曲目 id。
- `src/ui/screens/CourtyardScreen.tsx` — 后宫院子（gongdian_yuanzi）：5 殿/主殿入口。
- `src/ui/components/SettingsMenu.tsx` — 全屏设置菜单（读档/存档/音乐/返回主界面）。
- `tests/ui/trackFor.test.ts`、`tests/ui/courtyardHalls.test.ts` — 纯逻辑单测。

修改：
- 引擎/内容（属性删除）：`types.ts`、`schemas.ts`、`stateSchema.ts`、`initialState.ts`、`funnel.ts`、`taihou.ts`、`world.json`、5 个 scene json、相关测试。
- `MapScreen.tsx`（删红点/删信息栏/直接进入/院子子视图/上报当前 board）。
- `HaremGrid.tsx`（点宫→开院子）。
- `CharacterScene.tsx`（`focusConsortId` 聚焦入参）。
- `LocationScreen.tsx`（透传 focusConsortId）。
- `BedchamberPicker.tsx`（全屏 fanpaizi 托盘）。
- `TopStatusBar.tsx` / `GameShell.tsx`（存档按钮→设置）。
- `SaveLoadScreen.tsx`（`mode: "load" | "save"`）。
- `App.tsx`（视图/回调接线：courtyard、settings、focus、audio）。
- `ResourcePanel.tsx`、`DebugPanel.tsx`（删属性条/调试）。
- `assets/manifest.json`（注册 3 个背景）。
- `src/ui/styles.css`（院子/托盘/设置样式 + 删 `.map-node__event`）。

---

## Task 1: 资产整理与 manifest 注册

**Files:**
- Modify: `assets/manifest.json`
- Shell: `public/assets/bgm/`

**Interfaces:**
- Produces: manifest keys `bg.gongdian_yuanzi`(+`.twilight`/`.night`)、`bg.fanpaizi`、`bg.game_setting`；BGM 文件 `public/assets/bgm/{main,hougong,jiaowai,market,wenqing}.mp3`。

- [ ] **Step 1: 清理 bgm 目录并重命名京城曲目**

```bash
cd /home/zhang35h/Si-Chen/public/assets/bgm
rm -f *.Zone.Identifier
mv "Market of the Prosperous.mp3" market.mp3
ls
```
Expected: 列出 `main.mp3 hougong.mp3 jiaowai.mp3 market.mp3 wenqing.mp3`（外加 yanhui.mp3 等无妨），无 `*.Zone.Identifier`。

- [ ] **Step 2: 注册三个背景到 manifest**

在 `assets/manifest.json` 的 `entries` 内、`"bg.game_start"` 那一行之后，加入：

```json
    "bg.gongdian_yuanzi": { "path": "backgrounds/gongdian_yuanzi_morning.png", "kind": "background", "placeholder": false },
    "bg.gongdian_yuanzi.twilight": { "path": "backgrounds/gongdian_yuanzi_twilight.png", "kind": "background", "placeholder": false },
    "bg.gongdian_yuanzi.night": { "path": "backgrounds/gongdian_yuanzi_night.png", "kind": "background", "placeholder": false },
    "bg.fanpaizi": { "path": "backgrounds/fanpaizi.png", "kind": "background", "placeholder": false },
    "bg.game_setting": { "path": "backgrounds/game_setting.png", "kind": "background", "placeholder": false },
```

- [ ] **Step 3: 校验 manifest**

Run: `npm run validate-manifest`
Expected: 通过（所有 path 对应 `public/assets/` 下真实文件）。

- [ ] **Step 4: Commit**

```bash
git add assets/manifest.json
git commit -m "chore: 注册院子/翻牌子/设置背景，整理 bgm 资源"
```

---

## Task 2: 删除属性（后宫和睦/妒意 + 宗嗣合法性）

**Files:**
- Modify: `src/engine/state/types.ts`、`src/engine/content/schemas.ts`、`src/engine/save/stateSchema.ts`、`src/engine/state/initialState.ts`、`src/engine/effects/funnel.ts`、`src/store/taihou.ts`、`content/world.json`
- Modify: `content/scenes/sc_taihou_converse.json`、`content/scenes/sc_court_zhenzai.json`、`content/scenes/sc_shen_neglect.json`、`content/scenes/sc_fenghou_rules.json`、`content/scenes/sc_menses_rite.json`
- Modify: `src/ui/components/ResourcePanel.tsx`、`src/ui/debug/DebugPanel.tsx`
- Test: 现有 `tests/effects/funnel.test.ts`、`tests/content/schemas.test.ts`、`tests/content/loader.test.ts`、`tests/state/initialState.test.ts`（按失败定位更新）

**Interfaces:**
- Produces: `Resources` 不再有 `harem`；`BloodlineState` 不再有 `legitimacy`；effect schema 不再接受 `pillar:"harem"` 或 `pillar:"bloodline"/field:"legitimacy"`。

- [ ] **Step 1: 先让测试失败 —— 删 types**

`src/engine/state/types.ts`：删除整个 `HaremState` 接口（harmony/jealousy）：

```ts
// 删除以下整段
export interface HaremState {
  /** 和睦 */
  harmony: number;
  /** 妒意 */
  jealousy: number;
}
```

删除 `BloodlineState` 里的 legitimacy 字段：

```ts
// 删除这两行
  /** 宗嗣合法性 */
  legitimacy: number;
```

在 `Resources` 接口里删除 `harem: HaremState;` 那一行（搜 `harem:` 定位；保留 `domain` 等无关项）。

- [ ] **Step 2: 删 content schema 分支**

`src/engine/content/schemas.ts`：删除 harem 与 legitimacy 两个 resource effect 分支（约 157–168 行）：

```ts
// 删除这两个 strictObject
  z.strictObject({
    type: z.literal("resource"),
    pillar: z.literal("harem"),
    field: z.enum(["harmony", "jealousy"]),
    delta,
  }),
  z.strictObject({
    type: z.literal("resource"),
    pillar: z.literal("bloodline"),
    field: z.literal("legitimacy"),
    delta,
  }),
```

删除 world `startingResources` 里的 harem 与 bloodline.legitimacy（约 528–532 行）。把：

```ts
    harem: z.strictObject({ harmony: percent, jealousy: percent }),
    bloodline: z.strictObject({
      legitimacy: percent,
      menstrualStatus: z.enum(["normal", "irregular", "absent"]),
    }),
```

改为：

```ts
    bloodline: z.strictObject({
      menstrualStatus: z.enum(["normal", "irregular", "absent"]),
    }),
```

- [ ] **Step 3: 删 save schema**

`src/engine/save/stateSchema.ts`：删除 `harem: z.strictObject({ harmony: percent, jealousy: percent }),` 一行；在其后的 `bloodline` strictObject 内删除 `legitimacy: percent,` 一行。

- [ ] **Step 4: 删 initialState 初值**

`src/engine/state/initialState.ts`：删除 `harem: { harmony: 60, jealousy: 20 },` 一行；在 `bloodline` 内删除 `legitimacy: 60,` 一行。

- [ ] **Step 5: 删 funnel 应用分支**

`src/engine/effects/funnel.ts` 的 `case "resource"`（约 287–299 行）改为只剩 sovereign / nation / bloodline-非-legitimacy。但 bloodline 已无可写资源字段（legitimacy 是唯一一个），故整条 bloodline 分支去掉。替换：

```ts
        if (effect.pillar === "sovereign") {
          next.resources.sovereign[effect.field] = clampPct(next.resources.sovereign[effect.field] + applied);
        } else if (effect.pillar === "nation") {
          next.resources.nation[effect.field] = clampPct(next.resources.nation[effect.field] + applied);
        } else if (effect.pillar === "harem") {
          next.resources.harem[effect.field] = clampPct(next.resources.harem[effect.field] + applied);
        } else {
          next.resources.bloodline.legitimacy = clampPct(next.resources.bloodline.legitimacy + applied);
        }
```

为：

```ts
        if (effect.pillar === "sovereign") {
          next.resources.sovereign[effect.field] = clampPct(next.resources.sovereign[effect.field] + applied);
        } else {
          next.resources.nation[effect.field] = clampPct(next.resources.nation[effect.field] + applied);
        }
```

（此时 `effect.pillar` 仅 `"sovereign" | "nation"`，TS 会据窄化的 schema 类型收敛。）

- [ ] **Step 6: 删 taihou harmony effect**

`src/store/taihou.ts:137` 删除：

```ts
      { type: "resource", pillar: "harem", field: "harmony", delta: 2 },
```

（若删后该 effects 数组出现孤立逗号/空数组，相应整理语法。）

- [ ] **Step 7: 删 world.json 初值**

`content/world.json`：删除 `"harem": { "harmony": 60, "jealousy": 20 },` 一行；把 `"bloodline": { "legitimacy": 60, "menstrualStatus": "normal" }` 改为 `"bloodline": { "menstrualStatus": "normal" }`。

- [ ] **Step 8: 清理内容脚本里失效的 effect 行**

逐个删除以下 effect 条目（保留脚本其余结构；注意删后 JSON 数组逗号合法）：
- `content/scenes/sc_taihou_converse.json`：删 `{ "type": "resource", "pillar": "bloodline", "field": "legitimacy", "delta": 2 }`
- `content/scenes/sc_court_zhenzai.json`：删含 `"field": "legitimacy"` 的那条 resource effect
- `content/scenes/sc_shen_neglect.json`：删两条 `"field": "jealousy"`（delta 3、delta 5）
- `content/scenes/sc_fenghou_rules.json`：删两条 `"field": "harmony"`（delta 4、delta -4）
- `content/scenes/sc_menses_rite.json`：删两条 `"field": "legitimacy"`（delta 5、delta -3）

- [ ] **Step 9: 删 UI 展示**

`src/ui/components/ResourcePanel.tsx`：删除三条 Bar：

```tsx
        <Bar label="和睦" value={harem.harmony} />
        <Bar label="妒意" value={harem.jealousy} />
```
及 `<Bar label="宗嗣合法性" value={bloodline.legitimacy} />`。同时删除文件内对 `harem`（资源对象）解构/引用；`bloodline` 若仅为 legitimacy 而引入则一并清理（保留 menstrual 等其余展示，如有）。

`src/ui/debug/DebugPanel.tsx:171`：删除 `{ type: "resource", pillar: "harem", field: "harmony", delta: 1 },` 这条调试 effect（及其按钮，若该按钮仅作此用）。

- [ ] **Step 10: typecheck，按报错更新测试**

Run: `npm run typecheck`
Expected: 先报 `tests/` 与源码里引用 `harem`/`legitimacy` 的位置。逐处删除/改写断言：
- `tests/effects/funnel.test.ts`：删除针对 harem/legitimacy 的用例。
- `tests/content/schemas.test.ts`、`tests/content/loader.test.ts`、`tests/state/initialState.test.ts`、`tests/state/newGame.test.ts`：删除/更新涉及这两项的断言与 fixture。

- [ ] **Step 11: 跑全套校验**

Run: `npm run typecheck && npm test && npm run validate-content`
Expected: 全绿。

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: 删除后宫和睦/妒意与宗嗣合法性属性"
```

---

## Task 3: 主地图删红点 + 直接点击进入

**Files:**
- Modify: `src/ui/screens/MapScreen.tsx`
- Modify: `src/ui/styles.css`（删 `.map-node__event` 规则）

**Interfaces:**
- Consumes（已存在于 App 的 props）：`onTravelled`、`onEnterCurrent`、`onOpenView`、`onClose`、`onOpenResources`、`onOpenSave`(后续 Task 7 改为 settings)。
- Produces：新增 props `onOpenCourtyard: (loc: LocationContent) => void`、`onBoardChange?: (boardId: string) => void`（供 Task 4/6 使用）。点击节点即触发动作，不再有右侧信息栏。

- [ ] **Step 1: 移除事件红点**

`MapScreen.tsx` `renderNode` 内删除事件标记与其计算：
- 删除 `{showEvent && <span className="map-node__event" aria-label="有事件" />}`
- 删除 `const showEvent = (here && currentHasEvent) || courtAvailable(loc);`
- 删除顶部 `const currentHasEvent = getEligibleEvents(db, state, "location_enter").length > 0;`（及不再使用的 `getEligibleEvents` import，若无其他引用）。
- `courtAvailable` 若仅被 `showEvent` 使用则一并删除；若仍被 `infoFor` 引用，待 Step 2 删 `infoFor` 后再删。

`src/ui/styles.css`：删除 `.map-node__event` 选择器规则（搜索定位）。

- [ ] **Step 2: 点击节点即进入（删信息栏）**

`MapScreen.tsx`：
- 删除 `selected` state、`infoFor`、`LocationInfoPanel` 的 import 与渲染（`<LocationInfoPanel info={infoFor(selected)} />`）、`useEffect` 预选当前节点的逻辑、`Selected` 类型。
- `renderNode` 的 `onClick` 改为直接动作：

```tsx
  const onNodeActivate = (loc: LocationContent) => {
    if (loc.id === state.playerLocation) { onEnterCurrent(); return; }
    if (loc.entry === "free") { onOpenView(loc.id); return; }
    if (!checkTravel(db, state, loc.id).ok) return; // 不可达：点击无效
    travel(loc.id);
  };
```

把 `renderNode` 里 `onClick={() => setSelected(...)}` 改为 `onClick={() => onNodeActivate(loc)}`；`aria-pressed`/`is-selected` 相关删除。

- `renderPortal` 的 `onClick` 改为直接进入：

```tsx
      onClick={() => (portal.to === "jingcheng" ? exitPalace(portal.to) : enterBoard(portal.to))}
```
删除 portal 的 `is-selected`/`aria-pressed`。出宫（jingcheng）行动点不足时静默忽略（`exitPalace` 已有 backstop）。

- 布局：`.map-layout` 现在只剩 board，移除右栏。若 CSS 用 grid 两栏，改为单栏（在 styles.css 调整 `.map-layout`）。

- [ ] **Step 3: 后宫网格点宫 → 开院子；上报 board**

`MapScreen.tsx`：
- 新增 props：`onOpenCourtyard: (loc: LocationContent) => void;` 和可选 `onBoardChange?: (boardId: string) => void;`
- `HaremGrid` 的 `onSelect` 改为 `onSelect={(loc) => onOpenCourtyard(loc)}`，并删 `selectedId`（传 `null` 或删该 prop——见 Task 4 调整 HaremGrid 签名）。
- board 变化上报：在现有 `board` state 处加：

```tsx
  useEffect(() => { onBoardChange?.(board); }, [board]);
```

- [ ] **Step 4: typecheck（App 侧暂未接线会报缺 prop —— 由 Task 4 接）**

Run: `npm run typecheck`
Expected: 仅 `App.tsx` 报 `onOpenCourtyard` 未提供（预期，Task 4 解决）。MapScreen 自身无错。

> 说明：本任务与 Task 4 共同构成可编译单元。若按 subagent 单任务执行，可把 Task 3 的 App 接线最小桩（`onOpenCourtyard={() => {}}`）临时加上以通过编译，Task 4 再替换为真实实现。

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/MapScreen.tsx src/ui/styles.css
git commit -m "feat: 主地图删事件红点，点击节点直接进入"
```

---

## Task 4: 后宫院子 CourtyardScreen + CharacterScene 聚焦

**Files:**
- Create: `src/ui/screens/CourtyardScreen.tsx`
- Create: `tests/ui/courtyardHalls.test.ts`
- Modify: `src/ui/screens/HaremGrid.tsx`、`src/ui/screens/CharacterScene.tsx`、`src/ui/screens/LocationScreen.tsx`、`src/ui/screens/MapScreen.tsx`、`src/ui/App.tsx`、`src/ui/styles.css`

**Interfaces:**
- Consumes：`CHAMBERS`、`chamberOf`、`hasChambers`（`src/engine/characters/chambers.ts`）；`getPresentAt`（`src/engine/characters/presence.ts`）；`timeOfDay`、`registry.resolveVariant`。
- Produces：
  - `hallsFor(db, state, location): { chamber: ChamberId; name: string; occupant?: CharacterContent }[]` —— 纯函数，供院子渲染与测试。
  - `CourtyardScreen` 组件 props：`{ db, state, registry, location, onPickHall: (consortId: string) => void, onBack: () => void }`。
  - `CharacterScene` 新增可选 prop：`focusConsortId?: string | null`。
  - `LocationScreen` 新增可选 prop：`focusConsortId?: string | null`。

- [ ] **Step 1: 写 hallsFor 失败测试**

`tests/ui/courtyardHalls.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { hallsFor } from "../../src/ui/screens/CourtyardScreen";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("hallsFor", () => {
  it("设宫室居所给出 5 个殿（hallsFor 未排序，含全部 5 chamber）", () => {
    const state = createNewGameState(db);
    const halls = hallsFor(db, state, db.locations["jingren_gong"]!);
    expect(halls.map((h) => h.chamber).sort()).toEqual(
      ["east_annex", "east_side", "main", "west_annex", "west_side"].sort(),
    );
  });

  it("特殊宫（坤宁宫）只有主殿一个殿", () => {
    const state = createNewGameState(db);
    const halls = hallsFor(db, state, db.locations["kunninggong"]!);
    expect(halls.map((h) => h.chamber)).toEqual(["main"]);
  });
});
```

> 注：`createNewGameState(db)`（`src/engine/state/newGame.ts`）给出含 `playerLocation`/`standing` 的开局态，与现有引擎测试一致。`hallsFor` 本身按 `CHAMBERS` 顺序返回 5 项；左→右展示顺序由 `CourtyardScreen` 内 `HALL_ORDER` 排序，故此处用 `.sort()` 断言集合。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ui/courtyardHalls.test.ts`
Expected: FAIL（`hallsFor` 未定义 / 模块不存在）。

- [ ] **Step 3: 实现 CourtyardScreen + hallsFor**

`src/ui/screens/CourtyardScreen.tsx`：

```tsx
/**
 * 后宫院子（gongdian_yuanzi）。点后宫某宫进入此院：
 * 设 5 宫室的 7 座居所，左→右排 西偏殿｜西侧殿｜主殿｜东侧殿｜东偏殿，按 chamber 显住客；
 * 坤宁/长门/储秀等单居所只显居中主殿。点有人之殿→进入该侍君场景；空殿无动作。
 * 院子留作日后院中剧情的场所。
 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent, LocationContent } from "../../engine/content/schemas";
import type { ChamberId, GameState } from "../../engine/state/types";
import { CHAMBERS, chamberOf, hasChambers } from "../../engine/characters/chambers";
import { getPresentAt } from "../../engine/characters/presence";

export interface Hall {
  chamber: ChamberId;
  name: string;
  occupant?: CharacterContent;
}

/** 院子里的殿位：设宫室居所给 5 殿（按 CHAMBERS 序），特殊宫只给主殿。 */
export function hallsFor(db: ContentDB, state: GameState, location: LocationContent): Hall[] {
  const consorts = getPresentAt(db, state, location.id).filter((c) => c.kind === "consort");
  if (hasChambers(location.id)) {
    return CHAMBERS.map((ch) => ({
      chamber: ch.id,
      name: ch.name,
      occupant: consorts.find((c) => chamberOf(state.standing[c.id]) === ch.id),
    }));
  }
  return [{ chamber: "main", name: "主殿", occupant: consorts[0] }];
}

/** 视觉左→右顺序（西偏｜西侧｜主｜东侧｜东偏）。 */
const HALL_ORDER: ChamberId[] = ["west_annex", "west_side", "main", "east_side", "east_annex"];

export function CourtyardScreen({
  db,
  state,
  registry,
  location,
  onPickHall,
  onBack,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  location: LocationContent;
  onPickHall: (consortId: string) => void;
  onBack: () => void;
}) {
  const bg = registry.resolveVariant("bg.gongdian_yuanzi", timeOfDay(state.calendar), "background");
  const halls = hallsFor(db, state, location);
  const ordered = [...halls].sort((a, b) => HALL_ORDER.indexOf(a.chamber) - HALL_ORDER.indexOf(b.chamber));

  return (
    <main
      className="courtyard"
      style={{ backgroundImage: `url("${bg.url}")` }}
      data-fallback={bg.isFallback || undefined}
    >
      <header className="courtyard__bar">
        <button type="button" className="courtyard__back" onClick={onBack}>返回</button>
        <h1 className="courtyard__name">{location.name}</h1>
      </header>
      <div className={`courtyard__halls courtyard__halls--${ordered.length === 1 ? "single" : "full"}`}>
        {ordered.map((h) => (
          <button
            key={h.chamber}
            type="button"
            className={`courtyard-hall courtyard-hall--${h.chamber}${h.occupant ? "" : " is-empty"}`}
            disabled={!h.occupant}
            onClick={() => h.occupant && onPickHall(h.occupant.id)}
          >
            <span className="courtyard-hall__name">{h.name}</span>
            <span className="courtyard-hall__occupant">
              {h.occupant ? h.occupant.profile.name : "空置"}
            </span>
          </button>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npx vitest run tests/ui/courtyardHalls.test.ts`
Expected: PASS。

- [ ] **Step 5: HaremGrid 改为点宫即开院子**

`src/ui/screens/HaremGrid.tsx`：`onSelect` 语义不变（仍是"点了哪座宫"），但 MapScreen 传入的回调改为开院子。`selectedId` 不再用于信息栏，可保留（无害）或删。最小改动：保留签名不变，由 MapScreen 决定 onSelect 行为（见 Step 6）。无需改 HaremGrid 文件即可——若保留 `selectedId`，MapScreen 传 `selectedId={null}`。

- [ ] **Step 6: MapScreen 接 onOpenCourtyard**

`MapScreen.tsx`：HaremGrid 渲染处：

```tsx
          <HaremGrid
            db={db}
            state={state}
            locations={onBoard}
            selectedId={null}
            onSelect={(loc) => onOpenCourtyard(loc)}
          />
```

- [ ] **Step 7: CharacterScene 支持 focusConsortId**

`src/ui/screens/CharacterScene.tsx`：在 props 加 `focusConsortId?: string | null;`。初始化选中改为优先聚焦：

```tsx
  const focus = focusConsortId ? consorts.find((c) => c.id === focusConsortId) : undefined;
  const [activeChamber, setActiveChamber] = useState<ChamberId>(
    (focus ? chamberOf(state.standing[focus.id]) : consorts[0] ? chamberOf(state.standing[consorts[0].id]) : "main"),
  );
  const [activeId, setActiveId] = useState<string | null>(focus?.id ?? consorts[0]?.id ?? null);
```

- [ ] **Step 8: LocationScreen 透传 focusConsortId**

`src/ui/screens/LocationScreen.tsx`：props 加 `focusConsortId?: string | null;`，传给 `<CharacterScene ... focusConsortId={focusConsortId} />`。

- [ ] **Step 9: App 接线 courtyard 视图 + focus**

`src/ui/App.tsx`：
- `View` 联合类型加 `"courtyard"`。
- 新增 state：

```tsx
  const [courtyardLocId, setCourtyardLocId] = useState<string | null>(null);
  const [focusConsortId, setFocusConsortId] = useState<string | null>(null);
  const [currentBoard, setCurrentBoard] = useState<string>("palace");
```

- MapScreen 加 props：

```tsx
          onOpenCourtyard={(loc) => { setCourtyardLocId(loc.id); setView("courtyard"); }}
          onBoardChange={setCurrentBoard}
```

- 进入某侍君（从院子）：

```tsx
  const enterConsortQuarters = (palaceId: string, consortId: string) => {
    setFocusConsortId(consortId);
    setCourtyardLocId(null);
    const here = store.getState().playerLocation === palaceId;
    if (here) { enterCurrentLocation(); return; }
    const batch = buildTravelBatch(db, store.getState(), palaceId);
    if (!batch.ok) return;
    const spentAp = batch.value.some((c) => c.type === "SPEND_AP");
    const result = store.dispatchBatch(batch.value);
    if (result.ok) {
      doAutosave();
      // 复用 MapScreen.onTravelled 的结算：懿旨/敲打/转旬 + 进入对应房间
      onTravelledSettle(result.value.rolledOver, spentAp);
    }
  };
```

> `buildTravelBatch` 从 `../engine/map/travel` import。把 MapScreen 现有 `onTravelled` 回调体抽成 App 内复用函数 `onTravelledSettle(rolledOver, spentAp)`（即现在写在 `<MapScreen onTravelled={...}>` 里的那段逻辑），MapScreen 的 `onTravelled` 改为传 `onTravelledSettle`。这样院子进入与地图前往共用结算。

- 渲染 courtyard：

```tsx
      {view === "courtyard" && courtyardLocId && db.locations[courtyardLocId] && (
        <CourtyardScreen
          db={db}
          store={store ? undefined as never : undefined as never}
          state={liveState}
          registry={registry}
          location={db.locations[courtyardLocId]!}
          onPickHall={(consortId) => enterConsortQuarters(courtyardLocId!, consortId)}
          onBack={() => { setCourtyardLocId(null); setMapAtRoot(false); setView("map"); }}
        />
      )}
```

> 修正：`CourtyardScreen` 取 `state` 而非 `store`。删掉上面占位的 `store=...` 行，按签名只传 `db, state, registry, location, onPickHall, onBack`：

```tsx
      {view === "courtyard" && courtyardLocId && db.locations[courtyardLocId] && (
        <CourtyardScreen
          db={db}
          state={liveState}
          registry={registry}
          location={db.locations[courtyardLocId]!}
          onPickHall={(consortId) => enterConsortQuarters(courtyardLocId!, consortId)}
          onBack={() => { setCourtyardLocId(null); setMapAtRoot(false); setView("map"); }}
        />
      )}
```

- 把 `focusConsortId` 传入 LocationScreen：在 `<LocationScreen ... focusConsortId={focusConsortId} />`。
- 进入地图时清 focus：在打开地图的回调里（LocationScreen `onOpenMap`、各屏的 onOpenMap）调用 `setFocusConsortId(null)`，或更简单：在 `enterCurrentLocation` 之外不清，改为离开 location 时清——最小可在 MapScreen 打开处 `onOpenMap={() => { setFocusConsortId(null); ...existing... }}`。
- import：`import { CourtyardScreen } from "./screens/CourtyardScreen";` 与 `import { buildTravelBatch } from "../engine/map/travel";`。

- [ ] **Step 10: 院子样式**

`src/ui/styles.css` 末尾追加（数值可后续微调）：

```css
.courtyard { position: relative; width: 100%; height: 100%; background-size: cover; background-position: center; display: flex; flex-direction: column; }
.courtyard__bar { display: flex; align-items: center; gap: 12px; padding: 12px 16px; }
.courtyard__name { font-size: 1.2rem; color: #f4ead8; text-shadow: 0 2px 6px rgba(0,0,0,.7); }
.courtyard__halls { margin-top: auto; display: flex; justify-content: center; gap: 2.5%; padding: 0 4% 6%; }
.courtyard__halls--single { justify-content: center; }
.courtyard-hall { flex: 0 1 16%; min-height: 96px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 4px; padding: 10px; border: 1px solid rgba(180,140,90,.5); border-radius: 8px; background: rgba(20,14,11,.45); color: #f4ead8; cursor: pointer; }
.courtyard-hall.is-empty { opacity: .55; cursor: default; }
.courtyard-hall__name { font-weight: 600; }
.courtyard-hall__occupant { font-size: .85rem; opacity: .85; }
```

- [ ] **Step 11: 全量校验 + 手动验证**

Run: `npm run typecheck && npm test`
Expected: 全绿。
手动：`npm run dev` → 新游戏 → 进后宫 → 点景仁宫见 5 殿（住客/空置）→ 点有人之殿进入该侍君场景；点坤宁宫只见主殿。

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat: 后宫院子 gongdian_yuanzi（5殿/主殿），点殿进侍君场景"
```

---

## Task 5: 翻牌子全屏（fanpaizi 托盘）

**Files:**
- Modify: `src/ui/components/BedchamberPicker.tsx`、`src/ui/styles.css`
- Consumes：`registry`（需从 App 透传到 BedchamberPicker）。

**Interfaces:**
- BedchamberPicker props 增加 `registry: AssetRegistry`。

- [ ] **Step 1: 改 BedchamberPicker 为全屏**

`src/ui/components/BedchamberPicker.tsx` 整体替换为：

```tsx
/** 御书房「翻牌子」：全屏 fanpaizi 背景，居中托盘上排开宫中侍君竖刻名牌，点牌即召见。 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { inPalaceConsorts } from "../../engine/characters/presence";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function BedchamberPicker({
  db,
  state,
  registry,
  onPick,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  onPick: (charId: string) => void;
  onClose: () => void;
}) {
  const consorts = inPalaceConsorts(db, state);
  const bg = registry.background("bg.fanpaizi");

  return (
    <div
      className="fanpaizi"
      style={{ backgroundImage: `url("${bg.url}")` }}
      data-fallback={bg.isFallback || undefined}
    >
      <button type="button" className="fanpaizi__close" onClick={onClose}>关闭</button>
      <h2 className="fanpaizi__title">翻牌子</h2>
      <div className="fanpaizi__tray">
        {consorts.map((c) => {
          const st = state.standing[c.id]!;
          return (
            <button key={c.id} type="button" className="fanpaizi-tablet" onClick={() => onPick(c.id)}>
              <span className="fanpaizi-tablet__name">{c.profile.name}</span>
              <span className="fanpaizi-tablet__rank">{db.ranks[st.rank]?.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: App 透传 registry**

`src/ui/App.tsx`：`<BedchamberPicker ... />`（约 813 行）加 `registry={registry}`。

- [ ] **Step 3: 样式**

`src/ui/styles.css` 追加：

```css
.fanpaizi { position: fixed; inset: 0; z-index: 50; background-size: cover; background-position: center; display: flex; flex-direction: column; align-items: center; justify-content: center; }
.fanpaizi__title { color: #f4ead8; text-shadow: 0 2px 6px rgba(0,0,0,.7); margin-bottom: 16px; }
.fanpaizi__close { position: absolute; top: 16px; right: 16px; }
.fanpaizi__tray { display: flex; flex-wrap: wrap; gap: 14px; justify-content: center; align-items: flex-end; max-width: 70%; padding: 28px 32px; border-radius: 14px; background: rgba(40,24,16,.55); box-shadow: inset 0 2px 10px rgba(0,0,0,.5); }
.fanpaizi-tablet { writing-mode: vertical-rl; min-height: 150px; padding: 14px 10px; border-radius: 6px; border: 1px solid rgba(200,160,110,.7); background: linear-gradient(180deg, #f6e6c8, #e7cfa3); color: #4a2d18; font-weight: 600; cursor: pointer; display: flex; gap: 8px; align-items: center; }
.fanpaizi-tablet__rank { font-size: .8rem; opacity: .8; }
```

可删除 styles.css 中旧的 `.tablet-tray`/`.tablet`/`.bedchamber-picker__close` 规则（已不再引用）。

- [ ] **Step 4: 校验 + 手动**

Run: `npm run typecheck`
Expected: PASS。
手动：御书房 → 翻牌子 → 全屏背景 + 托盘名牌；点名牌召见，点关闭返回。

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/BedchamberPicker.tsx src/ui/App.tsx src/ui/styles.css
git commit -m "feat: 翻牌子改为全屏 fanpaizi 托盘"
```

---

## Task 6: BGM 系统

**Files:**
- Create: `src/ui/audio/trackFor.ts`、`src/ui/audio/AudioController.ts`、`tests/ui/trackFor.test.ts`
- Modify: `src/ui/App.tsx`

**Interfaces:**
- Produces：
  - `type TrackId = "main" | "hougong" | "jiaowai" | "market" | "wenqing";`
  - `trackFor(input: { view: string; board?: string; zone?: string }): TrackId`
  - `audioController`（模块单例）：`.play(track: TrackId)`、`.setVolume(v: number)`、`.setMuted(b: boolean)`、`.getVolume()`、`.isMuted()`。

- [ ] **Step 1: 写 trackFor 失败测试**

`tests/ui/trackFor.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { trackFor } from "../../src/ui/audio/trackFor";

describe("trackFor", () => {
  it("标题用 main", () => expect(trackFor({ view: "title" })).toBe("main"));
  it("院子用 hougong", () => expect(trackFor({ view: "courtyard" })).toBe("hougong"));
  it("地图在后宫板用 hougong", () => expect(trackFor({ view: "map", board: "hougong" })).toBe("hougong"));
  it("地图在京城板用 market", () => expect(trackFor({ view: "map", board: "jingcheng" })).toBe("market"));
  it("地图在郊外板用 jiaowai", () => expect(trackFor({ view: "map", board: "jingjiao" })).toBe("jiaowai"));
  it("后宫居所(zone=hougong)用 hougong", () => expect(trackFor({ view: "location", zone: "hougong" })).toBe("hougong"));
  it("京城地点(zone=jingcheng)用 market", () => expect(trackFor({ view: "location", zone: "jingcheng" })).toBe("market"));
  it("其余用 wenqing", () => expect(trackFor({ view: "location", zone: "palace" })).toBe("wenqing"));
});
```

- [ ] **Step 2: 确认失败**

Run: `npx vitest run tests/ui/trackFor.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 trackFor**

`src/ui/audio/trackFor.ts`：

```ts
export type TrackId = "main" | "hougong" | "jiaowai" | "market" | "wenqing";

/** 场景 → BGM 曲目。view=map 时按所看 board；其余按 playerLocation 的 zone。 */
export function trackFor(input: { view: string; board?: string; zone?: string }): TrackId {
  const { view, board, zone } = input;
  if (view === "title") return "main";
  if (view === "courtyard") return "hougong";
  const key = view === "map" ? board : zone;
  if (key === "hougong") return "hougong";
  if (key === "jingcheng") return "market";
  if (key === "jingjiao") return "jiaowai";
  return "wenqing";
}
```

- [ ] **Step 4: 测试通过**

Run: `npx vitest run tests/ui/trackFor.test.ts`
Expected: PASS。

- [ ] **Step 5: 实现 AudioController**

`src/ui/audio/AudioController.ts`：

```ts
import type { TrackId } from "./trackFor";

const TRACK_URLS: Record<TrackId, string> = {
  main: "/assets/bgm/main.mp3",
  hougong: "/assets/bgm/hougong.mp3",
  jiaowai: "/assets/bgm/jiaowai.mp3",
  market: "/assets/bgm/market.mp3",
  wenqing: "/assets/bgm/wenqing.mp3",
};

const VOL_KEY = "bgm.volume";
const MUTE_KEY = "bgm.muted";

class AudioController {
  private audio: HTMLAudioElement | null = null;
  private current: TrackId | null = null;
  private volume = 0.6;
  private muted = false;

  private ensure(): HTMLAudioElement {
    if (!this.audio) {
      const a = new Audio();
      a.loop = true;
      this.volume = Number(localStorage.getItem(VOL_KEY) ?? "0.6");
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
      a.volume = this.volume;
      a.muted = this.muted;
      this.audio = a;
    }
    return this.audio;
  }

  play(track: TrackId): void {
    const a = this.ensure();
    if (this.current === track) return;
    this.current = track;
    a.src = TRACK_URLS[track];
    void a.play().catch(() => { /* 自动播放被拦截：下次用户交互后的 play 会成功 */ });
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    localStorage.setItem(VOL_KEY, String(this.volume));
    if (this.audio) this.audio.volume = this.volume;
  }

  setMuted(b: boolean): void {
    this.muted = b;
    localStorage.setItem(MUTE_KEY, b ? "1" : "0");
    if (this.audio) this.audio.muted = b;
  }

  getVolume(): number { return this.volume; }
  isMuted(): boolean { return this.muted; }
}

export const audioController = new AudioController();
```

- [ ] **Step 6: App 接线切歌**

`src/ui/App.tsx`：
- import：`import { audioController } from "./audio/AudioController";` 与 `import { trackFor } from "./audio/trackFor";`
- 在组件体内（`db` 可用之后、return 之前）加：

```tsx
  const playerZone = db.locations[liveState.playerLocation]?.zone;
  useEffect(() => {
    audioController.play(trackFor({ view, board: currentBoard, zone: playerZone }));
  }, [view, currentBoard, playerZone]);
```

> `useEffect` 需在文件顶部 `import { useEffect, useMemo, useRef, useState } from "react";`（现有 import 补 `useEffect`）。`currentBoard` 来自 Task 4 Step 9。

- [ ] **Step 7: 校验 + 手动**

Run: `npm run typecheck && npm test`
Expected: 全绿。
手动：`npm run dev` → 标题(main) → 新游戏后内廷(wenqing) → 进后宫(hougong) → 出宫到京城(market) → 郊外(jiaowai)，切场景换歌、循环。

- [ ] **Step 8: Commit**

```bash
git add src/ui/audio src/ui/App.tsx tests/ui/trackFor.test.ts
git commit -m "feat: BGM 系统（按场景切歌、循环、音量/静音）"
```

---

## Task 7: 右上角"设置"菜单 + 读/存分离

**Files:**
- Create: `src/ui/components/SettingsMenu.tsx`
- Modify: `src/ui/components/TopStatusBar.tsx`、`src/ui/components/GameShell.tsx`、`src/ui/screens/SaveLoadScreen.tsx`、`src/ui/App.tsx`、各透传屏幕、`src/ui/styles.css`

**Interfaces:**
- `TopStatusBar`/`GameShell` 的 `onOpenSave` 改名为 `onOpenSettings`。
- `SaveLoadScreen` 新增 `mode: "load" | "save"`。
- `SettingsMenu` props：`{ db, store, storage, logger, registry, onLoaded, onReturnTitle, onClose }`。

- [ ] **Step 1: SaveLoadScreen 加 mode**

`src/ui/screens/SaveLoadScreen.tsx`：props 加 `mode: "load" | "save";`。
- 顶栏标题按 mode 显示 `mode === "load" ? "读档" : "存档"`。
- 槽位动作：`save` 模式只渲染"保存"按钮（manual 槽）；`load` 模式只渲染"读取"按钮。即把现有：

```tsx
                  {manual && gameStarted && (
                    <button type="button" onClick={() => save(slot)}>保存</button>
                  )}
                  {info?.status !== "empty" && (
                    <button type="button" onClick={() => load(slot)}>读取</button>
                  )}
```

改为：

```tsx
                  {mode === "save" && manual && gameStarted && (
                    <button type="button" onClick={() => save(slot)}>保存</button>
                  )}
                  {mode === "load" && info?.status !== "empty" && (
                    <button type="button" onClick={() => load(slot)}>读取</button>
                  )}
```

- 导入/导出区：`save` 模式只显示"导出当前进度"；`load` 模式只显示"从文件导入"（及导入预览块整段仅在 load 模式渲染）。把 `save-screen__io` 内两个按钮各自包一层 mode 判断；导入预览块外层加 `mode === "load" && pendingImport && (...)`。

- [ ] **Step 2: SettingsMenu 组件**

`src/ui/components/SettingsMenu.tsx`：

```tsx
/** 全屏设置菜单（game_setting 背景）：读档 / 存档 / 音乐 / 返回主界面。读、存分屏。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { RingBufferLogger } from "../../engine/infra/logger";
import type { KVStorage } from "../../engine/save/storage";
import type { GameStore } from "../../store/gameStore";
import { audioController } from "../audio/AudioController";
import { SaveLoadScreen } from "../screens/SaveLoadScreen";

type Pane = "menu" | "load" | "save" | "audio";

export function SettingsMenu({
  db,
  store,
  storage,
  logger,
  registry,
  onLoaded,
  onReturnTitle,
  onClose,
}: {
  db: ContentDB;
  store: GameStore;
  storage: KVStorage | null;
  logger?: RingBufferLogger;
  registry: AssetRegistry;
  onLoaded: () => void;
  onReturnTitle: () => void;
  onClose: () => void;
}) {
  const [pane, setPane] = useState<Pane>("menu");
  const [volume, setVolume] = useState(audioController.getVolume());
  const [muted, setMuted] = useState(audioController.isMuted());
  const bg = registry.background("bg.game_setting");

  if (pane === "load" || pane === "save") {
    return (
      <SaveLoadScreen
        db={db}
        store={store}
        storage={storage}
        logger={logger}
        gameStarted
        mode={pane}
        onClose={() => setPane("menu")}
        onLoaded={onLoaded}
      />
    );
  }

  return (
    <div
      className="settings-menu"
      style={{ backgroundImage: `url("${bg.url}")` }}
      data-fallback={bg.isFallback || undefined}
    >
      <button type="button" className="settings-menu__close" onClick={onClose}>返回游戏</button>
      <h1 className="settings-menu__title">设置</h1>

      {pane === "menu" && (
        <nav className="settings-menu__list">
          <button type="button" onClick={() => setPane("load")}>读档</button>
          <button type="button" onClick={() => setPane("save")}>存档</button>
          <button type="button" onClick={() => setPane("audio")}>音乐</button>
          <button type="button" onClick={onReturnTitle}>返回游戏主界面</button>
        </nav>
      )}

      {pane === "audio" && (
        <div className="settings-menu__audio">
          <label>
            音量
            <input
              type="range" min={0} max={1} step={0.05} value={volume}
              onChange={(e) => { const v = Number(e.target.value); setVolume(v); audioController.setVolume(v); }}
            />
          </label>
          <label>
            <input
              type="checkbox" checked={muted}
              onChange={(e) => { setMuted(e.target.checked); audioController.setMuted(e.target.checked); }}
            />
            静音
          </label>
          <button type="button" onClick={() => setPane("menu")}>返回</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: TopStatusBar / GameShell 改名 onOpenSettings**

`src/ui/components/TopStatusBar.tsx`：把 `onOpenSave` 改名为 `onOpenSettings`，按钮文案"存档"→"设置"：

```tsx
        {onOpenSettings && (
          <button type="button" className="topbar__btn" onClick={onOpenSettings}>
            设置
          </button>
        )}
```
（props 类型同步改名；更新文件头注释"存档"→"设置"。）

`src/ui/components/GameShell.tsx`：`onOpenSave` 改名 `onOpenSettings`，并把传给 `<TopStatusBar onOpenSave={onOpenSave} />` 改为 `onOpenSettings={onOpenSettings}`。

- [ ] **Step 4: 各屏 props 改名**

把以下文件中向 GameShell 传的 `onOpenSave` 改名为 `onOpenSettings`（props 声明 + 透传）：
- `src/ui/screens/LocationScreen.tsx`
- `src/ui/screens/MapScreen.tsx`
- `src/ui/screens/ShangshufangScreen.tsx`
- `src/ui/screens/YuqingGongScreen.tsx`
- `src/ui/screens/FengxiandianScreen.tsx`
- `src/ui/screens/CiningGongScreen.tsx`

（每个文件：props 里 `onOpenSave` → `onOpenSettings`；`<GameShell ... onOpenSave={onOpenSave}>` → `onOpenSettings={onOpenSettings}`。）

- [ ] **Step 5: App 接线 settings**

`src/ui/App.tsx`：
- 新增 state：`const [settingsOpen, setSettingsOpen] = useState(false);`
- 把各屏 `onOpenSave={() => { ...; setView("save"); }}` / `onOpenSave={() => setView("save")}` 改为 `onOpenSettings={() => setSettingsOpen(true)}`（连同 LocationScreen 里 `setSummonedConsortId(null)` 等既有副作用保留）。
- 删除/停用旧的 `view === "save"` 块（设置内已含 SaveLoadScreen）。`continueGame`/autosave 等逻辑不动。
- 渲染设置覆盖层（置于 return 顶层，与其他覆盖层并列）：

```tsx
      {settingsOpen && (
        <SettingsMenu
          db={db}
          store={store}
          storage={storage}
          logger={logger}
          registry={registry}
          onLoaded={() => { resetRollGuards(); setSettingsOpen(false); enterCurrentLocation(); }}
          onReturnTitle={() => { doAutosave(); setSettingsOpen(false); setView("title"); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
```
- import：`import { SettingsMenu } from "./components/SettingsMenu";`

- [ ] **Step 6: 样式**

`src/ui/styles.css` 追加：

```css
.settings-menu { position: fixed; inset: 0; z-index: 60; background-size: cover; background-position: center; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; }
.settings-menu__title { color: #f4ead8; text-shadow: 0 2px 6px rgba(0,0,0,.7); }
.settings-menu__close { position: absolute; top: 16px; right: 16px; }
.settings-menu__list { display: flex; flex-direction: column; gap: 12px; min-width: 220px; }
.settings-menu__list button { padding: 12px 18px; font-size: 1rem; }
.settings-menu__audio { display: flex; flex-direction: column; gap: 14px; background: rgba(20,14,11,.6); padding: 22px 28px; border-radius: 12px; color: #f4ead8; }
.settings-menu__audio label { display: flex; align-items: center; gap: 10px; }
```

- [ ] **Step 7: 校验 + 手动**

Run: `npm run typecheck && npm test`
Expected: 全绿。
手动：右上角"设置" → 菜单四项；读档只读、存档只存；音量/静音即时生效且重开仍记忆；返回主界面回标题且已 autosave。

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: 右上角设置菜单（读/存分离 + 音乐 + 返回主界面）"
```

---

## Self-Review 记录

- **Spec 覆盖**：§1→Task2；§2→Task3 Step1；§3a→Task3；§3b→Task4；§4→Task5；§5→Task6+Task1；§6→Task7；资产注册→Task1。全覆盖。
- **类型一致**：`TrackId`、`audioController` API、`hallsFor`/`Hall`、`focusConsortId`、`onOpenSettings`、`mode` 在引入与消费处命名一致。
- **占位扫描**：无 TBD/TODO；代码块均给出实际内容。
- **风险点**：①Task2 删 `harem` 后 effect `pillar` 仅余两值，funnel 的 else 分支需对应；②测试统一用 `createNewGameState(db)` 建态（已校正，非 `buildInitialState`）；③院子进入复用的 `onTravelledSettle` 抽取需保证与原 `onTravelled` 行为一致。

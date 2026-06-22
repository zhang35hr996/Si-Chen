# 场景 UI · 人物交互 · 事件流程重构 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「背景横幅 + 人物卡列表」重构为「一座舞台」，并补齐事件呈现的中央路由、事件返回上下文、候见完整生命周期——使新 UI 不会出现「事件自动跳转 / 结束回错页 / 待宣事件无法重开」。

**Architecture:** 引擎层先建呈现基础设施（`presentation` 契约、`resolveEntryMode`、中央 router、`audience` 生命周期、`EventReturnTarget`），全部纯函数 + `flags`/可选 content 字段、零存档迁移、写入走 `store.applyEffects`。UI 层随后接入：SceneShell + 各专用屏 + 场景人物条；召见/候见改立绘入场；朝议结算用引擎级快照 diff（不改 `DialogueScreen.onDone` 共享契约）。

**Tech Stack:** TypeScript · React · Vite · Vitest · Zod · 现有 Effect 漏斗 · localStorage 存档

**配套设计规格：** [`../specs/2026-06-22-scene-ui-narrative-refactor-design.md`](../specs/2026-06-22-scene-ui-narrative-refactor-design.md)（评审 r1）

## Global Constraints

- **架构规则 #1**：状态变更只经 `store.applyEffects(db, effects)`/现有 store 方法，不绕过校验/事务/Effect 结算/存档。
- **架构规则 #2**：UI 只展示引擎已确定事实，绝不生成人物/位置/事件/属性。
- **零存档迁移优先**：呈现态用既有开放 `flags`（`state/types.ts:420`）；content 新字段一律 `optional` + 推导兜底。
- **flag 键用冒号分段**：`audience:pending:<id>` / `audience:promptShownAt:<id>` / `audience:remindAt:<id>`（与项目约定一致；不混用点号）。
- **不改 `DialogueScreen.onDone` 契约**（仍 `(committed, rolledOver)`；朝议结算用快照 diff）。
- **命名约定**：content id `^[a-z][a-z0-9_]*$`；TS camelCase。content 严格 JSON（`z.strictObject`）。
- **响应式**：360/768/1280/超宽；主点击区 ≥44–48px；不依赖 hover；移动固定栏含 `env(safe-area-inset-bottom)`，stage 用 `100dvh`。
- **美术方向**：深棕黑/暗金/朱红/半透明暗板/细边框；背景铺满；支持可选 `backgroundPosition` 控制裁切焦点。
- **每 PR 验证**：`npm run typecheck && npm test && npm run lint && npm run build`（content/资产改动追加 `validate-content`/`validate-manifest`）。
- **提交信息**：`<type>: <desc>`，无 Co-Authored 署名（项目全局禁用）。

## File Structure

**新建（引擎）：** `src/engine/events/entryMode.ts`、`src/engine/events/router.ts`、`src/engine/events/audience.ts`、`src/engine/map/subLocations.ts`、`src/engine/court/agenda.ts`。
**新建（UI）：** `src/ui/components/SceneShell.tsx`、`src/ui/components/SceneCharacterBar.tsx`、`src/ui/components/AudiencePrompt.tsx`、`src/ui/components/PendingAudienceDrawer.tsx`、`src/ui/components/ChengfengDispatch.tsx`、`src/ui/screens/ZichendianScreen.tsx`、`src/ui/screens/GardenOverviewScreen.tsx`、`src/ui/screens/XuanzhengdianScreen.tsx`。
**修改：** `src/engine/content/schemas.ts`（events 加 `presentation?`；locations 加 `subLocations?`/`backgroundPosition?`）、`src/ui/App.tsx`（`EventReturnTarget`、`startEvent(id,target)`、checkpoint 改 `pickAutoStartEvent`、新视图接线）、`src/ui/screens/LocationScreen.tsx`、`src/ui/components/BedchamberPicker.tsx`、`assets/manifest.json`、`content/locations/yuhuayuan.json`、`content/events/*`、`src/ui/styles.css`。
**测试：** `tests/events/{entryMode,router,audience}.test.ts`、`tests/map/subLocations.test.ts`、`tests/court/agenda.test.ts`、`tests/ui/{sceneShell,zichendianAudience,pendingAudience,summonNoCard,sceneCharacterBar,chengfengDispatch,gardenExploration,xuanzhengAgenda,eventReturn}.test.tsx`。

---

# PR1 — 事件呈现基础设施（纯引擎/类型）

> 全部可完整 TDD，不触 UI 视觉。这是修复「自动跳转 / 回错页 / 待宣丢失」的契约层。

### Task 1.1: `presentation` schema + `resolveEntryMode`

**Files:** Modify `src/engine/content/schemas.ts`；Create `src/engine/events/entryMode.ts`；Test `tests/events/entryMode.test.ts`

**Interfaces:**
- Produces: `export type EventEntryMode = "auto_on_enter"|"request_audience"|"exploration"|"manual"|"scheduled";`
- Produces: `export function resolveEntryMode(event: GameEventContent, location: LocationContent | undefined): EventEntryMode;`
- schema: `gameEventSchema.presentation?` 判别联合（见下）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/events/entryMode.test.ts
import { resolveEntryMode } from "../../src/engine/events/entryMode";
const ev = (o = {}) => ({ id:"ev_x", title:"t", sceneId:"sc_x", checkpoint:"location_enter", condition:{all:[]}, priority:0, once:false, apCost:0, ...o });
const loc = (o = {}) => ({ id:"zichendian", zone:"palace", ...o });

test("presentation.mode wins over derivation", () => {
  expect(resolveEntryMode(ev({ presentation:{ mode:"manual" } }), loc())).toBe("manual");
});
test("court → scheduled", () => expect(resolveEntryMode(ev({ checkpoint:"court" }), loc())).toBe("scheduled"));
test("location_enter @ zichendian → request_audience", () => expect(resolveEntryMode(ev(), loc({ id:"zichendian" }))).toBe("request_audience"));
test("location_enter @ yuhuayuan → exploration", () => expect(resolveEntryMode(ev(), loc({ id:"yuhuayuan" }))).toBe("exploration"));
test("location_enter @ hougong palace → auto_on_enter", () => expect(resolveEntryMode(ev(), loc({ id:"yanhe_gong", zone:"hougong" }))).toBe("auto_on_enter"));
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 加 schema**（`gameEventSchema`，`apCost` 之后）

```ts
presentation: z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("request_audience"), audienceCharacterId: idSchema, audiencePrompt: nonEmpty }),
  z.strictObject({ mode: z.literal("exploration"), subLocationId: idSchema, eventHint: nonEmpty.optional() }),
  z.strictObject({ mode: z.literal("auto_on_enter") }),
  z.strictObject({ mode: z.literal("manual") }),
  z.strictObject({ mode: z.literal("scheduled") }),
]).optional(),
```

- [ ] **Step 4: 实现 entryMode.ts**

```ts
import type { GameEventContent, LocationContent } from "../content/schemas";
export type EventEntryMode = "auto_on_enter"|"request_audience"|"exploration"|"manual"|"scheduled";
export function resolveEntryMode(event: GameEventContent, location: LocationContent | undefined): EventEntryMode {
  if (event.presentation) return event.presentation.mode;
  if (event.checkpoint === "court") return "scheduled";
  if (event.checkpoint === "location_enter") {
    if (location?.id === "zichendian") return "request_audience";
    if (location?.id === "yuhuayuan") return "exploration";
    return "auto_on_enter";
  }
  return "auto_on_enter";
}
```

- [ ] **Step 5: 运行通过 + `npm run validate-content`（旧 content 无 presentation 仍合法）。**

- [ ] **Step 6: 提交** — `feat(events): 事件 presentation 契约 + resolveEntryMode`

### Task 1.2: 中央 router — `pickAutoStartEvent`（P0-1 核心）

**Files:** Create `src/engine/events/router.ts`；Test `tests/events/router.test.ts`

**Interfaces:**
- Consumes: `getEligibleEvents`（`engine.ts`，不变）、`resolveEntryMode`。
- Produces: `export function pickAutoStartEvent(db: ContentDB, state: GameState, checkpoint: Checkpoint, location: LocationContent | undefined): GameEventContent | null;`

- [ ] **Step 1: 写失败测试（关键回归）**

```ts
// tests/events/router.test.ts
import { pickAutoStartEvent } from "../../src/engine/events/router";
// 构造 db：同一 location_enter checkpoint 下，一个 auto_on_enter（priority 1）+ 一个 request_audience（priority 9）
test("auto checkpoint only starts auto_on_enter, never higher-priority request_audience", () => {
  const picked = pickAutoStartEvent(db, state, "location_enter", zichendianLoc);
  expect(picked?.presentation?.mode ?? "auto_on_enter").toBe("auto_on_enter");
});
test("returns null when only request_audience/exploration/manual eligible", () => {
  expect(pickAutoStartEvent(db, state, "location_enter", yuhuayuanLoc)).toBeNull();
});
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现**

```ts
import { getEligibleEvents, type Checkpoint } from "./engine";
import { resolveEntryMode } from "./entryMode";
import type { ContentDB } from "../content/loader";
import type { GameState } from "../state/types";
import type { GameEventContent, LocationContent } from "../content/schemas";
export function pickAutoStartEvent(db: ContentDB, state: GameState, checkpoint: Checkpoint, location: LocationContent | undefined): GameEventContent | null {
  return getEligibleEvents(db, state, checkpoint)
    .filter((e) => e.affordable && resolveEntryMode(e.event, location) === "auto_on_enter")
    .map((e) => e.event)[0] ?? null;
}
```

- [ ] **Step 4: 运行通过。**

- [ ] **Step 5: 提交** — `feat(events): pickAutoStartEvent 中央呈现路由（仅 auto_on_enter 自动启动）`

### Task 1.3: audience 生命周期（P0-3）

**Files:** Create `src/engine/events/audience.ts`；Test `tests/events/audience.test.ts`

**Interfaces:**
- Produces:
  - `export type AudienceStatus = "available"|"pending"|"suppressed";`
  - `export interface AudienceItem { event: GameEventContent; status: AudienceStatus; }`
  - `export function defer(eventId: string, dayIndex: number): EventEffect[];`
  - `export function clearAudience(eventId: string): EventEffect[];`
  - `export function shouldRemind(state: GameState, eventId: string): boolean;`
  - `export function audienceStatus(state: GameState, eventId: string): AudienceStatus;`
  - `export function getAudienceQueue(db: ContentDB, state: GameState, locationId: string): AudienceItem[];`
  - `export function pendingAudienceCount(db: ContentDB, state: GameState, locationId: string): number;`
  - const `AUDIENCE_REMIND_AFTER_DAYS = 3;`
- flag 键：`audience:pending:<id>` / `audience:promptShownAt:<id>` / `audience:remindAt:<id>`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/events/audience.test.ts
import { defer, clearAudience, shouldRemind, audienceStatus, getAudienceQueue, pendingAudienceCount, AUDIENCE_REMIND_AFTER_DAYS } from "../../src/engine/events/audience";

test("defer sets pending + promptShownAt + remindAt", () => {
  expect(defer("ev_a", 5)).toEqual([
    { type:"flag", key:"audience:pending:ev_a", value:true },
    { type:"flag", key:"audience:promptShownAt:ev_a", value:5 },
    { type:"flag", key:"audience:remindAt:ev_a", value:5 + AUDIENCE_REMIND_AFTER_DAYS },
  ]);
});
test("status: not-pending=available; pending+notDue=suppressed; pending+due=pending", () => {
  const base = (f) => ({ flags:f, calendar:{ dayIndex:10 } } as any);
  expect(audienceStatus(base({}), "ev_a")).toBe("available");
  expect(audienceStatus(base({ "audience:pending:ev_a":true, "audience:remindAt:ev_a":99 }), "ev_a")).toBe("suppressed");
  expect(audienceStatus(base({ "audience:pending:ev_a":true, "audience:remindAt:ev_a":10 }), "ev_a")).toBe("pending");
});
test("shouldRemind true only when remindAt reached", () => {
  const s = (d, r) => ({ flags:{ "audience:pending:ev_a":true, "audience:remindAt:ev_a":r }, calendar:{ dayIndex:d } } as any);
  expect(shouldRemind(s(4,5), "ev_a")).toBe(false);
  expect(shouldRemind(s(5,5), "ev_a")).toBe(true);
});
test("clearAudience zeroes all three flags", () => {
  expect(clearAudience("ev_a")).toEqual([
    { type:"flag", key:"audience:pending:ev_a", value:false },
    { type:"flag", key:"audience:promptShownAt:ev_a", value:0 },
    { type:"flag", key:"audience:remindAt:ev_a", value:0 },
  ]);
});
test("getAudienceQueue excludes once-fired ghost flags (no phantom count)", () => {
  // db: ev_a once+already in eventLog, but audience:pending:ev_a still true
  expect(getAudienceQueue(db, stateWithFiredGhost, "zichendian").map(i=>i.event.id)).not.toContain("ev_a");
  expect(pendingAudienceCount(db, stateWithFiredGhost, "zichendian")).toBe(0);
});
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现**

```ts
import type { GameState } from "../state/types";
import type { ContentDB } from "../content/loader";
import type { EventEffect, GameEventContent } from "../content/schemas";
import { getEligibleEvents } from "./engine";
import { resolveEntryMode } from "./entryMode";
import { hasEventFired } from "./conditions";

export const AUDIENCE_REMIND_AFTER_DAYS = 3;
export type AudienceStatus = "available"|"pending"|"suppressed";
export interface AudienceItem { event: GameEventContent; status: AudienceStatus; }
const PENDING = (id:string) => `audience:pending:${id}`;
const SHOWN = (id:string) => `audience:promptShownAt:${id}`;
const REMIND = (id:string) => `audience:remindAt:${id}`;

export function defer(eventId:string, dayIndex:number): EventEffect[] {
  return [
    { type:"flag", key:PENDING(eventId), value:true },
    { type:"flag", key:SHOWN(eventId), value:dayIndex },
    { type:"flag", key:REMIND(eventId), value:dayIndex + AUDIENCE_REMIND_AFTER_DAYS },
  ];
}
export function clearAudience(eventId:string): EventEffect[] {
  return [
    { type:"flag", key:PENDING(eventId), value:false },
    { type:"flag", key:SHOWN(eventId), value:0 },
    { type:"flag", key:REMIND(eventId), value:0 },
  ];
}
export function shouldRemind(state:GameState, eventId:string): boolean {
  if (state.flags[PENDING(eventId)] !== true) return false;
  const r = state.flags[REMIND(eventId)];
  return typeof r === "number" && state.calendar.dayIndex >= r;
}
export function audienceStatus(state:GameState, eventId:string): AudienceStatus {
  if (state.flags[PENDING(eventId)] !== true) return "available";
  return shouldRemind(state, eventId) ? "pending" : "suppressed";
}
export function getAudienceQueue(db:ContentDB, state:GameState, locationId:string): AudienceItem[] {
  // getEligibleEvents 已评估 condition（含 atLocation），故命中 = 当前 eligible 且宿主地点成立。
  const eligible = getEligibleEvents(db, state, "location_enter").map((e)=>e.event);
  const loc = db.locations[locationId];
  return eligible
    .filter((event)=> resolveEntryMode(event, loc) === "request_audience")
    .filter((event)=> !(event.once && hasEventFired(state, event.id)))   // once 已发 → 过期，不计数
    .map((event)=>({ event, status: audienceStatus(state, event.id) }))
    .sort((a,b)=> b.event.priority - a.event.priority || a.event.id.localeCompare(b.event.id));
}
export function pendingAudienceCount(db:ContentDB, state:GameState, locationId:string): number {
  return getAudienceQueue(db, state, locationId).length;
}
```

> 实现注：宿主地点判定用事件 `condition` 的 `atLocation`（已有 DSL）。`getEligibleEvents` 已含 condition 评估，故 `eligibleIds` 命中即代表当前 `atLocation` 成立。

- [ ] **Step 4: 运行通过。**

- [ ] **Step 5: 提交** — `feat(events): 候见生命周期（三态 + 队列 + 提醒 + 清理，flags 承载）`

### Task 1.4: `EventReturnTarget` + App 接线（P0-2）

**Files:** Modify `src/ui/App.tsx`；Test `tests/ui/eventReturn.test.tsx`

**Interfaces:**
- Produces（App 内或 `src/ui/eventReturn.ts`）：`export type EventReturnTarget = {kind:"map"} | {kind:"location";locationId:string} | {kind:"zichendian"} | {kind:"garden";subLocationId?:string} | {kind:"xuanzhengdian"};`
- `startEvent(eventId: string, returnTarget: EventReturnTarget)`；`restoreReturn(target: EventReturnTarget)`。

- [ ] **Step 1: 写失败测试** — 以测试替身记录：`startEvent("ev_x",{kind:"zichendian"})` 完成后 `restoreReturn` 把 view 设回 `"zichendian"`；`{kind:"garden",subLocationId:"taiyechi"}` 回 garden 且保留 subId；`{kind:"location",locationId:"yanhe_gong"}` 回该宫；中途退出按同 target 回（非 `goHome`）。

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现** — `startEvent` 增第二参 `returnTarget`，存 `setEventReturn(target)`；`DialogueScreen.onDone` 完成/退出后调 `restoreReturn(eventReturn)`（替换 `goHome()`/`setView("location")`），其中保留既有转旬补跑（`reactionRollover`/`runCheckpoints`），仅落点按 target；`court` 会话 onDone 同理用 `{kind:"xuanzhengdian"}`。链事件继承同 target。

- [ ] **Step 4: 运行通过 + `npm run typecheck`。**

- [ ] **Step 5: 提交** — `feat(ui): EventReturnTarget 事件返回上下文，替换一律 goHome`

### Task 1.5: PR1 回归

- [ ] `npm run typecheck && npm test && npm run lint && npm run build && npm run validate-content`，全绿。提交 `test(events): PR1 呈现基础设施回归`。

---

# PR2 — 紫宸殿

> 依赖 PR1。本 PR 把候见/召见/乘风落到紫宸殿专用屏，并移除该殿人物卡。

### Task 2.1: SceneShell + 样式（含 backgroundPosition / dvh / safe-area）

**Files:** Create `src/ui/components/SceneShell.tsx`；Test `tests/ui/sceneShell.test.tsx`；Modify `src/ui/styles.css`、`schemas.ts`（`locationSchema.backgroundPosition?`）

**Interfaces:** `export function SceneShell(props: { background:string; isFallback?:boolean; backgroundPosition?:string; stage?:ReactNode; narrative?:ReactNode; actions?:ReactNode; ariaLabel:string }): JSX.Element`

- [ ] **Step 1: 写失败测试** — 渲染 background/narrative/actions 三槽；`backgroundPosition` 透传到 stage style。
- [ ] **Step 2–6:** 失败 → 加 `locationSchema.backgroundPosition: nonEmpty.optional()` → 实现组件（`background-position` 用 prop，缺省 center）→ 样式：`.scene-shell__stage{background-size:cover;min-height:100dvh}`、`.scene-shell__actions{padding-bottom:env(safe-area-inset-bottom)}`、`@media(prefers-reduced-motion:reduce)` 关过渡 → 通过 → 提交 `feat(ui): SceneShell 统一外壳（裁切焦点/移动安全区）`。

### Task 2.2: AudiencePrompt（非阻塞，文案/立绘来自 presentation）

**Files:** Create `src/ui/components/AudiencePrompt.tsx`；Test `tests/ui/audiencePrompt.test.tsx`

**Interfaces:** `export function AudiencePrompt(props: { characterName:string; line:string; portraitUrl:string; affordable:boolean; disabledReason?:string; onAdmit:()=>void; onDefer:()=>void }): JSX.Element`

- [ ] **Step 1: 写失败测试** — 渲染叙事 `line` + 候见者名；`[宣进来]`→`onAdmit`、`[记入待宣]`→`onDefer`；容器**无** `modal-backdrop` class；`affordable=false` 时宣入禁用并显 `disabledReason`。
- [ ] **Step 2–5:** 失败 → 实现（语义 button、`aria-label`）→ 通过 → 提交 `feat(ui): 非阻塞候见提示 AudiencePrompt`。

### Task 2.3: PendingAudienceDrawer（待宣列表，可重开）

**Files:** Create `src/ui/components/PendingAudienceDrawer.tsx`；Test `tests/ui/pendingAudience.test.tsx`

**Interfaces:** `export function PendingAudienceDrawer(props: { items: AudienceItem[]; characterNameOf:(id:string)=>string; onAdmit:(eventId:string)=>void; onClose:()=>void }): JSX.Element`

- [ ] **Step 1: 写失败测试** — 列出 pending/suppressed 项（候见者名 + prompt）；点某项 → `onAdmit(eventId)`；空列表显「当前无待宣事务」。
- [ ] **Step 2–5:** 失败 → 实现（底部 Sheet/右抽屉，焦点管理 + Escape 关闭）→ 通过 → 提交 `feat(ui): 待宣列表 PendingAudienceDrawer`。

### Task 2.4: ZichendianScreen + App 接线（候见 + 默认态 + 召见立绘）

**Files:** Create `src/ui/screens/ZichendianScreen.tsx`；Modify `src/ui/App.tsx`（`view==="zichendian"`、`enterCurrentLocation` 路由）、`src/ui/components/BedchamberPicker.tsx`（响应式对象抽屉）；Test `tests/ui/zichendianAudience.test.tsx`、`tests/ui/summonNoCard.test.tsx`

**Interfaces:**
- Consumes: `getAudienceQueue`/`pendingAudienceCount`/`defer`/`clearAudience`、`startEvent(id,{kind:"zichendian"})`、`canSummon`。
- 默认态：摘要只显真实项（候见数 + 可批阅奏折，**不显虚构「待批奏折:3」**）；操作栏：奏折/召见/传乘风/休息/离开。

- [ ] **Step 1: 写失败测试（关键回归）**

```tsx
// tests/ui/zichendianAudience.test.tsx
test("no audience → no character cards, no prompt, no fabricated counts", /* 断言无 CharacterCard、无 待批奏折数字 */);
test("request_audience → non-blocking AudiencePrompt (no modal-backdrop)", /* … */);
test("宣进来 → startEvent(id, {kind:'zichendian'})", /* … */);
test("记入待宣 → applyEffects(defer) 调用，提示关闭", /* … */);
test("re-enter while suppressed → prompt NOT shown", /* … */);
test("remindAt reached (pending) → prompt shown again", /* … */);
test("待宣列表点项 → 宣入开始", /* … */);
// summonNoCard.test.tsx
test("召见侍君 → 立绘入场，无 CharacterCard；结束恢复默认态", /* … */);
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现 ZichendianScreen** — `SceneShell`：stage=背景+事务摘要（`候见 · {pendingAudienceCount}`）；narrative=`getAudienceQueue` 中首个 `status∈{available,pending}` 项渲染 `AudiencePrompt`（文案/立绘取 `event.presentation`）；actions=奏折/召见/传乘风/休息/离开 + 「候见 · N」开 `PendingAudienceDrawer`。

- [ ] **Step 4: App 接线** — `enterCurrentLocation`：`loc==="zichendian"` → `setView("zichendian")`；加 `view==="zichendian"` 渲染块；`onDefer={(id)=>{store.applyEffects(db, defer(id, dayIndex)); doAutosave();}}`；`onAdmit={(id)=>startEvent(id,{kind:"zichendian"})}`；事件**成功提交**后在 onDone 内 `store.applyEffects(db, clearAudience(id))`。召见走升级版 `BedchamberPicker` → `setSummonedConsortId(id)` → 立绘入场（复用 `CharacterScene`/`ReactionScreen`），**不渲染 CharacterCard**。

- [ ] **Step 5: 运行通过 + `npm run typecheck && npm test`。**

- [ ] **Step 6: 标注 content** — 紫宸殿 `location_enter` 事件（司礼类）加 `presentation:{mode:"request_audience", audienceCharacterId:"wei_ling", audiencePrompt:"司礼卫绫正在殿外候见，似有宫务需要禀奏。"}`；`npm run validate-content`。

- [ ] **Step 7: 提交** — `feat(ui): 紫宸殿候见/待宣/召见立绘，移除人物卡`

### Task 2.5: ChengfengDispatch 乘风传令

**Files:** Create `src/ui/components/ChengfengDispatch.tsx`；Modify `src/ui/App.tsx`；Test `tests/ui/chengfengDispatch.test.tsx`

**Interfaces:** `export function ChengfengDispatch(props: { interruptible:boolean; disabledReason?:string; onSummonConsort:()=>void; onManageRank:()=>void; onRelocate:()=>void; onBestow:()=>void; onPhysician:()=>void; onClose:()=>void }): JSX.Element`

- [ ] **Step 1: 写失败测试** — 可中断场景点「传乘风」→ 乘风台词 + 谕令菜单；选项调对应回调（走现有 `applyRankOp`/`buildRelocate`/`BestowModal`，**不新增业务**）；`interruptible=false`（关键事件/原子操作）→ 入口禁用 + `disabledReason`；快速双击不重复打开（去抖）。
- [ ] **Step 2–5:** 失败 → 实现（挂 SceneShell 操作栏；关闭后回原场景焦点；不嵌套多层 Modal）→ 通过 → 提交 `feat(ui): 乘风传令谕令菜单（空闲/普通互动可用）`。

### Task 2.6: PR2 回归 — `typecheck/test/lint/build/validate-content` 全绿，提交。

---

# PR3 — 普通地点与御花园

> 依赖 PR1。场景人物条 + 后宫直入 + 御花园探索。

### Task 3.1: SceneCharacterBar（P0-8：移除卡后保留人物入口）

**Files:** Create `src/ui/components/SceneCharacterBar.tsx`；Test `tests/ui/sceneCharacterBar.test.tsx`

**Interfaces:** `export function SceneCharacterBar(props: { characters:{id:string;name:string;role:string}[]; onFocus:(id:string)=>void }): JSX.Element`

- [ ] **Step 1: 写失败测试** — 列在场人物名+身份（来自 `presentAt`）；点击 → `onFocus(id)`；非完整卡（无容貌/健康/恩宠数值与全部管理按钮）。
- [ ] **Step 2–5:** 失败 → 实现（桌面侧条/手机底部 Sheet）→ 通过 → 提交 `feat(ui): 场景人物条（轻量人物选择器）`。

### Task 3.2: LocationScreen 移除人物卡 + 接 SceneCharacterBar + 后宫直入

**Files:** Modify `src/ui/screens/LocationScreen.tsx`（删 `location-screen__present`/`summoned`/`event-overlay`/`eventsDismissed`）、`src/ui/App.tsx`（后宫 `auto_on_enter` 直入，返回 `{kind:"location",locationId}`）；Test `tests/ui/autoOnEnter.test.tsx`

- [ ] **Step 1: 写失败测试** — 普通地点不出 `CharacterCard`，出 `SceneCharacterBar`；后宫有 `auto_on_enter` 事件 → 直接 `startEvent(id,{kind:"location",locationId})`，无「是否处理」弹窗；事件结束回该宫。
- [ ] **Step 2–5:** 失败 → 删旧分支 + 接 SceneCharacterBar + checkpoint 改 `pickAutoStartEvent` → 通过 → 提交 `refactor(ui): 普通地点移除人物卡/阻塞弹窗，接场景人物条与后宫直入`。

### Task 3.3: 御花园 subLocations schema + manifest + 调度

**Files:** Modify `schemas.ts`（`locationSchema.subLocations?`）、`assets/manifest.json`、`content/locations/yuhuayuan.json`、`content/events/*`（御花园事件加 `presentation:{mode:"exploration",subLocationId,...}`）；Create `src/engine/map/subLocations.ts`；Test `tests/map/subLocations.test.ts`

> **前置同步：** `git fetch origin && git rebase origin/main`，确认 `public/assets/backgrounds/{jiangxuexuan,taiyechi,fubiting,tuixiushan}.png` 存在。

**Interfaces:**
- schema: `subLocations?: { id, name, backgroundKey, description }[]`（`description` 为静态环境，无人物暗示）。
- Produces: `export function pickSubLocationEvent(db, state, locId, subId): GameEventContent | null;`

- [ ] **Step 1: 写失败测试**

```ts
test("binds via presentation.subLocationId (static, not flag)", /* 命中 subId 的 exploration 事件 */);
test("at most one event, highest priority wins; tie by id asc", /* … */);
test("no eligible event → null (普通游览)", /* … */);
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: schema** — `subLocations: z.array(z.strictObject({ id:idSchema, name:nonEmpty, backgroundKey:nonEmpty, description:nonEmpty })).optional(),`

- [ ] **Step 4: manifest** — 加 4 条（同 `bg.yuhuayuan` 形）：

```json
"bg.jiangxuexuan": { "path":"backgrounds/jiangxuexuan.png", "kind":"background", "placeholder":false },
"bg.taiyechi":     { "path":"backgrounds/taiyechi.png",     "kind":"background", "placeholder":false },
"bg.fubiting":     { "path":"backgrounds/fubiting.png",     "kind":"background", "placeholder":false },
"bg.tuixiushan":   { "path":"backgrounds/tuixiushan.png",   "kind":"background", "placeholder":false }
```
运行 `npm run validate-manifest`。

- [ ] **Step 5: 实现调度**

```ts
import { getEligibleEvents } from "../events/engine";
import { resolveEntryMode } from "../events/entryMode";
export function pickSubLocationEvent(db, state, locId, subId): GameEventContent | null {
  const loc = db.locations[locId];
  return getEligibleEvents(db, state, "location_enter")
    .filter((e)=> e.affordable
      && resolveEntryMode(e.event, loc) === "exploration"
      && e.event.presentation?.mode === "exploration"
      && e.event.presentation.subLocationId === subId)
    .map((e)=>e.event)[0] ?? null;
}
```

- [ ] **Step 6: yuhuayuan content** — 加 4 子地点（**静态 description，无人物踪迹**，P0-6）：

```json
"subLocations": [
  { "id":"jiangxuexuan", "name":"绛雪轩", "backgroundKey":"bg.jiangxuexuan", "description":"轩前海棠成荫，朱栏曲折，阶下苔痕半绿。" },
  { "id":"taiyechi",     "name":"太液池", "backgroundKey":"bg.taiyechi",     "description":"池水开阔，映着宫墙与垂柳，水榭临波。" },
  { "id":"fubiting",     "name":"浮碧亭", "backgroundKey":"bg.fubiting",     "description":"亭立水心，四面通透，檐角风铃轻响。" },
  { "id":"tuixiushan",   "name":"堆秀山", "backgroundKey":"bg.tuixiushan",   "description":"叠石为山，磴道盘曲，山巅御景亭可望宫苑。" }
]
```
人物/事件线索仅由命中事件的 `presentation.eventHint` 提供。运行 `npm run validate-content`。

- [ ] **Step 7: 运行通过。提交** — `feat(map): 御花园子地点 schema + manifest + 静态描述 + 事件调度`

### Task 3.4: GardenOverviewScreen + App 接线

**Files:** Create `src/ui/screens/GardenOverviewScreen.tsx`；Modify `src/ui/App.tsx`（`View` 加 `"garden"`；进御花园先总览）；Test `tests/ui/gardenExploration.test.tsx`

- [ ] **Step 1: 写失败测试** — 御花园先显 4 子地点入口（读 `subLocations`，桌面卡片/手机大区块），各显**静态 description**；点有事件子地点 → `startEvent(id,{kind:"garden",subLocationId})`，事件结束回该子地点；点无事件子地点 → 普通游览（只 description，无人物踪迹）。
- [ ] **Step 2–5:** 失败 → 实现 `SceneShell` 总览 + 接线（`pickSubLocationEvent` 命中 `eventHint` 才显线索）→ 通过 → 提交 `feat(ui): 御花园子地点探索总览（静态描述/动态线索分离）`。

### Task 3.5: PR3 回归 — 全绿，提交。

---

# PR4 — 宣政殿与视觉收尾

> 依赖 PR1。议程/朝议结果用引擎快照 diff，不改 onDone 契约。

### Task 4.1: court 议程预览 + 快照 diff（P0-7 方案 B）

**Files:** Create `src/engine/court/agenda.ts`；Test `tests/court/agenda.test.ts`

**Interfaces:**
- `export function courtAgendaPreview(db, state): { id:string; title:string }[];`（同 `beginCourt` 种子 `court:{rngSeed}:{dayIndex}`）
- `export interface CourtMetrics { resources: Record<string, number>; favor: Record<string, number>; }`
- `export function snapshotCourtMetrics(state): CourtMetrics;`
- `export function diffCourtMetrics(before, after): { resourceDeltas:{key:string;delta:number}[]; attitudeDeltas:{char:string;delta:number}[] };`

- [ ] **Step 1: 写失败测试**

```ts
test("preview ids === pickCourtAffairs(same seed)", /* 断言一致 */);
test("snapshot+diff captures resource net change", /* 改 nation.treasury 前后 diff */);
test("diff captures favor (attitude) change for participants", /* 改 standing[x].favor */);
test("empty pool → empty preview", /* … */);
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现** — `courtAgendaPreview` 调 `pickCourtAffairs(db, \`court:${state.rngSeed}:${state.calendar.dayIndex}\`).map(id=>({id,title:db.events[id]?.title??id}))`；`snapshotCourtMetrics` 抓 `resources`（扁平化 sovereign/nation 数值）+ 各 `standing[*].favor`；`diffCourtMetrics` 输出非零差值（资源 + favor）。

- [ ] **Step 4: 运行通过。提交** — `feat(court): 议程预览 + 快照 diff 结算摘要（资源+态度）`

### Task 4.2: XuanzhengdianScreen + 朝议结果页

**Files:** Create `src/ui/screens/XuanzhengdianScreen.tsx`；Modify `src/ui/App.tsx`（`View` 加 `"xuanzhengdian"`；宣政殿路由该屏；`beginCourt` 存 `snapshotCourtMetrics`，court 结束 `diffCourtMetrics` 存结果态；court onDone 返回 `{kind:"xuanzhengdian"}`）；Test `tests/ui/xuanzhengAgenda.test.tsx`

- [ ] **Step 1: 写失败测试** — 有议程显 `courtAgendaPreview` 标题 + 「升朝」；无议程显合理空状态（非空白）；上朝逐议题（沿用）；结束显**真实** `diffCourtMetrics`（资源 + 态度）结果页（查看记录/召见官员/返回）。
- [ ] **Step 2–5:** 失败 → 实现 `SceneShell` 议程屏 + 结果页（保留 `beginCourt`/`CourtSession`）→ 通过 → 提交 `feat(ui): 宣政殿议程屏与真实朝议结果`。

### Task 4.3: 视觉权重 + 响应式

**Files:** Modify `src/ui/styles.css`；（验证）`npm run dev` 人工 + 可选 Playwright

- [ ] **Step 1: 加四级权重 + 断点样式**（纯 CSS）：主操作金色实边 ≥44px；次操作弱边半透明入「更多」；信息区细分隔线；`@media(max-width:480px)` 单列、主立绘单显、底部固定栏含 safe-area。
- [ ] **Step 2: 人工验证 360/768/1280/超宽**（`npm run dev`）。**不写 jsdom 假响应式快照（P1-5）**；如做截图回归则用 `npm run test:e2e`（Playwright）。
- [ ] **Step 3: 提交** — `style(ui): 视觉权重四级与响应式断点`

### Task 4.4: 清理 + 全量回归

**Files:** Delete 死代码/死样式（`eventsDismissed`/`location-screen__present`/`summoned-consort`/`event-overlay`、紫宸殿迁出后 LocationScreen 死分支、FreeView 宣政殿分支保留冷宫/寺庙）

- [ ] **Step 1:** `grep -rn "eventsDismissed\|location-screen__present\|summoned-consort\|event-overlay" src/` 确认无引用后删除。
- [ ] **Step 2:** `npm run typecheck && npm test && npm run lint && npm run build && npm run validate-content && npm run validate-manifest` 全绿。
- [ ] **Step 3: 提交** — `refactor(ui): 清理被 SceneShell 取代的旧布局与死样式`

---

## Self-Review（规格覆盖核对）

| 规格条目 | 任务 |
|----------|------|
| §3.1 presentation 契约 | Task 1.1 |
| §3.2 中央路由（P0-1） | Task 1.2, 3.2 |
| §3.3 候见生命周期（P0-3） | Task 1.3, 2.2, 2.3, 2.4 |
| §3.4 返回上下文（P0-2） | Task 1.4, 2.4, 3.2, 3.4, 4.2 |
| §4 SceneShell（P1-4） | Task 2.1 |
| §5.3 场景人物条（P0-8） | Task 3.1, 3.2 |
| §6.1 真实摘要（P1-1） | Task 2.4 |
| §6.2/6.3 候见/待宣 | Task 2.2, 2.3, 2.4 |
| §6.4 召见无卡 | Task 2.4 |
| §6.5 乘风范围（P1-2） | Task 2.5 |
| §7 后宫直入 | Task 3.2 |
| §8 御花园（P0-5/P0-6） | Task 3.3, 3.4 |
| §9 朝议结算（P0-7） | Task 4.1, 4.2 |
| §11 响应式/视觉（P1-5） | Task 4.3 |
| §12 存档零迁移 | Task 1.1,1.3,3.3 |
| §13 测试 | 各 Task TDD |
| §14 清理 | Task 4.4 |

**执行时仍需确认：**
- `getAudienceQueue` 的「宿主地点判定」依赖事件 `condition.atLocation`（Task 1.3 实现注）；若某候见事件不写 `atLocation`，需在 content 补齐或扩判定。执行 Task 1.3 时按真实 content 复核。
- 乘风 `interruptible` 判定（Task 2.5）：MVP 由 App 按 `view`/`activeEventId`/是否原子操作中硬判定；后续可下沉 content。
- Task 1.4/2.4/4.2 触及 `App.tsx` rollover/checkpoint 回旋逻辑（`reactionRollover`/`runCheckpoints`）——改返回落点须保留转旬补跑路径，测试覆盖。

# 场景 UI · 人物交互 · 事件流程重构 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「背景横幅 + 人物卡列表」的地点 UI 重构为「一座舞台」：人物按需出场、事件场景化、行政移入面板，并以确定性的候见生命周期修复「稍后再说」反复弹出。

**Architecture:** 引擎层新增两个纯函数模块（`audience.ts` 呈现生命周期、`entryMode` 推导）+ 御花园子地点调度，全部以 `flags`/可选 content 字段承载、零存档迁移、所有写入走 `store.applyEffects` 漏斗。UI 层抽出 `SceneShell` 统一外壳，紫宸殿/宣政殿改专用屏，召见与候见改为立绘入场而非人物卡。

**Tech Stack:** TypeScript · React · Vite · Vitest · Zod（content schema）· 现有 `store.applyEffects` Effect 漏斗 · localStorage 存档（`saveSystem.ts`）

**配套设计规格：** [`../specs/2026-06-22-scene-ui-narrative-refactor-design.md`](../specs/2026-06-22-scene-ui-narrative-refactor-design.md)

## Global Constraints

- **架构规则 #1**：所有状态变更只经 `store.applyEffects(db, effects)`/现有 store 方法，绝不在组件内直改状态、绝不绕过校验/事务/Effect 结算/存档。
- **架构规则 #2**：UI 只展示引擎已确定的事实（当前人物/地点/事件/可执行操作/结算结果），绝不自行生成人物关系/位置/事件/属性变化/角色状态。
- **零存档迁移优先**：呈现态用既有开放 `flags: Record<string, FlagValue>`（`state/types.ts:420`）；content 新字段一律 `optional` + 推导兜底。仅在确需结构化字段时才升 `SAVE_FORMAT_VERSION`（当前 6）并加一级 `MIGRATIONS`。
- **命名约定**：content id `^[a-z][a-z0-9_]*$`（`idSchema`）；flag 键 `:` 分段（如 `audience.pending.<eventId>`）；TS camelCase。
- **content 严格 JSON**：无注释、无尾逗号；`z.strictObject` 拒绝未知键。
- **响应式**：360/768/1280/超宽四档可用；主点击区 ≥44–48px；不依赖 hover。
- **美术方向**：深棕黑/暗金/朱红/半透明暗板/细边框装饰角；背景铺满主视口。
- **可中断/去抖**：动画不阻塞事件态；结算不依赖 CSS 动画结束；快速点击不重复入场/重复结算。
- **每阶段验证命令**：`npm run typecheck && npm test && npm run lint && npm run build`（content 改动追加 `npm run validate-content`）。
- **提交信息**：`<type>: <desc>`（feat/fix/refactor/docs/test/chore），无 Co-Authored 署名（项目全局禁用）。

## File Structure

**新建：**
- `src/engine/events/audience.ts` — 候见呈现生命周期纯函数（`audienceStatus`/`defer`/`shouldRemind`/`clearAudience`/`pendingAudienceCount`）。
- `src/engine/events/entryMode.ts` — `resolveEntryMode(event, location)` 推导纯函数。
- `src/engine/map/subLocations.ts` — `pickSubLocationEvent(db, state, locId, subId)` 御花园子地点事件调度。
- `src/engine/court/agenda.ts` — `courtAgendaPreview(db, state)`（复用 `pickCourtAffairs` 种子）+ `summarizeCourtOutcome(effects)`。
- `src/ui/components/SceneShell.tsx` — 统一场景外壳（stage/narrative/actions 槽）。
- `src/ui/components/AudiencePrompt.tsx` — 非阻塞候见提示（宣入/记入待宣）。
- `src/ui/screens/ZichendianScreen.tsx` — 紫宸殿专用工作台（取代 `LocationScreen` 通用分支）。
- `src/ui/screens/XuanzhengdianScreen.tsx` — 宣政殿议程屏（取代 `FreeViewScreen` 单按钮）。
- `src/ui/components/ChengfengDispatch.tsx` — 乘风传令谕令菜单。
- `src/ui/screens/GardenOverviewScreen.tsx` — 御花园子地点总览。
- 对应测试：`tests/events/audience.test.ts`、`tests/events/entryMode.test.ts`、`tests/map/subLocations.test.ts`、`tests/court/agenda.test.ts`、`tests/ui/zichendianAudience.test.tsx`、`tests/ui/summonNoCard.test.tsx`、`tests/ui/chengfengDispatch.test.tsx`、`tests/ui/gardenExploration.test.tsx`、`tests/ui/xuanzhengAgenda.test.tsx`。

**修改：**
- `src/engine/content/schemas.ts` — `gameEventSchema` 加 `entryMode?`；`locationSchema` 加 `subLocations?`。
- `src/ui/screens/LocationScreen.tsx` — 移除通用人物卡分支与阻塞事件弹窗；紫宸殿分流到 `ZichendianScreen`。
- `src/ui/App.tsx` — 接线新屏/候见/乘风；`View` 增 `xuanzhengdian`/`garden`；召见改立绘入场。
- `src/ui/components/BedchamberPicker.tsx` — 升级为响应式对象选择抽屉（简化信息）。
- `src/ui/styles.css` — SceneShell/候见/视觉权重/响应式断点。
- `content/locations/yuhuayuan.json` — 加 `subLocations`；御花园事件标 `entryMode`。
- `content/events/*`、`content/locations/*` — 关键事件标 `entryMode`（紫宸殿 request_audience / 后宫 auto_on_enter）。

---

## Phase 1 — Scene Shell

### Task 1: SceneShell 组件 + 样式

**Files:**
- Create: `src/ui/components/SceneShell.tsx`
- Test: `tests/ui/sceneShell.test.tsx`
- Modify: `src/ui/styles.css`（追加 `.scene-shell*`）

**Interfaces:**
- Produces: `export function SceneShell(props: { background: string; isFallback?: boolean; stage?: ReactNode; narrative?: ReactNode; actions?: ReactNode; ariaLabel: string }): JSX.Element` — 背景铺满 + 三槽布局 + 底部渐变遮罩。

- [ ] **Step 1: 写失败测试**

```tsx
// tests/ui/sceneShell.test.tsx
import { render, screen } from "@testing-library/react";
import { SceneShell } from "../../src/ui/components/SceneShell";

test("renders background, narrative and actions slots", () => {
  render(
    <SceneShell background="bg.png" ariaLabel="紫宸殿"
      narrative={<p>场景描述</p>} actions={<button>奏折</button>} />,
  );
  expect(screen.getByLabelText("紫宸殿")).toBeInTheDocument();
  expect(screen.getByText("场景描述")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "奏折" })).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行确认失败** — `npx vitest run tests/ui/sceneShell.test.tsx`，预期 FAIL（模块不存在）。

- [ ] **Step 3: 实现**

```tsx
// src/ui/components/SceneShell.tsx
import type { ReactNode } from "react";

export function SceneShell({
  background, isFallback, stage, narrative, actions, ariaLabel,
}: {
  background: string; isFallback?: boolean;
  stage?: ReactNode; narrative?: ReactNode; actions?: ReactNode; ariaLabel: string;
}) {
  return (
    <section className="scene-shell" aria-label={ariaLabel}>
      <div className="scene-shell__stage" style={{ backgroundImage: `url("${background}")` }}
        data-fallback={isFallback || undefined}>
        {stage}
        {narrative && <div className="scene-shell__narrative">{narrative}</div>}
      </div>
      {actions && <footer className="scene-shell__actions">{actions}</footer>}
    </section>
  );
}
```

- [ ] **Step 4: 加样式**（`styles.css`）：`.scene-shell__stage{background-size:cover;background-position:center;min-height:…}`；`.scene-shell__narrative` 加 `linear-gradient` 底部遮罩保证对比度；`@media (prefers-reduced-motion: reduce)` 关过渡。

- [ ] **Step 5: 运行确认通过** — `npx vitest run tests/ui/sceneShell.test.tsx`，预期 PASS。

- [ ] **Step 6: 提交** — `git add … && git commit -m "feat(ui): SceneShell 统一场景外壳"`

---

## Phase 2 — 去除普通场景人物卡

### Task 2: LocationScreen 移除通用人物卡分支

**Files:**
- Modify: `src/ui/screens/LocationScreen.tsx:135-249`（删除 `location-screen__present` 人物卡列表与 `summoned` 卡片）
- Test: `tests/ui/locationNoCards.test.tsx`

**Interfaces:**
- Consumes: 现有 `presentAt`/`CharacterScene`。后宫居所仍走 `CharacterScene`（保留）；通用分支不再渲染 `CharacterCard`。

- [ ] **Step 1: 写失败测试** — 渲染一个普通 `palace` 地点（有 `present` 角色），断言**不**出现 `CharacterCard`（按其 testid/角色名+管理按钮组合），改出现纯叙事 stage。

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现** — 删除 `LocationScreen.tsx:192-247` 的 `location-screen__present` 区与 `summoned` 卡片块（`:96-99,193-219`）；非 hougong 非紫宸殿地点仅渲染 `SceneShell` 的 narrative（地点描述/在场以文案呈现）。紫宸殿在 Task 6 迁出。

- [ ] **Step 4: 运行确认通过 + 全量 `npm run typecheck`。**

- [ ] **Step 5: 提交** — `refactor(ui): 普通场景移除常驻人物卡`

---

## Phase 3 + 4 — 候见生命周期（引擎核心，修复「稍后」缺陷）

> 先实现引擎纯函数（可完整 TDD），再接 UI。这是 headline 缺陷修复。

### Task 3: entryMode schema + 推导

**Files:**
- Modify: `src/engine/content/schemas.ts`（`gameEventSchema` 加 `entryMode?`）
- Create: `src/engine/events/entryMode.ts`
- Test: `tests/events/entryMode.test.ts`

**Interfaces:**
- Produces: `export type EventEntryMode = "auto_on_enter"|"request_audience"|"exploration"|"manual"|"scheduled";`
- Produces: `export function resolveEntryMode(event: GameEventContent, location: LocationContent | undefined): EventEntryMode;`

- [ ] **Step 1: 写失败测试**

```ts
// tests/events/entryMode.test.ts
import { resolveEntryMode } from "../../src/engine/events/entryMode";

const ev = (over: Partial<any> = {}) => ({
  id: "ev_x", title: "t", sceneId: "sc_x", checkpoint: "location_enter",
  condition: { all: [] }, priority: 0, once: false, apCost: 0, ...over,
});
const loc = (over: Partial<any> = {}) => ({ id: "zichendian", zone: "palace", ...over });

test("explicit entryMode wins", () => {
  expect(resolveEntryMode(ev({ entryMode: "manual" }), loc())).toBe("manual");
});
test("court checkpoint → scheduled", () => {
  expect(resolveEntryMode(ev({ checkpoint: "court" }), loc())).toBe("scheduled");
});
test("location_enter at zichendian → request_audience", () => {
  expect(resolveEntryMode(ev(), loc({ id: "zichendian" }))).toBe("request_audience");
});
test("location_enter at hougong palace → auto_on_enter", () => {
  expect(resolveEntryMode(ev(), loc({ id: "yanhe_gong", zone: "hougong" }))).toBe("auto_on_enter");
});
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现 schema 字段** — `schemas.ts` `gameEventSchema` 内加 `entryMode: z.enum(["auto_on_enter","request_audience","exploration","manual","scheduled"]).optional(),`（位于 `apCost` 之后）。

- [ ] **Step 4: 实现推导**

```ts
// src/engine/events/entryMode.ts
import type { GameEventContent, LocationContent } from "../content/schemas";
export type EventEntryMode = "auto_on_enter"|"request_audience"|"exploration"|"manual"|"scheduled";

export function resolveEntryMode(event: GameEventContent, location: LocationContent | undefined): EventEntryMode {
  if (event.entryMode) return event.entryMode;
  if (event.checkpoint === "court") return "scheduled";
  if (event.checkpoint === "location_enter") {
    if (location?.id === "zichendian") return "request_audience";
    if (location?.id === "yuhuayuan") return "exploration";
    if (location?.zone === "hougong") return "auto_on_enter";
    return "auto_on_enter";
  }
  if (event.checkpoint === "game_start" || event.checkpoint === "scene_end" || event.checkpoint === "time_advance") {
    return "auto_on_enter";
  }
  return "manual";
}
```

- [ ] **Step 5: 运行确认通过 + `npm run validate-content`（确认旧 content 无 `entryMode` 仍合法）。**

- [ ] **Step 6: 提交** — `feat(events): EventEntryMode 字段 + 推导`

### Task 4: audience 呈现生命周期

**Files:**
- Create: `src/engine/events/audience.ts`
- Test: `tests/events/audience.test.ts`

**Interfaces:**
- Consumes: `GameState.flags`、`GameState.calendar.dayIndex`、`EventEffect`（`{type:"flag",key,value}`）。
- Produces:
  - `export function audienceStatus(state: GameState, eventId: string): "available"|"pending";`
  - `export function pendingAudienceCount(state: GameState): number;`
  - `export function defer(eventId: string, dayIndex: number): EventEffect[];`
  - `export function shouldRemind(state: GameState, eventId: string): boolean;`
  - `export function clearAudience(eventId: string): EventEffect[];`
  - flag 键常量：`audience.pending.<id>` / `audience.promptShownAt.<id>` / `audience.remindAt.<id>`。

- [ ] **Step 1: 写失败测试**

```ts
// tests/events/audience.test.ts
import { audienceStatus, defer, shouldRemind, clearAudience, pendingAudienceCount } from "../../src/engine/events/audience";

const st = (flags: Record<string, any> = {}, dayIndex = 5) =>
  ({ flags, calendar: { dayIndex } } as any);

test("defer sets pending + promptShownAt flags", () => {
  expect(defer("ev_a", 5)).toEqual([
    { type: "flag", key: "audience.pending.ev_a", value: true },
    { type: "flag", key: "audience.promptShownAt.ev_a", value: 5 },
  ]);
});
test("status is available by default, pending after defer flag", () => {
  expect(audienceStatus(st(), "ev_a")).toBe("available");
  expect(audienceStatus(st({ "audience.pending.ev_a": true }), "ev_a")).toBe("pending");
});
test("pending event without remindAt does NOT re-prompt", () => {
  expect(shouldRemind(st({ "audience.pending.ev_a": true }), "ev_a")).toBe(false);
});
test("remindAt reached → shouldRemind true", () => {
  const s = st({ "audience.pending.ev_a": true, "audience.remindAt.ev_a": 5 }, 5);
  expect(shouldRemind(s, "ev_a")).toBe(true);
});
test("clearAudience clears all three flags", () => {
  expect(clearAudience("ev_a")).toEqual([
    { type: "flag", key: "audience.pending.ev_a", value: false },
    { type: "flag", key: "audience.promptShownAt.ev_a", value: 0 },
    { type: "flag", key: "audience.remindAt.ev_a", value: 0 },
  ]);
});
test("pendingAudienceCount counts truthy pending flags", () => {
  expect(pendingAudienceCount(st({ "audience.pending.ev_a": true, "audience.pending.ev_b": false }))).toBe(1);
});
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现**

```ts
// src/engine/events/audience.ts
import type { GameState } from "../state/types";
import type { EventEffect } from "../content/schemas";

const PENDING = (id: string) => `audience.pending.${id}`;
const SHOWN = (id: string) => `audience.promptShownAt.${id}`;
const REMIND = (id: string) => `audience.remindAt.${id}`;

export function audienceStatus(state: GameState, eventId: string): "available" | "pending" {
  return state.flags[PENDING(eventId)] === true ? "pending" : "available";
}
export function pendingAudienceCount(state: GameState): number {
  return Object.entries(state.flags).filter(([k, v]) => k.startsWith("audience.pending.") && v === true).length;
}
export function defer(eventId: string, dayIndex: number): EventEffect[] {
  return [
    { type: "flag", key: PENDING(eventId), value: true },
    { type: "flag", key: SHOWN(eventId), value: dayIndex },
  ];
}
export function shouldRemind(state: GameState, eventId: string): boolean {
  if (audienceStatus(state, eventId) !== "pending") return false;
  const remindAt = state.flags[REMIND(eventId)];
  return typeof remindAt === "number" && state.calendar.dayIndex >= remindAt;
}
export function clearAudience(eventId: string): EventEffect[] {
  return [
    { type: "flag", key: PENDING(eventId), value: false },
    { type: "flag", key: SHOWN(eventId), value: 0 },
    { type: "flag", key: REMIND(eventId), value: 0 },
  ];
}
```

- [ ] **Step 4: 运行确认通过。**

- [ ] **Step 5: 提交** — `feat(events): audience 候见呈现生命周期（flags 承载，零迁移）`

### Task 5: 候见提示 UI（AudiencePrompt，非阻塞）

**Files:**
- Create: `src/ui/components/AudiencePrompt.tsx`
- Test: `tests/ui/audiencePrompt.test.tsx`

**Interfaces:**
- Produces: `export function AudiencePrompt(props: { title: string; line: string; affordable: boolean; onAdmit: () => void; onDefer: () => void }): JSX.Element` — 渲染于叙事区，非 `modal-backdrop`。

- [ ] **Step 1: 写失败测试** — 断言渲染叙事文案、`[宣她进来]` 调 `onAdmit`、`[记入待宣]` 调 `onDefer`，且容器**无** `modal-backdrop` class。

- [ ] **Step 2–5：** 运行失败 → 实现（语义按钮、`aria-label`、不可承担时禁用宣入并给原因）→ 运行通过 → 提交 `feat(ui): 非阻塞候见提示 AudiencePrompt`。

### Task 6: 紫宸殿专用屏接线候见

**Files:**
- Create: `src/ui/screens/ZichendianScreen.tsx`
- Modify: `src/ui/App.tsx`（`view==="zichendian"` 分支；`enterCurrentLocation` 把 `zichendian` 路由到新屏）、`src/ui/screens/LocationScreen.tsx`（移除紫宸殿专属逻辑）
- Test: `tests/ui/zichendianAudience.test.tsx`

**Interfaces:**
- Consumes: `audienceStatus`/`defer`/`shouldRemind`/`pendingAudienceCount`/`resolveEntryMode`、`getEligibleEvents(db,state,"location_enter")`、现有回调（`onReviewMemorials`/`onRestAlone`/`onFlipTablet`/`onStartEvent`/`onManage`…）。
- 行为：默认态无人物卡；`request_audience` 事件 → `AudiencePrompt`；宣入 → `onStartEvent(id)`；待宣 → `store.applyEffects(db, defer(id, dayIndex))`；再次进入 `pending && !shouldRemind` → 不弹。

- [ ] **Step 1: 写失败测试（关键回归）**

```tsx
// tests/ui/zichendianAudience.test.tsx 关键用例
test("no audience event → no character cards, no prompt", /* … */);
test("request_audience event → non-blocking prompt, no modal-backdrop", /* … */);
test("click 宣她进来 → onStartEvent called with event id", /* … */);
test("click 记入待宣 → applyEffects(defer) called, prompt closes", /* … */);
test("re-enter while pending & not due → prompt NOT shown again", /* … */);
test("remindAt reached → prompt shown again", /* … */);
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现 ZichendianScreen** — `SceneShell`：stage=背景+今日事务摘要（`候见 · {pendingAudienceCount}` / 待批奏折）；actions=奏折/召见/传乘风/休息/离开；narrative=对 `request_audience` 且（`available` 或 `shouldRemind`）的最高优先事件渲染 `AudiencePrompt`。`pending && !shouldRemind` 不渲染。

- [ ] **Step 4: App 接线** — `View` 已有 `"location"`；新增 `enterCurrentLocation` 中 `loc==="zichendian"` → `setView("zichendian")` 并加 `view==="zichendian"` 渲染块；`onDefer={(id)=>store.applyEffects(db, defer(id, store.getState().calendar.dayIndex))}` 后 `doAutosave()`。

- [ ] **Step 5: 运行确认通过 + `npm run typecheck && npm test`。**

- [ ] **Step 6: 标注 content** — 给紫宸殿的 `location_enter` 事件（如 `ev_fenghou_rules` 司礼类）显式标 `entryMode:"request_audience"`；运行 `npm run validate-content`。

- [ ] **Step 7: 提交** — `feat(ui): 紫宸殿候见系统替换阻塞弹窗`

### Task 7: 移除 LocationScreen 阻塞事件弹窗 + auto_on_enter 直入

**Files:**
- Modify: `src/ui/screens/LocationScreen.tsx:267-284`（删除 `event-overlay` 阻塞弹窗）、`src/ui/App.tsx`（`enterCurrentLocation`/`runCheckpoints` 对后宫居所 `auto_on_enter` 直接 `startEvent`）
- Test: `tests/ui/autoOnEnter.test.tsx`

- [ ] **Step 1: 写失败测试** — 进入有 `auto_on_enter` 事件的后宫居所 → 直接 `onStartEvent`，**不**出现「是否处理」弹窗。

- [ ] **Step 2–5：** 运行失败 → 删除 `eligible` 阻塞弹窗块与 `eventsDismissed` 状态（`LocationScreen.tsx:77-80,267-284`）；后宫 `auto_on_enter` 由 App 的 `location_enter` checkpoint 既有 `pickNextEvent` 路径直入（已有，确认不再被弹窗拦截）→ 运行通过 → 提交 `refactor(ui): 移除阻塞事件弹窗，后宫事件进门直入`。

---

## Phase 5 — 乘风传令

### Task 8: ChengfengDispatch 谕令菜单

**Files:**
- Create: `src/ui/components/ChengfengDispatch.tsx`
- Modify: `src/ui/App.tsx`（`chengfengOpen` 状态 + 「传乘风」入口 + 可中断判定）
- Test: `tests/ui/chengfengDispatch.test.tsx`

**Interfaces:**
- Produces: `export function ChengfengDispatch(props: { interruptible: boolean; disabledReason?: string; onSummonConsort: ()=>void; onManageRank: ()=>void; onRelocate: ()=>void; onBestow: ()=>void; onPhysician: ()=>void; onClose: ()=>void }): JSX.Element`
- 仅暴露**已实现**操作；`interruptible===false` 时按钮禁用并显示 `disabledReason`（不无反应）。

- [ ] **Step 1: 写失败测试** — 可中断场景：点「传乘风」→ 出现乘风台词+谕令菜单；选「召见」→ 调 `onSummonConsort`，乘风离场。关键事件场景：`interruptible=false` → 入口禁用 + 原因文案。重复快速点击不重复打开（去抖）。

- [ ] **Step 2–5：** 运行失败 → 实现（复用现有 `applyRankOp`/`buildRelocate`/`BestowModal`/`PhysicianModal` 入口，**不新增业务**）→ 运行通过 → 提交 `feat(ui): 乘风传令谕令菜单`。

---

## Phase 6 — 召见人物流程（立绘入场，无卡片）

### Task 9: BedchamberPicker 升级为响应式对象抽屉 + 立绘入场

**Files:**
- Modify: `src/ui/components/BedchamberPicker.tsx`（简化信息：姓名/位分/状态/可否召+原因；底部 Sheet 版式）、`src/ui/App.tsx`（召见后 `setSummonedConsortId(id)` → 立绘入场而非加卡）
- Test: `tests/ui/summonNoCard.test.tsx`

**Interfaces:**
- Consumes: `canSummon(state, id)`（可否召+原因）、现有 `setSummonedConsortId`。
- 行为：选定 → 立绘入场（复用 `CharacterScene`/`ReactionScreen` 范式）→ 直接进对话/侍寝 → 告退 → `setSummonedConsortId(null)` → 恢复默认态。**全程不渲染 `CharacterCard`。**

- [ ] **Step 1: 写失败测试** — 召见侍君后，紫宸殿出现该侍君**立绘**（按 alt/名牌）且**无** `CharacterCard`（无全属性面板）；结束后立绘消失、恢复默认态。

- [ ] **Step 2–5：** 运行失败 → 实现（对象抽屉简化信息 + 立绘入场）→ 运行通过 → 提交 `refactor(ui): 召见改立绘入场，移除被召人物卡`。

---

## Phase 7 — 侍君宫殿内部居所（收敛，已大部分实现）

### Task 10: 后宫居所进门直入 + 宫室槽响应式复核

**Files:**
- Modify: `src/ui/screens/CharacterScene.tsx`（宫室槽 360px 可点、移除残留管理大按钮入「更多」已具备，仅核对）、相关 `content/events/*` 后宫 `location_enter` 标 `entryMode:"auto_on_enter"`
- Test: `tests/ui/consortPalaceEnter.test.tsx`

- [ ] **Step 1: 写失败测试** — 多人居住宫殿先显示宫室槽（`occupantOf` 动态、无硬编码名）；点具体宫室进对应人物场景；有 `auto_on_enter` 事件则直入。
- [ ] **Step 2–5：** 运行失败 → 核对/微调 `CharacterScene` + 标注 content `entryMode` → 运行通过 + `validate-content` → 提交 `refactor(content): 后宫事件标 auto_on_enter；宫室槽响应式复核`。

---

## Phase 8 — 御花园子地点探索

> **前置：同步 origin/main。** 御花园 4 张子地点背景由 `0dd9dc1 背景图` 推到 `origin/main`，本分支创建于其前。开工前 `git fetch origin && git rebase origin/main`（或 merge），确认 `public/assets/backgrounds/{jiangxuexuan,taiyechi,fubiting,tuixiushan}.png` 存在。

### Task 11: subLocations schema + manifest 登记 + 调度纯函数

**Files:**
- Modify: `src/engine/content/schemas.ts`（`locationSchema` 加 `subLocations?`，含 `backgroundKey`）
- Modify: `assets/manifest.json`（登记 4 个 `bg.*` 子地点背景）
- Create: `src/engine/map/subLocations.ts`
- Modify: `content/locations/yuhuayuan.json`（加 `subLocations`）
- Test: `tests/map/subLocations.test.ts`

**固定子地点 → 资产映射：**

| 子地点 | `id` | `backgroundKey` | manifest path |
|--------|------|-----------------|---------------|
| 绛雪轩 | `jiangxuexuan` | `bg.jiangxuexuan` | `backgrounds/jiangxuexuan.png` |
| 太液池 | `taiyechi` | `bg.taiyechi` | `backgrounds/taiyechi.png` |
| 浮碧亭 | `fubiting` | `bg.fubiting` | `backgrounds/fubiting.png` |
| 堆秀山 | `tuixiushan` | `bg.tuixiushan` | `backgrounds/tuixiushan.png` |

**Interfaces:**
- schema: `subLocations?: { id, name, backgroundKey, hint }[]`。
- Produces: `export function pickSubLocationEvent(db: ContentDB, state: GameState, locId: string, subId: string): GameEventContent | null;`（同子地点多事件按优先级取一：限时>已约定>角色专属>随机；id 字典序兜底）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/map/subLocations.test.ts
import { pickSubLocationEvent } from "../../src/engine/map/subLocations";
test("at most one event per sublocation, highest priority wins", /* 构造两个 atLocation+subId 命中事件，断言取 priority 高者 */);
test("no eligible event → null (普通游览)", /* … */);
test("priority tie → deterministic by id asc", /* … */);
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现 schema** — `locationSchema` 加 `subLocations: z.array(z.strictObject({ id: idSchema, name: nonEmpty, backgroundKey: nonEmpty, hint: nonEmpty })).optional(),`。

- [ ] **Step 4: 登记 manifest** — 在 `assets/manifest.json` 的 `entries` 加 4 条（与 `bg.yuhuayuan` 同形）：

```json
"bg.jiangxuexuan": { "path": "backgrounds/jiangxuexuan.png", "kind": "background", "placeholder": false },
"bg.taiyechi":     { "path": "backgrounds/taiyechi.png",     "kind": "background", "placeholder": false },
"bg.fubiting":     { "path": "backgrounds/fubiting.png",     "kind": "background", "placeholder": false },
"bg.tuixiushan":   { "path": "backgrounds/tuixiushan.png",   "kind": "background", "placeholder": false }
```

运行 `npm run validate-manifest` 确认 4 张图片文件存在且 schema 合法。

- [ ] **Step 5: 实现调度** — 复用 `getEligibleEvents(db,state,"location_enter")` 过滤 `atLocation===locId` 且 `resolveEntryMode==="exploration"` 且绑定 `subId`（子地点绑定用事件 `condition` 的 `flagSet` 或新增弱标记；MVP 用约定 flag），按 `priority desc, id asc` 取首个 affordable。

- [ ] **Step 6: 填 yuhuayuan content** — `content/locations/yuhuayuan.json` 加 `subLocations`（4 个固定子地点，各带 `backgroundKey` 与含蓄 `hint`）：

```json
"subLocations": [
  { "id": "jiangxuexuan", "name": "绛雪轩", "backgroundKey": "bg.jiangxuexuan", "hint": "轩前海棠开得正好，朱栏边似有衣袂一闪。" },
  { "id": "taiyechi",     "name": "太液池", "backgroundKey": "bg.taiyechi",     "hint": "水面波光粼粼，远处水榭上停着一道身影。" },
  { "id": "fubiting",     "name": "浮碧亭", "backgroundKey": "bg.fubiting",     "hint": "亭中棋局未收，茶尚温，人却不知去向。" },
  { "id": "tuixiushan",   "name": "堆秀山", "backgroundKey": "bg.tuixiushan",   "hint": "假山石径幽深，风过处隐约有低语。" }
]
```

运行 `npm run validate-content`。

- [ ] **Step 7: 运行确认通过。**

- [ ] **Step 8: 提交** — `feat(map): 御花园子地点 schema + manifest + 事件调度`

### Task 12: GardenOverviewScreen + App 接线

**Files:**
- Create: `src/ui/screens/GardenOverviewScreen.tsx`
- Modify: `src/ui/App.tsx`（`View` 加 `"garden"`；进入御花园先总览）
- Test: `tests/ui/gardenExploration.test.tsx`

- [ ] **Step 1: 写失败测试** — 御花园先显示多个子地点入口（读 `subLocations`，桌面卡片/手机纵向大区块）；点有事件子地点 → 直接 `onStartEvent`；点无事件子地点 → 普通游览文案；`hint` 不泄露事件名。
- [ ] **Step 2–5：** 运行失败 → 实现 `SceneShell` 总览 + 接线 → 运行通过 → 提交 `feat(ui): 御花园子地点探索总览`。

---

## Phase 9 — 宣政殿议程

### Task 13: court 议程预览 + 结算摘要纯函数

**Files:**
- Create: `src/engine/court/agenda.ts`
- Test: `tests/court/agenda.test.ts`

**Interfaces:**
- Consumes: `pickCourtAffairs(db, seedKey)`（`court/affairs.ts`）、`EventEffect`。
- Produces:
  - `export function courtAgendaPreview(db: ContentDB, state: GameState): { id: string; title: string }[];`（用与 `beginCourt` **同一** 种子 `court:{rngSeed}:{dayIndex}`，保证预览=实际）。
  - `export function summarizeCourtOutcome(effects: EventEffect[]): { pillar: string; field: string; delta: number }[];`（累计资源净变化，UI 不猜测）。

- [ ] **Step 1: 写失败测试**

```ts
// tests/court/agenda.test.ts
test("preview uses same seed as beginCourt → identical id set", /* 断言 courtAgendaPreview ids === pickCourtAffairs(同种子) */);
test("summarizeCourtOutcome nets resource deltas across affairs", /* 多 effect 累计 */);
test("empty pool → empty preview", /* … */);
```

- [ ] **Step 2: 运行确认失败。**

- [ ] **Step 3: 实现** — `courtAgendaPreview` 调 `pickCourtAffairs(db, \`court:${state.rngSeed}:${state.calendar.dayIndex}\`).map(id => ({ id, title: db.events[id]?.title ?? id }))`；`summarizeCourtOutcome` 归并 `type:"resource"` effects。

- [ ] **Step 4: 运行确认通过。**

- [ ] **Step 5: 提交** — `feat(court): 议程预览 + 结算摘要纯函数`

### Task 14: XuanzhengdianScreen（取代 FreeView 单按钮）

**Files:**
- Create: `src/ui/screens/XuanzhengdianScreen.tsx`
- Modify: `src/ui/App.tsx`（`View` 加 `"xuanzhengdian"`；宣政殿路由到新屏，非 `FreeViewScreen`）、court 会话结束累计 effects 供摘要
- Test: `tests/ui/xuanzhengAgenda.test.tsx`

- [ ] **Step 1: 写失败测试** — 有议程时显示 `courtAgendaPreview` 标题列表 + 「升朝」；上朝逐议题推进、每议题只结算一次（沿用现状）；结束显示**真实**结算摘要（`summarizeCourtOutcome`）；无议程显示合理空状态文案（非空白）。
- [ ] **Step 2–5：** 运行失败 → 实现 `SceneShell` 议程屏（保留 `beginCourt`/`CourtSession` 逐议题流程）→ 运行通过 → 提交 `feat(ui): 宣政殿议程屏与朝议结果摘要`。

---

## Phase 10 — 响应式与视觉统一

### Task 15: 视觉权重四级 + 响应式断点

**Files:**
- Modify: `src/ui/styles.css`（主/次/信息/事件提示四级；360/768/1280/超宽断点；主点击区 ≥44px；底部操作栏固定；「更多」收纳）
- Test: 人工验证 + `tests/ui/responsive.test.tsx`（关键断点快照作回归基线）

- [ ] **Step 1: 加断点与权重样式**（无逻辑，纯 CSS）：`.scene-shell__actions button{min-height:44px}`；`@media (max-width:480px)` 单列、主立绘单显、次操作入「更多」；主操作金色实边、次操作弱边半透明、信息区细分隔线。
- [ ] **Step 2: 人工验证 360/768/1280/超宽**（`npm run dev`，浏览器各宽度）。
- [ ] **Step 3: 提交** — `style(ui): 视觉权重四级与响应式断点`

---

## Phase 11 — 测试与旧代码清理

### Task 16: 清理废弃路径 + 全量回归

**Files:**
- Modify/Delete: `CharacterCard` 在场景层的残留 props/CSS（`location-screen__present`/`summoned-consort`/`event-overlay` 死样式）、`LocationScreen` 的 `eventsDismissed`、紫宸殿迁出后 `LocationScreen` 死分支、`FreeViewScreen` 宣政殿分支（保留冷宫/寺庙）。
- Test: 全量 `npm test`

- [ ] **Step 1: 删除死代码** — `grep -rn "eventsDismissed\|location-screen__present\|summoned-consort\|event-overlay" src/` 逐一确认无引用后删除；保留两套竞争 UI 流程是禁止项。
- [ ] **Step 2: 全量回归** — `npm run typecheck && npm test && npm run lint && npm run build && npm run validate-content`，全绿。
- [ ] **Step 3: 提交** — `refactor(ui): 清理被 SceneShell 取代的旧布局与死样式`

---

## Self-Review（规格覆盖核对）

| 规格条目 | 实现任务 |
|----------|----------|
| §4 Scene Shell | Task 1 |
| §5 去除人物卡 | Task 2, 9, 16 |
| §3.1 entryMode | Task 3 |
| §3.2 候见生命周期/「稍后」修复 | Task 4, 6, 7 |
| §6.2 候见系统 | Task 5, 6 |
| §6.3 召见无卡 | Task 9 |
| §6.4 乘风传令 | Task 8 |
| §7 侍君宫殿内部居所 | Task 10 |
| §8 御花园子地点 | Task 11, 12 |
| §9 宣政殿议程 | Task 13, 14 |
| §11 响应式/视觉 | Task 15 |
| §12 存档兼容（零迁移） | Task 3,4,11（optional + flags） |
| §13 测试 | 各 Task 的 TDD 步骤 |
| §14 清理 | Task 16 |

**风险/需执行时确认：**
- 御花园子地点↔事件的绑定机制（Task 11 Step 4）：MVP 用约定 flag，若 content 量大可升级为事件显式 `subLocationId` 字段（再扩 schema，仍 optional）。执行该任务时按实际 content 复核。
- 乘风「可中断」判定来源（Task 8）：需为各场景/事件声明 `interruptible`，MVP 由 App 按 `view`/`activeEventId` 硬判定，后续可下沉到 content。
- Task 6/14 触及 `App.tsx` 的 rollover/checkpoint 回旋逻辑（`reactionRollover`/`runCheckpoints`）——改视图路由时须保留时间结算路径，测试覆盖转旬补跑。

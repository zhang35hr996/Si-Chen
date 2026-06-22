# 场景 UI · 人物交互 · 事件流程重构 — 设计规格

**日期：** 2026-06-22
**状态：** 待设计评审
**相关文档：**
[`engineering/10-current-implementation.md`](../../engineering/10-current-implementation.md)（引擎契约）·
[`2026-06-18-yushufang-redesign-design.md`](./2026-06-18-yushufang-redesign-design.md)（御书房/紫宸殿前次改版）·
[`2026-06-19-ui-bgm-courtyard-overhaul-design.md`](./2026-06-19-ui-bgm-courtyard-overhaul-design.md)（院子/CharacterScene 视觉小说化）·
[`2026-06-21-consort-presence-greeting-design.md`](./2026-06-21-consort-presence-greeting-design.md)（在场/请安）

---

## 0. 范围与非范围

把当前「背景横幅 + 人物卡列表 + 按钮矩阵」的地点 UI，重构为「一个地点即一座舞台」：人物只在真正出现时显示、事件在场景中自然发生、行政管理移入独立面板，并修复事件阻塞弹窗与「稍后再说」反复弹出的问题。

**本期实现：**
- **事件呈现层模型**：为事件引入「进入方式」与「呈现生命周期」两个概念（`entryMode` + pending/提示态），令「稍后处理」可确定性延期、可存档、不再每次进门重弹。
- **候见（audience）系统**：把 `location_enter` 阻塞弹窗改为非阻塞的「殿外候见」提示 → 宣入 → 入场 → 对话 → 告退。
- **Scene Shell**：抽出可复用场景外壳（顶部状态条 + 背景铺满 + 叙事/事务区 + 操作栏），统一各地点页结构。
- **紫宸殿（zichendian）重构**：默认态去除乘风/卫绫/被召侍君的常驻人物卡，改为「今日事务摘要 + 主操作栏」；召见侍君改为对象抽屉 → 立绘入场，不再新增人物卡。
- **乘风传令入口**：可中断场景中「传乘风」→ 谕令菜单 → 走现有业务入口执行。
- **御花园（yuhuayuan）子地点探索**：先选子地点，再发现事件；每子地点至多一个当前事件。
- **宣政殿（xuanzhengdian）议程**：上朝前显示今日朝议摘要，上朝后显示真实结算摘要。
- **响应式与视觉层级**：360/768/1280/超宽四档可用；区分主/次/信息/事件四级视觉权重。

**非范围（明确不做）：**
- 不重写事件引擎、Effect 漏斗、对话 Provider、`store.applyEffects` 契约、位分/孕育/健康/侍寝业务规则（沿用现状，遵守架构规则 #1）。
- 不修改人物事实、剧情内容、属性数值规则。
- 不引入新 UI 框架（继续 React + CSS，无新增运行时依赖）。
- 不把所有地点改造成复杂地图；御花园子地点为「卡片/列表入口」，非像素热区地图。
- 不新增尚不存在的业务系统（谕令菜单只暴露已实现的行政操作）。
- 不为 360px 以下或横屏做专门优化（仅保证不破版）。

---

## 1. 审计结论（Phase 1 实测）

> 全部引用真实文件/类型/函数名。下列为「现状」，非目标态。

### 1.1 地点页面组件树
- 总入口 `src/ui/App.tsx`（1558 行）是一台 `useState` 视图状态机：`type View = "title" | "coronation" | "location" | "map" | "freeview" | "event" | "court" | "wenzhaodian" | "yuqing_gong" | "fengxiandian" | "cining_gong" | "courtyard" | "shop" | "dianxuan"`（`App.tsx:84`），约 40 个 `useState` 字段（`activeEventId`/`summonedConsortId`/`reaction`/`court`/…）。
- 普通地点走 `LocationScreen`（`src/ui/screens/LocationScreen.tsx`）；专用屏：上书房 `ShangshufangScreen`、`YuqingGongScreen`、`FengxiandianScreen`、`CiningGongScreen`、院子 `CourtyardScreen`、自由视图 `FreeViewScreen`、地图 `MapScreen`。
- `LocationScreen` 内部二分支：`showScene`（`location.zone === "hougong"` 有住客 **或** `hasChambers(location.id)`）→ 渲染 `CharacterScene`（视觉小说态）；否则渲染通用 `location-screen`（背景 stage + `yushufang-menu` 按钮 + 人物卡列表）。

### 1.2 人物卡在哪里生成
- `src/ui/components/CharacterCard.tsx`，由 `LocationScreen.tsx:192-247` 的 `location-screen__present` 区渲染：`present`（`presentAt(db,state,location.id)` 当前在场者）逐个出卡，外加 `summoned`（`location.id === "zichendian" && summonedConsortId` → 被召侍君额外一张卡，`LocationScreen.tsx:96-99,193-219`）。
- 紫宸殿因乘风/卫绫 `defaultLocation` 在此，永久作为「在场」出卡——这是「页面像后台管理工具」的根因。
- **已存在的好范式**：`src/ui/screens/CharacterScene.tsx` 已实现立绘居中大尺寸、宫室槽（`CHAMBERS` 主殿/东西侧殿/东西偏殿）、`action-dock`（主操作 + 「更多 ▾」收纳管理/搬迁）、缺席禀报。后宫居所已是目标态，无需重做。

### 1.3 事件弹窗在哪里触发
- `LocationScreen.tsx:267-284`：`eligible = getEligibleEvents(db, state, "location_enter")`，`eligible.length > 0 && !eventsDismissed` 时渲染 `modal-backdrop > event-overlay` 居中阻塞弹窗（标题「{地点}　有事相询」、「稍后再说」按钮）。
- 自动事件链：`App.startEvent` → `view="event"` → `DialogueScreen`；结束后 `pickNextEvent(db,state,"scene_end"|"time_advance")` 串联（`App.tsx:1187-1216`，`MAX_EVENT_CHAIN=3`）。

### 1.4 「稍后处理」状态如何保存（缺陷根因）
- **完全不持久化**。`LocationScreen.tsx:77-80`：`const [eventsDismissed, setEventsDismissed] = useState(false)`，且 `useEffect(()=>setEventsDismissed(false),[state.playerLocation])`——换地点即复位。「稍后再说」仅压制本次挂载，再次进入同一地点重新弹出。
- 事件本身无「呈现态」：`gameEventSchema`（`schemas.ts:465-484`）只有 `checkpoint/condition/priority/once/cooldown/apCost/public/headline`。去重仅靠 `once`+`hasEventFired`（查 `eventLog`）与 `cooldown`（`engine.ts:20-51`）。无 `pending`/`deadline`/`remindAt`/`entryMode` 概念。

### 1.5 各殿是否共用组件
- 紫宸殿/后宫居所**共用** `LocationScreen`（内部按 `showScene` 分流）。
- 宣政殿**不共用**：`entry:"free"` + `actionEventId:"ev_chaohui"`（`content/locations/xuanzhengdian.json`）→ 走 `FreeViewScreen`，仅渲染背景 stage + 单个「上朝」按钮（大面积空白根因，`FreeViewScreen.tsx:64-87`）。
- 御花园：普通 travel 地点（`content/locations/yuhuayuan.json`），`connections:["zichendian"]`，**无子地点结构**，走 `LocationScreen` 通用分支。
- 上书房/毓庆宫/奉先殿/慈宁宫各有专用屏，结构相近但各自实现。

### 1.6 对话模式如何切换
- 脚本事件：`DialogueScreen`（`view==="event"`/`"court"`），跑 `src/engine/scenes/runner.ts`。
- 即时反应台词：`ReactionScreen`（`reaction` 状态 + `reactionQueue` 串播，`App.tsx:1272-1302`），用于位分反应、懿旨、对话、上香等。
- 侍寝体验：`BedchamberScene`；子嗣反应：`CharacterReactionScreen`。
- LLM 实时对话：`orchestrator.ts` + providers（本期不动其契约）。

### 1.7 人物召见如何改变状态
- 翻牌子：`BedchamberPicker` → `onPick(id)` → `setSummonedConsortId(id)`（`App.tsx:1313-1324`）。被召侍君仅是 `summonedConsortId` 这一 UI 态（**未落档**），在紫宸殿额外渲染一张 `CharacterCard`。死亡 tick 会清召见态（`App.tsx:168-173`）。
- 召见后侍寝/对话走 `beginBedchamber`/`converse`，提交后 `setSummonedConsortId(null)`。

### 1.8 哪些状态写入存档
- `GameState`（`src/engine/state/types.ts:415-445`）整体序列化：`flags`（开放 `Record<string,FlagValue>`）、`eventLog`、`standing`（含 `residence`/`chamber`）、`chronicle`、`pendingAftermath`（已有的持久化待办队列范式）等。
- **关键**：`flags` 是开放记录，新增以 flag 为载体的呈现态**无需 schema 迁移**；现有代码已大量以 flag 去重（如 `tributeMinister:{dayIndex}`、`daxuanDianxuanFlagKey(year)`）。
- `summonedConsortId`、`eventsDismissed` 等纯 UI 态**未落档**（符合「展示态不入档」原则）。
- 存档系统 `src/engine/save/saveSystem.ts` 有真实版本迁移链 `MIGRATIONS`（当前 `SAVE_FORMAT_VERSION = 6`，v1→v6 已落地），未来版本被拒绝、损坏存档隔离到 `sichen.corrupt.*`。**与记忆笔记「pre-release 不迁移旧档」相比，实际项目是有迁移阶梯的**——本期优先用 `flags`（零迁移），仅在确需结构化字段时才动 schema + 加一级迁移。

### 1.9 现有测试覆盖
- `tests/scenes/runner.test.ts`、`tests/events/{engine,resolve,conditions}.test.ts`、`tests/court/affairs.test.ts`、`tests/ui/courtyardHalls.test.ts`、`tests/map/*`、`tests/save/*`。
- 引擎层覆盖较好；UI 行为（弹窗/候见/召见）覆盖薄。
- 命令：`npm test`（vitest run）、`npm run typecheck`、`npm run lint`、`npm run build`、`npm run validate-content`。

### 1.10 耦合风险
- `App.tsx` 是巨型协调器：召见/反应串播/转旬补跑/懿旨掷骰高度交织（`reactionRollover`/`reactionStayOnMap`/`shopRollover` 等回旋逻辑）。改召见/候见须保留这些时间结算路径。
- `LocationScreen` 同时承担「紫宸殿工作台」「后宫场景分流」「事件弹窗」「请安弹窗」四职——拆分时须逐一迁移，避免回归。
- 视图切换全靠 `setView` + 散落的 rollover ref，无路由抽象；新增 view 需手工接线 BGM（`trackFor`）、autosave、checkpoint 补跑。

---

## 2. 目标架构：四层分离

明确分离四层，**UI 只展示引擎已确定的事实，绝不创造游戏事实**（架构规则 #2）：

| 层 | 职责 | 现有载体 → 目标 |
|----|------|----------------|
| **场景层** | 当前地点/背景/在场人物/环境描述 | `Scene Shell`（新）+ 各地点 body |
| **叙事层** | 入场/对话/事件选择/结果/离场 | `DialogueScreen`/`ReactionScreen`/候见提示（复用+扩展） |
| **管理层** | 宫册/详情/位分/封号/迁宫/封赏/召太医 | 已有 Modal/Drawer（`ConsortListModal`/`RankAdminModal`/`RelocateModal`/`CharacterProfileDrawer`/`PhysicianModal`）—收敛入口 |
| **导航层** | 日期/地点/行动力/国情/国库/设置/离开 | `GameShell` 顶部条 + `ResourcePanel`/`StorehouseScreen` 浮层（已可全画面开） |

**核心原则**：普通场景不再以完整人物卡为主要交互；完整人物卡只保留于管理层（宫册/详情/对象选择/名录）。

---

## 3. 数据模型变更

遵守现有命名约定（snake_case content id、camelCase TS、flag 以 `:` 分段）。**优先零迁移**。

### 3.1 事件进入方式 `entryMode`（content 层，可选 + 可推导）

在 `gameEventSchema`（`schemas.ts`）新增可选字段：

```ts
// schemas.ts — gameEventSchema 扩展
entryMode: z
  .enum(["auto_on_enter", "request_audience", "exploration", "manual", "scheduled"])
  .optional(),
```

语义与既有 `checkpoint` 协同（**不取代** checkpoint，仅描述「如何呈现给玩家」）：

| entryMode | 含义 | 默认推导（缺省时） |
|-----------|------|-------------------|
| `auto_on_enter` | 进入地点直接开始 | 后宫居所 `location_enter` 事件 |
| `request_audience` | 殿外候见，玩家决定宣入 | 紫宸殿 `location_enter` 事件 |
| `exploration` | 先选子地点再发现 | 御花园等子地点宿主 |
| `manual` | 玩家主动发起（召见/对话/侍寝…） | 无 checkpoint 的纯 manual 事件 |
| `scheduled` | 到点进入（上朝/宫宴…） | `checkpoint:"court"` / 定时 |

**推导规则（`resolveEntryMode(event, location)`，纯函数）**：`event.entryMode` 显式优先；否则按 `checkpoint` + 宿主 `location.zone`/id 推导，使旧 content 不写字段也能正确分流。**旧存档/旧 content 不会因缺 `entryMode` 失效**（字段可选 + 推导兜底）。

### 3.2 事件呈现生命周期（以 `flags` 为载体，零迁移）

不新增 `GameState` 顶层字段。用既有开放 `flags` 记录承载呈现态，键名约定：

```
audience.pending.<eventId>      = true            // 「记入待宣」后置位
audience.promptShownAt.<eventId> = <dayIndex>     // 首次候见提示已展示的 dayIndex
audience.remindAt.<eventId>      = <dayIndex>      // 下次允许再次提醒的 dayIndex（deadline/升级）
```

封装为纯函数模块 `src/engine/events/audience.ts`（**新**，与现有 `engine.ts` 并列）：

```ts
// audience.ts
export type AudienceStatus = "available" | "pending" | "suppressed";
export function audienceStatus(state: GameState, eventId: string): AudienceStatus;
export function defer(state: GameState, eventId: string): EventEffect[];   // → flag effects，置 pending + promptShownAt
export function shouldRemind(state: GameState, event: GameEventContent): boolean; // remindAt 到点 / 升级
export function clearAudience(eventId: string): EventEffect[];             // 事件开始或解决后清 flag
```

所有写入仍走 `store.applyEffects(db, [{type:"flag",...}])`（**不绕过漏斗**，架构规则 #1）。

**「稍后处理」正确语义**：玩家选「记入待宣」→ `defer()` 置 `pending`+`promptShownAt` → 候见提示关闭、可继续行动 → 顶部/事务区显示「候见 · N」→ 再次进入紫宸殿**不**无条件重弹（`audienceStatus==="pending"` 且未 `shouldRemind` → 不弹）→ deadline/升级时 `shouldRemind` 为真才再提醒。

### 3.3 召见态（沿用 UI 态，不入档）

被召侍君 `summonedConsortId` 维持为 App 层临时态（一次召见在一次会话内完成，无跨时间义务，符合「展示态不入档」）。改动仅是**呈现**：从「额外人物卡」改为「立绘入场 → 直接进对话/互动」。

---

## 4. Scene Shell（统一场景外壳）

抽出 `src/ui/components/SceneShell.tsx`（**新**），在 `GameShell`（已有顶部状态条/返回/国情/国库/设置）之内提供统一布局槽：

```
┌─────────────────────────────────────┐
│ 日期·时段        当前地点      行动力·菜单 │  ← GameShell 顶部条（已有）
│                                     │
│         背景铺满 + 人物立绘区          │  ← <slot name="stage">
│                                     │
│ 场景描述 / 候见提示 / 当前事务          │  ← <slot name="narrative">（渐变遮罩保证可读）
├─────────────────────────────────────┤
│ 当前地点主操作栏                      │  ← <slot name="actions">
└─────────────────────────────────────┘
```

- 背景 `background-size: cover` 铺满主视口；底部/侧边 `linear-gradient` 遮罩保证文字对比度（替代「顶部横幅 + 下方黑区」）。
- **不强制**所有地点同一业务模板：Shell 只管布局，地点 body 由各屏注入。
- `prefers-reduced-motion` 下禁用入场/淡出过渡。

各地点屏改为 `<SceneShell stage={…} narrative={…} actions={…}>`。`CharacterScene` 的立绘+action-dock 作为 `stage`/`actions` 内容复用。

---

## 5. 人物展示规则

### 5.1 普通场景不显示完整人物卡
完整 `CharacterCard`（含全属性 + 多按钮）仅保留于：`ConsortListModal`（宫册/对象选择）、`CharacterProfileDrawer`（详情）、`HeirListModal`（皇嗣谱）、官员名录、位分/迁宫/封赏对象选择页。**普通地点页删除常驻人物卡。**

### 5.2 当前互动人物用大立绘（复用 `CharacterScene` 范式）
立绘居中/侧置；名牌仅显示「人物名 / 身份·位分 / 一行必要状态」。详细属性进 `CharacterProfileDrawer`。不常驻容貌/健康/恩宠/性格/喜好数值与全部按钮。

### 5.3 多人物场景
桌面端：当前说话者正常亮度、其余压暗（CSS `filter: brightness`），位置/描边突出；同时至多 2–3 人。手机端：主区只显当前说话者，其余作顶部/底部小头像标签，切换主立绘。后宫居所已由 `CharacterScene` 宫室槽切换实现，沿用。

### 5.4 在场状态明确化（不靠「卡片是否渲染」推断）
复用现有引擎判定，不新增持久字段：`presentAt`（当前在场）、`getPresentAt`（住处花名册）、`absentAt`（去向）、`summonedConsortId`（被召）、`canSummon`（可否召见+原因）。场景层据此区分：常驻/在场/候见/被召/互动中/已离开/暂不可召，并以文案呈现（如缺席禀报，已实现于 `CharacterScene`）。

---

## 6. 紫宸殿（zichendian）重构

紫宸殿不再走 `LocationScreen` 通用人物卡分支，改为专用「皇帝工作台」`stage` + 候见/召见叙事。

### 6.1 默认态
进入紫宸殿：背景铺满；**不**显示乘风/卫绫/被召侍君的常驻卡；显示「今日事务摘要」（候见 N / 待批奏折 / 待办谕令——数据全来自引擎：候见数 = `audienceStatus==="pending"` 计数）；主操作栏：奏折(`onReviewMemorials`)、召见(`onFlipTablet`→对象抽屉)、传乘风(新)、休息(`onRestAlone`)、离开(`onOpenMap`)。「查看侍君/查看子嗣」等**全局管理入口**移出本地操作栏，归入导航层/「更多」。

### 6.2 候见系统（替换阻塞弹窗）
进入紫宸殿先正常展示场景，再以**非阻塞**叙事提示呈现 `request_audience` 事件（底部叙事区或右侧事务栏小面板，**非** `modal-backdrop` 居中弹窗）：

```
殿外传来通报。
司礼卫绫正在殿外候见，似有宫务需要禀奏。
[宣她进来]   [记入待宣]
```

- 「宣她进来」→ 简短通报文案 → 立绘入场 → `onStartEvent(eventId)` 走现有 `DialogueScreen` → 玩家选择 → `resolveEvent` 结算 → 告退淡出 → 回默认态。**不新增人物卡。**
- 「记入待宣」→ `store.applyEffects(db, defer(state,eventId))` → 提示关闭、`audience.pending` 置位 → 顶部「候见 · N」→ 玩家可主动点候见列表处理。
- 再次进入**不重弹**（§3.2）；仅 `shouldRemind` 为真时再提醒。

### 6.3 召见侍君流程（移除「召见即加卡」）
点「召见」→ `BedchamberPicker` 升级为适配桌面/手机的对象选择抽屉（简化信息：姓名/位分/当前状态/可否召见/不可召原因，**不**塞全属性与全部管理操作）→ 选定 → `setSummonedConsortId(id)` → 立绘入场 → 直接进对话/互动 → 结束告退 → 立绘消失 → 紫宸殿恢复默认态。

### 6.4 乘风传令
可中断场景提供「传乘风」：当前场景压暗 → 乘风立绘入场（「臣在」）→ 谕令菜单（仅暴露已实现操作：召见 `onFlipTablet`、调整位分 `onManage`、封号、迁宫 `onRelocate`、赏赐 `BestowModal`、召太医 `onSummonPhysician`、传口谕/承嗣 `onSummonZongzheng`）→ 选择确认 → 走现有业务入口（`applyRankOp`/`buildRelocate`/`applyBestow`…）→ 乘风领命离场 → 恢复场景。

**可中断性**：每场景/事件声明是否允许（紫宸殿空闲=允许；批阅普通阶段=允许；关键剧情选择/上朝核心议题/生产重病=禁止）。禁用时给明确原因，不做无反应按钮。乘风传令为 `entryMode:"manual"` 范式，**不新增业务系统**。

---

## 7. 侍君宫殿与多人居住（大部分已实现，收敛即可）

- **内部居所结构已存在**：`CharacterStanding.chamber`（main/east_side/west_side/east_annex/west_annex）+ `CharacterScene` 宫室槽（`chambers.ts` `CHAMBERS`/`CHAMBERED_PALACES`）。无需新建子地点数据，**不硬编码人物名**（已由 `occupantOf(chamber)` 动态解析）。
- **进入即开始**：若该居所有 `auto_on_enter` 事件 → 直接开始，**不再问**「此处有事件，是否处理？」。事件结束回普通场景。
- 点具体宫室：有事件→直接开始；无事件且人在→普通互动场景（`CharacterScene` 已实现 `action-dock`）；人不在→缺席禀报（已实现 `awayLine`）；休息/生病→对应状态与允许操作。
- 本期改动：把后宫居所的 `location_enter` 事件呈现从「弹窗」改为 `auto_on_enter` 直接开始（§3.1 推导），并复核宫室槽在 360px 可点。

---

## 8. 御花园（yuhuayuan）子地点探索

御花园采用 `exploration` 结构。**子地点名称读内容配置，不硬编码进通用组件。**

### 8.1 数据
为支持子地点而**不**膨胀 location schema，采用既有「子地点即同地点内槽位」思路（类比 chambers）：在 `content/locations/yuhuayuan.json` 增加可选 `subLocations` 数组（schema 扩展，可选字段，旧 content 不受影响）。每个子地点带自己的背景图 key：

```ts
// locationSchema 扩展（可选）
subLocations: z.array(z.strictObject({
  id: idSchema,                 // jiangxuexuan / taiyechi / fubiting / tuixiushan
  name: nonEmpty,               // 绛雪轩 / 太液池 / 浮碧亭 / 堆秀山
  backgroundKey: nonEmpty,      // bg.<id>（各子地点独立背景，铺满舞台）
  hint: nonEmpty,               // 含蓄线索，不泄露事件名/结果
})).optional(),
```

**本期固定 4 个御花园子地点**（背景图已由 `0dd9dc1 背景图` 推送到 `origin/main` 的 `public/assets/backgrounds/`，**但 `assets/manifest.json` 尚未登记，实现时须补 manifest 条目**）：

| 子地点 | `id` | `backgroundKey` | 图片文件 |
|--------|------|-----------------|----------|
| 绛雪轩 | `jiangxuexuan` | `bg.jiangxuexuan` | `backgrounds/jiangxuexuan.png` |
| 太液池 | `taiyechi` | `bg.taiyechi` | `backgrounds/taiyechi.png` |
| 浮碧亭 | `fubiting` | `bg.fubiting` | `backgrounds/fubiting.png` |
| 堆秀山 | `tuixiushan`（堆=tui，按文件名） | `bg.tuixiushan` | `backgrounds/tuixiushan.png` |

> 名称读 content 配置，**不硬编码进通用组件**（架构规则）。这 4 张为单图背景（无 time-of-day 变体），manifest `kind:"background"`，`placeholder:false`。
> **分支同步**：本 worktree 分支创建于该推送之前，落地实现前须同步 `origin/main`（`git rebase origin/main` 或 merge）以取得图片与最新 main。

子地点与事件的绑定：事件 `condition` 用既有 `atLocation` + 一个新的弱约束（或复用 flag）标记其 `subLocationId`；调度纯函数 `pickSubLocationEvent(db, state, locId, subId)` 返回该子地点当前唯一事件。

### 8.2 流程
进御花园先显示总览（子地点入口：桌面=卡片/画卷，手机=纵向大区块列表），每入口显含蓄线索（`hint`）。进子地点：有事件→直接开始；无事件有人→普通交谈；无人无事件→普通游览文案；不可用→明确原因。

### 8.3 多事件调度（确定性优先级）
同一子地点同时至多绑定一个可进入事件。多事件竞争同一子地点时按优先级取一：主线/限时 > 已约定 > 角色专属 > 普通随机；其余留候选池/延后/分配兼容地点/后续刷新。**未触发事件不丢失。**

---

## 9. 宣政殿（xuanzhengdian）重构

宣政殿从 `FreeViewScreen` 单按钮，升级为专用 `XuanzhengdianScreen`（**新**，走 Scene Shell）。

### 9.1 上朝前
显示今日朝议摘要（议题来自 `pickCourtAffairs(db, "court:{rngSeed}:{dayIndex}")` 抽取的 2–3 件 `checkpoint:"court"` 事件标题预览——**真实数据**，与实际上朝抽取同一种子，保证预览=实际）。主操作：升朝（`beginCourt`）、查看议程、离开。群臣剪影/卷轴为氛围层，不要求全员立绘。

### 9.2 上朝中
沿用现有逐议题 `DialogueScreen`（`view==="court"`，`CourtSession{queue,index}`，`App.tsx:1223-1247`）：开场 → 逐件议题 → `resolveEvent` 结算 → 进下一件 → 结束。每议题只结算一次（现状已保证：`committed` 才 `nextIndex++`）。

### 9.3 上朝结束
展示**真实结算**摘要（汇总本次 court 会话各议题 effects 的资源净变化 + 角色态度变化；由结算结果累计，**UI 不猜测**）。提供：查看朝议记录、召见官员、返回。无议程时显示合理空状态文案（非大片空白）。

---

## 10. 管理面板与抽屉（收敛入口）

人物管理/行政操作统一用 Drawer/Sheet/Panel（已有 `Drawer.tsx`/各 Modal）。桌面=右侧抽屉/居中面板；手机=底部 Sheet/全屏页 + 大按钮列表。要求：清楚返回、保留当前场景、完成后自然回场景、不丢非关键上下文、行政文本不与对话混框。复用现有 `ConsortListModal`/`RankAdminModal`/`RelocateModal`/`BestowModal`/`PhysicianModal`/`CharacterProfileDrawer`，仅统一触发入口（导航层「更多」/乘风谕令菜单）与手机端版式。

---

## 11. 响应式与视觉层级

### 11.1 断点
360（手机）/768（平板）/1280（桌面）/超宽。主点击区 ≥ 44–48px。手机端：同时只突出一个主交互对象；不并排 3 张人物卡；不横向滚动密集按钮；主操作按钮 ≥44px；底部操作栏可固定；次要操作进「更多」；对话可滚动；立绘不挤出操作区；不依赖 hover。

### 11.2 视觉权重四级
沿用美术方向（深棕黑/暗金/朱红/半透明暗板/细边框装饰角），但区分：
- **主操作**：金色实边/明显高亮，数量有限。
- **次操作**：纯文字/弱边/半透明底/「更多」。
- **信息区**：细分隔线/小标题/半透明渐变/局部底板，不全套金框。
- **事件提示**：像场景叙事（「宫人低声禀报，司礼卫绫正在殿外候见。」），非系统警告框（除非真系统错误）。

### 11.3 动画
轻量过渡：人物淡入/侧入、告退淡出、当前说话者高亮、抽屉开合、场景渐变、候见提示平滑出现。要求：尊重 `prefers-reduced-motion`；动画不阻塞事件态；结算不依赖 CSS 动画结束；快速点击不致重复入场/重复结算（入场/结算去抖）。

---

## 12. 存档兼容

- **优先零迁移**：呈现态（候见 pending/promptShownAt/remindAt）以 `flags` 承载（§3.2），旧档读出即默认「无 pending」，行为正确。
- **content 可选字段**：`entryMode`、`subLocations` 均 `optional` + 推导兜底，旧 content/旧档不失效；不让已完成事件复活（仍由 `once`/`eventLog`/`cooldown` 把关）；不让旧事件因缺 `entryMode` 无法触发（推导兜底）。
- **仅在确需结构化字段时**才升 `SAVE_FORMAT_VERSION`（6→7）并在 `MIGRATIONS` 加一级，为新字段提供默认值；更新 `stateSchema` 与 `tests/save/*`。本期预计**不需要**升版（flags 足够）。
- 纯展示态（被召立绘、压暗、动画）维持临时 UI 态，不入档。

---

## 13. 测试策略

补**行为**测试（非快照）。引擎纯函数优先：

- **audience（`audience.ts`）**：`defer` 产出正确 flag effects；`audienceStatus` 在 pending/available/suppressed 间转换；`shouldRemind` 仅在 remindAt 到点/升级为真。
- **entryMode 推导（`resolveEntryMode`）**：紫宸殿→request_audience；后宫居所→auto_on_enter；御花园→exploration；court→scheduled；显式字段覆盖推导。
- **御花园调度（`pickSubLocationEvent`）**：多事件同子地点优先级稳定、至多取一、未触发不丢。
- **宣政殿议程**：预览=`pickCourtAffairs` 实际抽取；逐议题只结算一次；结算摘要来自真实 effects。
- **UI（`tests/ui/*`，React Testing Library，已有先例 `courtyardHalls.test.ts`）**：紫宸殿无候见时无人物卡/无候见提示；有候见显示非阻塞提示；宣入后事件开始；告退后离场；「记入待宣」后再次进入不重弹；deadline 到点重提醒；召见侍君不新增永久卡；召见结束恢复场景；乘风可中断场景召出、关键事件中不可召出、完成后离场、不重复执行。
- **响应式**：360/768/1280/超宽人工验证 + 关键断点快照（仅作回归基线）。

---

## 14. 验收标准（对应原始需求 §24）

1. 进紫宸殿不再永久显示乘风/卫绫/侍君人物卡。
2. 紫宸殿背景占据主画面，非顶部横幅+黑区。
3. 司礼有事以候见出现，非立即阻塞弹窗。
4. 「稍后」后同一事件不再每次进门重弹。
5. 宣人入殿后人物自然入场/对话/离场。
6. 乘风可在允许场景随时召见并走现有行政操作。
7. 召见侍君以立绘出现，不新增人物卡。
8. 一宫多人经内部宫室进入各自居所。
9. 御花园可先选太液池/倚梅园等子地点。
10. 每御花园子地点至多一个当前事件。
11. 宣政殿有今日议程与朝议结果，非单按钮+空白。
12. 人物详情/管理进独立面板，不与叙事混杂。
13. 手机端可正常点击浏览，不依赖并排大卡片。
14. 旧存档可继续读取。
15. 业务规则/Effect 结算/对话系统未被破坏。
16. `typecheck`/`test`/`lint`/`build` 全通过。

---

## 15. 实施阶段

详见配套实现计划 [`../plans/2026-06-22-scene-ui-narrative-refactor.md`](../plans/2026-06-22-scene-ui-narrative-refactor.md)。阶段优先序（与原始需求 §22 Phase 3 一致）：

1. Scene Shell
2. 去除普通场景人物卡
3. 紫宸殿默认态 + 候见系统
4. 「稍后处理」生命周期（audience.ts）
5. 乘风传令
6. 召见人物流程
7. 侍君宫殿内部地点（收敛）
8. 御花园子地点
9. 宣政殿议程
10. 响应式与视觉统一
11. 测试与旧代码清理

每阶段独立可交付、独立可测；完成即跑 `typecheck`/`test`/`lint`/`build`。

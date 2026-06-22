# 场景 UI · 人物交互 · 事件流程重构 — 设计规格

**日期：** 2026-06-22
**状态：** 评审 r3 修订完成，待复审批准（对账按 eligibility 清理且不误删他 host / 候见数与待宣数分离 / 修正 manual 不可检测的校验承诺 / 文字一致性）
**相关文档：**
[`engineering/10-current-implementation.md`](../../engineering/10-current-implementation.md)（引擎契约）·
[`2026-06-18-yushufang-redesign-design.md`](./2026-06-18-yushufang-redesign-design.md)·
[`2026-06-19-ui-bgm-courtyard-overhaul-design.md`](./2026-06-19-ui-bgm-courtyard-overhaul-design.md)·
[`2026-06-21-consort-presence-greeting-design.md`](./2026-06-21-consort-presence-greeting-design.md)

---

## 0. 范围与非范围

把「背景横幅 + 人物卡列表 + 按钮矩阵」的地点 UI 重构为「一个地点即一座舞台」，并**补齐事件呈现的中央路由、事件结束的返回上下文、候见的完整生命周期**——这些是「新 UI 做出来了但事件仍自动跳转、结束回错页、待宣事件无法重开」的根因。

**本期实现：**
- **事件呈现契约 `presentation`**：在事件上声明「如何呈现给玩家」（mode + 元数据），令 UI 不再靠「读场景首个 speaker / 事件标题 / 硬编码人名」猜测事实。
- **中央呈现路由**：自动 checkpoint 只能启动 `auto_on_enter` 与合规全局自动事件；`request_audience`/`exploration`/`manual` **绝不**被自动启动；`scheduled` 由专用入口（上朝等）管理。
- **事件返回上下文 `EventReturnTarget`**：事件开始时记录来源，结束/中途退出按来源恢复，替换一律 `goHome()`。
- **候见（audience）完整生命周期**：三态 + 真实「待宣列表」+ 提醒时间 + 清理/过期规则，修复「稍后再说」反复弹出与「点了记入待宣后永久消失」。
- **Scene Shell** + **场景人物条**（移除人物卡后仍保留轻量人物交互入口）。
- **紫宸殿 / 宣政殿 / 御花园** 三处地点重构；**响应式与视觉层级**。

**非范围（明确不做）：**
- 不重写事件引擎核心 `getEligibleEvents`、Effect 漏斗、对话 Provider、`store.applyEffects` 契约、位分/孕育/健康/侍寝业务规则。
- **不改 `DialogueScreen.onDone` 共享契约**（朝议结算用引擎级快照 diff，见 §9）。
- 不修改人物事实、剧情内容、属性数值规则；不引入新 UI 框架；不把地点改成像素热区地图；不新增尚不存在的业务系统。
- 不为 <360px / 横屏做专门优化（仅保证不破版）。

---

## 1. 审计结论（Phase 1 实测）

> 全部引用真实文件/类型/函数名。下列为「现状」，非目标态。

### 1.1 地点页面组件树
- `src/ui/App.tsx`（1558 行）是 `useState` 视图状态机：`type View = "title"|…|"location"|"map"|"freeview"|"event"|"court"|"wenzhaodian"|"yuqing_gong"|"fengxiandian"|"cining_gong"|"courtyard"|"shop"|"dianxuan"`（`App.tsx:84`），约 40 个 `useState`。
- 普通地点走 `LocationScreen`；专用屏：`ShangshufangScreen`/`YuqingGongScreen`/`FengxiandianScreen`/`CiningGongScreen`/`CourtyardScreen`/`FreeViewScreen`/`MapScreen`。
- `LocationScreen` 二分支：`showScene`（hougong 有住客 **或** `hasChambers`）→ `CharacterScene`；否则通用 `location-screen`（背景 stage + `yushufang-menu` + 人物卡列表）。

### 1.2 人物卡在哪里生成
- `src/ui/components/CharacterCard.tsx`，由 `LocationScreen.tsx:192-247` 渲染 `present`（`presentAt`）+ `summoned`（`zichendian && summonedConsortId`，`:96-99,193-219`）。紫宸殿因乘风/卫绫 `defaultLocation` 在此而永久出卡。
- **已存在的好范式**：`CharacterScene.tsx` 已实现立绘居中 + 宫室槽（`CHAMBERS`）+ `action-dock`（主操作 +「更多」）+ 缺席禀报。后宫居所已是目标态。

### 1.3 事件弹窗在哪里触发
- `LocationScreen.tsx:267-284`：`getEligibleEvents(db,state,"location_enter")` 非空且 `!eventsDismissed` → `modal-backdrop > event-overlay` 居中阻塞弹窗。
- 自动链：`App.startEvent` → `view="event"` → `DialogueScreen`；结束 `pickNextEvent(db,state,"scene_end"|"time_advance")` 串联（`App.tsx:1187-1216`，`MAX_EVENT_CHAIN=3`）。

### 1.4 「稍后处理」缺陷根因
- **完全不持久化**：`LocationScreen.tsx:77-80` `eventsDismissed = useState(false)` 且换地点即复位。事件本身无呈现态：`gameEventSchema`（`schemas.ts:465-484`）仅 `checkpoint/condition/priority/once/cooldown/apCost/public/headline`；去重仅 `once`+`hasEventFired`+`cooldown`（`engine.ts:20-51`）。

### 1.5 事件调度器现状（P0-1 根因）
- `getEligibleEvents`（`engine.ts:39-51`）纯资格判断（checkpoint+once+cooldown+condition），排序 priority desc/id asc。
- `pickNextEvent`（`engine.ts:54-60`）= 取首个 affordable，**完全不理解 entryMode**。
- `runCheckpoints`（`App.tsx:319-336`）移动后直接 `pickNextEvent("time_advance")??("location_enter")` → 命中即 `startEvent()`。→ 紫宸殿候见事件、御花园探索事件、任何挂了 checkpoint 的 manual 事件都会被自动启动。

### 1.6 事件返回路径现状（P0-2 根因）
- `DialogueScreen.onDone(committed, rolledOver)`：`committed` → 链事件/转旬补跑后 `goHome()`（`App.tsx:1215`，统一回皇城主地图）；中途退出 → `setView("location")`（`:1219`）。
- court `onDone(committed)`：结束统一 `goHome()`（`:1244`）。
- **无任何 `eventReturnTarget`/`eventOrigin`/导航栈**。→ 紫宸殿宣人结束回地图、御花园事件结束丢子地点、宫殿自动事件回错页。

### 1.7 朝议结算现状（P0-7 根因）
- `DialogueScreen.onDone` 只回 `(committed, rolledOver)`，**不返回 applied effects**；court 会话结束直接 `goHome()`（`App.tsx:1233-1245`）。无 court 结果页、无 effects 累计来源。

### 1.8 其他
- 宣政殿 `entry:"free"`+`actionEventId:"ev_chaohui"` → `FreeViewScreen` 单按钮（空白根因）。御花园普通 travel 地点，**无子地点结构**。
- `flags: Record<string,FlagValue>`（`types.ts:420`）开放记录，已用于 dedupe（`tributeMinister:{dayIndex}`、`daxuanDianxuanFlagKey`）。存档有真实迁移链 `MIGRATIONS`（`SAVE_FORMAT_VERSION=6`）。
- `CharacterStanding.chamber`（main/east_side/west_side/east_annex/west_annex）+ `CharacterScene` 宫室槽 = 已有的多人居所模型。
- 测试：引擎层覆盖好；UI 行为薄。命令 `npm test`/`typecheck`/`lint`/`build`/`validate-content`/`validate-manifest`。

### 1.9 耦合风险
- `App.tsx` 巨型协调器：召见/反应串播/转旬补跑/懿旨掷骰交织（`reactionRollover`/`reactionStayOnMap`/`shopRollover`）。改返回路由/候见须保留这些时间结算路径。

---

## 2. 目标架构：四层分离

| 层 | 职责 | 载体 |
|----|------|------|
| **场景层** | 地点/背景/在场人物/环境描述 | `SceneShell` + 场景人物条 |
| **叙事层** | 入场/对话/事件选择/结果/离场 | `DialogueScreen`/`ReactionScreen`/`AudiencePrompt` |
| **管理层** | 宫册/详情/位分/封号/迁宫/封赏/召太医 | 既有 Modal/Drawer（收敛入口） |
| **导航层** | 日期/地点/行动力/国情/国库/设置/离开 | `GameShell` + 浮层 |

**UI 只展示引擎已确定的事实，绝不创造游戏事实**（架构规则 #2）。所有写入走 `store.applyEffects`（#1）。

---

## 3. 事件呈现契约、中央路由、返回上下文

### 3.1 `presentation` 字段（事件元数据单一来源）

在 `gameEventSchema`（`schemas.ts`）新增**可选**判别联合 `presentation`，作为「如何呈现」的权威来源。`checkpoint` 仍负责 eligibility（不变），`presentation.mode` 负责呈现分流：

```ts
// schemas.ts — gameEventSchema 扩展（可选）
presentation: z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("request_audience"),
    hostLocationId: idSchema,        // 候见归属地点（呈现宿主，独立于 condition.atLocation）
    audienceCharacterId: idSchema,   // 候见者（立绘/名牌来源）
    audiencePrompt: nonEmpty,        // 候见提示文案（叙事口吻，UI 不再硬编码）
  }),
  z.strictObject({
    mode: z.literal("exploration"),
    hostLocationId: idSchema,        // 御花园等宿主地点
    subLocationId: idSchema,         // 静态绑定的子地点（P0-5：不用 flag）
    eventHint: nonEmpty.optional(),  // 事件存在时才显示的人物/事件线索（P0-6）
  }),
  z.strictObject({ mode: z.literal("auto_on_enter") }),
  z.strictObject({ mode: z.literal("manual") }),
  z.strictObject({ mode: z.literal("scheduled") }),
]).optional(),
```

**`resolveEntryMode(event, location)`**（纯函数，`src/engine/events/entryMode.ts`）：

```ts
export type EventEntryMode = "auto_on_enter"|"request_audience"|"exploration"|"manual"|"scheduled";
export function resolveEntryMode(event, location): EventEntryMode {
  if (event.presentation) return event.presentation.mode;     // 显式优先
  if (event.checkpoint === "court") return "scheduled";
  if (event.checkpoint === "location_enter") {
    if (location?.id === "zichendian") return "request_audience";
    if (location?.id === "yuhuayuan") return "exploration";
    return "auto_on_enter";                                   // 后宫/普通居所
  }
  return "auto_on_enter";                                     // game_start/scene_end/time_advance
}
```

**呈现模式声明规则（评审 r2 #2 / r3 #3）**：`auto_on_enter` 可由旧 content 推导（无 `presentation` 也能展示）。`request_audience`/`exploration` 在其宿主地点（紫宸殿/御花园）由推导识别为「需 presentation」，缺失时 `validate-content` 报错（见 §3.5）。`manual` **无推导路径**——数据上与 `auto_on_enter` 不可分，validator 无法检测「本想 manual 却漏声明」；只有显式 `presentation.mode:"manual"` 才算 manual。

旧 content 无 `presentation` 且推导为 `auto_on_enter` → 正常；可推导为 request_audience/exploration 而缺 presentation → **`validate-content` 报错**。旧档不受影响（字段可选）。

### 3.2 中央呈现路由（P0-1：entryMode 真正接入调度器）

`getEligibleEvents` **保持纯资格判断不变**；新增路由层 `src/engine/events/router.ts`，**App 的 checkpoint 接线改调路由而非裸 `pickNextEvent`**：

```ts
// router.ts
/** 自动 checkpoint 唯一可自动启动的事件：仅 auto_on_enter（含全局自动），取首个 affordable。 */
export function pickAutoStartEvent(db, state, checkpoint): GameEventContent | null;
/** 紫宸殿候见队列（见 §3.3）。绝不自动启动。 */
export function getAudienceQueue(db, state, locationId): AudienceItem[];
/** 御花园子地点当前唯一事件（见 §8）。绝不自动启动。 */
export function pickSubLocationEvent(db, state, locId, subId): GameEventContent | null;
```

`pickAutoStartEvent(db, state, checkpoint, location)` = `getEligibleEvents(db,state,checkpoint)` 过滤 `resolveEntryMode(e,loc)==="auto_on_enter"` 且 affordable 的首个。`request_audience`/`exploration`/`manual` 被排除，**不可能被任何自动 checkpoint 拉起**。`scheduled` 不参与自动 checkpoint（上朝由 `ev_chaohui` 专用入口）。

**所有「系统自动启动事件」的调用点统一改走 router（评审 r2 #4）**。审计确认 `App.tsx` 有 **4 处** 自动 `pickNextEvent`，全部须改为 `pickAutoStartEvent(db, state, checkpoint, db.locations[state.playerLocation])`：

| 位置 | checkpoint | 现状 → 改为 |
|------|-----------|-----------|
| `runCheckpoints`（`:322-323`） | time_advance / location_enter | `pickAutoStartEvent` |
| `proceedAfterNewGame`（`:528`） | game_start | `pickAutoStartEvent` |
| `DialogueScreen.onDone` 链（`:1191`） | scene_end | `pickAutoStartEvent` |
| `DialogueScreen.onDone` 转旬（`:1208`） | time_advance | `pickAutoStartEvent` |

否则挂在 `scene_end`/`time_advance` 上的 `manual`/`request_audience` 事件仍会被自动拉起。`pickNextEvent` 仅保留给确实不区分呈现模式的内部用途，App 层不再直接调用。紫宸殿进入改为渲染候见队列；御花园进入改为渲染子地点总览。

### 3.3 候见完整生命周期（P0-3：三态 + 列表 + 提醒 + 清理）

`src/engine/events/audience.ts`（纯函数）。flag 键统一 **冒号** 分段（P1-3）：`audience:pending:<id>` / `audience:promptShownAt:<id>` / `audience:remindAt:<id>`。

**提醒间隔修正（评审 r2 #6）**：`dayIndexOf = (...)*3 + PERIOD_ORDINAL`（`time.ts:81`），即 **1 个 `dayIndex` = 1 旬**，一月 = 3 个 dayIndex。故「下一旬提醒」是 `+1`，不是 `+3`（`+3` 是下月同旬）。

```ts
const AUDIENCE_REMIND_AFTER_PERIODS = 1;  // defer 后 1 旬（=1 dayIndex）再主动提醒；紧急事件由 content 覆盖 remindAt 提前

export type AudienceStatus = "available" | "pending" | "suppressed";

/** UI 唯一消费的候见项：自带呈现元数据 + 行动力 + 日期，UI 不再二次读 flags/算 ap/收窄 presentation。 */
export interface AudienceItem {
  event: GameEventContent;
  presentation: {            // 类型已收窄；保证非 undefined（§3.5 校验）
    mode: "request_audience";
    hostLocationId: string;
    audienceCharacterId: string;
    audiencePrompt: string;
  };
  status: AudienceStatus;
  affordable: boolean;       // 来自 getEligibleEvents().affordable（不再 .map 丢弃）
  deferredAtDayIndex?: number;  // = promptShownAt（待宣列表「候见于 X」+ 排序）
  remindAtDayIndex?: number;    // = remindAt（可显示「将于 X 再禀」）
}

export function audienceStatus(state, eventId): AudienceStatus;     // 读 pending + shouldRemind
export function shouldRemind(state, eventId): boolean;             // 读 remindAt（dayIndex 已到）
export function defer(eventId, dayIndex): EventEffect[];           // pending=true, promptShownAt=dayIndex, remindAt=dayIndex+AFTER_PERIODS
export function clearAudience(eventId): EventEffect[];             // 三个 flag 归零
/** 权威队列（全部三态）：校验 resolveEntryMode===request_audience、presentation.hostLocationId===locationId、当前 eligibility、once/cooldown。 */
export function getAudienceQueue(db, state, locationId): AudienceItem[];
export function audienceCount(db, state, locationId): number;            // 全部候见（含 available）→「候见之人」
export function getDeferredAudienceQueue(db, state, locationId): AudienceItem[]; // 仅 pending+suppressed → Drawer
export function deferredAudienceCount(db, state, locationId): number;    // →「待宣 · N」
/** 对账：清除「属于本 host 但已不合法」的 pending（纯函数，无副作用）。 */
export function audienceReconciliationEffects(db, state, locationId): EventEffect[];
```

- **`AudienceItem` 自足（评审 r2 #1）**：携带收窄后的 `presentation` + `affordable` + `deferredAtDayIndex` + `remindAtDayIndex`。`AudiencePrompt`/`PendingAudienceDrawer` 只消费 `AudienceItem`，不再读 flags、不重算 ap、不自行收窄 `event.presentation`。
- **候见数 ≠ 待宣数（评审 r3 #2）**：「候见之人」= `audienceCount`（含首次出现的 `available`）；「待宣 · N」= `deferredAudienceCount`（仅 `pending`+`suppressed`）。`PendingAudienceDrawer` 直接消费 `getDeferredAudienceQueue`，**UI 不自行过滤**——避免「候见 · 1 → 点开却『当前无待宣事务』」（那 1 是 available，不是已延期）。
- **宿主地点用 `presentation.hostLocationId`（评审 r2 #3）**：`getAudienceQueue` 以 `hostLocationId===locationId` 判定归属，**不依赖 `condition.atLocation`**（后者是游戏资格条件、可嵌套 all/any/not、可缺省，不适合做呈现宿主）。`condition.atLocation` 仍决定「当前是否 eligible」，`hostLocationId` 决定「属于哪个场景」，两者职责分离。
- **三态语义**：`available`（未延期、当前 eligible）→ 主动弹；`pending`（已延期、`shouldRemind` 真）→ 再次主动弹；`suppressed`（已延期、未到提醒点）→ 仅在待宣列表。提示可见 = available||pending；待宣列表 = pending||suppressed。
- **`defer` 真正设 `remindAt`** = dayIndex + `AUDIENCE_REMIND_AFTER_PERIODS`（提醒确会发生）；deadline/升级由事件 effects 覆盖为更早。
- **`clearAudience` 接线 + 对账（评审 r2 #5 / r3 #1）**：宣入但**中途退出** → 保留 pending；**成功提交** → `clearAudience`。过期清理由独立纯函数 `audienceReconciliationEffects` 完成（selector 不产副作用），规则：
  - eligibility（condition / cooldown / once）**一律走 `getEligibleEvents` 权威判断**，不复制逻辑——先取「本 host 当前合法候见集 `validIds`」。
  - 遍历现存 `audience:pending:*`：事件**不存在 / 非 request_audience** → 清；`hostLocationId !== 当前 host` → **跳过（不清，避免误删其它 host 的待宣）**；属本 host 但 `!validIds.has(id)`（条件失效/cooldown/once 已发）→ 清。
  - 时机：**进入该候见宿主时**（含读档后首次进入该 host）按 `locationId` 跑，**绝不在任意地图态全局清理**；事件提交后再跑一次。杜绝「条件暂失效→从队列消失→flag 残留→日后以旧 pending 复活」。

### 3.4 事件返回上下文（P0-2）

App 层临时状态（不入档，符合「不允许中途存场景」）：

```ts
type EventReturnTarget =
  | { kind: "map" }
  | { kind: "location"; locationId: string }
  | { kind: "zichendian" }
  | { kind: "garden"; subLocationId?: string }
  | { kind: "xuanzhengdian" };
```

`startEvent(eventId, returnTarget)` 记录来源；`DialogueScreen.onDone` 完成/退出后调 `restoreReturn(target)` 恢复对应视图（替换一律 `goHome()`）。`restoreReturn` 内仍跑既有转旬补跑/checkpoint 路径（保留 `reactionRollover` 等结算），只是落点按 target 而非主地图。

**target 生命周期（评审 r2 建议）**：`startEvent` 必覆盖旧 target（新入口启动即重置）；链事件（scene_end/time_advance 自动续接）**继承**同一 target；`restoreReturn` 恢复后**清空** `eventReturnTarget`；中途退出同样恢复并清空；新游戏/读档清空。一条链最终只恢复一次，避免上次事件的 target 污染下次由其它入口启动的事件。Task 1.4 须含 stale-target 回归测试。

### 3.5 内容跨引用校验（评审 r2 #2）

`tools/validate-content.ts` 增加跨引用校验（构建期失败，不留运行时兜底）：

- **可检测的缺失（靠地点推导）**：`location_enter` 事件，若其 `condition` 引用的 `atLocation` 推导为 `request_audience`（紫宸殿）或 `exploration`（御花园）而**缺 `presentation`** → 报错（深层嵌套 `atLocation` 为 best-effort）。
- **引用校验**（对已声明的 `presentation`）：`audienceCharacterId` ∈ `db.characters`；`hostLocationId` ∈ `db.locations`；`exploration.hostLocationId` 对应 location 须有 `subLocations` 且 `subLocationId` ∈ 其 `subLocations[].id`；`request_audience` 的 `audiencePrompt`/`audienceCharacterId` 非空（schema 已强制，校验再确认语义）。
- **`manual` 不可检测意图（评审 r3 #3）**：`manual` 无推导路径——无 `presentation` 的非 court 事件在数据上等同 `auto_on_enter`，没有 `manual:true` 之类标记。故 validator **只校验显式 `presentation.mode:"manual"` 的结构**，**无法**检测「本想 manual 却漏声明」。本期**不**强制所有事件声明 `presentation`（不扩大迁移范围）。

这对可推导的 request_audience/exploration 满足「UI 不猜事实」与类型安全；manual 依赖作者显式声明。

---

## 4. Scene Shell

`src/ui/components/SceneShell.tsx`（新）：背景铺满 + stage/narrative/actions 三槽 + 渐变遮罩。

- **背景裁切焦点（P1-4）**：支持可选 `backgroundPosition`（location 顶层 + **每个 `subLocation` 亦可独立配置**，评审 r2 UI 修正；缺省 `center`），如紫宸殿 `"62% center"`，避免超宽/360px 主体被裁。
- **布局避免溢出（评审 r2 UI 修正）**：`SceneShell` 位于既有 `GameShell` 内，**不**对 stage 用裸 `100dvh`（会与顶部栏叠加纵向溢出）。改为 `GameShell` 纵向 flex、`SceneShell` `flex:1; min-height:0`，由 flex 占满顶部栏以下剩余高度。
- **移动安全区（P1-4）**：固定操作栏 `padding-bottom: env(safe-area-inset-bottom)`，避免移动浏览器地址栏抖动遮挡按钮。
- `prefers-reduced-motion` 关过渡。Shell 只管布局，地点 body 各屏注入。

---

## 5. 人物展示规则

### 5.1 普通场景不显示完整人物卡
完整 `CharacterCard`（全属性+多按钮）仅留于管理层（`ConsortListModal`/`CharacterProfileDrawer`/`HeirListModal`/官员名录/对象选择）。普通地点删除常驻卡。

### 5.2 当前互动人物用大立绘
复用 `CharacterScene` 范式：立绘 + 名牌（人物名 / 身份·位分 / 一行状态）。详细属性进 `CharacterProfileDrawer`。

### 5.3 场景人物条（P0-8：移除卡片后保留轻量入口）
移除人物卡后，**普通地点仍须可点人物**。新增轻量 `SceneCharacterBar`（非人物卡）：列「在场」人物名 + 身份（数据来自 `presentAt`，引擎事实）。桌面=侧边人物条；手机=底部 Sheet / 大区块列表。点击 → 聚焦该人物立绘 + 打开可用互动（对话/侍寝按门槛）或 `CharacterProfileDrawer`。它是**场景人物选择器**，不展示容貌/健康/恩宠/性格数值与全部管理按钮。

### 5.4 在场状态明确化
复用 `presentAt`/`getPresentAt`/`absentAt`/`summonedConsortId`/`canSummon` 区分：常驻/在场/候见/被召/互动中/已离开/暂不可召，以文案呈现（缺席禀报已实现）。

---

## 6. 紫宸殿重构

### 6.1 默认态（P1-1：不展示虚构数量）
背景铺满；无乘风/卫绫/被召侍君常驻卡。今日事务摘要**只展示有真实引擎来源的项**：

```
今日事务
候见之人：{audienceCount(db,state,"zichendian")}    // 全部候见（含首次出现）
可批阅奏折                                          // 行动可用性（非数量）
[待宣 · {deferredAudienceCount(...)}]               // 仅已延期，开 PendingAudienceDrawer
```

**不**显示「待批奏折：3」「待办谕令：2」——无队列模型前不编造数量。主操作栏：奏折 / 召见 / 传乘风 / 休息 / 离开。「查看侍君/查看子嗣」移入导航层「更多」。

### 6.2 候见系统
进殿正常展示场景，再以**非阻塞** `AudiencePrompt`（叙事区/事务栏，非 `modal-backdrop`）呈现候见队列中 `status∈{available,pending}` 的最高优先项。文案与立绘来自 `event.presentation.audiencePrompt`/`audienceCharacterId`（P0-4，**UI 不猜**）：

```
殿外传来通报。
{audiencePrompt}
[宣进来]   [记入待宣]
```

- 宣进来 → 通报文案 → 立绘入场 → `startEvent(id, {kind:"zichendian"})` → `DialogueScreen` → 结算 → 告退 → 回紫宸殿默认态（P0-2）。
- 记入待宣 → `applyEffects(defer(id, dayIndex))` → 提示关闭、进待宣列表 → 顶部「候见 · N」。
- `status==="suppressed"` 不主动弹；再次进殿不重弹（P0-3）。

### 6.3 待宣列表（P0-3#3：真实可重开）
新增 `PendingAudienceDrawer`：直接消费 `getDeferredAudienceQueue`（仅 pending/suppressed；候见者名 + `audiencePrompt` + 候见于 `deferredAtDayIndex` 日）。点某项 → 立绘入场宣入（同 6.2 宣进来流程）。过期项（once 已发/条件失效/cooldown）由 `audienceReconciliationEffects` 清理、不出现。**「待宣 · N」徽标 = `deferredAudienceCount`，非全部候见数（评审 r3 #2）。**

### 6.4 召见侍君（无卡片）
点召见 → `BedchamberPicker` 升级为响应式对象抽屉（姓名/位分/状态/可否召+原因，无全属性/全管理）→ 选定 → `setSummonedConsortId(id)` → 立绘入场 → 直接进对话/互动 → 告退 → `setSummonedConsortId(null)` → 恢复默认态。**全程不渲染 `CharacterCard`。**

### 6.5 乘风传令（P1-2：明确范围与归位）
`ChengfengDispatch`：当前场景压暗 → 乘风立绘（「臣在」）→ 谕令菜单（仅暴露已实现：召见 `onFlipTablet`、调整位分 `onManage`、封号、迁宫 `onRelocate`、赏赐 `BestowModal`、召太医 `onSummonPhysician`、承嗣 `onSummonZongzheng`）→ 选择 → 走现有业务入口 → 乘风离场 → 恢复原场景焦点。

- **归位**：入口挂在 `SceneShell` 操作栏（紫宸殿默认态、侍君普通互动场景可见），**不嵌套多层 Modal**；打开管理 Modal → 关闭后回到调用前的场景/人物焦点。
- **本期范围边界**：仅在**空闲场景**与**普通人物互动页**可调用；**禁止**在一次原子操作（如批阅奏折结算中）或剧情选项界面插入。禁用时给明确原因，不做无反应按钮。

---

## 7. 侍君宫殿与多人居住（已实现，收敛）

- 内部居所 = `CharacterStanding.chamber` + `CharacterScene` 宫室槽（`occupantOf` 动态，无硬编码人名）。
- 后宫居所 `location_enter` 事件标 `presentation.mode:"auto_on_enter"`（或推导）→ **进门直接开始**，不再问「是否处理」；结束按 `{kind:"location", locationId}` 回该宫普通场景（P0-2）。
- 点宫室：有事件→直入；无事件人在→普通互动（`action-dock` 已实现）；人不在→缺席禀报（已实现）。

---

## 8. 御花园子地点探索

`exploration` 结构。子地点名称读 content，不硬编码进通用组件。

### 8.1 数据（P0-5：subLocationId 静态字段；P0-6：静态描述 vs 动态线索）
`locationSchema` 加可选 `subLocations`；每子地点带**静态环境描述** `description`（恒成立，不含人物踪迹）+ 背景 key：

```ts
subLocations: z.array(z.strictObject({
  id: idSchema,                       // jiangxuexuan / taiyechi / fubiting / tuixiushan
  name: nonEmpty,                     // 绛雪轩 / 太液池 / 浮碧亭 / 堆秀山
  backgroundKey: nonEmpty,            // bg.<id>
  backgroundPosition: nonEmpty.optional(), // 每子地点独立裁切焦点（评审 r2 UI 修正）
  description: nonEmpty,              // 静态环境（永久成立，无人物/事件暗示）
})).optional(),
```

**人物/事件线索只在事件存在时显示**：来自 `event.presentation.eventHint`（§3.1）或人物 `presence`，由 `pickSubLocationEvent` 命中时生成。无事件无人时只显 `description`，**不显人物踪迹**（P0-6）。

**事件↔子地点绑定 = `event.presentation`（静态字段，非 flag）**。`pickSubLocationEvent(db,state,locId,subId)` = `getEligibleEvents(db,state,"location_enter")` 过滤 `resolveEntryMode==="exploration"` 且 `presentation.hostLocationId===locId` 且 `presentation.subLocationId===subId`，按 priority desc/id asc 取首个 affordable（至多一个）。宿主用 `hostLocationId`，与候见同一原则（§3.3，评审 r2 #3）。

**固定 4 子地点 → 资产映射**（背景图已由 `0dd9dc1 背景图` 推到 `origin/main` 的 `public/assets/backgrounds/`，**manifest 待登记**）：

| 子地点 | `id` | `backgroundKey` | 图片 |
|--------|------|-----------------|------|
| 绛雪轩 | `jiangxuexuan` | `bg.jiangxuexuan` | `backgrounds/jiangxuexuan.png` |
| 太液池 | `taiyechi` | `bg.taiyechi` | `backgrounds/taiyechi.png` |
| 浮碧亭 | `fubiting` | `bg.fubiting` | `backgrounds/fubiting.png` |
| 堆秀山 | `tuixiushan`（堆=tui，按文件名） | `bg.tuixiushan` | `backgrounds/tuixiushan.png` |

> **分支同步**：本 worktree 创建于该推送之前，落地前须 `git rebase origin/main`。

### 8.2 流程
进御花园先显总览（子地点入口：桌面卡片/画卷，手机纵向大区块），各入口显**静态** `description`。进子地点：`pickSubLocationEvent` 有事件→直接开始 `startEvent(id, {kind:"garden", subLocationId})`，结束按该 target 回**该子地点**上下文（P0-2，不丢子地点）；无事件有人→普通交谈；无人无事件→`description` 游览；不可用→明确原因。

### 8.3 多事件调度（确定性）
同子地点至多一个可进入事件；多事件竞争按 priority desc/id asc 取一，其余留池/延后/分配/后续刷新，**不丢失**。

---

## 9. 宣政殿重构

专用 `XuanzhengdianScreen`（取代 `FreeViewScreen` 单按钮），走 Scene Shell。

### 9.1 上朝前
今日朝议摘要 = `courtAgendaPreview(db,state)`：与 `beginCourt` **同一种子** `court:{rngSeed}:{dayIndex}` 调 `pickCourtAffairs`，标题预览=实际抽取（`court/agenda.ts`）。主操作：升朝 / 查看议程 / 离开。无议程显合理空状态文案。

### 9.2 上朝中
沿用既有逐议题 `DialogueScreen`（`view==="court"`，`CourtSession{queue,index}`），每议题只结算一次（现状已保证）。

### 9.3 上朝结束（P0-7：方案 B 引擎级快照 diff，不改 onDone 契约）
**不**扩展 `DialogueScreen.onDone`。在 `beginCourt` 进殿时 `snapshotCourtMetrics(state)` 存「展示快照」；court 会话结束（`setCourt(null)` 前）`diffCourtMetrics(before, after)` 计算真实差异：

```ts
// court/agenda.ts
export function courtAgendaPreview(db, state): { id: string; title: string }[];
export interface CourtMetrics { resources: Record<string, number>; favor: Record<string, number>; }
export function snapshotCourtMetrics(state): CourtMetrics;   // 抓 resources + 参与官员 standing.favor
export function diffCourtMetrics(before, after): { resourceDeltas: {...}[]; attitudeDeltas: {char,delta}[] };
```

差异覆盖**资源净变化 + 角色态度（favor）变化**（兑现规格承诺，非只 resource）。中途退朝：快照 diff 仍只反映已提交议题的真实落库变化（因 effects 已入 state）。结果存 App 临时态 → 进 court 结果页展示（查看朝议记录 / 召见官员 / 返回）。

---

## 10. 管理面板与抽屉（收敛入口）

统一 Drawer/Sheet/Panel。桌面=右侧抽屉/居中面板；手机=底部 Sheet/全屏。复用 `ConsortListModal`/`RankAdminModal`/`RelocateModal`/`BestowModal`/`PhysicianModal`/`CharacterProfileDrawer`/`PendingAudienceDrawer`，统一触发入口（导航层「更多」/乘风谕令菜单/场景人物条），完成后回原场景焦点，不与对话混框。

---

## 11. 响应式与视觉层级

### 11.1 断点
360/768/1280/超宽。主点击区 ≥44–48px。手机端：同时只突出一个主交互对象；不并排 3 卡；不横向滚动密集按钮；底部操作栏可固定（含 `env(safe-area-inset-bottom)`）；对话可滚动；立绘不挤出操作区；不依赖 hover。

### 11.2 视觉权重四级
主操作（金色实边/高亮，数量有限）/ 次操作（纯文字/弱边/半透明/「更多」）/ 信息区（细分隔线/小标题/半透明渐变/局部底板，不全套金框）/ 事件提示（场景叙事口吻，非系统警告框）。

### 11.3 动画
人物淡入侧入/告退淡出/说话者高亮/抽屉开合/场景渐变/候见提示平滑。尊重 `prefers-reduced-motion`；动画不阻塞事件态；结算不依赖 CSS 动画结束；快速点击不重复入场/结算（入场/结算去抖）。

---

## 12. 存档兼容

- **零迁移优先**：候见呈现态用 `flags`（冒号键），旧档读出=「无 pending」，行为正确。
- `presentation`、`subLocations`、`backgroundPosition` 均 `optional` + 推导兜底；不让已完成事件复活（`once`/`eventLog`/`cooldown` 把关）；不让旧事件缺 `presentation` 而无法触发（推导）。
- `EventReturnTarget`、court 结果、被召立绘、压暗、动画 = 临时 UI 态，不入档。
- 本期预计**不需**升 `SAVE_FORMAT_VERSION`。

---

## 13. 测试策略

补**行为**测试（非快照）。引擎纯函数优先：

- **router（`pickAutoStartEvent`）**：只返回 `auto_on_enter`；`request_audience`/`exploration`/`manual` 永不被返回（P0-1 回归）。
- **entryMode/presentation**：`presentation.mode` 优先于推导；各 checkpoint+地点推导正确。
- **audience**：三态转换；`defer` 设 pending+promptShownAt+remindAt；`shouldRemind` 仅 remindAt 到点真；`getAudienceQueue` 排除 once-已发/条件失效（无幽灵待办）；`clearAudience` 在提交/过期清、中途退出不清。
- **return target**：紫宸殿宣入结束回紫宸殿；御花园事件结束回该子地点；后宫事件结束回该宫。
- **subLocation**：`presentation.subLocationId` 绑定；多事件优先级稳定、至多一、未触发不丢。
- **court**：`courtAgendaPreview`=实际抽取；`diffCourtMetrics` 含 resource + favor；逐议题只结算一次。
- **UI（RTL，先例 `courtyardHalls.test.ts`）**：紫宸殿无候见时无卡无提示；有候见非阻塞提示；宣入开始；告退离场回紫宸殿；记入待宣后再次进入不重弹；待宣列表可重开宣入；deadline 到点重提醒；召见无永久卡；乘风可中断场景召出、关键事件/原子操作中不可召出；移除卡后场景人物条可点。
- **响应式（P1-5）**：不写 jsdom 假快照（无法验证布局）。保留人工 360/768/1280/超宽验证；项目已有 Playwright（`test:e2e`）→ 关键页截图测试作回归。

---

## 14. 验收标准

1. 进紫宸殿不再永久显示乘风/卫绫/侍君人物卡。
2. 背景占主画面，非横幅+黑区。
3. 司礼有事以候见出现，非阻塞弹窗。
4. 「稍后」后同一事件不再每次进门重弹。
5. 宣入后人物自然入场/对话/离场，**结束回紫宸殿**（非主地图）。
6. 乘风可在允许场景召见并走现有行政操作；原子操作/剧情选项中不可。
7. 召见侍君以立绘出现，不新增人物卡。
8. 一宫多人经宫室进入各自居所；后宫事件结束回该宫。
9. 御花园可先选 **绛雪轩/太液池/浮碧亭/堆秀山** 子地点；事件结束回该子地点。
10. 每御花园子地点至多一个当前事件；无事件子地点只显静态环境描述，不暗示人物。
11. 宣政殿有今日议程与**真实**朝议结果（资源 + 态度），非单按钮+空白。
12. 人物详情/管理进独立面板；移除卡后仍可点人物（场景人物条）。
13. 手机端可正常点击浏览，不依赖并排大卡片。
14. `request_audience`/`exploration`/`manual` 事件不被自动 checkpoint 启动。
15. 旧存档可继续读取；业务规则/Effect 结算/对话系统未被破坏。
16. `typecheck`/`test`/`lint`/`build`/`validate-content`/`validate-manifest` 全通过。

---

## 15. 实施：拆为四个 PR

详见 [`../plans/2026-06-22-scene-ui-narrative-refactor.md`](../plans/2026-06-22-scene-ui-narrative-refactor.md)。**依赖顺序 PR1 → PR2 → PR3，PR2 → PR4**（PR3 的 `GardenOverviewScreen`、PR4 的 `XuanzhengdianScreen` 均依赖 PR2 引入的 `SceneShell`）。Claude 顺序执行即按 PR1、PR2、PR3、PR4。

- **PR1 事件呈现基础设施**：`presentation` schema + `resolveEntryMode` + 中央 router（`pickAutoStartEvent`/`getAudienceQueue`/`pickSubLocationEvent`）+ audience 生命周期 + `EventReturnTarget` + audience content 元数据 + 单元测试。（纯引擎/类型，不动 UI 视觉。）
- **PR2 紫宸殿**：SceneShell + ZichendianScreen + 候见提示/待宣列表 + 司礼宣入/延期 + 召见立绘 + 乘风入口 + 移除紫宸殿人物卡。
- **PR3 普通地点与御花园**：场景人物条 + 后宫 auto_on_enter 直入 + `subLocationId` + manifest 登记 + 御花园总览 + 子地点返回上下文 + 静态描述/动态线索分离。
- **PR4 宣政殿与视觉收尾**：议程预览 + court 快照 diff + 朝议结果页 + 响应式 + CSS 清理 + 全量回归。

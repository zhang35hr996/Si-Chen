# 太后系统：慈宁宫 · 生病侍疾 · 敲打 · 养父 — 设计 (Spec)

**Date:** 2026-06-18
**Branch:** feat/heir-lifecycle-system
**Status:** Approved design, pre-implementation

## 背景与目标

新增**太后** NPC（性别倒置设定中的皇帝长辈，等同 heir spec 里 `太后（皇帝生父）`），及其交互：
- 主图新增**慈宁宫**入口；太后可对话（固定脚本事件，非 AI，耗 1 行动点）。
- 太后每旬有概率生病（逐年递增）；生病提示。
- 太后病中，前往慈宁宫有概率触发**侍疾**事件（遇侍君或凤后之一）。
- 每行动点有 5% 概率触发**敲打**事件（太后召高宠侍君训诫，宠爱越高越易触发）。
- 奉先殿择养父时可选太后。

## 架构约束（沿用既有）

1. **唯一写路径**：所有状态变更只经 `applyEffects` 漏斗；新机制 = 新 `EventEffect` 类型 + `eventEffectSchema` 校验分支 + funnel apply 分支。
2. **确定性**：所有掷骰走种子化 `gestationRoll(seedString)`，不用 `Math.random`，回放稳定。
3. **动态参与者走装配层**：侍疾/敲打/养父的台词与效果由 `src/store/*.ts` 纯函数组装，经 `ReactionScreen`/`reactionQueue` 串播（与凤后懿旨、收养同构）。固定参与者的太后对话用静态 scene（与 `上朝` 同构）。
4. **派生优先**：生病概率按当前年份纯派生，不存「已过年数」。
5. **存档迁移**：新增字段带向后兼容默认值；`SAVE_FORMAT_VERSION` 升级并加 migration。
6. **±10 通用 cap**：侍疾/敲打的恩宠变动用既有 `favor` 效果（±10 内，本设计 ±5）。

---

## 1. 太后 NPC 建模

### 1.1 角色 schema
`characterSchema.kind` enum 扩为 `["consort", "official", "elder"]`。

### 1.2 内容文件 `content/characters/taihou.json`
- `id: "taihou"`，`kind: "elder"`。
- **无 `attributes` 块**（schema 中 `attributes` 已是可选）。
- `defaultLocation: "cining_gong"`，`portraitSet: "taihou"`，`expressions: ["neutral"]`。
- `profile.name: "太后"`，role/personality/speechStyle 按长辈威严慈和拟定。
- `initialRelationship`（trust/affinity）可有；**无 `initialStanding`**（elder 不入位分体系）。

### 1.3 角色卡渲染
慈宁宫角色卡走 elder 分支：只显示姓名 + 身份 + 单个「与太后叙话（1行动点）」按钮（`disabled` 当 `ap < 1`）。不渲染位分/属性/侍寝/管理位分。点按 → 触发 `ev_taihou_converse`（见 §3）。

---

## 2. 慈宁宫地点

`content/locations/cining_gong.json`：
- `id: "cining_gong"`，`name: "慈宁宫"`，`zone: "palace"`，主图（宫城图 `mapBoards[0]`）节点。
- `position: {x,y}`（主图空位，参照既有 palace 节点）。
- `travelCost: {ap:1}`，`backgroundKey: "bg.cining_gong"`。
- `connections`：与某既有 palace 节点（如 `yushufang`）**双向**连边（loader 强制对称：对端 location 也要加回边）。

---

## 3. 太后对话（固定脚本事件）

仿 `上朝`（`ev_chaohui`/`sc_chaohui`）：
- `content/events/ev_taihou_converse.json`：`sceneId: "sc_taihou_converse"`，`checkpoint` 不设自动触发；`condition.atLocation: "cining_gong"`，`apCost: 1`，`once: false`。
- `content/scenes/sc_taihou_converse.json`：太后请安/叙话脚本，1–2 个 choice 分支，终端 `effect` 节点。
- 效果（脚本内授权）：小幅 `legitimacy +2`（宗嗣合法性）+ 太后一条 `memory`。
- 触发：太后卡「与太后叙话」按钮调 `onStartEvent(ev_taihou_converse)`，走既有 SceneSession 提交路径（提交才扣 AP、记 fired）。

---

## 4. 太后生病（旬掷骰）

### 4.1 状态
`GameState` 增 `taihou: { ill: boolean }`，新游戏初始 `{ ill: false }`。

### 4.2 概率（纯派生）
`src/store/taihou.ts`：
```ts
export const TAIHOU_BASE_ILL_CHANCE = 5;
export const TAIHOU_ILL_CHANCE_CAP = 25;
export const TAIHOU_RECOVER_CHANCE = 50;
/** 元年=5%，逐年+1%，封顶25%。year 取 calendar.year（≥1）。 */
export function taihouIllnessChance(year: number): number {
  return Math.min(TAIHOU_BASE_ILL_CHANCE + Math.max(0, year - 1), TAIHOU_ILL_CHANCE_CAP);
}
```

### 4.3 掷骰时机与判定
在**旬翻转**（`time_advance` checkpoint，每次 rollover 恰好过一旬）掷骰，种子含年月旬确保每旬一次且确定：
- 未病：`gestationRoll(\`taihou:ill:${y}:${m}:${p}\`) % 100 < taihouIllnessChance(y)` → 生病。
- 已病：`gestationRoll(\`taihou:recover:${y}:${m}:${p}\`) % 100 < TAIHOU_RECOVER_CHANCE` → 自愈。

装配函数 `buildTaihouIllnessTick(state, seedKey)` 返回 `{ effects: EventEffect[]; beats: {speakerId,lines}[] } | null`（无变化→null）。

### 4.4 效果
新效果 `set_taihou_illness { ill: boolean }`，漏斗写 `state.taihou.ill`。

### 4.5 生病提示
当本次 tick 令 `ill` 由 false→true，`buildTaihouIllnessTick` 在 `beats` 里附一条司礼官奏报「太后凤体违和」，由 App 推入 `reactionQueue`，经 ReactionScreen 浮现（一次性提示，不持久弹窗）。自愈（true→false）不强制提示（或附一条司礼官「太后凤体已安」，可选；本期**不出**自愈提示，保持简洁）。

### 4.6 App 接线
旬翻转路径（`runCheckpoints(true)` 触发处 / `spendAp` 的 `rolledOver` 分支）调 `buildTaihouIllnessTick`，命中则 `applyEffects(effects)` + `setReactionQueue(q => [...q, ...beats])`。种子用 rollover **之后**的 `year/month/period`。

---

## 5. 侍疾事件（病中进慈宁宫遇侍君/皇后）

`src/store/taihou.ts` → `buildShizhiEncounter(db, state, seedKey): ShizhiPlan | null`：
```ts
export interface ShizhiPlan {
  attendantId: string;
  effects: EventEffect[];
  beats: { speakerId: string; lines: string[] }[];
}
```
- 仅当 `state.taihou.ill`，否则 `null`。
- **遭遇门控**：`gestationRoll(\`taihou:shizhi:gate:${seedKey}\`) % 100 < 50`。`seedKey` 用 `${y}:${m}:${p}`（按旬钉死，反复进出同旬结果一致，杜绝刷取）。不命中→`null`。
- **选人**：池 = 在宫（`defaultLocation!=="lenggong"`）、`lifecycle!=="deceased"` 的 `consort` + `feng_hou`。`gestationRoll(\`taihou:shizhi:pick:${seedKey}\`) % 池长` 取一人。空池→`null`。
- **台词**（3 段）：太后夸奖该侍君（speaker `taihou`）→ 皇帝表扬（speaker `player`）→ 侍君「侍奉太后是臣本分」（speaker attendantId）。文案引用该侍君称呼（`resolveDisplayName`）。
- **效果**：该侍君 `{type:"favor", char:attendantId, delta:5}` + `{type:"set_taihou_illness", ill:false}`（侍疾即愈）+ 该侍君一条 `memory`。

### 5.1 App 接线
进入慈宁宫后（travel 完成 / `enterCurrentLocation` 路由到 location 后），若 `taihou.ill`，调 `buildShizhiEncounter(db,state,\`${y}:${m}:${p}\`)`，非空则 `applyEffects` + 推 `beats` 入 `reactionQueue`。门控按旬钉死保证幂等。

---

## 6. 敲打事件（每行动点 5%，宠爱加权）

`src/store/taihou.ts` → `buildTaihouRebuke(db, state, seedKey): RebukePlan | null`（与 `buildEmpressDecree` 同构）：
```ts
export const TAIHOU_REBUKE_CHANCE = 5; // 每行动点 5%
export interface RebukePlan {
  targetId: string;
  effects: EventEffect[];
  beats: { speakerId: string; lines: string[] }[];
}
```
- **前置**：`state.taihou.ill` 为真时**不掷**（病中不敲打）→ `null`。
- **门控**：`gestationRoll(\`taihou:rebuke:gate:${seedKey}\`) % 100 < TAIHOU_REBUKE_CHANCE`。
- **候选**：在宫存活 `consort`，**排除 `feng_hou`**（凤后正宫不在敲打之列）。空→`null`。
- **加权选人**：按 `standing.favor` 加权——累积权重 = 各候选 favor 之和，`roll = gestationRoll(\`taihou:rebuke:pick:${seedKey}\`) % totalFavor`，落在哪个区间取谁（favor 高区间大，更易中）。favor 全 0 时退化为均匀取。
- **台词**（2 段）：太后召训「勿恃宠而骄、独占圣心」（speaker `taihou`）→ 侍君领训请罪（speaker targetId）。
- **效果**：`{type:"favor", char:targetId, delta:-5}` + `{type:"resource", pillar:"harem", field:"harmony", delta:2}` + 双方各一条 `memory`。

### 6.1 App 接线
在 `spendAp` 的逐行动点掷骰处（现已掷凤后懿旨），**追加**敲打掷骰：同一 slot 种子 `key`，先掷懿旨后掷敲打，各自命中即 `applyEffects` 并把 beats 追加进当次返回的 `decreeBeats`（或并入 `reactionQueue`）。两者独立，可同旬同 slot 并发，串播。`rolledSlots` 去重键需区分懿旨/敲打（如 `key` 同但两次 `buildXxx` 调用各自掷不同种子前缀，天然不冲突；`rolledSlots` 仍按 slot 去重整体一次）。

> 实现注意：`rolledSlots` 现以 `day:slot` 去重「该 slot 是否已 roll」。敲打与懿旨在同一 slot 的同一次 `rollDecree`/`spendAp` 内一并掷出，仍只占一个 slot 标记，避免重复应用。

---

## 7. 养父池含太后

- `eligibleAdoptiveFathers(db,state)`：在原 `consort` 过滤基础上，**追加**太后（`kind==="elder"` 且 `lifecycle!=="deceased"`）。
- `heir_adopt` 漏斗校验放宽：目标须 `kind==="consort"` **或** `kind==="elder"`，且非 `deceased`、非 `defaultLocation==="lenggong"`（仍拒 `official`）。
- **太后养父播报**（`buildAdoptionReaction` 分支）：当 `fatherId==="taihou"`（或 `kind==="elder"`），**不走谢恩、不走「生父泪如雨下」**，返回**单段**：太后欣然（speaker `taihou`），一句「会好好培养这皇子/皇郎」之意。生父在不在宫**均不**附加司礼官泪报。

---

## 8. 美术接线

`assets/manifest.json` 注册：
- `portrait.taihou.neutral` → `portraits/<太后立绘>.png`（`placeholder:false`）。
- `bg.cining_gong` → `backgrounds/cining_gong.png`（若有黄昏/晚上变体一并登记 `.twilight`/`.night`）。
- 用户新增的时段背景变体键，按 `public/assets/backgrounds/` 实际文件登记：`bg.jingjiao.twilight/.night`、`bg.yushufang.twilight/.night`、`bg.hougong.twilight/.night`、`bg.jingcheng.twilight/.night`（仅登记实际存在的文件）。`AssetRegistry.resolveVariant` 自动按 `timeOfDay` 选图，缺变体回落基键。

跑 `npm run validate-manifest` 确认路径齐全、无孤儿。

---

## 9. 分期与测试

每期 TDD。测试落点参照既有 `tests/store/empressDecree.test.ts`、`tests/effects/funnel.*.test.ts`、`tests/save/migration*.test.ts`、`tests/content/*.test.ts`。

- **P1 太后基建**：`elder` kind + taihou.json + cining_gong.json + 卡片 elder 分支 + ev/sc 太后对话 + 慈宁宫连边对称。
  测试：schema 解析 `elder`、cining_gong/连边对称、taihou 无 attributes 合法。
- **P2 生病系统**：`taihou` state + `set_taihou_illness` 效果 + `taihouIllnessChance` + `buildTaihouIllnessTick` + 旬掷骰接线 + 生病提示 + 存档 v3→v4 迁移。
  测试：概率封顶/逐年、掷骰确定性、自愈、`set_taihou_illness` 漏斗、迁移补 `{ill:false}`。
- **P3 侍疾**：`buildShizhiEncounter` + 进慈宁宫接线。
  测试：非病时 null、门控钉死、池构成（含凤后、排除冷宫/已故）、效果（+5 favor + 治愈）、确定性。
- **P4 敲打**：`buildTaihouRebuke` + spendAp 接线。
  测试：门控、排除凤后、favor 加权（高宠更易中，可钉种子）、`!ill` 门、效果（−5 favor + harmony+2）、确定性。
- **P5 养父含太后**：`eligibleAdoptiveFathers` 含太后 + `heir_adopt` 接受 elder + 太后欣然单段播报。
  测试：池含 taihou、`heir_adopt` 接受 elder/拒 official、太后分支单段且无泪报。
- **P6 美术接线**：manifest 注册 + 计数测试更新。
  测试：`validate-manifest` 绿、boot/manifestCheck 计数更新。

## 10. 风险与缓解

- **侍疾门控刷取**：种子按旬钉死（`y:m:p`），同旬反复进出结果一致，杜绝刷恩宠/刷治愈。
- **敲打与懿旨同 slot 叠放**：两者独立种子前缀、`rolledSlots` 按 slot 整体去重一次、beats 串播；逐处回归 `spendAp` 原有 `rolledOver`/reaction 行为。
- **存档破坏**：v3→v4 迁移补 `taihou:{ill:false}`；新增迁移测试覆盖旧档无字段。
- **太后入养父池的称呼**：太后无 standing，`resolveDisplayName(c, undefined, undefined)` 须回落 `profile.name`「太后」；P5 测试钉死。
- **elder 卡渲染遗漏**：慈宁宫若漏 elder 分支会按 consort 卡渲染（缺 standing 崩）；P1 须覆盖 elder 卡只出叙话按钮。

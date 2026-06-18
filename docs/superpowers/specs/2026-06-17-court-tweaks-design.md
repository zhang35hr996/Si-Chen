# 朝局小改：国情面板 · 上朝限时 · 凤后下旨 — 设计 (Spec)

**Date:** 2026-06-17
**Branch:** feat/heir-lifecycle-system
**Status:** Approved design, pre-implementation

## 背景

三项独立小改，围绕「朝局/位分/UI」：
A. 随时可查看国家/朝局资源的只读面板。
B. 上朝（朝会）限定只能在每日首个行动点（卯时早朝）进行；过时提示。
C. 凤后（皇后）有概率自行下旨，升降「贵人及以下」侍君的位分。

## 架构约束（沿用既有）
- 所有状态变更只经 `applyEffects` 漏斗；位分变更复用现有 `set_rank` 效果（已校验：目标须后宫位分、非凤后）。
- 纯逻辑（掷骰/选人/方向）走种子化确定性（复用 `gestationRoll(seedString)`），不用 `Math.random`，回放稳定。
- 台词经 `ReactionScreen` 重放；装配层在 `src/store/*.ts`。
- 只读 UI 不读逻辑、不写状态。

---

## A. 国情面板（只读资源）

**数据**：现有 `state.resources`（`court{authority,publicSupport,factionPressure}` / `harem{harmony,jealousy}` / `bloodline.legitimacy`），无新增。

**组件**：新 `src/ui/components/ResourcePanel.tsx` —— 模态，三组只读展示：
- 朝局：圣威 `authority`、民心 `publicSupport`、派系压力 `factionPressure`
- 后宫：和睦 `harmony`、妒意 `jealousy`
- 血脉：宗嗣合法性 `legitimacy`

**接线**：App 层 `resourcePanelOpen` 状态 + 渲染 `ResourcePanel`。HUD 加「国情」按钮，传入 `onOpenResources` 回调，置于 `LocationScreen` 与 `MapScreen` 表头（最常驻的两处；其余屏后续可加）。纯展示，关闭即收。

**测试**：只读 UI，`typecheck` + `build` 验证。

---

## B. 上朝限首个行动点

**首个行动点判定**：`ap === apMax`（slot 0 = 卯时早朝）。

**内容标记**：`location` schema 加可选 `actionFirstSlotOnly?: boolean`（默认 `undefined`/false）。`content/locations/chaotang.json` 设 `actionFirstSlotOnly: true`。

**FreeViewScreen**：当 `location.actionFirstSlotOnly === true` 且 `state.calendar.ap !== state.calendar.apMax` 时：「上朝」按钮 `disabled`，并显示提示「朝时已过，请明日卯时早朝」。首个行动点（`ap === apMax`）照常可点，走原有 `onStartEvent` 路径。`actionFirstSlotOnly` 不为真的自由视图行为不变。

**测试**：在 `FreeViewScreen` 逻辑层无独立纯函数，但加一条 schema 测试确认 `chaotang` 解析出 `actionFirstSlotOnly===true`；门控判定（`ap===apMax`）以 UI 断言/手动验证为主。可抽一个极小纯函数 `firstSlotOnlyBlocked(location, calendar): boolean` 便于单测。

---

## C. 凤后自行下旨升降（贵人及以下）

### 触发
**每消耗一个行动点**掷骰一次，**3%** 概率出懿旨。按 `(dayIndex, slot)` 确定性掷骰（`slot = apMax - apBeforeSpend`）；单次行动（即便耗多点）至多出一道懿旨。App 用 ref `rolledSlots`（`Set<"day:slot">`）保证同一行动点只判一次，避免重复应用。

### 装配 `src/store/empressDecree.ts`
`buildEmpressDecree(db, state, seedKey: string) → DecreePlan | null`，纯函数：
- **候选**：`db.characters` 中 `kind==="consort"`、`standing` 存在、`lifecycle!=="deceased"`、`defaultLocation!=="lenggong"`、非 `feng_hou`，且当前位分 `order ≤ 100`（贵人及以下：贵人100/美人90/才人80/常在70/答应60/更衣50/官男子40）。无候选→`null`。
- **选人**：`gestationRoll(\`empress:pick:${seedKey}\`) % 候选数`。
- **方向**：按该侍君 `standing.favor` —— `≥65`→升一级；`<35`→降一级；中间档→`null`（本次不动）。
- **目标位分**：在「贵人↔官男子」带内取相邻一级（升=order 更高的最近后宫位分但不超过贵人100；降=order 更低的最近但不低于官男子40）。触边（已是贵人却要升 / 已是官男子却要降）→`null`。
- **效果**：`[{type:"set_rank", char, rank: targetRankId}, {type:"memory", char, entry:{kind:"event", summary, salience, tags:["empress",dir], participants:["feng_hou",char]}}]`。
- **台词**：司礼官奏报凤后懿旨（升/降两版）+ 该侍君领旨一句。`DecreePlan = { effects, lines, speakerId }`（speakerId 用 `sili_nvguan` 起报；侍君台词随后）。返回多段时用与收养同构的「反应队列」串播。

常量（写在 `empressDecree.ts`）：`DECREE_CHANCE=3`、`PROMOTE_FAVOR=65`、`DEMOTE_FAVOR=35`、带边界 order∈[40,100]。

### App 接线（集中化 AP 消耗）
- 新增 `spendAp(amount): SpendResult` 包装：`store.dispatch({type:"SPEND_AP",amount})`；成功后对消耗的行动点掷骰（命中即 `applyEffects(decree.effects)` 并把 `decree` 台词推入反应队列）；返回原 spend 结果（含 `rolledOver`）。把现有各处直接 `store.dispatch({type:"SPEND_AP",...})`（侍寝、批阅、对话、召见、问功课、问先生、独自休息、择养父、travel）改走 `spendAp`。
- **反应队列**：把现有 `adoptionQueue` 泛化为通用 `reactionQueue`（`{speakerId,lines}[]`）。`ReactionScreen.onDone` 已会排空该队列；懿旨台词作为追加节拍，在当前行动自身的反应之后串播。
- 对不自带反应的行动（travel/独自休息/无初夜的侍寝）：spendAp 后调用 `flushReactions()`（若无反应在显示且队列非空，则弹出队首），确保懿旨能浮现。
- 转旬（time_advance）路径：懿旨反应优先于 checkpoint；其 onDone 复用既有 `reactionRollover` → `runCheckpoints(true)`。

### 测试（`tests/store/empressDecree.test.ts`）
- 候选过滤：排除冷宫/已故/官员/凤后/位分>贵人；含贵人及以下在宫存活侍君。
- 方向：高恩宠→升、低恩宠→降、中间→null。
- 边界：贵人遇升→null；官男子遇降→null。
- 确定性：同 seedKey 同结果。
- 概率门控判定（命中/不命中由 seed 决定，可用已知 seed 钉死一例命中、一例落空）。

---

## 分期
1. **A 国情面板**（最小，独立）
2. **B 上朝限时**（schema + FreeViewScreen + chaotang）
3. **C 凤后下旨**（empressDecree 纯逻辑 + spendAp/reactionQueue 接线）—— 最重，含 App 集中化改造。

## 风险
- **C 的 AP 集中化**：把分散的 `SPEND_AP` 统一到 `spendAp` 是较大面的接线改动；须保证各处原有 `rolledOver`/reaction 行为不变。逐处替换 + 全套测试回归。
- **反应叠放**：懿旨与行动自身反应、收养队列、转旬 checkpoint 的先后——统一走 `reactionQueue` 串播，避免互相覆盖。
- **set_rank 漏斗校验**：目标须后宫位分且非凤后——候选过滤已保证；相邻位分计算须只取 `domain==="harem"` 的位分。

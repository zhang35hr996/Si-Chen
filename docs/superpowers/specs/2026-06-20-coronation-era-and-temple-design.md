# 登基开场 + 年号 + 郊外寺庙 — 设计

日期：2026-06-20
范围：两项功能 —— (1) 新游戏登基开场 + 年号系统（贯穿时间显示）；(2) 郊外新增寺庙（上香/求签）。
约束：发布前，存档不做向后兼容迁移（见 memory `no-save-backcompat`）。

---

## 功能一：登基开场 + 年号

### 流程（点「新游戏」后、正式进入游戏前）

1. 全屏登基画面 `CoronationScreen`，背景 `cg/dengji.png`。
2. 旁白第一段：「妘朝的第五位皇帝登基，改年号为——」
3. 年号输入：**恰好 2 个中文字**（如「甘露」）。校验：长度必须为 2，且均为中文字符（`一-鿿`）；不合法则禁用「确认」。
4. 确认后旁白第二段（**纯叙事，不改任何游戏状态**）：
   尊皇太后入慈宁宫 · 封皇后入坤宁宫 · 群臣高呼万岁、行礼 · 天下同庆。
5. 「开始」→ 进入「{年号}元年一月」开始游戏。

> 登基封赏为纯文案：开局状态已是 太后@慈宁宫、沈知白=凤后@坤宁宫，无需改状态。

### 数据与显示

- `GameState` 新增字段 `eraName: string`。`createNewGameState` 初始化为 `""`；登基确认后写入。存档持久化（`stateSchema` 增 `eraName`）。无旧档迁移。
- 写入路径：`GameStore` 增一个动作把 `eraName` 写进 state（如 `SET_ERA` 或 `store.setEraName(name)`，按现有 store 形态择一，于 plan 阶段定）。
- 时间格式化加可选年号：
  - `formatYear(year, eraName?)`：`year===1` → `{eraName}元年`；否则 `{eraName}{中文数字}年`。`eraName` 为空时退回原行为（`元年`/`X年`）。
  - `formatGameTime(time, eraName?)`：透传 `eraName` 给 `formatYear`。
  - 所有**显示**日期处把 `state.eraName` 传入（主要是 `TopStatusBar`；plan 阶段 grep 全部 `formatGameTime`/`formatYear` 显示调用点并补传）。
- `App`：`View` 增 `"coronation"`。`newGame()` 改为：`store.newGame(db)` → `resetRollGuards()` → `setView("coronation")`（不直接进游戏）。`CoronationScreen.onConfirm(era)` → 写入 eraName → 再执行原 new-game 收尾（`pickNextEvent(game_start)` 命中则 `startEvent`，否则 `goHome()`）。
- manifest 注册 `cg/dengji.png`：key `bg.dengji`，kind `background`，path `cg/dengji.png`。

### 组件边界

- `CoronationScreen`（新）：props `{ registry, onConfirm: (era: string) => void }`。内部两段旁白 + 输入框 + 校验。纯展示，唯一外部副作用是 `onConfirm`。
- 时间格式化改动集中在 `src/engine/calendar/time.ts`，向后兼容（新参数可选）。

---

## 功能二：郊外·寺庙（上香 / 求签）

### 地点

- 新增 `content/locations/simiao.json`：`id: "simiao"`、`name: "寺庙"`（名称可后调）、`zone: "jingjiao"`、`backgroundKey: "bg.simiao"`、`position`（郊外板上一个节点，如 `{x:0.4,y:0.5}`）、`connections: []`、`travelCost: { ap: 0 }`。
- manifest 注册 `bg.simiao`（path `backgrounds/simiao.png`，kind background）。
- 到达：在郊外板（`jingjiao`，由 京城→郊外 portal 进入）点寺庙节点 → 直接进入（沿用「点击节点直接进入」）。

### 寺庙动作（各消耗 1 行动点）

均通过 `App` 的 `spendAp(1)` + `playReactions` 串接（与「奏折/对话」同模式）；反应台词以旁白/住持口吻呈现，`speakerId` 复用 `wei_sui`（现有旁白型官员；plan 阶段确认其立绘可用，否则改用合适的既有讲述者）。随机用确定性 RNG（`rngSeed + dayIndex + 行动点槽` 派生 key，与现有掷骰一致，保证存档稳定）。

属性字段映射：民心=`nation.publicSupport`，威望=`sovereign.prestige`，健康=`sovereign.health`，生产力=`nation.productivity`，谣言=`nation.rumor`，宗室不满=`nation.clanDiscontent`，国库=`nation.treasury`。

**上香祈福**（`buildIncense`）：
- `publicSupport += rand(0–5)`、`prestige += rand(0–5)`、`health += rand(0–5)`（各自独立随机）。
- 反应：祈福祥和的旁白。

**求签**（`buildFortune`）：先按概率抽档，再在档内取随机量级。**整体偏正**：吉类增益总体略大于凶类减益。

| 签 | 概率 | 效果 |
|---|---|---|
| 大吉 | 10% | `publicSupport += rand(10–12)`；`productivity += rand(10–12)`；额外随机一项：`prestige` 或 `treasury` `+= rand(4–6)` |
| 吉 | 25% | `publicSupport += rand(5–7)`；`productivity += rand(5–7)` |
| 中平 | 30% | `publicSupport += rand(0–2)` |
| 凶 | 25% | `publicSupport -= rand(3–5)` |
| 大凶 | 10% | `publicSupport -= rand(7–9)`；额外随机一项：`rumor` 或 `clanDiscontent` `+= rand(3–5)` |

- 量级设定使 E[吉类净收益] > E[凶类净损失]（大吉/吉的正向幅度与额外 buff 明显高于 凶/大凶 的负向幅度）。
- 反应：按抽中档位给出对应吉凶旁白（每档一组台词）。

### 组件边界

- `store/temple.ts`（新）：
  - `buildIncense(db, state, key): { effects, lines }`
  - `buildFortune(db, state, key): { tier, effects, lines }`（tier ∈ 大吉/吉/中平/凶/大凶）
  - 纯函数，给定 state+key 输出确定，便于单测（对 effects 数值范围与抽档分布断言）。
- `LocationScreen`：对 `simiao` 增专屏动作菜单（仿 `zichendian`），两个按钮「上香」「求签」，行动点不足时禁用。
- `App`：`onOfferIncense` / `onDrawFortune` 两个处理器（spendAp + applyEffects + doAutosave + playReactions），透传给 `LocationScreen`。

---

## 影响面 / 模块边界

- **功能一**：`time.ts`（格式化加可选年号，向后兼容）、`types.ts`/`stateSchema.ts`/`newGame.ts`（eraName 字段）、`gameStore`（写 eraName 动作）、`App`（coronation 视图 + 流程）、新 `CoronationScreen`、显示调用点补传 era、manifest（dengji）。
- **功能二**：新 `simiao.json` + manifest（simiao）、新 `store/temple.ts`、`LocationScreen`（寺庙菜单）、`App`（两个处理器）。
- 两功能相互独立，可分别实现与测试。

## 测试策略

- `formatYear`/`formatGameTime` 年号：单测（year=1 → 「甘露元年」；year=2 → 「甘露二年」；空 era 退回原行为）。
- 年号输入校验：2 个中文字通过、其余拒绝（组件级或抽出纯校验函数单测）。
- `buildIncense`：effects 仅含三项目标字段，delta ∈ [0,5]。
- `buildFortune`：给定不同 key 覆盖到各档；各档 effects 字段/符号正确；统计意义上吉类期望净值 > 凶类期望净损（可用固定多 key 抽样断言方向）。
- 其余 UI（登基画面、寺庙菜单）以手动验证为主。

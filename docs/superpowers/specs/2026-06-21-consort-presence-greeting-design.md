# 侍君「一时辰一地点」临场系统 + 卯时请安仪式

- 日期：2026-06-21
- 分支：`feat/consort-presence-greeting`
- 状态：设计已确认，待实现计划

## 1. 目标与动机

让后宫具备「同一时辰，一个侍君只能在一个地方」的真实感，并落地早朝请安礼制：

- **临场不变式（layer 1）**：侍君此刻在御花园被遇见，则其宫殿此刻就见不到他，由宫人禀报其去向。
- **卯时请安（layer 2）**：卯时全体在宫侍君赴坤宁宫向皇后请安；此时去后宫居所多半扑空。
- **翌晨免请安**：子时在某侍君宫中侍寝/对话后，次晨皇帝可施恩免其请安。
- **坤宁宫请安场景**：皇帝卯时入坤宁宫可旁观请安，皇后率众行礼。

## 2. 既有机制（约束前提）

- 一日 6 个行动点槽位映射时辰：卯(0) 辰(1) 申(2) 酉(3) 戌(4) 子(5)。见 `src/engine/calendar/time.ts`。
- **子时(slot 5)是当日最后一槽**：花掉最后一点行动点 → `advanceActionDay` 滚到次旬卯时(slot 0)，行动点回满，**`playerLocation` 不变**（reducer 不在滚旬时改位置）。因此子时侍寝/对话后，皇帝「次晨仍在该侍君宫中」。见 `src/engine/state/reducer.ts:89-91`。
- 当前 `getCharacterLocation` = `standing[id].residence ?? defaultLocation`，无时辰维度。见 `src/engine/characters/presence.ts`。
- 确定性掷骰既有模式：`fnv1a64Hex(\`${rngSeed}:${dayIndex}:${charId}\`).slice(0,8)` 取模。见 `src/engine/characters/conception.ts:10`。
- 皇后＝沈知白(rank `fenghou`)，居 `kunninggong`；御花园＝`yuhuayuan`(zone `palace`)。
- 设宫室居所走视觉小说场景 `CharacterScene`；后宫居所在 `LocationScreen` 经 `getPresentAt` 取在场侍君。

## 3. 架构总览

分层不变（引擎纯函数 → store 装配 → UI 消费）：

| 层 | 改动 |
|---|---|
| 引擎 `characters/presence.ts` | 新增时辰感知 `consortLocationAt`；`getCharacterLocation`/`getPresentAt` 接入当前 slot |
| 引擎 `characters/greeting.ts`（新） | 请安出席名单、免请安判定、游走掷骰（纯函数） |
| 状态 `state/types.ts` | 新增两处瞬态字段（见 §8） |
| store `greeting.ts`（新） | 装配「免请安」「请安进入」效果批 + 文案 |
| store `bedchamber.ts` / `conversation.ts` | 子时滚旬时记 `overnightWith` |
| UI | 乘风请安遮罩、请安场景、离宫二选一、缺席禀报 |

## 4. 时辰感知临场引擎

新增纯函数（签名示意）：

```ts
// 某侍君在给定 slot 的实际所在 locationId
consortLocationAt(db, state, charId, slot): string
```

按优先级判定：

| 条件 | 结果 |
|---|---|
| 非 `consort` / 冷宫(`changmengong`) / 已故(`lifecycle==="deceased"`) / 待选(储秀宫) | 维持住处，不请安、不游走 |
| **卯时(slot 0)** 且为本晨留宿对象（`overnightWith` 命中、皇帝尚未离宫/未做选择） | → 住处（与皇帝同在，尚未赴请安） |
| **卯时(slot 0)** 且未被免请安 | → `kunninggong` |
| 卯时但本晨被免请安（见 §7） | → 住处 |
| 辰/申/酉(slot 1–3) 且游走命中 | → `yuhuayuan` |
| 其余（辰/申/酉未命中、戌/子 slot 4–5） | → 住处 |

- 「住处」沿用现有 `standing[id].residence ?? defaultLocation`。
- 皇后（凤后）不参与游走/请安，永远在坤宁宫。
- `getCharacterLocation(db, state, charId)` 改为以 `shichenSlot(state.calendar)` 调 `consortLocationAt`；`getPresentAt` 随之按当前 slot 过滤。`inPalaceConsorts`（翻牌子/查看侍君用）维持「按住处」语义，不受时辰影响——它问的是「宫里有谁」，非「此刻在哪」。

### 游走掷骰（确定性、性格加权）

```ts
wanders(rngSeed, dayIndex, slot, charId, chancePercent): boolean
// fnv1a64Hex(`${rngSeed}:${dayIndex}:${slot}:${charId}`).slice(0,8) % 100 < chancePercent
```

- 仅 slot ∈ {1,2,3}（白天 辰/申/酉）参与游走；slot ∈ {4,5}（戌/子，夜）一律在家。
- `chancePercent` = 基础 **25** 经 `profile.personalityTraits` 关键词加权：
  - 外向类关键词（活泼/开朗/好动/爱热闹/天真/烂漫…）每命中 **+15**
  - 内敛类关键词（端肃/克制/沉静/守礼/重礼法/清冷/淡泊/孤僻…）每命中 **−15**
  - clamp 到 **[5, 60]**
- 关键词表为引擎内常量；无命中则用基础值。后续可加 content 显式覆盖字段，本期不做。

> 取舍：不把位置物化进存档（与「pre-release 不迁移旧档」一致，且重算更省）。每次按种子重算，同一 slot 内稳定。

## 5. 缺席禀报（layer 1 收尾）

进侍君居所而本人此刻不在时，`CharacterScene` 对应空位显示宫人禀报，理由取该侍君 `consortLocationAt` 的当前所在：

- 在坤宁宫 → 「{称谓}往坤宁宫向皇后请安去了。」
- 在御花园 → 「{称谓}往御花园散心去了。」

文案模板集中于 store/format 层，引擎只回位置。

## 6. 卯时请安仪式（坤宁宫）

进入坤宁宫时若 **当前为卯时 且 出席侍君 ≥ 1**：

1. 乘风遮罩提示：「众侍君正给皇后请安，陛下是否去看看？」
   - **退出坤宁宫** → 离场（回地图），**不耗行动点**
   - **进入主殿** → **耗 1 行动点**（卯时→辰时）
2. 进入主殿后：皇后起身，率众侍君向皇帝行礼，问「陛下可有要事相告？」
   - 唯一选项「无事，只是来看看皇后」→ 请安仪式结束（事件结束）
3. 仪式结束即辰时，众侍君散去（按 §4 进入辰时分支：回住处或游走）；坤宁宫此刻只剩皇后，玩家可继续与皇后互动（沿用既有坤宁宫/皇后交互）。

卯时进坤宁宫但 **无人出席**（全被免/全冷宫/全故）→ 无乘风遮罩，正常皇后场景。

## 7. 翌晨免请安（morning-after）

**触发记录**：子时(slot 5，即最后一点行动点) 在某侍君居所完成 **侍寝或对话** 且因之滚旬时，记 `overnightWith = { charId, morningDayIndex }`（`morningDayIndex` = 滚旬后的 `dayIndex`）。

**次晨选择**：当 `当前 slot===0(卯时)` 且 `playerLocation === overnightWith.charId 的住处` 且 `state.calendar.dayIndex === overnightWith.morningDayIndex`，皇帝在该宫「离开」时弹二选一（**均不耗行动点**）：

- **「昨晚爱卿辛苦了，今日多歇着吧」** → 该侍君本晨免请安（留宫休息）；效果：该侍君对皇帝 **affection +3、standing.favor(恩宠) +2**（数值已确认，可调）。
- **不说（无事发生）** → 皇帝离开后该侍君照常赴坤宁宫请安。

两种选择后均清除 `overnightWith`。被免者写入 `excusedFromGreeting`（§8），在 §4 走「卯时被免→住处」分支。

## 8. 状态字段（瞬态，不迁移旧档）

`GameState` 新增：

```ts
// 本晨被免请安的侍君（按 dayIndex 自然失效）
excusedFromGreeting?: { dayIndex: number; charIds: string[] };
// 子时留宿记录，供次晨离宫二选一
overnightWith?: { charId: string; morningDayIndex: number };
```

- 两者均按 `dayIndex` 校验有效性：读取时若 `dayIndex` 不匹配当前则视为空。无需写迁移逻辑（pre-release，[[no-save-backcompat]]）。

## 9. 测试要点（TDD）

引擎纯函数为主：

- `consortLocationAt`：卯时→坤宁宫；被免→住处；白天游走命中/未命中；夜里在家；冷宫/已故/待选不动。
- `wanders`：同 (旬,slot,char) 稳定；性格关键词加权与 clamp 边界。
- 请安出席名单：排除冷宫/已故/被免/待选；含皇后判定。
- 免请安效果批：affection/favor 增量正确；写入 `excusedFromGreeting`。
- `overnightWith`：仅子时滚旬触发；侍寝与对话均触发；非子时不触发。
- 缺席禀报理由：映射到当前所在。

UI 行为（组件级/手测）：乘风遮罩两分支的行动点消耗；请安场景出席与散场；离宫二选一。

## 10. 非目标（YAGNI，本期不做）

- 御花园以外的游走去向（互相串门、慈宁宫问安等）。
- content 显式作息表 / 显式游走偏好字段。
- 请安出勤对皇后关系的长期影响（接入记忆/认知系统后再做）。
- 请安场景内除「无事」外的其他要事选项（结构预留可扩展）。

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
| 引擎 `characters/presence.ts` | 新增 `consortLocationAt`（时辰感知所在）与 `presentAt`（按当前 slot 的实际在场者）；`getCharacterLocation`/`getPresentAt` **语义不变**（住处/花名册） |
| 引擎 `characters/greeting.ts`（新） | 请安出席名单、免请安判定、游走掷骰（纯函数） |
| 状态 `state/types.ts` | 新增两处瞬态字段（见 §8） |
| store `greeting.ts`（新） | 装配「免请安」「请安进入」效果批 + 文案 |
| store `bedchamber.ts` / `conversation.ts` | 子时滚旬时记 `overnightWith` |
| 引擎 `characters/gongli.ts`（新） | 侍君贴身宫隶的确定性派生（名字/立绘/禀告者，见 §5.1） |
| 资产 `assets/manifest.json` | 加 6 条 `portrait.gongliN.neutral` |
| UI | 乘风请安遮罩、请安场景、离宫二选一、缺席禀报（宫隶口吻） |

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

**关键：不改既有两函数的语义（避免破坏搬迁/地图）**

- `getCharacterLocation(db, state, charId)` —— **保持住处/家语义不变**。它被 `relocate.ts`、`funnel.ts` 的 `relocate` 校验、人物详情「居所」依赖，这些都问「住在哪」，非「此刻在哪」。
- `getPresentAt(db, state, locationId)` —— **保持住处花名册语义不变**。`HaremGrid`（地图总览住客）、`CourtyardScreen`（院子宫室住客）、`inPalaceConsorts`（翻牌子/查看侍君）依赖之；地图永远按住处显示住客，不随时辰闪变。既有 `tests/characters/presence.test.ts` 同此契约。
- **新增** `consortLocationAt(db, state, charId, slot): string` —— 某 slot 的实际所在（住处 / 坤宁宫 / 御花园）。
- **新增** `presentAt(db, state, locationId): CharacterContent[]` —— 以 `shichenSlot(state.calendar)` 调 `consortLocationAt`，返回此刻实际在场者（含皇后判定），按位分降序。**仅 `LocationScreen` 改用它**（替换其原 `getPresentAt` 调用），用于「此处此刻有谁」。

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

`LocationScreen` 同时取 **住处花名册**（`getPresentAt`，谁住这）与 **实际在场**（`presentAt`，谁在这）。缺席者 = 花名册 − 在场。进侍君居所而某住客此刻不在时，`CharacterScene` 对应宫室显示宫人禀报，理由取该侍君 `consortLocationAt` 的当前所在：

禀报由该侍君的**贴身宫隶**口吻发出（见 §5.1），非通用「宫人」：

- 在坤宁宫 → 「{宫隶名}垂手禀道：『{称谓}往坤宁宫向皇后请安去了。』」
- 在御花园 → 「{宫隶名}垂手禀道：『{称谓}往御花园散心去了。』」

`CharacterScene` 缺席时改用**禀告宫隶的立绘 + 名牌**取代侍君空位。

## 5.1 宫隶（侍君贴身宫人）

每名侍君固定 2 名贴身宫隶，**确定性派生、不落存档**（与 `randomPetName`/`pickGivenName` 同范式）：

```ts
interface GongliAttendant { name: string; portraitSet: string } // portraitSet 如 "gongli3"
attendantsOf(rngSeed, consortId): [GongliAttendant, GongliAttendant]
reportingAttendant(rngSeed, consortId, dayIndex): GongliAttendant
```

- **名字**：从 `MALE_ATTENDANT_RESERVED_CHARS`（`characters/lilangNames.ts`，96 个无姓二字名，含听雪/听竹）按 `fnv1a64Hex(\`${rngSeed}:${consortId}:gongli:${i}\`)` 取（`i=0,1`）；两名相同则 `(idx+1)%N` 错开 —— 保证同侍君 2 名互不相同。
- **立绘**：`gongli${1 + hash%6}`，对应 `assets/manifest.json` 新增的 `portrait.gongli1.neutral … gongli6.neutral` → `portraits/gongli/gongliN.png`（gongli 文件夹现有 6 张）。
- **禀告者**：`reportingAttendant` 按 `dayIndex` 在 2 名间择一（当日稳定、跨日可换人）。
- **范围**：仅缺席禀告时浮现。跨侍君偶发同名容忍（YAGNI）。冷宫/待选/凤后几乎不缺席，其宫隶自然不出现。

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

- `consortLocationAt`：卯时→坤宁宫；被免→住处；留宿对象→住处；白天游走命中/未命中；夜里在家；冷宫/已故/待选不动。
- `presentAt`：卯时坤宁宫＝皇后＋出席侍君；卯时某后宫居所空；白天游走者出现在御花园。既有 `getPresentAt`/`getCharacterLocation` 契约（`presence.test.ts`）保持不变。
- `gongli`：同 `(rngSeed,consortId)` 稳定；2 名互不相同；名字落在 `MALE_ATTENDANT_RESERVED_CHARS`；`portraitSet` ∈ gongli1–6；`reportingAttendant` 随 dayIndex 在 2 名间切换。manifest 含 6 条 gongli 条目（`validate-manifest` 通过）。
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

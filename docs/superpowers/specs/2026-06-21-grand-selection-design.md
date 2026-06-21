# 大选（三年一次的殿选）设计

> 状态：已通过 brainstorming，待实现计划（writing-plans）。
> 分支：`feat/grand-selection`（基于 `feat/item-acquisition`，复用其乘风 prompt 基础设施）。

## 0. 目标

每三年一次的后宫大选：乘风按日历提醒 → 殿选挑选秀男 → 选中者落库为持久侍君，
五月起可侍寝。秀男为**运行时随机生成**（立绘/姓名/家世/年龄/属性皆随机），
每个大选年重新生成，支持长期重玩。

## 1. 触发节奏（日历门控的乘风）

- **大选年**：`(year - 1) % 3 === 0` → 元年、四年、七年、十年……
- **二月报告**（无选项，纯叙事节拍）：凤后遣人禀告——大选已准备妥当，秀男已入住
  储秀宫学规矩。走现有 reaction/beats 路径。每大选年一次，flag `daxuan:announce:{year}`。
  此时**不**生成候选，仅叙事铺垫。
  - 触发槽位：二月上旬，首个行动槽（辰时 / `MORNING_SLOT`），与秋猎的槽位门控同构。
- **四月下旬辰时 prompt**（带选项）：乘风+礼部来报，殿选准备完毕，请陛下前往体元殿，
  皇后太后已到。选项 `[前往体元殿] / [让太后皇后决定]`。每大选年一次，
  flag `daxuan:dianxuan:{year}`。触发槽位：四月下旬 `MORNING_SLOT`（辰时）。

两条都通过 `buildDaxuan*Prompt(db, state)` 纯函数构造（参照 `buildAutumnHuntPrompt`），
返回 `null` 表示当前不触发。

## 2. 候选秀男生成（factory）

进入殿选时（前往或委托），用 `gestationRoll(seedKey)`（`seedKey = "daxuan:{year}:..."`）
**确定性**生成 `N = 8–12` 位秀男。每位：

- `id`：`xiunan_{year}_{i}`（snake_case，合 `idSchema`）。
- `portraitSet`：从通用立绘 `consort1`–`consort6` 随机（允许重复）。
- 姓名：`shijunNames.ts` 的 `ARISTOCRATIC_SURNAME_POOL` + `ARISTOCRATIC_MALE_GIVEN_NAME_POOL`。
- `age`：14–22。
- **家世**：随机判为「世家」或「平民」。
  - 世家：随机挂一名现有官员（`state.officials`）为父亲，其 `officialPost.gradeOrder`
    决定皇后推荐位分；保存 `fatherOfficialId`（生成对象自带，落库时随之保存）。
  - 平民：无官身。
- `attributes`（appearance/health/nurture/specialty/likes）、`profile.personalityTraits`、
  `hidden`（affection/fear/ambition）随机取自各自的池。
- 生成对象用 `characterSchema` 校验，保证 schema 合法；非法则丢弃重掷。

候选名册是**临时**的，存在于殿选流程内（前往路径在殿选 View 的本地 state；委托路径
即时计算）。只有「留牌子」/被 NPC 留下的才落库，其余丢弃。

### 2.1 生成池（作者撰写，确定性取样）

- 特长（specialty）池：如 古筝/琵琶/书法/刺绣/烹茶/骑射/丹青/棋艺……
- 性格 traits 池：如 温婉/活泼/沉静/孤傲/机敏/腼腆/爽利……
- likes 标签池：如 玉器/香料/古籍/骏马/茶饮/花木……
- appearance 文案池：按 appearance 分档（高/中/平）各若干句。

## 3. 殿选界面（新 View `dianxuan`，背景 `tiyuandian`）

逐个秀男呈现：

1. 礼官宣读身份：
   - 世家：`{父官职}之男 {姓名}，年{age}。`（如「礼部尚书之男成星星，年十八」）
   - 平民：`良家子 {姓名}，年{age}。`
2. 秀男上前行礼：`参见陛下、太后、皇后，吾皇万福金安。`
3. 主按钮 `留牌子 / 撂牌子`；副选项：
   - `抬起头来`：依 `appearance` 分档 + `personalityTraits` 出一句**模板化确定性**描述
     （如「秀男娇羞地微微抬头，是个面目清秀的小男儿」）。
   - `问才艺`：依 `specialty` 出一句（如「小男儿擅刺绣，家中长辈的荷包都是小男儿所做」）。
   - 副选项可在决定前随时使用；也可不问直接留/撂。
4. **留牌子 → 定位分子步骤**：皇后依家世进言推荐（§5），陛下自由选 `更衣 → 皇贵君`
   任一档（不含凤后），确认后落库（§6），进入下一位。
5. **撂牌子** → 下一位。
6. `提前离开体元殿`（任意时刻）：余下秀男大概率被撂；**20%** 几率离场后乘风来报，
   太后留了**随机一位**秀男（乘风按那位的真实家世来报），该位自动按 §5 标准定位分落库。
7. 全部看完或提前离开 → 退出殿选，回到地图/房间。

进体元殿消耗 **1 行动点**（在进入殿选时扣）。

### 3.1 原子性

殿选为单次不可中断流程：进入即扣 1 AP 并设 `daxuan:dianxuan:{year}` flag，逐位审阅，
**仅在流程结束时**提交落库 + autosave。流程中不触发其它 checkpoint/autosave。

## 4. 委托路径（让太后皇后决定）

不跳转、不耗行动点。设 `daxuan:dianxuan:{year}` flag。**20%** 几率太后/皇后留下
`1–2` 位**随机**秀男（自动按 §5 标准定位分落库），乘风节拍逐位汇报；否则乘风报一句
「此次大选，太后与皇后未中意者」。

## 5. 家世 → 推荐位分（皇后标准）

`recommendRank(gradeOrder | "commoner")`：

| 父官品 | 推荐位分 | rank id |
|---|---|---|
| 一品 / 皇亲 | 贵人（从四品） | `guiren` |
| 二、三品 | 美人（正五品） | `meiren` |
| 四、五品 | 常在（六品） | `changzai` |
| 六、七品 | 答应（七品） | `daying` |
| 平民 | 更衣（八品） | `gengyi` |

皇后台词：`陛下，臣侍觉得封为{rankName}比较合适。` 仅为建议。
玩家最终自由选 `更衣…皇贵君`（位分表 order 50–180，排除凤后 order 1000）。
NPC 委托/自留路径直接按此表自动定位分，无玩家介入。

> 备注：「皇帝喜欢的四五品→才人」这一细分暂不建模，四五品统一推荐常在。

## 6. 落库 — 运行时生成的侍君

- 新增 `state.generatedConsorts: Record<string, CharacterContent>`：
  - 加入 save 的 `gameStateSchema`（`stateSchema.ts`，strictObject 必须显式声明）。
  - `createNewGameState` / `createInitialState` 初始化为 `{}`。
- App 用 `useMemo`（dep = `content` + `state.generatedConsorts`）把它合并进 `db.characters`：
  `{ ...content.characters, ...state.generatedConsorts }`，使全部 ~70 处 `db.characters[id]`
  调用点自动可见生成侍君。引擎 reducer 仍以 `GameState`（standing/memories 按 id）运作。
- 每位落库侍君同时写入：
  - `standing[id]`：所选 `rank`、初始 `favor`（随位分高低 10–20，见下）、
    `residence: "chuxiu_gong"`、`chamber: "main"`、`availableFromMonth: monthOrdinal(year, 5)`。
  - **初始恩宠按位分缩放**：`favor = clamp(10 + round(10 * (order - 50) / (180 - 50)), 10, 20)`，
    即更衣（order 50）→ 10，皇贵君（order 180）→ 20，中间线性。位分越高初始恩宠相对越高。
  - `memories[id]`：空库 + 一条初始记忆（殿选承恩，入住储秀宫，salience 中等）。
  - `bedchamber[id]`：空记录（按需，与现有侍君一致）。
- **侍寝门槛**：五月前不可。新增 `CharacterStanding.availableFromMonth?: number`
  （monthOrdinal）。`canSummon`、`passionAllowed`、翻牌选人列表（`inPalaceConsorts`
  的消费方）在 `monthOrdinal(state.calendar) < availableFromMonth` 时排除该侍君。
  字段加入 `characterStandingSchema`（content）与 save 的 standing schema。

> 兼容性：本项目 pre-release，不迁移旧存档（见 memory `no-save-backcompat`）。
> 新增 state 字段会使旧存档失效，符合既定策略。

## 7. 接线（最小，只接大选）

- 新建 `src/store/grandSelection.ts`：
  - `buildDaxuanAnnouncePrompt(db, state)` → 二月报告（DecreeReaction beats）。
  - `buildDaxuanDianxuanPrompt(db, state)` → 四月 prompt（`ChengFengPrompt`，带选项）。
  - `generateCandidates(db, state, year)` → 候选秀男数组（含家世/属性）。
  - `recommendRank(...)`、`npcKeepOnLeave(...)`（20% 随机留一位）、
    `npcKeepOnDelegate(...)`（20% 留 1–2 位）。
- 扩展 `PromptAction`（`src/store/prompt.ts`）：新增
  `{ type: "daxuanEnter"; year } | { type: "daxuanDelegate"; year }`，更新 `isPromptAction`。
- `GameStore` 新方法：提交单个/多个落库侍君（写 generatedConsorts + standing + memories
  + bedchamber + flags），设 flag。
- `App.tsx`：
  - 渲染 `ChengFengPromptScreen` 承载待决大选 prompt（新增 pending-prompt 求值：在
    checkpoint/到达房间时调用 `buildDaxuanDianxuanPrompt`，非空且未决则显示）。
  - 二月报告走现有 reaction beats 路径（在 spendAp 的乘风/节拍汇报附近，或 checkpoint）。
  - 新增 `dianxuan` View + `DianxuanScreen`，处理 `daxuanEnter`/`daxuanDelegate` 动作。
  - 秋猎/进贡 prompt 接线**维持现状**，本次不接。

## 8. 测试要点

- `(year-1)%3===0` 触发判定；二月/四月槽位门控；flag 一次性。
- `generateCandidates`：确定性（同 seed 同结果）、数量 8–12、生成对象过 `characterSchema`、
  世家挂存在的官员、id 唯一。
- `recommendRank` 各官品档映射正确；平民→更衣。
- 落库：standing/memory 正确写入，`availableFromMonth` 门控（五月前 `canSummon` 为 false，
  五月起为 true）。
- 委托/早退场的 20% NPC 留人：随机选取、按标准定位分、数量 1–2 / 0–1。
- App `db` 合并：生成侍君在房间/翻牌/对话中可见。

## 9. 默认值（已与用户确认或自定，可调）

- 秀男 age 14–22；平民宣读「良家子{姓名}，年{x}」。
- 四五品统一推荐常在（不细分才人）。
- 落库初始 favor 随位分 10–20 缩放（更衣 10 → 皇贵君 20，线性）。
- 太后/皇后留人为**随机**秀男（非固定家世）。

# 侍寝系统 + 孕育系统 — 设计规格

**日期：** 2026-06-15
**状态：** 已通过设计评审，待写实现计划
**相关文档：** [`background-v1.0.md`](../../background-v1.0.md)（位分/称谓权威）·
[`engineering/10-current-implementation.md`](../../engineering/10-current-implementation.md)（引擎契约）·
[`systems/60-pregnancy-and-heir-system.md`](../../systems/60-pregnancy-and-heir-system.md)（孕育系统设计层）

---

## 0. 范围与非范围

**本期实现：**
- 侍寝系统：在侍君宫殿或御书房召侍君侍寝，消耗 1 行动点；模板化体验台词。
- 受宠程度（盛宠/宠爱/小宠/无宠/失宠）：由侍寝频率**派生**，取代侍君卡片上的数值「恩宠」条。
- 侍寝次数统计：近一月 / 近三月 / 近一年。
- 御书房「翻牌子」入口。
- 初夜结束后询问晋升，选「是」打开位分选择器。
- 孕育系统第一阶段：激情侍寝按概率受孕；次月第一次行动前提示并由玩家挑选 1–3 名生父；帝王状态转「怀胎」。

**非范围（明确不做）：**
- 孕期推进、胎息、承养、分娩、产子、写入 `heirs`、继承顺序。文档 `systems/60` 将这些标注为 future，本期只到「怀胎」状态。
- 侍寝不自动改动数值恩宠 `standing.favor`（受宠程度完全由频率决定）。`favor` 仍存在于状态、仍供 `favorAtLeast` 条件使用，只是不再在侍君卡片上展示。

---

## 1. 架构定位

侍寝是**运行时的引擎/store 流程**，不是 authored content。理由与位分操作（`rankOps.ts` → `store.applyEffects` + `ReactionScreen`）一致：

- 侍君是运行时选定的（任意一名），无法用每侍君一个 authored scene 表达。
- 激情/享受、受孕判定、受宠分级不在现有 authored scene DSL 的表达能力内。

但**所有状态变更仍只走效果漏斗**（架构规则 #1），方式与位分/封号系统新增 `set_rank`/`set_title`/`remove_title` 完全一致：新增几个 effect type，校验在 `funnel.validateEffects`，应用在 `funnel.applyEffects`。

孕育提示（次月弹窗选生父）**绕过事件触发 DSL**，由 App 层直接拦截渲染——与位分操作、`ReactionScreen` 同理，且遵守 scaffold guard（条件 DSL 不读 bloodline 资源，规则 #4）。

---

## 2. 新增 GameState 状态

`src/engine/state/types.ts`：

```ts
export type BedchamberMode = "passion" | "pleasure"; // 激情（纳入式）/ 享受

export interface BedchamberEncounter {
  at: GameTime;        // 侍寝发生时刻（纯 GameTime，不带 AP）
  mode: BedchamberMode;
}

export interface BedchamberRecord {
  encounters: BedchamberEncounter[]; // append-only
}

export type PregnancyStatus = "none" | "pending" | "expecting";
// none      — 未受孕
// pending   — 已受孕，尚未在次月告知玩家（玩家不可见）
// expecting — 怀胎（玩家已知、生父已选）

export interface PregnancyState {
  status: PregnancyStatus;
  conceivedAt?: GameTime;   // 受孕发生时刻
  fatherIds: string[];      // 玩家选定的生父候选（1–3，confirm 后写入）
}
```

`GameState` 新增：
```ts
bedchamber: Record<string, BedchamberRecord>; // 仅 consort（含皇后 feng_hou）
```
`BloodlineState` 新增：
```ts
pregnancy: PregnancyState;
```

**初始化（`newGame.ts` / `initialState.ts`）：** 每个 `kind === "consort"` 的角色给一条空 `{ encounters: [] }`；`pregnancy = { status: "none", fatherIds: [] }`。游戏开局所有侍君次数为 0 ⇒ 全员「无宠」，符合「从未侍寝为无宠」。

**存档（`stateSchema.ts`）：** 新增字段进入版本化 SaveData 的 schema 校验，随存档走。

---

## 3. 受宠程度（派生，不存储）

新纯函数模块 `src/engine/characters/favorTier.ts`。无副作用，输入 `BedchamberRecord` + 当前 `GameTime` + 配置，输出分级与统计。**实时计算**，因此随月份翻转自动回落（见 §3.3 例）。

### 3.1 时间窗口（按月边界）
设 `monthOrdinal(t) = (t.year - 1) * 12 + t.month`，`cur = monthOrdinal(now)`。
- **近一月** = `cur - monthOrdinal(e) === 0` 的 encounters（即当前月）。
- **近三月** = `0 ≤ cur - monthOrdinal(e) ≤ 2`（当前月 + 前两月）。
- **近一年** = `0 ≤ cur - monthOrdinal(e) ≤ 11`（当前月 + 前十一月）。

三项统计**计入所有 mode**（受宠是「被临幸频率」，与受孕无关）。

### 3.2 分级（阈值取自 `world.json.bedchamber.tiers`）
设 `n3` = 近三月次数：
- `n3 ≥ abundant(10)` → **盛宠**
- `n3 ≥ favored(5)` → **宠爱**
- `n3 ≥ small(3)` → **小宠**
- `n3 < small`：
  - 若历史上 3 月窗口曾达 `favored(5)` 及以上 → **失宠**
  - 否则 → **无宠**

「历史曾达宠爱+」算法：从首次 encounter 所在月序到 `cur`，对每个月序 `m` 计算「以 m 结尾的 3 月窗口次数」，取最大值，是否 `≥ favored`。月份数量有限，开销可忽略。

### 3.3 验收例（来自需求，作为测试 fixture）
某侍君：一月 4 次、二月 3 次、三月 3 次、四月 0 次（mode 不限）。
- 一月末（窗口=一月）：n3 = 4 → **小宠**
- 二月末（窗口=一、二月）：n3 = 7 → **宠爱**
- 三月末（窗口=一、二、三月）：n3 = 10 → **盛宠**
- 四月（窗口=二、三、四月）：n3 = 6 → **宠爱**（「四月结束掉回宠爱」）

### 3.4 展示
侍君卡片（`CharacterCard.tsx`）对 consort 用受宠程度标签**取代**数值恩宠条，并展示近一月/近三月/近一年次数。官员不变（仍展示圣眷）。

---

## 4. 新增效果类型（走漏斗）

`src/engine/content/schemas.ts` 的 `eventEffectSchema` 新增两个分支；`funnel.ts` 校验 + 应用。

### 4.1 `bedchamber`
```ts
{ type: "bedchamber", char: idSchema, mode: z.enum(["passion", "pleasure"]) }
```
- **校验：** `char` 是存在的 consort 且有 `bedchamber` 记录。
- **应用：** 向 `next.bedchamber[char].encounters` 追加 `{ at: toGameTime(state.calendar), mode }`。

### 4.2 `pregnancy`
```ts
{ type: "pregnancy", op: z.enum(["begin", "confirm", "clear"]), fatherIds?: idSchema[] }
```
- **校验：** `op === "confirm"` 时 `fatherIds` 长度 1–3，且每个都是存在的 consort。其余 op 不带 `fatherIds`。
- **应用：**
  - `begin` → `pregnancy = { status: "pending", conceivedAt: now, fatherIds: [] }`
  - `confirm` → `{ status: "expecting", conceivedAt: 保持, fatherIds }`
  - `clear` → `{ status: "none", fatherIds: [] }`（调试/重置用）

两个新效果不参与数值钳制（非 0–100 轴），与 `set_rank`/`flag` 等结构性效果同类。

---

## 5. 受孕判定（确定性）

不引入/不变更随机种子，不在漏斗内做随机。判定为纯函数：

```
conceives(state, char) =
  state.resources.bloodline.pregnancy.status === "none"
  && fnv1a(`${state.rngSeed}:${state.calendar.dayIndex}:${char}`) % 100
       < world.json.bedchamber.conceptionChance
```

- 仅 **激情（passion）** 侍寝触发判定；享受永不受孕。
- 仅在 `status === "none"` 时判定（怀胎/pending 期间不再受孕）。
- 确定性 ⇒ 存档/重放稳定。复用 `save/canonical.ts` 已有的 FNV-1a 或在引擎内提供等价 helper。

命中后立即在同一提交批里追加 `pregnancy{ op: "begin" }`。

---

## 6. 侍寝流程（消耗 1 行动点）

### 6.1 两个入口，同一流程
- **(a) 宫殿侍寝：** 进入侍君宫殿，其卡片在场时显示「侍寝」按钮。皇后（坤宁宫）同样可侍寝。
- **(b) 御书房翻牌子：** 御书房 `LocationScreen` 提供「翻牌子」按钮 → 打开侍君列表 → 选一人「来御书房侍寝」。

两条入口都要求当前剩余 AP ≥ 1，不足则禁用（与事件「行动点不足」一致，绝不自动翻旬）。

### 6.2 步骤
1. **选激情/享受**：弹窗，两选项各附一句简述。
2. **播放体验台词**：模板存 `world.json.bedchamberScript`，按 mode 取词，支持 `{name}`（侍君称呼）/`{self}`（侍君自称）替换；含闾笔带过、以帝王视角「神清气爽」式收尾。经对话缝隙（`assembleDialogueRequest` + `produceDialogueLine` + MockProvider）渲染，复用 `ReactionScreen` 的播放模式（多行点击推进）。
3. **提交：**
   - `store.applyEffects([{ bedchamber, char, mode }, ...(命中受孕 ? [{pregnancy begin}] : [])])`
     —— 受孕判定在 applyEffects 之前用当前 state 算好（时间戳取当前月，故 begin 的 conceivedAt 也落当前月）。
   - 然后 `store.dispatch(SPEND_AP 1)`；若耗尽 AP 翻旬，按旅行同样的方式跑 `time_advance` checkpoint。
   - 触发 scene-commit 同款 autosave。
4. **初夜**（提交前该 char 的 `encounters` 为空）：体验播放结束后弹「是否晋升{称呼}」。
   - 「是」→ 打开位分选择器（复用 `RankAdminModal` / `buildRankOp` 的 `set_rank` 路径，产生谢恩反应）。皇后已是正宫、不可调整 ⇒ 皇后初夜不弹晋升。
   - 「否」→ 直接结束。

### 6.3 顺序保证
受孕判定与 encounter 时间戳都基于**侍寝当下**的 GameTime（SPEND_AP 翻旬之前），确保孕育归属落在正确月份。

---

## 7. 孕育提示与生父挑选

### 7.1 触发
App 层在每次导航/时间推进后、放行玩家行动前检查：
```
pregnancy.status === "pending" && monthOrdinal(now) > monthOrdinal(conceivedAt)
```
满足则强制弹出 `PregnancyModal`（先于其它交互），不经事件 DSL。

### 7.2 生父候选
列出**受孕当月（conceivedAt 的月序）发生过激情侍寝的全部侍君**——由 `bedchamber` 日志按 `mode==="passion"` 且月序等于受孕月序筛出（无需额外状态）。因 pending 必由一次激情侍寝置位，候选至少一人。

### 7.3 选择
玩家多选 **1–3** 人 → `store.applyEffects([{ pregnancy, op: "confirm", fatherIds }])` → 帝王状态转「怀胎」。HUD 显示「怀胎」徽标。怀胎期间仍可侍寝（激情可选，但 §5 判定因 `status !== "none"` 跳过，不再受孕）。

---

## 8. 配置（world.json）

`worldSchema` 新增可选块：
```json
"bedchamber": {
  "conceptionChance": 30,
  "tiers": { "small": 3, "favored": 5, "abundant": 10 }
},
"bedchamberScript": {
  "passion": { "lines": ["...{name}...", "...{self}...", "...神清气爽..."] },
  "pleasure": { "lines": ["...", "..."] }
}
```
缺省（最小内容/测试）时给引擎内置 fallback，受孕概率默认 30。

---

## 9. UI 改动清单

- `CharacterCard.tsx`：consort 用受宠程度标签取代恩宠条 + 三段次数；新增可选「侍寝」按钮（`onBedchamber`）。
- `LocationScreen.tsx`：御书房新增「翻牌子」按钮 → 侍君选择列表；侍君宫殿卡片透出「侍寝」入口。
- 新增 `BedchamberModal`（选激情/享受）、`BedchamberScene`（播放体验，可基于 `ReactionScreen` 模式）、`PregnancyModal`（多选生父）。
- HUD：怀胎徽标。
- `App.tsx`：编排侍寝流程、初夜晋升衔接位分选择器、pending→怀胎拦截弹窗、AP/翻旬/autosave/time_advance checkpoint 接线。

---

## 10. 测试

TDD 覆盖纯逻辑：
- `favorTier`：§3.3 四月 fixture；窗口边界；失宠 vs 无宠；空日志=无宠。
- 受孕 hash 的确定性与概率门限。
- 漏斗新效果 `bedchamber`/`pregnancy` 的校验（坏 target、fatherIds 越界 1–3、非 consort）与原子性（reject-one-reject-all）、append 正确、状态机迁移。
- 孕育触发判定（pending + 跨月）。
- 存档往返：新字段持久化、损坏隔离不回归。

UI 沿用现有 Playwright 冒烟模式，不强制新增 e2e。

---

## 11. 统一 DoD

typecheck → lint → test → validate-content → validate-manifest → build 全绿；main 始终可启动；新内容（world.json 配置）过 `validate-content`。

# 健康 / 病情 / 生死 系统设计

> 状态：已通过 brainstorming，待实现计划（writing-plans）。
> 分支：`feat/health-illness-mortality`（新建，基于当前 `feat/consort-presence-greeting`）。

## 0. 目标

为**所有有名角色**（皇帝、太后、侍君、皇嗣）引入统一的「数值健康 + 病情状态」系统：

- 健康为 0–100 的可变数值；病情状态 `健康 / 生病 / 重病` 独立存储（不由健康数值派生）。
- 年龄越大、健康越低越容易生病；35 岁起每年自然衰老掉血。
- 召见太医可为四类人看诊：加健康、并按概率治病。
- 病情按月推进（生病↔痊愈↔重病↔死亡）；健康降到 0 或重病暴毙则死亡。
- 死亡有完整身后事：皇帝→游戏结束；太后→葬仪/谥号/慈宁宫永久关闭/服丧；
  侍君→移出活人列表/承养人标注（已故）/追封位分+谥号；皇嗣→夭折。
- 奉先殿新增「已故侍君」可缅怀。

设计原则：**tick 幂等、读档不重掷、死亡走持久化事件队列**（见 §3、§7）。

## 1. 数据模型

### 1.1 新增枚举与年龄

- `HealthStatus = "healthy" | "sick" | "critical"`（健康/生病/重病），新建于 `types.ts`。
- 皇帝年龄走 **world config**（不放在 `startingResources` 下，不硬编码）：
  `world.json` 顶层新增 `sovereign: { startingAge: 18 }`（schema 校验 `≥0`）。
  当前年龄 `currentAge = startingAge + (year − 1)`。
- `ageOver35(age) = max(0, age − 35)`。年龄工具集中于新文件 `src/engine/characters/aging.ts`。
- **各类角色当前年龄算法不同**（不可一律 `profile.age + year − 1`）：
  - **皇帝**：`startingAge + (year − 1)`。
  - **太后 / 预置侍君**：`profile.age + (year − 1)`，其中 `profile.age` 约定为「游戏元年（year 1）年龄」。
  - **皇嗣**：由出生日期计算 `heirAge(heir.bornAt, currentTime)`（皇嗣是游戏中出生的，
    不能用开局年份增长）。`bornAt` 取现有皇嗣出生时刻字段（实现时核对 `heirs.ts`）。
  - **后续动态入宫侍君（选秀等）**：不依赖 `profile.age` 的元年语义，**入宫时落库
    `ageAtEntry` + `enteredAtYear`**（或直接存出生年份），当前年龄 = `ageAtEntry + (year − enteredAtYear)`。
    Phase 1 即为侍君 standing 预留该字段；预置侍君回退到 `profile.age + (year − 1)`。
  - 统一出口 `currentAgeOf(db, state, subject)`，内部按角色类型分派，杜绝误用。

### 1.2 各角色健康字段

| 角色 | 健康数值 | 状态 | 初始 health | 初始 status |
|------|----------|------|-------------|-------------|
| 皇帝 | `resources.sovereign.health`（已有） | `resources.sovereign.healthStatus`（新增） | world 起始 70 | healthy |
| 太后 | `taihou.health`（新增） | `taihou.healthStatus`（新增） | **固定 70** | healthy |
| 侍君 | `standing[id].health`（新增） | `standing[id].healthStatus`（新增） | **取卡牌 `attributes.health`** | healthy |
| 皇嗣 | `heir.health`（已有） | `heir.healthStatus`（新增） | 现有出生逻辑 | healthy |

- 侍君旧 `standing.ill?: boolean` **删除**，由 `healthStatus` 取代。
  辅助函数 `isIll(status) = status !== "healthy"` 供需要布尔的旧调用方（如太后侍疾/敲打）使用。
- 太后旧 `taihou.ill: boolean` **删除**；`taihou.ts` 的 `buildTaihouIllnessTick`（每旬 5–25%
  生病掷骰）**移除**，太后生病改由 §3 统一月度 tick 驱动。`buildShizhiEncounter` /
  `buildTaihouRebuke` 改读 `isIll(taihou.healthStatus)`，逻辑不变。
- `set_taihou_illness` 效果**退役**，由 §1.4 的 `set_taihou_health`（可设状态/加减健康）取代；
  所有旧调用点改用新效果。

### 1.3 死亡与身后事字段

死后数据**与生前数据分开存放，绝不覆盖原字段**。

- **侍君**（`CharacterStanding`）：`lifecycle: "deceased"` 标记死亡，外加一个独立
  `deathRecord?`（避免 `posthumousTitle` 与生前 `title` 混淆）：

  ```ts
  deathRecord?: {
    diedAt: GameTime;
    cause: DeathCause;          // "illness" | "critical_sudden" | "pregnancy" | "childbirth" | "scripted"
    originalRankId: string;     // 生前位分快照
    originalTitle?: string;     // 生前封号快照
    posthumousRankId?: string;  // 追封位分（生前 rank 不动）
    posthumousEpithet?: string; // 追封谥号，1–2 汉字（区别于生前 title）
  }
  ```

- **太后**（`TaihouState`）：
  - `deceased?: boolean`；`diedAt?: GameTime`；`posthumousName?: string`（谥号，1–2 字）；
  - `mourningUntilDayExclusive?: number`：服丧截止 `dayIndex`（**独占上界**，见 §5/§6.2）。
- **皇嗣**（`Heir`）：`lifecycle`/`deceased?` + `diedAt?` 标记夭折（沿用现有皇嗣生命周期字段；
  若无则新增）。实现时先核对 `heirs.ts` 现状。
- **皇帝**：死亡**不入存档身后事队列**，由健康结算返回 `sovereignDied`，settle 后直接 game-over（见 §6.1/§7）。

`DeathCause` 枚举集中定义于 `types.ts`。

### 1.4 全局健康不变量与 `resolveHealthChange`（关键）

> **不变量：任何使角色健康降至 0 的效果或事务，必须在同一事务内立即标记死亡并入身后事，
> 不得等待月度 tick。** 否则会出现「转胎后 health=0 仍能出现在列表/对话/侍寝」的窗口。

为此，**所有**健康变更（月度 tick、转胎 −10、生产 −5/−10、剧情 `set_*_health`、未来的惩罚/受伤
事件）**统一经由**一个结算函数，禁止调用方自行拼装「扣血 + 置死 + 入队」三步：

```ts
resolveHealthChange(state, {
  subject,        // { kind: "sovereign" | "taihou" | "consort" | "heir", id? }
  healthDelta?,   // 加减（clamp 0–100）
  healthStatus?,  // 可选直接置状态（看诊治愈、tick 迁移结果）
  cause,          // DeathCause
  at,             // GameTime
}): HealthChangeOutcome
```

`HealthChangeOutcome = { previousHealth, nextHealth, previousStatus, nextStatus, died, deathCause?,
sovereignDied?, aftermathId? }`。该函数**原子**完成：

1. clamp 健康值；2. 更新状态；3. 检查死亡（`nextHealth ≤ 0` 或调用方传入的暴毙判定）；
4. 处理孕期死亡（§6.5：未产断胎 / 已产存嗣）；5. 标记生命周期；
6. **幂等**地加入身后事队列（皇帝除外，见 §7；同人同月只入一条）。

调用方只调用 `resolveHealthChange`，由它内部使用下列**底层 funnel 效果**（不被调用方直接组合）：

- `set_consort_health { char, healthStatus?, healthDelta? }` / `set_taihou_health { healthStatus?, healthDelta? }`
  / `set_heir_health { heirId, healthStatus?, healthDelta? }`：clamp 0–100。`set_taihou_illness` 退役迁移至此。
- `set_consort_posthumous { char, posthumousRankId?, posthumousEpithet? }`：写 `deathRecord`，不动生前数据。
- `consort_decease { char, at, cause }` / `heir_decease { heirId, at, cause }` / `taihou_decease { at, cause }`：
  置死亡标记 + 时间 + 死因，**不触发 UI**（UI 由身后事事件驱动，见 §7）。
- `enqueue_aftermath { id, kind, subjectId, at }`：幂等入队（按稳定 `id` 去重）。
- 葬仪扣银沿用现有 `resource`/`treasury` funnel（带下限 clamp 至 0），见 §6.2。

所有新效果在 `schemas.ts` 的 `eventEffectSchema` 增分支，在 `funnel.ts` 增 case，各配单测；
`resolveHealthChange` 本身为纯函数（输入 state + 参数 → 一组原子效果 + outcome），配独立单测。

### 1.5 存档迁移

按项目惯例（pre-release，不迁移旧档）：更新 `stateSchema.ts` / `initialState.ts` /
`newGame.ts` 引入新字段并赋初值即可；旧存档不兼容、不做向后迁移。

## 2. 确定性随机：`healthRoll`

**不复用 `gestationRoll`**。新增 `src/engine/characters/healthRoll.ts`：

```ts
export function healthRoll(seedKey: string): number   // 0–99，fnv1a64Hex 取模
export function healthRollRange(seedKey: string, lo: number, hi: number): number // [lo,hi]
```

- 实现同 `gestationRoll`（`fnv1a64Hex` 哈希取模），但独立命名空间，互不串扰。
- 所有病情/看诊/死亡掷骰都用稳定 seedKey（含 `rngSeed` + `year:month` + 角色 id +
  用途），保证**读档重算结果不变**、tick 幂等。
- 月度判定 seedKey 形如 `health:onset:{rngSeed}:{charId}:{year}:{month}`，**不含 period/ap**，
  确保一个月内只产生一个稳定结果。

## 3. 月度健康 tick

### 3.1 触发点与幂等

- 在每月**上旬**（`period === "early"`）首次结算时运行一次，覆盖全体角色。
- 复用现有「转旬应用」时机：在 `App.tsx` 的 rollover 路径增设 `rollHealthTick()`，
  以 `health:tick:{rngSeed}:{year}:{month}` 写入 `tickedPeriods` 风格的去重集，
  **每月至多执行一次**（多次 rollover、读档后重入都不重复）。
- 实际状态变更通过 §1.4 的 funnel 效果落地（确定性，可单测）。

### 3.2 年化→月度生病概率（关键修正）

```
annualRate  = clamp(5 + round((100 − health) × 0.4) + max(0, age − 35), 5, 60)   // %
monthlyRate = 1 − (1 − annualRate/100)^(1/12)
```

- `annualRate` 即「健康/年龄算出的 5%–60%」，定义为**年化生病概率**。
- 月度判定用 `monthlyRate`，避免「5% 月概率→年 46% 患病、全宫长期生病」。
- 仅对 `healthStatus === "healthy"` 者掷此 onset。

### 3.3 每月按角色的原子投影（`projectMonthlyHealth`）

**不可**「按月初状态生成多个独立 effect 再统一应用」——那样死亡判定看不到前序扣血结果。
改为每个角色用一个**纯函数局部投影**串行算出最终值：

```ts
projectMonthlyHealth(subject, context): {
  previousHealth, nextHealth, previousStatus, nextStatus,
  died, deathCause?,
}
```

函数内部按**固定顺序在本地变量上累加**（不经 funnel）：

1. **怀孕成本**（仅承孕侍君，见 §5）：`h −= rand(0–5)`。
2. **年龄自然衰老**：仅当本月为年初（`month === 1` 上旬）且 `age ≥ 35`：
   `decay = 1 + floor(ageOver35 / 10)`（35–44 −1，45–54 −2，55–64 −3…），`h −= decay`。
   *（新游戏元年一月初始化不属于 tick 触发，不扣衰老，见 §3.1/§12。）*
3. **病损**：仅对**本月之前已处于**该状态者——生病 `h −= rand(1–2)`，重病 `h −= rand(3–5)`。
   *（本月刚转生病者本月不扣病损、不恶化，见步骤 6。）*
4. **0 血死亡**：若 `h ≤ 0` → `died = true, deathCause = "illness"`，**到此为止**（不再迁移）。
5. **重病暴毙**：若 `previousStatus === "critical"`，5% → `died = true, deathCause = "critical_sudden"`，到此为止。
6. **互斥状态迁移**（单次，不叠加；仅未死亡时）：
   - `healthy`：按 §3.2 `monthlyRate` 掷 onset，命中 → `sick`（**本月到此为止，不扣病损**）。
   - `sick`：单次取 `r ∈ [0,100)`：`criticalRate = clamp(1 + ageOver35, 1, 30)`；
     `r < criticalRate` → `critical`；否则 `r < criticalRate + 50` → `healthy`（痊愈）；否则维持 `sick`。
     **必须单次互斥**：不可先判痊愈再判重病（否则重病概率被减半）。
   - `critical`：不自动痊愈（仅太医或死亡改变之）。

得到投影后，tick **对每个角色调用一次** `resolveHealthChange`（§1.4）原子落地
（传 `healthDelta = nextHealth − previousHealth`、`healthStatus = nextStatus`、`cause`），
由它统一处理死亡标记、孕期死亡、入队。顺序固定为「成本→衰老→病损→死亡→暴毙→迁移」，迁移放最后保证「刚生病当月不恶化」。

## 4. 召见太医·看诊（Phase 3）

### 4.1 入口与行动点

紫宸殿 `PhysicianModal` 扩为四个看诊对象，**每个看诊各消耗 1 行动点**：

- 为陛下诊脉（自己）
- 给太后请脉
- 给侍君请脉（弹侍君选择器，活着的在宫侍君）
- 给皇嗣请脉（弹皇嗣选择器，活着的皇嗣）

保留既有 **流胎** 流程（自孕中红色二次确认；已传嗣不可弃）。AP 不足时看诊按钮禁用。

### 4.2 每月每人至多一次

- 每个角色记 `lastPhysicianVisitMonthKey`（`{year}:{month}`）：
  皇帝 → `resources.sovereign`；太后 → `taihou`；侍君 → `standing[id]`；皇嗣 → `heir`。
- 当月已看诊者，再次看诊按钮禁用并提示「本月已请脉，太医嘱静养」，**不得重复刷血**。

### 4.3 看诊结算

- 经 `resolveHealthChange`（§1.4）原子落地：`healthDelta = +healthRollRange(key, 5, 10)`（clamp 100）；
  若 `sick` 50% / `critical` 30% 命中则 `healthStatus = "healthy"`；`healthy` 仅加血。
  （加血即便使健康满也不会致死，故走同一结算函数无副作用。）
- 写 `lastPhysicianVisitMonthKey`（§4.2）。
- 太医本人：单个常驻**太医院正（女官）**，`src/engine/characters/taiyi.ts` 的
  `courtPhysician(rngSeed) → { name, portraitSet }`，`fnv1a64Hex` 确定性派生、不落档（仿 `gongli.ts`）。
  - **姓名池**：**不使用** `MAID_RESERVED_CHARS`（宫女名，不适合女官）。改用官员姓名池
    （`namePool.ts` 的 `pickSurname` + `pickGivenName` 组成「姓+名」），
    或新增小型 `FEMALE_OFFICIAL_NAME_POOL`；实现时二选一并在 plan 中定。
  - **立绘**：取 `official1`–`official8`。
  - 台词经通用台词页渲染（按 `portraitSet + name + lines`，无需 db 角色）。
- **组件改名**：现 `ChildReactionScreen` 本质是通用「立绘+台词」页，**重命名为 `CharacterReactionScreen`**
  （皇嗣调用同步改），再供太医复用，避免语义债务。
- 看诊为耗 1 AP 行动，沿用 `spendAp(1)` 路径（懿旨/敲打/转旬 rollover 照常）。

### 4.4 manifest

`assets/manifest.json` 增 `portrait.official1.neutral`–`portrait.official8.neutral`
（文件已在 `public/assets/portraits/official/`）。

## 5. 怀孕健康成本（Phase 3，仅侍君承孕）

全部经 `resolveHealthChange`（§1.4）落地，**扣血致 0 即时死亡**（不等月度 tick）：

- **转胎**（`pregnancy_transfer` 落到侍君）：该侍君 `healthDelta = −10`，`cause = "pregnancy"`（一次性）。
  若致死且尚未生产 → 断胎（§6.5）。
- **承养期间**：每月 `−rand(0–5)`（在 §3.3 投影步骤 1，`cause = "pregnancy"`）。
- **生产**：顺产 `−5` / 难产 `−10`，`cause = "childbirth"`，挂在现有 `birth` 结算（`bearerOutcome`）旁。
  **执行顺序**：先创建/落库皇嗣，再对母方扣血结算——保证「已产则皇嗣存活，仅母亡」（§6.5）。
- 皇帝自孕**不**计这些成本。

## 6. 死亡与身后事

死亡分两段：**tick 内只标记**（§7 队列），**身后事由持久化事件驱动**逐个处理。

### 6.1 皇帝死亡

- health ≤ 0 或重病暴毙 → `resolveHealthChange` 返回 `sovereignDied = true`（**不入身后事队列**）。
- settle 完成后**最高优先**进入 **game over → 回主界面**；即使同月其他角色也死亡，游戏已结束，
  不再展示任何身后事（§7 优先级）。

### 6.2 太后死亡

**机械后果在死亡事务内立即、原子执行**（不等玩家输入谥号；UI 只收集谥号）：

```
taihou.deceased = true
taihou.diedAt = now
taihou.mourningUntilDayExclusive = deathDayIndex + 3   // 含死亡当日，见 §5/§8
treasury = max(0, treasury − 10000)                    // 葬仪强制扣银，下限 0
enqueue aftermath { kind: "taihou", id: 稳定 }          // 仅收集谥号
```

- 慈宁宫**从死亡时刻起永久关闭**（进入即「太后已驾鹤西去」拦截）——由 `taihou.deceased` 直接门控，
  不依赖 aftermath 是否 resolved（避免弹窗未处理时仍能进慈宁宫/上朝）。
- 葬仪扣银只在死亡事务**发生一次**（非 aftermath resolve 时），读档/重复 settle 不重扣。
- 身后事 UI：输入太后**谥号**（1–2 字）→ 单命令原子写 `taihou.posthumousName` 并置 `resolved`。

### 6.3 侍君死亡

- 死亡事务内立即：写 `deathRecord`（含 `originalRankId/originalTitle` 生前快照、`cause`、`diedAt`），
  置 `lifecycle = "deceased"`，**移出活人列表**（`inPalaceConsorts` 等过滤 `deceased`），
  但**保留存档、亲缘关系、奉先殿**。承养皇嗣的**承养人显示**改为 `{name}（已故）`（查表处统一处理）。
- 身后事 UI（多步）**全程只用 UI 局部状态，最后一次性原子提交**，避免中途退出/读档产生半追封：
  1. **是否追封**：候选 = `effectiveOrder` **严格高于**生前位分的所有位分；
     **皇后边界**：若已是最高位分（无更高）→ 跳过追封、提示「位极后宫，无可复加」。
  2. 选「是」→ 选更高位分；3. **是否追加谥号** → 选「是」输入 1–2 汉字。
  4. 确认时发**单命令** `resolveConsortAftermath({ aftermathId, posthumousRankId?, posthumousEpithet? })`，
     原子写 `deathRecord.posthumousRankId/posthumousEpithet`（不动生前数据）并置 `aftermath.resolved`。
  - 叙事行如「感念与侍君的情谊，追封顾贵人为颖承徽」（`颖`=谥号，与生前封号分离）。

### 6.4 皇嗣死亡（夭折）

- 标记夭折、`diedAt`，移出活人皇嗣列表；保留存档与亲缘。
- 身后事：纯叙事节拍（无追封/谥号）。

### 6.5 承养人孕期死亡规则

- 侍君**转胎后、生产前**死亡 → 该胎 `胎息断绝`（清除对应 gestation，无新皇嗣）。
- 侍君**已诞下皇嗣后**因生产扣血死亡 → **皇嗣存活**，仅母方亡故（走 §6.3）。
- 实现：死亡标记时检查其 `gestations`/`bloodline` 关系决定是否一并清胎。

## 7. 死亡事件队列（持久化、防重）

- 死亡检测**不直接弹 UI**，而是 push 一条 `pendingAftermath` 到存档：
  `{ id, kind: "taihou" | "consort" | "heir", subjectId, at, resolved: boolean }`。
  - **皇帝不入队**（队列 `kind` **不含 `sovereign`**）；皇帝死亡由 `resolveHealthChange` 的
    `sovereignDied` 标记，settle 后直接 game-over（§6.1）。这消除 §6.1/§7 的矛盾。
  - `id` 稳定：`death:{kind}:{subjectId}:{deathDayIndex}`，**幂等去重**（同人同次死亡只入一条；
    读档/重复 settle 不重复入队）。
- **同月多人死亡处理优先级**（不可依赖对象遍历顺序）：
  1. **皇帝死亡 → 立即终止**（game-over，跳过其余 aftermath）；
  2. 太后；3. 侍君（按 `subjectId` 字典序稳定排序）；4. 皇嗣（按 `subjectId` 稳定排序）。
- settle 后取首个 `resolved === false` 的 aftermath 弹对应 UI；玩家完成时发**单条原子命令**
  写入副作用并置 `resolved = true`。一个 resolved 后再弹下一个（逐个处理）。
- **副作用幂等**：太后葬仪扣银/服丧/慈宁宫关闭在**死亡事务**时已执行（§6.2，非 resolve 时）；
  追封等 UI 副作用只在 aftermath **首次 resolve 时执行一次**。`resolved` + 稳定 `id`
  保证读档不重复扣银/重复追封。

## 8. 重病 / 服丧 gating（Phase 3 + Phase 4）

- **皇帝重病**（`sovereign.healthStatus === "critical"`）：禁止上朝、禁止翻牌子/侍寝，
  按钮禁用并给出说明（如「陛下凤体违和，太医请陛下静养」）。
- **太后服丧**：自太后死亡当日起，**连续 3 个行动日**禁止上朝、禁止侍寝，**死亡当日计为第 1 日**。
  字段用 `mourningUntilDayExclusive = deathDayIndex + 3`（独占上界），
  服丧条件 `taihou.deceased && currentDayIndex < mourningUntilDayExclusive`。
  *（月初 tick 致死时，上/中/下旬正好禁满一个月。）*
- 两种 gating **可叠加**：任一成立即禁止；说明文案按当前主因显示。
- gating 校验集中为纯函数（如 `canHoldCourt(state)` / `canBedchamber(state)`），UI 与
  入口逻辑共用，便于单测叠加场景。

## 9. 面板状态显示（Phase 1）

- 凡显示角色面板处都加**健康状态** chip（健康/生病/重病 + 数值 health）；完整清单：
  - 皇帝面板；
  - **太后 / 慈宁宫角色面板**（勿遗漏太后）；
  - 侍君详情与列表（`CharacterCard` / `ConsortListModal`）；
  - 皇嗣详情与列表；
  - **太医看诊选择器**（侍君/皇嗣 picker 中显示健康状态，便于选人）。
- **孕情** chip：沿用现有怀孕状态，**与健康状态分成两个独立显示**。
- Phase 1 仅显示，不启用 tick。

## 10. 奉先殿·已故侍君（Phase 4）

- `FengxiandianScreen` 增「已故侍君」按钮 → 列出 `lifecycle==="deceased"` 的侍君：
  - 显示生前位分/封号、追封位分/谥号（`deathRecord`）、抚养皇嗣。
  - 选一人**缅怀**：**消耗 1 行动点**，播一段叙事台词。
- **缅怀只写结构化记录，不写自由文本 memory**（避免重复缅怀污染三层记忆系统）：
  在该侍君 `deathRecord` 旁记 `lastMemorializedAt` / `memorialCount`。
  *（是否将缅怀接入记忆检索系统，留作后续显式需求，本期不做。）*

## 11. 分期实现

- **Phase 1 — 数据结构、migration 和 UI（不启用 tick）**
  新增 `HealthStatus`/`DeathCause`、各角色 health/status/`deathRecord` 字段、侍君 `ageAtEntry`/`enteredAtYear`、
  world `sovereign.startingAge`、太后死亡/服丧字段、`healthRoll`、`aging`、`resolveHealthChange` 与
  funnel 新效果（仅落地、暂不被调用）；面板双状态显示；`taiyi.ts` 与 manifest 可一并就位。
  **此阶段任何角色都不会掉血或死亡。**
- **Phase 2 — 统一健康 tick、基础死亡与事件队列**
  月度 `projectMonthlyHealth` + `resolveHealthChange` tick（衰老/onset/病损/迁移/暴毙）、
  health≤0 与暴毙的死亡标记 + `pendingAftermath` 队列 + 优先级、皇帝 game-over、孕期死亡断胎/存嗣。
  **避免出现 health=0 但角色仍存活的中间版本。**
  - **不得用「会永久 resolved 的假占位 UI」**：非皇帝身后事 UI 用 **feature flag** 关闭（死亡正常标记入队、
    机械后果照常，但 aftermath **保持 `resolved=false` 不被假处理**）；该分支在 Phase 4 完成前
    **不作为可长期游玩版本发布**。或将各身后事的**最小真实处理**提前到本阶段（Phase 4 只完善表现层与奉先殿）。
- **Phase 3 — 太医、怀孕成本、重病 gating**
  四类看诊（每月每人一次、各 1 AP、加血+治病、经 `resolveHealthChange`）、怀孕健康成本、皇帝重病 gating。
- **Phase 4 — 太后葬仪、侍君追封、奉先殿**
  太后服丧/谥号/慈宁宫关闭/葬仪扣银（机械后果其实在 §6.2 死亡事务已落地，本阶段补**谥号输入 UI**）、
  侍君追封位分+谥号+承养人（已故）原子提交、奉先殿缅怀、皇嗣夭折叙事；开启非皇帝身后事 UI 的 feature flag。

## 12. 测试要点

纯逻辑优先单测（`healthRoll`、`aging`、tick、看诊、怀孕成本、追封候选、funnel 效果）。
self-review 与测试**重点覆盖**：

- **tick 幂等性**：同月多次 rollover / 读档重入，状态只变一次。
- **多人同月死亡**：aftermath 队列逐个处理，互不串扰、不丢失。
- **读档不重掷**：同 seedKey 重算结果一致；身后事 `resolved` 防重复扣银/追封。
- **皇后无法追封**：最高位分边界跳过追封分支。
- **承养人孕期死亡**：转胎后未产→断胎；已产→皇嗣存活。
- **服丧 / 重病 gating 叠加**：两者同时成立时上朝/侍寝均被禁止。
- 年化→月度概率换算正确（不出现全宫长期生病）。
- 互斥迁移：重病概率不被痊愈判定减半；刚生病当月不扣病损/不恶化。

补充用例（即时死亡不变量 / 边界 / 幂等）：

```text
- 转胎扣血到0，侍君立即死亡，不等待下月 tick
- 生产扣血到0，皇嗣已出生并存活，侍君进入身后事队列
- 任意剧情 healthDelta 致 0 血时，同样触发即时死亡不变量
- 新游戏第一年一月初始化时不执行衰老扣血
- 皇嗣年龄由出生日期计算，不使用游戏总年份
- 太后死亡当日到 mourningUntilDayExclusive 边界恰好禁止 3 个行动日（含当日）
- 太后葬仪在反复读档、重复 settle 后只扣一次 10000 两
- 侍君身后事中途退出/读档，不产生半追封状态（追封仅最终原子提交）
- 皇帝与其他角色同月死亡时，皇帝 game-over 优先，其余不再展示身后事
- 同月多个侍君死亡时，aftermath 队列按 subjectId 稳定排序，顺序确定
- healthy 且 health 很低、critical 且 health 很高的状态不被自动纠正
- 已故角色不出现在太医选择器、侍寝、互动与活人列表中
```

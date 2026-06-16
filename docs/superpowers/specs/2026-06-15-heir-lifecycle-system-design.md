# 承嗣 / 生产 / 子嗣系统（孕育生命周期）— 设计规格

**日期：** 2026-06-15
**状态：** 已通过设计评审，待写实现计划
**前置：** [`2026-06-15-bedchamber-and-pregnancy-system-design.md`](./2026-06-15-bedchamber-and-pregnancy-system-design.md)（侍寝 + 受孕到「pending」已实现）
**世界观权威：** [`world/30-bloodline-pregnancy.md`](../../world/30-bloodline-pregnancy.md)（承养制）·
[`world/40-imperial-family.md`](../../world/40-imperial-family.md)（皇子=女 / 皇郎=男 / 皇嗣=合称）·
[`systems/60-pregnancy-and-heir-system.md`](../../systems/60-pregnancy-and-heir-system.md)

---

## 0. 目标与范围

把上一期「激情受孕 → pending → 次月选生父 → 怀胎」这条简单链路，**替换/扩展**为完整的**承嗣制生命周期**：

1. 孕二月敬事房上书 → 选定**候选承嗣**（打标签，不转嗣）。
2. 孕三月起宗正寺上书 → **传嗣**给某侍君（承嗣君怀胎，帝王转健康）或继续**自孕**。
3. 御书房**召见太医** → 自孕期可**流胎**（红色二次确认）。
4. 自孕者孕四–九月可御书房**召见宗正寺**主动传嗣（越晚难产几率越高）。
5. 孕十月**生产**：自孕帝王不难产；承嗣君按几率难产（四种结局）。
6. **子嗣**落地、命名、嫡庶、宠爱；御书房**子嗣列表**（皇子/皇郎两表）。
7. 安产后凤后道贺 + 询问**晋升**立功侍君（育嗣君）。

**术语：** 全程用「承嗣 / 承嗣君（怀胎中）/ 育嗣君（安产后）」，**不用「血养」**。

**非范围（YAGNI）：** 子嗣成年/婚配/继承顺位；东宫；多胎并行（**单线孕育**，见 §3.6）；自动随时间增减子嗣宠爱（仅手动调整 + 出生初值）。

---

## 1. 孕月数锚点

`孕月数(now) = monthOrdinal(now) − monthOrdinal(conceivedAt) + 1`

- 受孕当月（激情侍寝）= **孕一月**（玩家未知）。
- 次月敬事房上书 = **孕二月**（检出、打候选承嗣标签）。
- 再次月 = **孕三月**（`transferEarliestMonth`）→ 起可传嗣（宗正寺上书）。
- **孕十月**（= 受孕月 + 9）→ 临盆。

`monthOrdinal` 已存在（period-agnostic）。

---

## 2. 状态模型（types.ts / save schema）

```ts
// 帝王孕育（bloodline.pregnancy）—— status 取代旧 "expecting"
type PregnancyStatus = "none" | "pending" | "carrying";
// none=未孕/已传嗣后(健康); pending=已受孕未告知; carrying=帝王自孕中
interface PregnancyState {
  status: PregnancyStatus;
  conceivedAt?: GameTime;
  candidateIds: string[];   // 候选承嗣（孕二月打标签；可为空）
}

// 当前唯一在孕的胎息（帝王或某承嗣君承载）
interface GestationState {
  carrier: "sovereign" | string;   // "sovereign" 或 侍君 charId
  conceivedAt: GameTime;
  fatherId?: string;               // 承嗣君 charId；自孕则无
  transferredAtMonth?: number;     // 传嗣时孕月（驱动难产几率）；自孕则无
}
GameState.resources.bloodline.pregnancy: PregnancyState      // 已存在，扩展
GameState.resources.bloodline.gestation?: GestationState     // 新增（单线，至多一个）
GameState.resources.bloodline.heirs: Heir[]                  // 启用现有保留字段

// 侍君生命周期标记（standing 上新增，或独立 map）—— 见 §5.1
type ConsortLifecycle = "normal" | "candidate" | "carrying" | "delivered" | "deceased";
// candidate=候选承嗣; carrying=承嗣君怀胎; delivered=育嗣君; deceased=难产亡
```

落地子嗣：
```ts
interface Heir {
  id: string;                       // "heir_000001" 单调
  sex: "daughter" | "son";          // daughter→皇子(女) / son→皇郎(男)
  fatherId: string | null;          // 承嗣君 charId；null=自孕
  bearer: "sovereign" | string;     // 谁承载生产（自孕="sovereign"）
  birthAt: GameTime;
  favor: number;                    // 宠爱度 0–100
  legitimate: boolean;              // 嫡
}
```
全部进 `stateSchema.ts`，随存档走。`pending` 期间 `gestation` 仍为空（受孕未公开）；敬事房处理后才进入 `carrying`/传嗣。

> 实现细节：帝王自孕（孕二月玩家未传嗣）时设 `status:"carrying"` 且 `gestation={carrier:"sovereign", conceivedAt}`。传嗣时 `status:"none"`、`gestation.carrier=侍君`。流胎/生产后清 `gestation` 并按结局处理。

---

## 3. 生命周期状态机

### 3.1 孕二月 · 敬事房上书（取代旧 PregnancyModal）
触发：`pregnancy.status==="pending" && 孕月数≥2`（= `monthOrdinal(now) > monthOrdinal(conceivedAt)`，与现有拦截一致）。
- 文案：敬事房主管上书，列出**受孕当月激情侍君**为「可能生父」（如「可能为沈承徽或凤后」）。问「是否即刻选定候选承嗣者？」
- **选定候选承嗣** → 打开**全体在世侍君**多选列表 → 选中者 `lifecycle:"candidate"` + 谢恩；`pregnancy.status:"carrying"`、建 `gestation{carrier:"sovereign"}`。
- **暂不 / 自孕** → 仅 `status:"carrying"` + `gestation{carrier:"sovereign"}`，不打标签。
- **孕三月前不能传嗣。**

### 3.2 孕三月 · 宗正寺上书
触发：`status==="carrying" && gestation.carrier==="sovereign" && 孕月数===3`。
- 建议尽早择嗣；若**凤后尚无子嗣**（heirs 无 bearer===凤后 的项）追加「是否优先凤后承嗣以生嫡子」。
- 打开在世侍君列表（高亮 `candidate`）→
  - **传嗣** → `pregnancy_transfer{carrierId, atMonth:3}`：帝王 `status:"none"`、`gestation.carrier=侍君`、`gestation.fatherId=侍君`、该侍君 `lifecycle:"carrying"`；谢恩。
  - **自孕** → 不变（继续自孕）。

### 3.3 孕四–九月 · 御书房召见宗正寺（自孕者主动传嗣）
御书房按钮「召见宗正寺」，仅当 `status==="carrying" && carrier==="sovereign" && 4≤孕月数≤9` 可见。选承嗣者 → `pregnancy_transfer{carrierId, atMonth:当前孕月}`。**孕月越大，难产几率越高。**

### 3.4 御书房召见太医（流胎）
御书房按钮「召见太医」（0 行动点咨询）：
- 帝王无孕：院正「陛下有何吩咐」（无操作）。
- 帝王自孕中（`carrier==="sovereign"`）：红色「流胎」→ 院正二次确认「皇嗣是国家大事，可有不妥？」→ 取消 / 执意 → `pregnancy_abort`（清 pregnancy+gestation）。
- **已传嗣给承嗣君后不可流胎**（承养不可弃 · 国法 · canon）。

### 3.5 生产（孕十月）
当 `gestation` 存在且 `孕月数(now)===10`：当月一个**确定性随机行动点** slot = `hash(seed, monthOrdinal(now)) % apMax`；玩家行动到该 slot（或更晚）时触发一次 `birth`。**兜底**：若孕月数已 >10（玩家未在十月触发）则在下次任意行动立即补触发，绝不漏。
- **自孕（carrier==="sovereign"）**：帝王不难产 → 安产；`fatherId=null`；嫡。
- **承嗣君**：难产判定（§8 公式，确定性）→ 安产 / 子嗣夭折 / 承嗣君亡 / 一尸两命。

### 3.6 单线孕育
任一胎息在孕期间（`pregnancy.status!=="none"` 或存在任一 `carrying` 侍君），`buildBedchamber` 的激情**不再触发受孕**（受孕条件追加「无在孕胎息」）。一次只跟一条生命周期。

---

## 4. 承嗣君侍寝限制（陪伴 mode）

新增 `BedchamberMode` 第三值 **`companionship`（陪伴）**。
- **普通在世侍君**：激情 / 享受（不变）。
- **承嗣君（lifecycle==="carrying"）**：**激情不可选**，仅 **享受 / 陪伴**；两者都计入侍寝次数（受宠频率），都不受孕。
- **deceased 侍君**：不可侍寝（从入口排除）。
- 育嗣君（delivered）/ candidate：按普通侍君（candidate 仍可激情；受孕已被 §3.6 单线封住）。

`bedchamberScript` 增 `companionship` 台词；`conception` 仅 `passion` 调用且受 §3.6 约束。

---

## 5. 子嗣模型 + 列表

### 5.1 侍君生命周期标记落点
在 `CharacterStanding` 增 `lifecycle?: ConsortLifecycle`（缺省视作 `"normal"`），随存档走、经漏斗效果迁移。卡片/名册/翻牌子/管理据此渲染与过滤（deceased 全程排除；carrying 显示「承嗣君·怀胎」；delivered 显示「育嗣君」；candidate 显示「候选承嗣」）。

### 5.2 命名 / 嫡 / 宠爱
- 两表：**皇子**（`sex==="daughter"`）/ **皇郎**（`sex==="son"`）。各表按出生序命名：1→**大**、2→**二**、3→**三**…（`大皇子/二皇子…`、`大皇郎/二皇郎…`；序号 `1→大`，`≥2→chineseNumeral`）。
- **性别** 出生时确定性随机：`hash(seed, birth monthOrdinal, heirSeq) % 2`。
- **嫡（legitimate）** = `bearer===凤后` 或 `bearer==="sovereign"`（自孕）。
- **宠爱初值**：
  - 自孕：**100**（固定）。
  - 侍君承嗣：`base = clamp(round(生父数值 favor ÷ 2), 0, 50)`（读 `standing[fatherId].favor` 0–100 → 0–50）；若 `bearer===凤后` 再 `+30`（即凤后封顶 80）。
  - *数值 favor 仍在状态内（卡面已用受宠程度取代展示）。*
- **调整机制**：子嗣列表内每项提供 ± 调整 → 漏斗效果 `child_favor{heirId, delta}`（钳 0–100，单次 ±10 上限同其他效果）。

### 5.3 列表（御书房·子嗣按钮）
打开 `HeirListModal`：两表分列，每项显示 **承嗣者**（`fatherId` 的称呼 / 「自孕」/ 已故侍君标注）、**当前年龄**（`now.year − birthAt.year`，元年出生记 0 岁）、**生日**（`formatGameTime(birthAt)`）、**宠爱度** + ± 调整、嫡标记。

---

## 6. 产后晋升 / 死亡

生产裁决后：
- **非凤后侍君安产**：凤后前来道贺「恭喜陛下喜得凤儿（皇子）/ 皇郎」+「是否晋升立功侍君（育嗣君）？」→ 复用位分选择器；侍君 `lifecycle:"delivered"`。
- **凤后承嗣安产 / 自孕安产**：仅道贺通知，不弹晋升（凤后不可调位分；自孕无侍君）。
- **凶讯**（子嗣夭折 / 承嗣君亡 / 一尸两命）：宗正寺/太医禀报结局通知；承嗣君亡/一尸两命 → 该侍君 `lifecycle:"deceased"`。
- 安产但 `子嗣夭折` 例外：无子嗣落地，侍君回 `lifecycle:"normal"`（健康）。

---

## 7. effects（走漏斗 — 唯一变更路径）

`eventEffectSchema` 新增（funnel 校验 + 应用 + 进 save schema）：
- `heir_designate { charIds: idSchema[] (1–N) }` — 给在世侍君打 `candidate` 标签；设 `pregnancy.candidateIds`。
- `pregnancy_transfer { carrierId, atMonth }` — 帝王 `status:"none"`；`gestation.carrier=carrierId, fatherId=carrierId, transferredAtMonth=atMonth`；侍君 `lifecycle:"carrying"`。校验：carrier 是在世侍君、当前 `status==="carrying" && carrier==="sovereign"`。
- `pregnancy_abort` — 清 `pregnancy`（none）+ `gestation`。校验：`carrier==="sovereign"`。
- `birth { sex, fatherId, bearer, legitimate, favor, bearerOutcome }` — 由生产裁决（纯函数）算好后提交：按 `bearerOutcome`（"safe"|"child_dies"|"bearer_dies"|"both"）落地/不落地 `Heir`、迁移承载侍君 lifecycle（delivered/normal/deceased）、清 `gestation`。
- `child_favor { heirId, delta }` — 调子嗣宠爱（钳 0–100）。

裁决（难产几率、结局、性别、宠爱初值）是**纯函数**（`engine/characters/birth.ts`），确定性随机；funnel 只做结构性落账。

---

## 8. 配置（world.json.gestation）+ 确定性随机

```json
"gestation": {
  "termMonths": 10,
  "transferEarliestMonth": 3,
  "dystocia": { "baseAtMonth3": 5, "perMonthAfter": 8,
                "outcomeSplit": { "childDies": 50, "bearerDies": 30, "both": 20 } },
  "childFavor": { "selfPregnancy": 100, "fenghouBonus": 30 }
}
```
- 难产几率 = `baseAtMonth3 + max(0, transferredAtMonth − 3) * perMonthAfter`（钳 0–100）。自孕不判定。
- 结局：命中难产后按 `outcomeSplit` 占比（确定性 hash 取一）；未命中=安产。
- 生产 slot、性别、难产判定均经 `fnv1a64Hex` 哈希（输入含 rngSeed + monthOrdinal/dayIndex + 标识），存档/重放稳定。缺省走引擎内置 fallback。

---

## 9. 文件结构（新增/改动）

**引擎纯逻辑（新建）**
- `src/engine/characters/gestation.ts` — `gestationMonth(now, conceivedAt)`、`dystociaChance(atMonth, cfg)`、生产 slot。
- `src/engine/characters/birth.ts` — 生产裁决（结局/性别/宠爱初值，纯函数）。
- `src/engine/characters/heirs.ts` — 命名（大/二/三 + 皇子/皇郎）、嫡判定、列表派生。

**引擎改动**
- `state/types.ts`（PregnancyState 扩展、GestationState、Heir、ConsortLifecycle、standing.lifecycle）
- `content/schemas.ts`（5 个新 effect + `companionship` mode + `world.gestation`）
- `effects/funnel.ts`（校验 + 应用 5 个新 effect）
- `save/stateSchema.ts`（gestation / heirs / lifecycle / pregnancy 扩展）
- `state/newGame.ts` `initialState.ts`（`candidateIds:[]`、`heirs:[]`、lifecycle 缺省）

**store**
- `store/bedchamber.ts`（承嗣君限制激情、陪伴 mode、§3.6 单线受孕）
- `store/gestation.ts`（新建：组装传嗣/流胎/生产裁决→effects + 反应台词，供 App 编排）

**内容**
- `content/world.json`（`gestation` 配置 + `bedchamberScript.companionship`）

**UI（新建/改动）**
- 改 `PregnancyModal`（敬事房·候选承嗣多选）、`BedchamberModal`（承嗣君时激情禁用 + 陪伴）、`CharacterCard`/`LocationScreen`/`BedchamberPicker`（lifecycle 标签 + deceased 排除 + 御书房「召见太医」「召见宗正寺」「子嗣」按钮 + 怀胎徽标随 carrier）
- 新建 `SuccessorModal`（宗正寺·传嗣，高亮候选）、`PhysicianModal`（太医·流胎红色二次确认）、`BirthScreen`（生产结局播报）、`HeirListModal`（子嗣两表 + 宠爱 ± 调整）
- `App.tsx`（编排：孕二月敬事房、孕三月宗正寺、孕十月生产拦截、产后晋升/凶讯、御书房三按钮接线）

---

## 10. 测试（TDD 纯逻辑优先）

- `gestation`：孕月数锚点（受孕月=1，检出=2，传嗣=3，临盆=10）；难产几率曲线（孕三月 5%、孕九月上限）；生产 slot 确定性。
- `birth`：结局占比分配确定性；性别确定性；宠爱初值（自孕 100 / 侍君 favor÷2 钳 0–50 / 凤后 +30）；嫡判定（凤后 or 自孕）。
- `heirs`：命名（大/二/三 + 皇子/皇郎、跨表独立序）；年龄；列表派生。
- 漏斗 5 新效果：校验（target 在世侍君、status 前置条件、deceased 拒绝）+ 原子性 + 状态机迁移（candidate→carrying→delivered/deceased）。
- `bedchamber`：承嗣君仅享受/陪伴；陪伴计数不受孕；单线孕育封受孕。
- 存档往返：gestation/heirs/lifecycle/candidateIds 持久化。
- UI 走现有 Playwright smoke（不强制新增）。

---

## 11. 统一 DoD

typecheck → lint → test → validate-content → validate-manifest → build 全绿；main 始终可启动；新内容过 `validate-content`。

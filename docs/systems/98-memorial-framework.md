# 奏折与前朝事件框架（Phase 4A · 第一刀）— 规格与测试计划

**状态：Implemented（disaster 切片）。** 通用 Memorial 模型 + **地方灾情**奏折已落地（引擎 `engine/court/memorials.ts`、
store 命令、年度生产 seam、schema/迁移 v18→v19、validator、紫宸殿 UI、测试）。其余类别（treasury/military/justice）
为框架占位（枚举存在，无 payload 变体、不生成）。本刀**不**做完整 Phase 4，不加入大量剧情模板。

> **与人事奏折的边界（本切片）**：人事奏折仍由 **PR3C-3b** 的 `personnelDecisions` 在其自有紫宸殿界面承载，
> **未**并入本框架（避免改动已上线的 PR3C-3b UI）。`MemorialPayload` 本切片只含 `disaster` 变体；personnel 委托
> （memorial 包壳 → `resolvePersonnelDecision`）与统一列表留作后续。所有职位变更仍只经 PR3C-3b 的正式 API。
>
> **treasury 成本**：`resources.nation.treasury` 不在 effect funnel 可寻址字段内，故本切片灾情后果只用 funnel 可寻址的
> nation/sovereign 字段表达取舍，未实现 treasury 成本前置（留作后续，需经专门 treasury 通道）。

## 一、目标与边界

通用「奏折」（memorial）是皇帝在紫宸殿批阅的**前朝事务待裁项**。第一刀范围：

1. 通用 memorial 领域模型（category 判别）。
2. 五类 category：`personnel` / `treasury` / `disaster` / `military` / `justice`。
3. pending/resolved 生命周期（可存档、resolved 不可再执行）。
4. 确定性生成 seam（无概率系统；测试可显式构造）。
5. 紫宸殿「奏折」列表入口（复用 PR3C-3b 的人事入口模式）。
6. **一个**非人事模板：`disaster`（地方灾情）。
7. 选择后经**正式 effect funnel**（`applyEffects`）改国家属性（`resources.nation` / `sovereign`）。
8. schema / migration / validator / tests。

**不在第一刀**：treasury/military/justice 的具体模板与后果（仅占位 category + 框架）、概率/节流系统、
多模板剧情库、与 PR3C-3b 同一 PR 混合提交。

## 二、领域模型

新增 `GameState.memorials: Record<string, Memorial>`（与 `personnelDecisions` 平行；不并入，避免回归 PR3C-3b）。

```ts
export type MemorialCategory = "personnel" | "treasury" | "disaster" | "military" | "justice";

export interface Memorial {
  id: string;                 // "mem_000001" 单调，与 record key 一致；永不删除
  category: MemorialCategory;
  status: "pending" | "resolved";
  createdAt: GameTime;
  sourceId: string;           // 去重键（同源不重复）
  title: string;              // 列表显示标题（短）
  summary: string;            // 卡片正文（叙述）
  /** 各 category 的结构化载荷（判别联合）。 */
  payload: MemorialPayload;
  resolvedAt?: GameTime;
  resolution?: string;        // 选定的 optionId（须属 payload 合法集合）
}
```

`MemorialPayload` 判别联合（第一刀只实地实现 `personnel` 委托与 `disaster`，其余 category 仅占位 schema）：

```ts
type MemorialPayload =
  | { category: "personnel"; decisionId: string }                 // 委托 personnelDecisions
  | { category: "disaster"; regionId: string; severity: "minor" | "major";
      options: DisasterOption[] }                                  // 见 §五
  | { category: "treasury" | "military" | "justice"; options: [] }; // 占位（第一刀不生成）
```

不变量（validator）：
- record key = id；id 唯一；sourceId 全局唯一。
- pending：无 `resolvedAt` / `resolution`；resolved：二者皆有，且 `resolution ∈ payload 合法 optionId`，
  `resolvedAt ≥ createdAt`。
- `personnel` payload 的 `decisionId` 必指向真实 `personnelDecisions` 条目；该条目 resolved 时本 memorial 亦须 resolved（一致性）。
- `disaster` payload 的 `regionId` 必为已知地域；`options` 非空且 optionId 唯一。

## 三、ID 与去重

- `memorialId(seq)` → `mem_` + 6 位；`seq = Object.keys(memorials).length + 1`（永不删除，无冲突）。
- `sourceId` 约定：`disaster:{regionId}:{year}`、`personnel:{decisionId}`、`{category}:{key}:{year}`。
- 生成器创建前查 `sourceId` 去重（pending 或 resolved 均算已存在）。

## 四、生成 seam（确定性）

`engine/court/memorials.ts`（拟）：

- `generateDisasterMemorial(state, db, regionId, severity, at)`：资格（该地域当年无同源、灾情未决）→
  构造确定性 `DisasterOption[]` → append pending memorial。
- `generatePersonnelMemorial(state, personnelDecisionId, at)`：把一条 `personnelDecisions` 包成 personnel 类
  memorial（使其出现在统一奏折列表中）。**职位变更仍由 `resolvePersonnelDecision` 执行**，本 memorial 仅作壳。
- 触发：第一刀提供显式生成 helper（测试构造）；与玩法的接线（如年度/季度灾情）留**最小** seam，
  挂在既有统一日历结算入口（`settleCalendarAdvance`），不引入新概率系统。

## 五、disaster 模板与后果（经 effect funnel）

`DisasterOption`：

```ts
interface DisasterOption {
  id: string;                 // "relief" | "tax_remit" | "ignore"
  label: string;
  /** 选定后经 applyEffects 施加的国家/皇帝属性 effects（resource effects）。 */
  effects: EventEffect[];     // 仅 { type:"resource", pillar, field, delta }
  /** AP 或国库前置（可选）；不足则 UI 禁用并说明。 */
  cost?: { treasury?: number };
}
```

示例（数值待平衡）：
- `relief` 开仓赈济：`treasury −N`、`publicSupport +a`、`productivity +b`；需国库 ≥ N。
- `tax_remit` 蠲免赋税：`treasury −M`（少）、`publicSupport +c`、`clanDiscontent −d`。
- `ignore` 不予理会：`publicSupport −e`、`rumor +f`、`regimeSecurity −g`。

**所有属性变更只经 `applyEffects`**（resource effect 漏斗，含 AXIS_CAP）；绝不直接写 `resources.*`。
Static knowledge（RAG）只可辅助叙述文本，不得覆盖 runtime state 或授予 structured claim。

## 六、原子裁断

`resolveMemorial(state, db, memorialId, optionId, at)`：

```
验证 pending → 验证 optionId 合法 → 按 category 执行：
  personnel → 委托 resolvePersonnelDecision（用映射后的 resolution）
  disaster  → applyEffects(option.effects)（含 cost 前置校验）
→ 标记 memorial resolved → 返回新 state（+ 可选 punishmentId 透传）
```

任一步失败即 `err`，输入 state 完全不变（不施后果、不标 resolved）。绝不先 resolve 再执行后果。
personnel 委托失败（如席位被占）整体回滚，memorial 保持 pending。

## 七、store / UI

- `store.resolveMemorial(db, memorialId, optionId)`：成功一次 emit，失败不 emit；autosave 在 UI（`onCommitted`）。
- 紫宸殿「奏折」入口（与 PR3C-3b「人事奏折 · N」并列或合并为统一列表，badge = 待裁 memorial 数）。
- `MemorialsScreen`（presentation-only）：列出待裁 memorial，卡片展示 category 标签、标题、正文、选项；
  选项含 cost 不足/disabled 原因；personnel 类卡片复用人事决策卡渲染。移动端 390px 单列、长文换行、按钮 40px。

## 八、schema / migration / validator

- Zod `memorialSchema` + `gameStateSchema.memorials`。
- `SAVE_FORMAT_VERSION` 读取当前值后 **+1**（届时以仓库实际为准，勿假定具体数字）；新增 `MIGRATIONS[n]`
  回填空 `memorials`（不破坏旧档）。
- `validateMemorials(state, db)`：§二不变量全集；并入 world/load 校验入口（任一 error → quarantine）。

## 九、测试计划（TDD）

### Engine
- 生成：disaster 资格/确定性 option/sourceId 去重；personnel 包壳指向真实 decision；无效地域不生成。
- 裁断：disaster relief/tax_remit/ignore 各自国家属性按 effect 变化（且只经 funnel，cap 生效）；cost 不足拒绝且 state 不变；
  personnel 委托成功/失败原子；resolved 不可再裁；save/load 后仍可裁 pending。
- 一致性：personnel memorial 与其 decision 状态联动。

### Store
- resolveMemorial 成功一次 emit / 失败不 emit；punishmentId 透传（personnel 降免）；round-trip。

### Validator corruption
- key≠id、dup sourceId、bad decisionId、bad regionId、空 options、pending 带 resolution、resolved 缺字段、
  非法 optionId、resolvedAt<createdAt、personnel 一致性破坏。

### UI
- disaster 卡渲染与三选项；cost 不足 disabled + 原因；裁断成功关闭 + onCommitted；personnel 卡复用；
  移动端 viewport；无自由任免/直接改属性入口回归。

### 全局回归
- PR3C-3b 人事决策不受影响；effect funnel 资源 cap；save migration chain；dialogue/claim gates；E2E。

## 十、提交边界

- PR3C-3b（#59）已合入 `main`，本规格分支 base = `main`。实现分两步推进：先本规格（spec only），
  再按 §九 测试计划落实现。
- 与 PR3C-3b **不**混在同一 PR。完整验证（typecheck/lint/test/validate-content/validate-manifest/
  knowledge:validate/build/test:e2e）全绿后转 ready。

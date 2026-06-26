# 财政奏折与国库台账（Phase 4B）— 规格文档

**状态：Implemented（Phase 4B）。** 国库台账领域层 + 财政奏折模板 + 灾情国库成本 + 年度生成 seam + 存档迁移 v20→v21 + UI 可购性。

> 通用奏折框架（Memorial 模型、生命周期、紫宸殿 UI 骨架）见 [98-memorial-framework.md](./98-memorial-framework.md)。

---

## 一、设计原则 — 为什么不走 applyEffects 通道

`resources.nation.treasury` 是原始银两数（当前范围 0 – Number.MAX_SAFE_INTEGER），**不是** 0–100 轴属性。

`applyEffects` 的 resource funnel 包含 `AXIS_CAP = 10`，对所有字段做 clamp(0, 100)。若国库走此通道，一次 +600 两会被截为 0–100 范围内的极值，完全摧毁国库单位语义。

因此：国库变动**必须**经独立通道 `applyTreasuryTransaction`，绝不经 `applyEffects`。其他 nation/sovereign 字段（民心、腐败等 0–100 轴属性）仍正常走 `applyEffects` funnel。

---

## 二、TreasuryLedgerEntry 结构

```ts
/** 国库流水台账条目。每次奏折批阅产生一条（delta 非零），原子写入，append-only。 */
export interface TreasuryLedgerEntry {
  /** "tre_000001" 格式序列号，全局唯一。 */
  id: string;
  /** 事务发生的游戏时间。 */
  at: GameTime;
  /** 非零安全整数；负数 = 支出，正数 = 收入。 */
  delta: number;
  /** 事务前国库余额（非负安全整数）。 */
  balanceBefore: number;
  /** 事务后国库余额（= balanceBefore + delta，非负安全整数）。 */
  balanceAfter: number;
  /** 来源奏折 + 选项引用（目前仅 "memorial" 类型）。 */
  source: {
    kind: "memorial";
    memorialId: string;  // 指向 GameState.memorials 中的已批奏折
    optionId: string;    // 该奏折的选定选项 id
  };
  /** 人读说明（选项 label），供审计展示。 */
  reason: string;
}
```

`GameState.treasuryLedger: TreasuryLedgerEntry[]` 是 append-only 数组，绝不原地修改或删除条目。

---

## 三、applyTreasuryTransaction API

**签名：**

```ts
function applyTreasuryTransaction(
  state: GameState,
  command: TreasuryTransactionCommand,
): Result<{ state: GameState; entry: TreasuryLedgerEntry }, GameError>
```

其中 `TreasuryTransactionCommand`：

```ts
interface TreasuryTransactionCommand {
  delta: number;
  at: GameTime;
  source: { kind: "memorial"; memorialId: string; optionId: string };
  reason: string;
}
```

**四步校验顺序（任一失败立即返回 err，输入 state 不变）：**

| 步骤 | 校验内容 | 错误码 |
|------|---------|--------|
| 1 | `delta` 为非零安全整数 | `TREASURY_BAD_DELTA` |
| 2 | `balanceBefore`（= `state.resources.nation.treasury`）为非负安全整数 | `TREASURY_INVALID_BALANCE` |
| 3 | `balanceAfter = balanceBefore + delta >= 0`（余额充足） | `TREASURY_INSUFFICIENT` |
| 4 | `balanceAfter` 为安全整数（防溢出） | `TREASURY_OVERFLOW` |

**纯函数语义：** 失败时输入 `state` 完全不变；成功时返回新 `state`（spread 构造，treasury 更新 + 台账条目追加），不触碰 store、不发事件、不操作 React。

**错误码汇总：**

- `TREASURY_BAD_DELTA` — delta 为零或非安全整数
- `TREASURY_INVALID_BALANCE` — 当前国库余额不合法（负数或非安全整数，说明 state 已损坏）
- `TREASURY_INSUFFICIENT` — 国库余额不足，无法完成支出
- `TREASURY_OVERFLOW` — 收入后超出安全整数上界

---

## 四、奏折批阅原子序列

`resolveMemorial(state, db, memorialId, optionId, at)` 执行以下原子序列：

1. **校验奏折存在且 pending** — 不存在返回 `MEMORIAL_NOT_FOUND`；已批返回 `MEMORIAL_ALREADY_RESOLVED`。
2. **找到选项** — `optionId` 不在 `payload.options` 中返回 `MEMORIAL_BAD_OPTION`。
3. **若 `option.treasuryDelta` 存在，调用 `applyTreasuryTransaction`** — 失败则整体返回错误（`TREASURY_INSUFFICIENT` 映射为 `MEMORIAL_TREASURY_INSUFFICIENT`），输入 state 不变。
4. **调用 `applyEffects`（effect funnel）** — 施加 `option.effects` 中的 nation/sovereign 属性变化；失败则步骤 3 的中间结果丢弃，输入 state 不变。
5. **标记奏折 resolved** — 写入 `resolvedAt`、`resolution`（= `optionId`）。
6. **返回最终 state** — 包含：treasury 更新、新台账条目、nation/sovereign 属性变化、memorial 状态标记。

绝不先标记 resolved 再执行后果；任一步失败则整体回滚（纯函数局部变量，输入 state 永不被变更）。

---

## 五、灾情成本常量

灾情奏折三选项均经 `MemorialOption.treasuryDelta` 携带国库消耗；批阅时由步骤 3 执行。

| 严重度 | 选项 | 国库变化 |
|--------|------|---------|
| minor | 开仓赈济（relief） | −400 |
| minor | 蠲免赋税（tax_remit） | −250 |
| minor | 不予理会（ignore） | — |
| major | 开仓赈济（relief） | −900 |
| major | 蠲免赋税（tax_remit） | −600 |
| major | 不予理会（ignore） | — |

其他国家属性影响（民心、宗室不满、生产力、谣言、皇权安全等）仍经 `applyEffects` funnel 按 AXIS_CAP clamp。

---

## 六、财政奏折模板（annual_revenue_plan）

财政奏折由户部年度岁入计划触发，payload 为 `TreasuryMemorialPayload`：

```ts
{ category: "treasury"; matter: "annual_revenue_plan"; urgency: "routine" | "urgent"; options: MemorialOption[] }
```

**紧急度阈值：** `state.resources.nation.treasury < 3000` → `urgent`；否则 → `routine`。

| 选项 | 例行收入 | 紧急收入 | 例行效果 | 紧急效果 |
|------|---------|---------|---------|---------|
| 清查侵耗（audit） | +600 | +1200 | 腐败 −5，治政 +2，部臣忠诚 −2 | 腐败 −6，治政 +2，部臣忠诚 −3 |
| 加征田赋（surtax） | +1000 | +1800 | 民心 −6，生产力 −3，谣言 +2 | 民心 −8，生产力 −4，谣言 +3 |
| 暂缓办理（defer） | — | — | 腐败 +2，治政 −2 | 同例行 |

- `audit` / `surtax` 的 `treasuryDelta` 为正数（收入），批阅时经 `applyTreasuryTransaction` 增加国库；`defer` 无国库变化。
- 国家属性变化均经 `applyEffects` funnel（含 AXIS_CAP clamp）。

---

## 七、年度生成契机

两类奏折均在年度 tick（`settleCalendarAdvance`）中通过 seam 函数幂等生成：

| 奏折类型 | 生成函数 | 触发月份 | 去重规则 |
|---------|---------|---------|---------|
| 灾情 | `maybeGenerateAnnualDisaster` | 每年 month = 1 | `sourceId = disaster:{regionId}:{year}` 已存在则跳过 |
| 财政 | `maybeGenerateAnnualTreasuryMemorial` | 每年 month = 4 | `sourceId = treasury:annual_revenue_plan:{year}` 已存在，或有任意 pending 财政奏折，则跳过 |

同一年内若已存在 pending 同类奏折，生成函数返回 `null`，state 不变（幂等）。

---

## 八、存档迁移（v20 → v21，财政奏折专属）

`MIGRATIONS[20]` 在加载旧档时执行以下回填（仅财政模块，不含军事奏折）：

1. **回填 `treasuryLedger: []`** — 若 `state.treasuryLedger` 不存在则补空数组（Zod schema `.default([])` 也会兜底，此处显式保证）。
2. **补全 pending 灾情奏折的 `treasuryDelta`** — 对所有 `status === "pending"` 且 `category === "disaster"` 的奏折，按严重度为 `relief` / `tax_remit` 选项写入 `treasuryDelta`（若字段已存在则不覆盖）。
3. **已批（resolved）奏折不补** — 不伪造历史账目；旧档已批灾情奏折的历史后果不可追溯，台账从空开始。
4. **`formatVersion` 写为 21**。

---

## 九、validateTreasuryLedger 不变式

`validateTreasuryLedger(state)` 返回所有发现的 `GameError[]`，供存档加载路径调用。共 17 项检查：

| 编号 | 检查内容 | 错误码 |
|------|---------|--------|
| 1 | 条目 id 符合 `tre_XXXXXX` 格式 | `TREASURY_LEDGER_DUP_ID` |
| 2 | 条目 id 全局唯一 | `TREASURY_LEDGER_DUP_ID` |
| 3 | `delta` 为非零安全整数 | `TREASURY_LEDGER_BAD_AMOUNT` |
| 4 | `balanceBefore` 与 `balanceAfter` 均为非负安全整数 | `TREASURY_LEDGER_BAD_BALANCE` |
| 5 | `balanceAfter === balanceBefore + delta`（等式成立） | `TREASURY_LEDGER_BAD_BALANCE` |
| 6 | 相邻链接：`prev.balanceAfter === cur.balanceBefore` | `TREASURY_LEDGER_CHAIN_BROKEN` |
| 7 | `at` 时间戳非递减（不允许倒序） | `TREASURY_LEDGER_CHAIN_BROKEN` |
| 8 | `source.memorialId` 指向 `state.memorials` 中真实条目 | `TREASURY_LEDGER_BAD_SOURCE` |
| 9 | `source.optionId` 属于该奏折的 `payload.options` | `TREASURY_LEDGER_BAD_SOURCE` |
| 10 | 来源奏折 `status === "resolved"`（台账仅在批阅后生成） | `TREASURY_LEDGER_SOURCE_PENDING` |
| 11 | `memorial.resolution === source.optionId`（台账与裁断一致） | `TREASURY_LEDGER_OPTION_MISMATCH` |
| 12 | 若 `option.treasuryDelta` 存在，则与台账 `delta` 相等 | `TREASURY_LEDGER_OPTION_MISMATCH` |
| 13 | 每条奏折至多产生一条台账（无重复来源） | `TREASURY_LEDGER_DUP_SOURCE` |
| 14 | （check 14 保留 — 与 check 6/7 区段合并编号，无独立 check） | — |
| 15 | 台账末条目 `balanceAfter` 与 `state.resources.nation.treasury` 相等 | `TREASURY_LEDGER_CURRENT_MISMATCH` |
| 16 | 已批奏折中，选定选项有 `treasuryDelta` 者必须存在台账条目（不缺失） | `TREASURY_LEDGER_MISSING_ENTRY` |
| 17 | （与 check 16 同块扫描，覆盖所有已批奏折的 `treasuryDelta` 选项） | `TREASURY_LEDGER_MISSING_ENTRY` |

检查 8 失败时后续依赖 memorial 的检查（9–12）跳过，避免 null 引用级联错误。

---

## 十、UI 可购性

奏折卡片通过 `memorialCard(memorial, currentTreasury)` 派生 `MemorialCardView`：

- **国库余额展示**：卡片顶部显示当前国库余额，格式 `国库：10,000 两`（千位逗号分隔，`formatSilver` 函数）。
- **选项国库变化**：每个选项的 `treasuryCost` 字段显示如 `国库 -900 两`（支出）或 `国库 +600 两`（收入）；无 `treasuryDelta` 则不显示。
- **余额不足时**：`MemorialOptionView.disabled = true`，`disabledReason = "国库不足，尚缺 X 两"`（X = shortfall）；UI 据此禁用按钮并展示原因。
- **双重保障**：UI 层为预防性 UX（防止用户误操作）；引擎层 `applyTreasuryTransaction` 同样校验（`TREASURY_INSUFFICIENT`），UI 禁用不是唯一防线。

---

## 十一、超出范围

以下内容**不**在 Phase 4B 范围内：

- 军事奏折（military category）— 仅占位枚举，无 payload 变体、不生成
- 人事奏折（personnel category）— 仍由 PR3C-3b 的 `personnelDecisions` 独立承载，未并入本框架
- 国库与店铺/赐赏系统集成（`store/treasury.ts` 保持独立，与本台账不交叉）
- 国库余额历史曲线 UI（`treasuryLedger` 数组可支撑，但无可视化图表）
- 奏折概率/节流系统（生成逻辑为确定性，无随机权重调度）

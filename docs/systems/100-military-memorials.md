# 军事奏折与前线评估（Phase 4C） — 规格文档

**状态：Implemented（Phase 4C）。** 边患压力隐属性 + 年度前线评估 + 军事奏折模板 + theater 轮换 + 年度生成 seam + 存档迁移 v21→v22 + validator + UI 显示。

> 通用奏折框架（Memorial 模型、生命周期、紫宸殿 UI）见 [98-memorial-framework.md](./98-memorial-framework.md)。

---

## 一、概述 — Phase 4C 新增

Phase 4C 向 Memorial 框架添加 **military** 类别，引入：

1. 隐属性 **`borderPressure`**（边患压力，0–100）— 国家军事态势指标，玩家可见但不可直接操作。
2. **FrontierAssessment** — 每年七月由年度边情评估生成的记录，包含 theater、rawDrift、modifiers、final pressure。
3. **军事奏折** — 根据年度评估风险等级自动生成，决议影响 military / borderPressure / governance / publicSupport 等属性。
4. **Theater Rotation** — 3 个前线剧院，按年份轮换活跃。

---

## 二、borderPressure — 边患压力

**类型**：nation 隐属性（后台，玩家可见）
**范围**：0–100（整数）
**初始值**：35（偶有骚动）
**显示**：军事奏折卡片中显示描述等级（NOT 原始数值）

**等级划分**：

| 范围 | 描述 |
|------|------|
| 0–19 | 边境安宁 |
| 20–39 | 偶有骚动 |
| 40–59 | 边患渐起 |
| 60–79 | 边情紧迫 |
| 80–100 | 烽烟四起 |

每年七月（month = 7）通过 FrontierAssessment 自动评估并更新。见 §十「Calendar Seam」。

---

## 三、FrontierAssessment — 前线评估记录

```ts
interface FrontierAssessment {
  /** "fro_YYYY_T" 格式，如 "fro_1025_1" 表示公元 1025 年 theater 1 评估。 */
  id: string;
  year: number;
  month: number;  // 7（固定七月）
  theaterId: FrontierTheaterId;        // 0, 1, 2（活跃 theater）
  rawDrift: number;                    // 妊娠滚数 % 11 - 3，范围 -3 到 7
  modifiers: {
    military: number;                  // military 属性贡献，可为正或负
    governance: number;                // governance 属性贡献
    publicSupport: number;             // publicSupport 属性贡献
  };
  pressureBefore: number;              // 评估前的 borderPressure
  pressureAfter: number;               // 评估后的 borderPressure（clamp 0–100）
  memorialId?: string;                 // 关联的军事奏折 id（若已生成）
}
```

`GameState.frontierAssessments: FrontierAssessment[]` 为 append-only 数组。

---

## 四、年度漂移算法 — Annual Drift

**年度原始漂移（rawDrift）：**

```
rawDrift = (gestationRollRaw % 11) - 3
范围：-3 ~ 7
```

**属性修正：**

| 属性 | 条件 | 修正值 |
|------|------|--------|
| military | 每 10 点 | +1 / -1 |
| governance | 每 15 点 | +0.5 / -0.5 |
| publicSupport | > 60 | -0.5；< 40 | +1 |

**评估后压力：**

```
pressureAfter = clamp(
  pressureBefore + rawDrift + modifiers.military + modifiers.governance + modifiers.publicSupport,
  -10, +10  // 单年最多 ±10 波动（clamp 前的漂移范围）
)
实际 borderPressure = clamp(result, 0, 100)
```

---

## 五、风险分类 — Risk Classification

奏折生成基于 pressureAfter 的风险等级（按优先级排序）：

| 等级 | 英文 | 优先级 | 压力范围 | 严重度 | 选项数 |
|------|------|--------|---------|--------|--------|
| 紧急 | critical | 1 | 80+ | 极高 | 3 |
| 迫在眉睫 | urgent | 2 | 60–79 | 高 | 3 |
| 观察 | watch | 3 | 40–59 | 中 | 2 |
| 稳定 | stable | 4 | 0–39 | 低 | 1 |

---

## 六、Theater 轮换 — FrontierTheaterId

3 个剧院，按年份轮换（确定性，不随机）：

```
theaterId = year % 3  // 0, 1, 2
年份 → Theater：1020=0, 1021=1, 1022=2, 1023=0, ...
```

每年评估仅作用于 **当年活跃 theater**；其他 theater 的压力不变。

---

## 七、Military Memorial Matters — 军事奏折事项

```ts
type MilitaryMemorialMatter = 
  | "annual_readiness"    // 年度戍备
  | "crisis_defense"      // 紧急防御
  | "emergency_mobilize"; // 紧急调防
```

与风险等级对应：

| 等级 | matter | 中文 |
|------|--------|------|
| critical | emergency_mobilize | 紧急调防 |
| urgent | crisis_defense | 紧急防御 |
| watch / stable | annual_readiness | 年度戍备 |

---

## 八、选项表 — Memorial Options

**年度戍备（annual_readiness，watch/stable）**

| 选项 | 国库成本 | 国家效果 | 皇帝效果 |
|------|---------|---------|---------|
| 操练戍卒（drill） | -600 | military+5, borderPressure-2, productivity-1 | — |
| 修缮堡垒（reinforce） | -1000 | military+8, borderPressure-3, governance+2 | — |
| 屯田储粮（provision） | -800 | borderPressure-1, productivity+3, clanDiscontent-2 | — |

**紧急防御（crisis_defense，urgent）**

| 选项 | 国库成本 | 国家效果 | 皇帝效果 |
|------|---------|---------|---------|
| 调度兵源（mobilize） | -1500 | military+12, borderPressure-5, publicSupport-3 | — |
| 紧急补给（supply） | -1800 | military+10, borderPressure-6, treasury 压力持续 | — |
| 驰援边域（relief） | -2000 | military+15, borderPressure-8, governance+3 | 武力+1 |

**紧急调防（emergency_mobilize，critical）**

| 选项 | 国库成本 | 国家效果 | 皇帝效果 |
|------|---------|---------|---------|
| 大规模调兵（full_deploy） | -3000 | military+20, borderPressure-10, publicSupport-5, clanDiscontent+2 | 武力+2 |
| 外交求援（diplomacy） | -1500 | borderPressure-4, governance+5, ministerLoyalty-3 | — |
| 纵兵屠掠（raid） | 0 | military+8, borderPressure-2, publicSupport-8, rumor+5 | 暴戾+3 |

所有属性变化均经 `applyEffects` funnel（含 AXIS_CAP clamp）；国库变化单独经 `applyTreasuryTransaction`。

---

## 九、Treasury 原子性

`resolveMemorial` 执行序列（与 Phase 4B 一致）：

1. 验证奏折 pending → 验证 optionId 合法
2. 若 `option.treasuryDelta` 存在，调用 `applyTreasuryTransaction` → 失败则整体回滚
3. 调用 `applyEffects`（nation/sovereign 属性变化）→ 失败则步骤 2 的中间结果丢弃
4. 标记奏折 resolved → 返回最终 state（包含 treasury + nation 属性 + assessment 关联）

---

## 十、Calendar Seam — 年度生成

触发时间：**每年 month = 7（七月）**

```ts
maybeGenerateAnnualFrontierAssessment(state, db, at):
  1. 计算 theaterId = year % 3
  2. 验证该 theatre 当年无已存在 assessment（sourceId = frontier:theaterId:year）
  3. 执行 rawDrift 及 modifier 计算 → pressureAfter
  4. 生成 FrontierAssessment 记录（仅记录，不生成奏折）
  5. 根据 pressureAfter 等级，生成对应 military memorial
     - 关联 assessment id
     - matter 由等级决定
     - sourceId = military:{theaterId}:{year}
  6. 若已存在 pending 军事奏折或 assessment，返回 null（幂等）
```

**Idempotency：** 同一年 theaterId 只生成一次 assessment 和对应奏折。

**Blocked by pending：** 若当年已有 pending 军事奏折，生成函数返回 null。

---

## 十一、Validator — validateFrontierAssessments

`validateFrontierAssessments(state)` 返回所有错误，供存档加载路径调用。检查项：

1. assessment id 符合格式且全局唯一
2. `theaterId` 值在 0–2 范围
3. `year`, `month` 为合法整数（month 必为 7）
4. `rawDrift` 在 -3 到 7 范围（但存档可能有偏差）
5. `pressureBefore` / `pressureAfter` 在 0–100 范围
6. `pressureAfter ≥ pressureBefore - 10 && pressureAfter ≤ pressureBefore + 10`（单年波动限制）
7. 若关联 `memorialId`，该 memorial 必存在且 `category === "military"`
8. 同一 theaterId 年份不重复

---

## 十二、存档迁移（v21 → v22）

`MIGRATIONS[21]` 在加载旧档时执行：

1. 回填 `frontierAssessments: []`（若不存在）
2. 按 nation.borderPressure 初始值 35（若缺失）回填
3. 对所有已批（resolved）的旧 disaster 奏折，不向后兼容军事模板
4. `formatVersion` 写为 22

---

## 十三、UI

**contextLabel 值**（替代 urgencyLabel）：

```ts
type ContextLabel = 
  | "routine"        // 例行、稳定
  | "attentive"      // 需关注
  | "urgent"         // 紧急
  | "critical";      // 极度危急
```

军事奏折映射：`stable/watch → routine`, `urgent → urgent`, `critical → critical`

**边患压力显示：**

- 国情抽屉：显示描述等级（如"边情紧迫"）不显示原始数值
- 军事奏折卡片：卡片标题或 subtitle 显示当前压力等级 + 变化方向（↑ / ↓）

**FIELD_LABEL 新增**：

```ts
FIELD_LABEL = {
  ...
  borderPressure: "边患压力",
  militaryReadiness: "戍备",
  theaterRotation: "前线活跃",
  ...
}
```

---

## 十四、超出范围

以下**不在** Phase 4C 范围内：

- 战争地图、实时兵力模型、外国势力
- 海战、内陆战役的细节规则
- 将领出战、殉难、升迁
- 与动物区系、女真族、吐蕃等具体民族的交互脚本
- 奏折内容的 RAG/LLM 生成（所有文本为预定义常量）
- 财政奏折与军事奏折的跨类别联动（各自独立）
- 可视化战场、兵力曲线图表

---

财政奏折扩展详见 [99-treasury-memorials.md](./99-treasury-memorials.md)；通用框架详见 [98-memorial-framework.md](./98-memorial-framework.md)。

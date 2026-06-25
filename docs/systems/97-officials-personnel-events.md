# 官员人事叙事事件（Phase 3 · PR3C-3b）

PR3C-3 的第二刀：把官员升降落到**皇帝亲裁的人事事件**上。三类玩法共享一个**人事决策**领域模型，所有
职位变更**一律复用 PR3C-3a 的正式 API**——升迁经 `promoteOfficialAdministratively`（行政，**不入 PUNISH**），
降职/免官经 `punishOfficial`（皇帝亲发惩戒，**入 PUNISH**）。事件与 UI **绝不**直接改 `official.postId` /
`officialHistory` / `justice.punishments`。

> **硬约束（贯穿 PR3C）**：皇帝亲自下令的惩戒性降职/降品/免官**都算惩罚**，必入 PUNISH（punishmentId +
> PunishmentRecord + officialHistory + CourtEvent + 后果）。**授官/调任/升迁是行政行为，绝不创建
> PunishmentRecord。** 年度吏部考课自动升降属制度结果（`authority: "system_review"`），不进 PUNISH。

**实现状态：Implemented（引擎 + store + UI + 校验 + 迁移 + 测试）。**

## 一、三类事件

| 种类 `kind` | 触发 | 准许 → API | 拒绝/其它 |
|---|---|---|---|
| `consort_petition_promotion` 侍君请提拔亲族 | 侍君私下恳请擢拔族中官员 | `approve` → `promoteOfficialAdministratively`（行政） | `reject`：职位不变，侍君适度失意 |
| `family_implication` 侍君获罪牵连家族 | 侍君获**严重**惩罚后，皇帝是否牵连族官 | `demote`/`dismiss` → `punishOfficial`（PUNISH） | `spare`：罪止其身，职位不变 |
| `memorial_promotion` 荐升 | 吏部荐在任官员升迁 | `approve` → `promoteOfficialAdministratively`（行政） | `reject`：不变 |
| `memorial_demotion` 请降 | 御史以政绩偏低请降 | `approve` → `punishOfficial`（PUNISH，皇帝准奏才入罚） | `reject`：不变 |
| `memorial_dismissal` 请免 | 御史以连年严重不合格弹劾 | `approve` → `punishOfficial`（PUNISH） | `reject`：驳回弹劾 |

> 奏折「请降/请免」只是**建议**；唯有皇帝**准奏**才进入 PUNISH。驳回与「罪止其身」绝不创建 PunishmentRecord。

## 二、人事决策领域模型

`GameState.personnelDecisions: Record<string, PersonnelDecision>`（`PersonnelDecision` 见
`engine/state/types.ts`）。

- `id`（`pdec_000001` 单调，与 record key 一致）；决策永不删除，resolved 留存。
- `sourceId` 为**去重键**：同一 sourceId 全局至多一条（无论 pending/resolved）。
  - petition：`petition:{consortId}:{officialId}:{year}` + 「同侍君只允许一条 pending 请求」。
  - implication：`implication:{sourcePunishmentId}`。
  - memorial：`memorial:{kind}:{officialId}:{year}`。
- 生命周期：`pending`（可存档、可裁断）→ `resolved`（不可再次执行；必带 `resolvedAt` + `resolution`）。
- `family_implication` 必带 `sourcePunishmentId`，且须指向真实**侍君**目标记录。

## 三、确定性生成（`engine/officials/personnelDecisions.ts`）

全部确定性（无概率），测试可显式构造触发。资格门 + 稳定目标选择 + tie-break：

- **目标官职**：`selectHigherVacantPost`（升迁，品级 (from, from+2]、有空缺、`promotionScore` 降序）/
  `selectLowerVacantPost`（降职，[from−2, from−1]、有空缺、取最接近当前者）。
- **侍君请托**：侍君在宫在世 + 有母族 + 族中有 active+seated 官员 + 存在合法更高空缺；选官员＝明确亲缘优先
  → 当前品级最高 → `promotionScore` 最高 → `officialId`。
- **获罪牵连**：来源须 `targetKind==="consort"` 且严重度 `severe`/`terminal`；选官员＝同族 active+seated 中
  品级最高 → 明确亲缘优先 → `officialId`；`recommendedPostId` 为更低空席（可能为空：降职选项禁用，免官恒可用）。
- **奏折**：荐升＝政绩/评分达标且有更高空缺；请降＝政绩偏低（或连续不合格）且有更低空缺；请免＝连年严重不合格。

亲缘一律凭 `kinship` 边，绝不靠姓名推断。

### 生产触发 seam（玩法可达）
- **侍君请托 + 人事奏折**：在统一日历结算（`settleCalendarAdvance`）的吏部考课之后，由
  `generateAnnualPersonnelEvents` 一次性确定性生成有界条目（同 `hasReviewedYear` 守卫，每年仅一次；
  每名在任官员每年至多一条奏折，按 id 稳定遍历，上限 `ANNUAL_MEMORIAL_CAP` / `ANNUAL_PETITION_CAP`）。
- **获罪牵连家族**：侍君获 severe/terminal 惩罚（幽禁/赐死/冷宫）时，由对应 store 命令经
  `commitPlannedTransaction` 的 `postCommit` 变换**即时**生成牵连待裁决策——折进同一次提交与 emit
  （不额外 emit）；生成器对不合格惩罚为纯 no-op。
- 三类决策均不在 React render 期生成；紫宸殿 badge 随订阅态自然出现。

## 四、原子裁断（`engine/officials/personnelDecisionResolve.ts`）

`resolvePersonnelDecision(state, db, decisionId, resolution, at)` 一次原子完成：

```
验证 pending → 验证裁断对 kind 合法 → 调正式职位 API → 施加侍君关系/记忆（applyEffects 漏斗）
→ 标记 resolved → 返回新 state（+ 降/免才有 punishmentId）
```

任一步失败即 `err`，输入 state **完全不变**（不改职位、不写历史、不写 PunishmentRecord、不推进 justice、
不动关系、不标记 resolved）。**绝不先 resolve 再执行职位变化。** 升迁失败（如席位被占）整体回滚。

## 五、关系与记忆（范围克制）

- 仅**侍君**有关系/记忆后果（官员暂无角色记忆，复用 officialHistory/PunishmentRecord/CourtEvent，后续可扩展）。
- 请托准许：侍君 favor/affection/loyalty 适度↑ + 私下感念记忆；拒绝：适度↓ + 私下被拒记忆（不广播全宫）。
- 牵连降/免：被牵连侍君形成**创伤**记忆，并以新官员 `punishmentId` 溯源；罪止其身：感念记忆。
- 所有记忆经 `applyEffects` 的 `memory` effect 写入（无侍君记忆库则跳过，不抛）。
- 知情范围：私下请托 circle/private；牵连降/免 palace；公布朝野的免官 realm（由 `punishOfficial` 的 publicity 决定）。

## 六、UI（`ui/officials/PersonnelDecisionsScreen.tsx` + `personnelDecisionView.ts`）

紫宸殿新增「人事奏折 · N」入口（badge＝待裁数）。决策卡展示：来源、类型、相关侍君/官员/家族、当前官职、
建议官职、政绩、能力适配，以及每个选项的**行政/惩戒标签**：

- 行政升迁：「此举属于行政任用，不记为惩罚。」
- 皇帝亲发惩戒（降职/免官）：「此举属于皇帝亲发惩戒，将记入惩罚记录，并影响官员忠心与家族皇恩。」

无空缺/无目标的惩戒/升迁按钮**禁用并说明原因**（实时据 state 计算）。成功裁决经 `onCommitted` 持久化。
移动端 390px 单列、长官职名换行、按钮 40px 触控。**官员名册与本屏均不提供自由升降/调任/免官按钮。**

## 七、schema / 迁移 / 校验

- Zod `personnelDecisionSchema` + `gameStateSchema.personnelDecisions`；`SAVE_FORMAT_VERSION = 18`；
  `MIGRATIONS[17]`（v17→v18）回填空 `personnelDecisions`。
- `validateOfficialWorld` 增人事决策闭环：record key=id、sourceId 去重、officialId/consortId/familyId/
  sourcePunishmentId/caseId 引用存在、官族匹配、family_implication 来源须为侍君目标、pending/resolved 字段
  一致、resolution 对 kind 合法、`resolvedAt ≥ createdAt`。

## 八、测试

生成器（资格/确定性/去重）、原子裁断（行政/PUNISH 边界、关系/记忆、失败原子性、二次裁断、席位被占回滚、
save/load）、validator 闭环、store 命令（一次 emit / 失败不 emit / punishmentId / round-trip）、v17→v18 迁移、
UI（渲染/标签/禁用原因/裁决/onCommitted/视图模型/无自由任免回归）。

## 九、不在本 PR

官员角色记忆模型（LLM 级）、奏折概率/节流系统（仅确定性资格 + 显式触发）、暂缓裁断、超出三类的奏折模板、
前朝/国政奏折框架（→ Phase 4A）。

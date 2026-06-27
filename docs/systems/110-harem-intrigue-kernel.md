# 110 — 宫斗系统内核（Phase 5A-1）

## 1. 本 PR 范围

本文档描述 Phase 5A-1 实现的**纯领域层**宫斗内核。

**已实现：**
- 侍君参与资格判断
- 宫斗动机（propensity）评分
- 目标威胁（threat）评分
- 五类非身体伤害阴谋类型
- 每月最优阴谋对选择（全局最优，非局部）
- 阴谋强度（potency）与隐蔽度（secrecy）
- 成功与败露的确定性判定（FNV-1a）
- 后果计划（consequence plan）
- 知识边界计划（knowledge boundary）
- Plan / Outcome validator
- 428 个测试

**未实现（Phase 5A-2 及后续）：**
- GameState.haremSchemes / haremIncidents 持久化
- 接入时间循环（settlePostAdvance / 月度 tick）
- Store emit / autosave
- UI 通知
- 记忆写入（MemoryEntry / CourtEvent）
- 身体后果（health / gestation / death）

## 2. 为什么暂不持久化

本 PR 的输出是 `HaremIntriguePlan`（领域计划对象），不是已经发生的 GameState 变化。

原因：
1. **与 73B 并行开发**：Phase 5A-1 与六宫年度结算（73B）同时进行，为避免在 `GameState` shape、`settlePostAdvance`、`PendingHaremAdminReport` 上产生冲突，本 PR 严格限制为只读（不修改任何 state）。
2. **设计审查前置**：宫斗的 notification priority、冷宫 incident 融合、六宫风闻队列等设计问题需要在 73B 合并后统一决策。
3. **可测性**：纯 planner 无需 Store，测试清晰，可单独 CI。

## 3. 与 73B 的并行边界

本 PR 不修改：
```text
gameStore.ts
haremAdminCommands.ts
haremAdminDecision.ts
state/types.ts
saveSystem.ts / stateSchema.ts
initialState.ts / newGame.ts
App.tsx
```

不读取：
```text
PendingHaremAdminReport
haremAdministration（本阶段完全不读，防止语义耦合）
```

架构验证：
```bash
rg "settlePostAdvance|PendingHaremAdminReport|resolveHaremAdminRankCommand" \
  src/engine/characters/haremIntrigue*
# 期望：无匹配
```

## 4. 数据来源

| 字段 | 来源 |
|------|------|
| favor / peakFavor / lifecycle / healthStatus / haremFactionId | `CharacterStanding` |
| affection / fear / ambition / loyalty | `resolveConsortRuntimeAttrs()` |
| personality (全 8 维) | `resolveConsortRuntimeAttrs()` |
| household (全 3 维) | `resolveConsortRuntimeAttrs()` |
| rank.order / rank.domain | `ContentDB.ranks` |
| 孕育承载 | `GameState.resources.bloodline.gestations` |
| 产后恢复 | `CharacterStanding.recoverUntilMonth` + `monthOrdinal()` |
| 怨恨记忆 | `GameState.memories[ownerId].entries` |
| 皇帝勤政 | `GameState.resources.sovereign.diligence` |

`ConsortPersonality / ConsortHousehold` 是**后台模拟参数**，不是玩家角色面板新增的明面属性。

## 5. Canonical 侍君识别

```ts
export function runtimeConsortIds(state: GameState): string[]
```

来源：`Object.keys(state.bedchamber)`

规则：
- 去重、按 ID 排序（不依赖 object insertion order）
- 返回新数组，不修改 state
- 官员/非侍君不在 bedchamber 中，自然排除
- 动态生成侍君（generatedConsorts）只要在 bedchamber 中，同样计入

## 6. 参与资格

### 通用条件（actor 与 target 均适用）
1. ID 在 `runtimeConsortIds()` 中
2. `standing` 存在
3. `lifecycle` 不为 `candidate` / `deceased`
4. 未身处冷宫（`isInColdPalace()`）
5. 未处于禁足（`isConfined()`）
6. `healthStatus` 不为 `critical`
7. rank 存在且 `domain === "harem"`

### Actor 额外条件
- 不在承嗣中（`gestation.carrier === actorId`）
- 未处于产后恢复期（`monthOrdinal(at) <= recoverUntilMonth`）

### Target 特殊规则
- **可以**处于 carrying（本阶段无身体后果）
- **可以**处于产后恢复
- **可以**是皇后或高位侍君（本内核不因行政身份豁免）

## 7. Grievance selector

```ts
export function unresolvedGrievanceStrength(
  state: GameState,
  ownerId: string,
  subjectId: string,
): number
```

只读取：
- `ownerId = actor`
- `kind = "grievance"`
- `unresolved = true`
- `subjectIds` 包含 `subjectId = target`

返回匹配条目中最大 strength（Phase 5A-1 无衰减 API，直接用原始值）。

## 8. Actor 宫斗倾向公式

```
lowLoyalty  = max(0, 60 - loyalty)
fearPressure = max(0, fear - 50)

raw =
  ambition × 0.24
  + jealousy × 0.22
  + scheming × 0.22
  + courage × 0.08
  + maxGrievanceStrength × 0.20
  + lowLoyalty × 0.12
  + fearPressure × 0.08
  − compassion × 0.10
  − emotionalStability × 0.06

propensity = clamp(round(raw), 0, 100)
```

门槛：`propensity >= 45`（`INTRIGUE_PROPENSITY_THRESHOLD`）

## 9. 目标威胁公式

```
favorGap     = max(0, target.favor - actor.favor)
peakFavorGap = max(0, target.peakFavor - actor.peakFavor)

rankRivalry  =
  target.rankOrder <= actor.rankOrder
    ? 0
    : round((target.rankOrder - actor.rankOrder) / max(1, maxOrder - minOrder) × 100)

factionBonus = (both in different non-empty factions) ? 15 : 0

raw =
  favorGap × 0.50
  + peakFavorGap × 0.25
  + rankRivalry × 0.15
  + target.servantOpinion × 0.10
  + grievanceStrength × 0.35
  + factionBonus

threat = clamp(round(raw), 0, 100)
```

## 10. Pair 优先级

```
tieJitter = (fnv1a64Hex("harem_intrigue:pair:{year}:{MM}:{actor}:{target}") % 5) − 2

priority = clamp(round(propensity × 0.55 + threat × 0.45 + tieJitter), 0, 100)
```

门槛：`priority >= 45`（`INTRIGUE_PAIR_THRESHOLD`）

排序：`priority desc → tieBreak asc → actorId asc → targetId asc`

## 11. 五类阴谋

| kind | 语义 |
|------|------|
| `slander` | 散布谗言，削弱目标恩宠 |
| `false_accusation` | 捏造罪名构陷目标（非司法案件） |
| `steal_credit` | 截取/冒认目标功劳 |
| `faction_pressure` | 借阵营/人脉施压 |
| `servant_subversion` | 收买宫人破坏目标宫室 |

本阶段全部无身体后果（无 health / gestation / death delta）。

## 12. Scheme 类型选择优先级

| 优先级 | 条件 | 结果 |
|--------|------|------|
| 1 | grievance≥70 且 scheming≥55 | false_accusation / resentment |
| 2 | factionConflict 且 courage≥55 且 (pride≥55 或 ambition≥60) | faction_pressure / faction |
| 3 | privateWealth≥60 且 scheming≥60 且 target.servant≤55 | servant_subversion / ambition† |
| 4 | target.favor−actor.favor≥20 且 jealousy≥60 | slander / jealousy |
| 5 | ambition≥70 且 target.peakFavor≥60 | steal_credit / ambition |
| 6 | fear≥70 且 loyalty≤40 | slander / fear |
| 7 | ambition≥60 | steal_credit / ambition |
| 默认 | — | slander / jealousy |

†servant_subversion motive：若 factionConflict 且 ambition < jealousy → faction，否则 ambition

## 13. Potency 公式

| kind | bonus |
|------|-------|
| slander | 0 |
| false_accusation | +5 |
| steal_credit | 0 |
| faction_pressure | +3 |
| servant_subversion | +2 |

```
raw =
  scheming × 0.30
  + ambition × 0.18
  + courage × 0.10
  + grievance × 0.20
  + privateWealth × 0.12
  + actor.servantOpinion × 0.05
  + targetThreat × 0.10
  + kindBonus

potency = clamp(round(raw), 10, 90)
```

## 14. Secrecy 公式

| kind | modifier |
|------|----------|
| slander | +2 |
| false_accusation | −8 |
| steal_credit | 0 |
| faction_pressure | −12 |
| servant_subversion | +5 |

```
raw =
  20
  + scheming × 0.35
  + emotionalStability × 0.20
  + privateWealth × 0.10
  + (100 − sociability) × 0.08
  − fear × 0.15
  − pride × 0.10
  + kindModifier

secrecy = clamp(round(raw), 10, 90)
```

## 15. 确定性 Roll

基于 `fnv1a64Hex`（FNV-1a 双遍 64 位）：

```
successRoll  = parseInt(fnv1a64Hex("harem_intrigue:success:{sourceKey}:{actorId}:{targetId}:{kind}").slice(0,8), 16) % 100
discoveryRoll = parseInt(fnv1a64Hex("harem_intrigue:discovery:{sourceKey}:{actorId}:{targetId}:{kind}").slice(0,8), 16) % 100
```

输出 0–99，save/reload 稳定。

## 16. 成功判定

执行时读取**当前** target runtime attrs（非快照）：

```
targetResistance =
  emotionalStability × 0.25
  + sociability × 0.10
  + target.servantOpinion × 0.15
  + loyalty × 0.10

rankProtection（target.rankOrder > actor.rankOrder）=
  clamp(round((targetRankOrder − actorRankOrder) / max(1, maxOrder − minOrder) × 100), 0, 100)

successThreshold = clamp(round(
  25 + potency × 0.55 + actor.courage × 0.10
  − targetResistance × 0.40 − rankProtection × 0.10
), 10, 90)

success = successRoll < successThreshold
```

## 17. 败露判定

```
discoveryThreshold = clamp(round(
  15
  + (100 − secrecy) × 0.55
  + target.sociability × 0.10
  + target.servantOpinion × 0.10
  + sovereign.diligence × 0.15
), 5, 90)

discovered = discoveryRoll < discoveryThreshold
```

成功与败露**完全独立**，四象限均合法。

## 18. 后果表

### slander
| 情形 | delta |
|------|-------|
| 成功 | target.favor−4, target.affection−2, nation.rumor+1 |
| 失败 | actor.fear+2 |

### false_accusation
| 情形 | delta |
|------|-------|
| 成功 | target.favor−5, target.fear+5, target.affection−3 |
| 失败 | actor.fear+3 |

### steal_credit
| 情形 | delta |
|------|-------|
| 成功 | actor.favor+3, actor.affection+2, target.favor−2 |
| 失败 | actor.fear+2 |

### faction_pressure
| 情形 | delta |
|------|-------|
| 成功 | target.fear+6, target.loyalty−4, nation.rumor+1 |
| 失败 | actor.fear+3 |

### servant_subversion
| 情形 | delta |
|------|-------|
| 成功 | target.servantOpinion−6, actor.servantOpinion+2, target.fear+2 |
| 失败 | actor.servantOpinion−2, actor.fear+1 |

### 败露附加（无论成败，只要 discovered）
```
actor.favor−4, actor.fear+5, nation.rumor+2
```

合并规则：
- 同角色同字段合并为单条目
- 0 delta 删除
- 每字段单次 delta 限 [−10, +10]
- standing 按 characterId 排序
- household 按 characterId 排序

## 19. 知识边界

| 状态 | targetKnowsInstigator | palacePublic |
|------|-----------------------|--------------|
| hidden | false | false |
| discovered | true | true |
| cancelled | false | false |

- actor 始终知道自己的行动（`actorKnowsOwnAction: true`）
- hidden：target 可以感受后果，但不知道幕后 actor
- discovered：才允许未来写 target 指向 actor 的 grievance / CourtEvent

## 20. 取消情形

| reason | 触发条件 |
|--------|----------|
| `actor_unavailable` | actor 已故/成为 candidate/入冷宫/禁足/critical/开始承嗣 |
| `target_unavailable` | target 已故/成为 candidate/入冷宫/禁足/critical |
| `actor_target_same` | actorId === targetId |
| `plan_invalid` | validateHaremIntriguePlan 返回 findings |

取消时：无 delta，无 public knowledge，无 rolls。

## 21. Validator

### Plan Validator (`validateHaremIntriguePlan`)
检查 14 个 code：
- `INTRIGUE_BAD_SOURCE_KEY`
- `INTRIGUE_BAD_TIME`
- `INTRIGUE_SELF_TARGET`
- `INTRIGUE_UNKNOWN_KIND`
- `INTRIGUE_UNKNOWN_MOTIVE`
- `INTRIGUE_BAD_SCORE`
- `INTRIGUE_BAD_POTENCY`
- `INTRIGUE_BAD_SECRECY`
- `INTRIGUE_BAD_GRIEVANCE`
- `INTRIGUE_SNAPSHOT_ID_MISMATCH`
- `INTRIGUE_BAD_SNAPSHOT_VALUE`
- `INTRIGUE_BAD_RATIONALE`
- `INTRIGUE_DUP_RATIONALE`
- `INTRIGUE_KIND_MOTIVE_MISMATCH`

### Outcome Validator (`validateHaremIntrigueOutcome`)
- roll 0–99
- threshold 范围
- success/discovered 一致性
- knowledge 三元组一致性
- delta 合法性（禁止 health/gestation/rank/title/death 字段）
- 与 `buildIntrigueConsequences()` 规范对比

## 22. 性能

后宫侍君数量通常 5–30，极端 100。Planner 为 O(n²)：

优化：
- 只对 canonical eligible consorts 建 pair
- actor / target snapshot 各缓存一次
- grievance 预建索引（避免 O(n²×m) 全量扫描记忆）
- rank bounds 只计算一次

100-consort 压力测试通过（< 2 秒）。

## 23. 非目标

本 PR 明确不实现：
- `GameState.haremSchemes` / `haremIncidents`
- save migration
- settlePostAdvance 接线
- notification modal / UI
- memory writes（MemoryEntry / CourtEvent）
- 身体伤害（health / gestation / death 后果）
- 处决、毒害、伤胎、滑胎
- 皇帝裁断
- 正式司法案件（false_accusation 仅为阴谋行为，非案件）

## 24. 下一阶段 Contract

Phase 5A-2 接入时，必须提供：

```ts
// Phase 5A-2 将新增：
planMonthlyHaremIntrigue(db, state, {
  at: context.at,
  existingSourceKeys: new Set(Object.keys(state.haremSchemes)),
})
```

Planner 输出 `HaremIntriguePlan | null`，runtime 负责：
1. 持久化 plan → `state.haremSchemes`
2. 月度执行 → `resolveIntrigueOutcome()` → `HaremIntrigueOutcome`
3. 写入 consequences 到 state（通过正式 effect funnel）
4. 写入 knowledge（MemoryEntry / CourtEvent）
5. discovered incidents → notification queue

见 docs/systems/111-harem-intrigue-runtime-plan.md。

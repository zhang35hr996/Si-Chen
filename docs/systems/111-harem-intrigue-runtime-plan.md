# 111 — 宫斗系统接线规划（Phase 5A-2，待实施）

> **本文档为规划，非实现。**
> Phase 5A-2 必须等待 73B（六月结算 / PendingHaremAdminReport / 73B 后续）合并后方可实施。

## Phase 5A-2 目标

将 Phase 5A-1 的纯领域内核接入生产时间循环，实现：

1. 每月阴谋自动生成并持久化；
2. 月度阴谋执行与后果写入；
3. 发现事件进入通知队列；
4. 记忆与编年史写入。

---

## 新增 GameState 字段

```ts
// 待 Phase 5A-2 添加到 GameState
interface GameState {
  // ...existing fields...

  /**
   * 已规划/已执行的宫斗方案。key = sourceKey ("harem_intrigue:{year}:{MM}")。
   * append-only；resolved/cancelled 后状态字段更新，不删除。
   */
  haremSchemes: Record<string, HaremScheme>;

  /**
   * 已发现/已公开的宫斗事件队列。
   * 只有 discovered=true 的事件才入队。
   */
  haremIncidents: HaremIncident[];
}

interface HaremScheme {
  plan: HaremIntriguePlan;
  outcome?: HaremIntrigueOutcome; // undefined = planned but not resolved
}

interface HaremIncident {
  id: string; // "incident:{sourceKey}:{actorId}:{targetId}"
  sourceKey: string;
  at: GameTime;
  actorId: string;
  targetId: string;
  kind: HaremIntrigueKind;
  discovered: boolean;
  acknowledged: boolean; // 玩家已阅 → true
}
```

save migration 需升级 SAVE_FORMAT_VERSION（Phase 5A-2 决定版本号）。

---

## settlePostAdvance 接线顺序

```
settlePostAdvance(month M)
  │
  ├─ 1. 解析到期方案（due schemes from haremSchemes）
  │      └─ resolveIntrigueOutcome() → outcome
  │         ├─ apply consequences（通过正式 effect funnel）
  │         ├─ write memory（actor secret / target grievance if discovered）
  │         ├─ write CourtEvent（if discovered → "scheme_discovered"）
  │         └─ if discovered → push HaremIncident
  │
  ├─ 2. 规划当月新方案
  │      planMonthlyHaremIntrigue(db, state, {
  │        at: context.at,
  │        existingSourceKeys: new Set(Object.keys(state.haremSchemes)),
  │      })
  │      └─ if plan != null → haremSchemes[plan.sourceKey] = { plan }
  │
  └─ 3. HaremAdminReport 队列（73B）
         共存，单事务 commit
```

---

## 与 73B Notification Queue 共存

| 类型 | 队列位置 | 优先级 |
|------|----------|--------|
| 六宫位分裁定（73B） | PendingHaremAdminReport | 高 |
| 宫斗发现事件 | haremIncidents | 中 |
| 隐匿方案 | 不入可见队列 | — |

建议规则：
- 宫斗 incident 不占全局 interrupt queue；
- 只有 `discovered=true` 的事件才创建 `HaremIncident` 并触发 UI；
- 月度结算时，位分裁定优先展示，宫斗通知排后；
- 同月多事件时，按 `actorId` 排序后 FIFO 处理。

---

## Effect Funnel 需求

Phase 5A-2 需要为以下字段建立正式 mutation seam：

### Standing deltas
当前 `apply_consort_attr` effect 支持 `fear / favor / affection / loyalty`。

需确认 funnel 支持：
- `favor` ✓（已有）
- `affection` ✓（已有）
- `fear` ✓（已有）
- `loyalty` ✓（已有）

### Household deltas
当前无正式 household mutation seam。

需新增：
```ts
// Phase 5A-2 增加 effect type
type HouseholdEffect = {
  kind: "adjust_household";
  targetId: string;
  servantOpinion?: number;
  livingStandard?: number;
  privateWealthLevel?: number;
}
```

### Nation deltas
`rumor` 已有 nation resource 支持，通过 `resource` effect 施加。

---

## 记忆写入规范

### 隐匿方案（hidden）

actor 写入 secret memory：
```ts
{
  kind: "secret",
  ownerId: actorId,
  subjectIds: [targetId],
  summary: "我悄悄对她施了手段，目前尚无败露迹象。",
  strength: 40,
  retention: "temporary",
  unresolved: false,
}
```

target **不得**得到任何指向 actor 的记忆。

### 发现方案（discovered）

target 写入 grievance：
```ts
{
  kind: "grievance",
  ownerId: targetId,
  subjectIds: [actorId],
  summary: "她竟然暗中对我出手，此仇不可不报。",
  strength: 60,
  retention: "temporary",
  unresolved: true,
}
```

生成 CourtEvent：
```ts
{
  type: "scheme_discovered",
  subjects: { perpetrator: actorId, victim: targetId },
}
```

---

## 大选与冷宫中断

| 情形 | 处理 |
|------|------|
| 大选期间（pendingDaxuan 存在） | 可正常规划阴谋，但发现事件推迟至大选结束后通知 |
| actor 入冷宫（月内） | resolveIntrigueOutcome 返回 cancelled(actor_unavailable) |
| target 入冷宫（月内） | resolveIntrigueOutcome 返回 cancelled(target_unavailable) |
| critical illness interrupt | 若 actor/target 变为 critical，月结时取消 |

---

## 未来扩展可能

本阶段 **不实现**，仅备案：
- 玩家可主动干预（举报/包庇）
- 阴谋升级为正式司法案件（false_accusation → justice case）
- 宫斗联盟（faction 合作）
- 跨月连续方案
- NPC 反制（target 主动防御）
- 宫斗积分系统
- 身体伤害（毒害 / 伤胎）——极严格限制，需要独立设计审查

---

## 迁移路径

Phase 5A-2 save migration：
- 新增 `haremSchemes: {}` 默认值（空 Record）
- 新增 `haremIncidents: []` 默认值
- 不影响现有字段

---

## Phase 5A-2 合并前置条件

1. 73B（六月结算 + PendingHaremAdminReport）已合并到 main；
2. `settlePostAdvance` 接口稳定；
3. notification queue 优先级规则已确定；
4. household effect funnel 已设计；
5. 本 PR（Phase 5A-1）已合并。

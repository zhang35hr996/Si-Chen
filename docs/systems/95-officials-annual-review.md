# 年度吏部考课与自动补缺（Phase 3 · PR3C-2）

每年**十一月**一次自动「吏部考课」，在 PR3C-1 的能力/政绩/铨选评分之上做**职位变化**：更新政绩 → 连年
不合格自动降级 → 自动升迁/连锁补缺 → 生成只读人事简报。玩家**不再在名册中自由调任/免官**，常规迁转由
系统完成。

> **硬约束**：自动考课升降是**行政制度结果**（`authority: "system_review"`），**绝不进入 PUNISH
> consequence**——本模块不调用任何惩罚系统、不写 `punishmentId`/`PunishmentRecord`。皇帝亲自下令的惩戒性
> 降职/降品/免官/褫权（PR3C-3）才算惩罚，必须走既有 PUNISH。

## 一、时序

`settleCalendarAdvance` 在 `month >= REVIEW_MONTH(11) && !hasReviewedYear(year)` 时调 `buildAnnualReview`，
**幂等 + catch-up**（不依赖 monthChanged；本年仅一次），排在正月 lifecycle、二月科举之后（候补已就绪）。

## 二、政绩更新

**仅考核 active 且确占官职者**（`postId !== null`）：`merit' = clamp(merit + annualMeritDelta, 0, 100)`，
`annualMeritDelta` 确定性 −3..+3（适配高者上行、低者下行 + 确定性 jitter）。**不合格** = `merit' < 35 ||
currentPostFit < 30`；不合格 `underperformanceYears+1`，合格清零；`lastReviewedYear = year`。**无职期间不
考核**（merit/计数/lastReviewedYear 一律不动——无岗位政绩可考，避免免职/起复等待补缺者被误计不合格、
重新授任后立即触发降级）。事件型政绩（±5..±20）留 PR3C-3。

## 三、自动降级（system_review）

`underperformanceYears >= 2` 的在任占职官员降 1–2 个 gradeOrder：**仅在 `[fromGrade−2, fromGrade−1]` 窗口内**
择最接近目标的**有品级空缺**（绝不一次跌落多品）；窗口内无空缺则释放为无职（postId=null，仍 active）。
降级后 `underperformanceYears` 清零，且**本轮被降级者一律排除出随后的补缺**（不得在同一事务被升回原职）。
每次移动写 `officialHistory`（status active + vacatedPostId），记入简报 `kind: "demotion"`。**不产生惩罚记录。**

## 四、自动升迁 + 连锁补缺 `resolveOfficialVacancies`

按官职品级**从高到低**逐个空缺补缺，每空缺按**严格三级优先级**挑补缺者（**绝不跨类别比分数**，上一级有
合格人选即用、不下探，级内再按分数 + 稳定 id tie-break）：
1. **无职 active 官员**（参照其最近任职品级，跨度 ≤ +2）。
2. **更低品在任官员**满足升迁门槛：`merit ≥ 50`、`promotionScore(目标) ≥ 65`、年资 ≥ 1、目标更高且 ≤ 当前 +2。
3. **eligible 候补**（仅 `gradeOrder ≤ CANDIDATE_ENTRY_GRADE_MAX(8)` 的低品入仕）。
4. 无合格人选 → 留空。

连锁：移动产生的新空缺继续入队，始终高品优先；**每人/每候补本轮至多移动一次、每官职无人可补即标记跳过、
设最大迭代上限禁止死循环、全程确定性排序（同存档同结果）**。只做 初授/重新授任/升迁，**绝不**自动惩戒性
降职或免官。失败则该步跳过，绝不留半填官位表（席位安全由 `isPostVacant` 保证）。

## 五、人事简报

`state.annualReviews`（append-only）每年一条 `AnnualReviewRecord { year, at, changes: PersonnelChange[] }`，
`PersonnelChange` 含 `kind`(promotion/demotion/fill/appointment)、from/toPostId、`authority: "system_review"`。
官员名册新增**只读「人事简报」tab** 展示最近一年变动。玩家不必逐项确认。

## 六、关闭玩家自由人事入口

官员名册详情**移除「免职 / 调任 / 任命」按钮**（职位只读）；保留对官员自发请求的裁决：准告老/挽留、起复。
store 的 `assignOfficialPost`/`dismissOfficial` 仍存在（供考课引擎与 PR3C-3 惩罚路径复用），但不再有玩家
直通自由编辑入口。PR3B 候补授官页保留，成为可选主动干预。

## 七、存档与校验

`state.annualReviews` + schema；`SAVE_FORMAT_VERSION` 14→15，`MIGRATIONS[14]` 补空数组。考课全程经
`validateOfficialWorld` 不变量（席位不超额、状态↔官职一致、授官溯源一致等）。

## 八、测试

merit 增量确定性/边界/适配牵引、连续不合格累计与清零；降级（2 年触发、单年不降、降到低品/无职、清零、
system_review、**无惩罚记录**）；连锁补缺（候补补低品不超席、确定性、写历史；强官员升迁封顶 +2）；
`buildAnnualReview` 幂等 + 简报 + 世界合法 + 无 PUNISH；store 月-11 catch-up 一次/幂等；save round-trip +
v14→v15 迁移；UI（移除免职/调任、保留告老/起复、人事简报 tab）；seeds 1..8 × 8 年 exam+review 恒绿可存档。

## 九、不在本 PR（留 PR3C-3）

侍君请求提拔亲族、侍君获罪牵连家族、紫宸殿人事奏折、玩家批准升迁的行政入口、玩家亲自降职/免官的**PUNISH**
入口、官员 punishment target 分支、官员忠心/家族皇恩 consequence。

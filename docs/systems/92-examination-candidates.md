# 科举与候补官员池（Phase 3 · PR3A：数据内核）

只建立「候补人才从哪里来、如何存活和消失」的底座，**不直接修改在任官员、不做任命/职位匹配/UI**
（留 PR3B），不做升迁/降职（留 PR3C，且必须接入 PUNISH consequence——惩戒性降职/降品/免官全算惩罚）。

## 一、候补者与官员严格分离

候补者存于 `state.officialCandidates`（与 `state.officials` 隔离），**不是官员**：
- 不占官位、不入官员名册、不参与官员年度告老。
- 非 `eligible` 者不被任命源选中；入池不获得 structured official claim。
- 女性限定（`OfficialCandidate` 无 sex 字段即女性）。

`OfficialCandidate`：`id`(`cand_<year>_<index>`) / surname / givenName / age / `familyId`(可空) /
`origin`(examination|recommendation) / `examinationYear` / `examinationRank` / `aptitude`(governance/
scholarship/military/integrity) / `status`(eligible|appointed|expired|withdrawn) / `enteredPoolAt` /
`expiresAtYear` / `appointedOfficialId?`。
`ExaminationResult`：year / generatedAt / candidateIds(按榜次) / acknowledged（PR3B 查看后置 true）。

## 二、时序（统一日历边界结算）

每年**二月起**（避开正月 lifecycle、四月大选）由 `settleCalendarAdvance` 调用 `settleAnnualExamination`：
先 `buildCandidateYearlyTick`（eligible 增龄 → 逾年限 expired / 年龄上限或自然死亡 withdrawn），再
`buildAnnualExamination`（本年榜单）。触发条件 `month >= EXAM_MONTH && !hasGeneratedExaminationForYear`
**不依赖 monthChanged**——`settleCalendarAdvance` 仅在成功时间事务后调用，`hasGeneratedExaminationForYear`
已保证本年幂等，故二月或其后**本月内首次推进/事件 apCost 未跨月**亦立即 catch-up，且不重复生成/增龄。
非 eligible 候补冻结。`buildOfficialYearlyTick`（正月，无年内幂等守卫，须 monthChanged）与候补 tick
相互独立、绝不混用。

## 三、确定性生成

种子 `official:exam:<year>:<rngSeed>` / `…:candidate:<i>` / `official:exam:withdraw:<year>:<id>`，与其它
随机流隔离。每年 4–8 人；能力 `examScore = scholarship*0.45 + governance*0.25 + integrity*0.20 +
military*0.10` 降序定 `examinationRank`（同分按生成序稳定），但保留各项原始能力供 PR3B 按官职类型匹配。
家世：约 40% 关联已有官员家族（取其 surname/familyId，**绝不伪造新亲缘边**），其余寒门 `familyId=null`；
PR3A 不建新家族树。同种子同年重复计算完全一致；查询不消耗随机数；读档不重生成；已生成则 tick 幂等。

## 四、有效期与退出

入榜后 `CANDIDATE_ELIGIBLE_YEARS=5` 年内 eligible（Y..Y+4），第 Y+5 年起 `expired`；年龄 ≥ 70 或自然
死亡 → `withdrawn`；被任命 → `appointed`（PR3B）。**绝不物理删除**历史候补者。

## 五、Selectors（只读，不做授官资格/职位匹配）

`getEligibleOfficialCandidates` / `getCandidatesByExaminationYear`(按榜次) / `getCandidateById` /
`getLatestExaminationResult` / `hasGeneratedExaminationForYear` / `getCandidatePoolCount`。

## 六、校验与存档

`validateOfficialWorld` 扩充：候补 id 全局唯一（含 candidate 命名空间）、record key===id、不得占 `officials`
id、年龄合法、`familyId` 引用有效、同年榜次唯一且 1..N 连续、`appointed` 须有有效 `appointedOfficialId`、
每年至多一份科举结果。**有效期判定以「年度结算标记」（最新榜单年份 `max(examinationResults.year)`）为准
而非历年**：届满年正月（本年二月结算尚未跑）仍 eligible 合法、可读档，避免合法存档被隔离；结算已跑仍
eligible 才非法。**榜单 canonical**：`candidateIds` 必须精确等于该年全部 `origin=examination` 候补按
`examinationRank` 升序的 id 序列（无重复、不遗漏、顺序正确、不混荐举），且 `generatedAt.year===year`。
`SAVE_FORMAT_VERSION` 11→12；`MIGRATIONS[11]` 给旧档补 `officialCandidates: {}` / `examinationResults: []`。

## 七、完成闭环（测试覆盖）

```
进入二月 → 本年科举仅生成一次 → 候补进入 eligible 池 → 排名/属性确定且可存档 → 读档完全一致不重生成
→ 五年未授官者 expired → appointed/expired/withdrawn 不在 eligible 池（getEligibleOfficialCandidates）
```
seed 1..30 × 20 年始终通过 `validateOfficialWorld` + `gameStateSchema` + round-trip。

## 八、PR3A 明确不做

多轮考试流程 / 玩家出题廷试 / 科举 UI / 候补任命 / 官职匹配评分 / 自动补缺 / 升迁降职弹劾 / 政绩 /
派系 / 买官舞弊科场案 / 候补完整家族生成 / 候补与后宫亲属联动 / 男性参考入仕。

## 九、下一阶段

PR3B：候补榜单与授官 UI（玩家查看科举结果/候补池、把候补授任到空缺官位，按官职类型匹配评分）。
PR3C：在任官员升迁/调任/降职规则——**皇帝亲自下令的降职/降品/免官等惩戒性处置全算惩罚**，必须接入
既有 PUNISH consequence 流程，不得新建绕过路径。

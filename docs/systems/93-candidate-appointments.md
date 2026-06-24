# 候补榜单与授官（Phase 3 · PR3B）

在 PR3A 的科举/候补数据底座之上，让玩家**查看历年科举榜单、查看候补池、把 eligible 候补授任到有空席
的官职**。engine/store/UI 完整闭环。**不含**升迁、降职、弹劾、政绩、派系（留 PR3C+）。

## 一、候补授官事务

唯一正式入口 `appointOfficialCandidate(state, db, candidateId, postId, at): Result<GameState>`——UI 绝不
手工拼装 `Official`。原子（失败 state 完全不变）：
1. 候补存在且 `eligible`，未重复授官（`appointedOfficialId` 未设）。
2. 官职存在且有空席（占用 < `seatCount`）。
3. 创建正式 `Official`：id `official_appointed_<candidateId>`（稳定、可追溯、命名空间隔离）、女性、
   `status: active`、`postId`、`appointedAt: at`、姓名/年龄/familyId 继承候补，`loyalty` 由
   `appointmentLoyalty`（`integrity*0.7 + governance*0.3`，确定性、不调随机流）派生。
4. 候补 → `appointed` + 回填 `appointedOfficialId`。
5. 写 `officialHistory`（`status: active` + `appointment` 溯源：candidateId/examinationYear/
   examinationRank/postId/**ageAtAppointment**；appointedAt 即条目 `at`）。
6. 成功后由 UI `onCommitted` 落盘；`appointed` 候补不再出现在 eligible selector。**绝不删除候补记录。**

**封闭规则**（唯一权威入口自检，不依赖 UI）：官职须存在且 `gradeOrder>0`（拒绝平民等非授官席位）；空席判定
复用 `isPostVacant`（不另算一套占用）；派生 `officialId` 与寒门 `hanmenFamilyId` 须与所有人物/家族命名空间
**全局不冲突**（character/generatedConsort/official/familyMember/candidate/officialFamily），否则 `OFFICIAL_BAD_POST`
/`OFFICIAL_SEAT_FULL`/`OFFICIAL_ID_COLLISION`。

**年龄语义**：候补 `appointed` 后其 `age` 永久冻结＝授官时年龄；正式官员每年正月随 lifecycle 增龄。故
provenance 存 `ageAtAppointment` 快照，validator **不要求当前年龄相等**——只校验 `candidate.age===ageAtAppointment`
且 `official.age >= ageAtAppointment`（增龄合法、永不变小）。姓名继承仍永久相等。

**家族**：候补 `familyId !== null` 沿用既有家族（必须存在）；寒门（`null`）建**最小家族壳**——仅一个
`OfficialFamily`（id `official_fam_appointed_<candidateId>`，surname 取候补，保守门第属性），**不生成母亲/
内卿/女儿/男郎/姐妹，不造任何 kinship**。完整家族扩展留后续。

## 二、官职匹配评分（`candidatePostFit`）

纯函数、确定性、0–100，**仅供 UI 推荐/排序，不作授官硬门槛**（玩家可任性用人，后果留政绩系统）。权重
集中于 `fit.ts` 的 `DEPARTMENT_FIT_WEIGHTS`，按部门主属性：

| 部门 | 主（0.6） | 辅（各 0.2） |
|---|---|---|
| 政事堂/吏部/户部/工部/地方 | 政略 governance | 才学、清正 |
| 礼部/寺监学 | 才学 scholarship | 政略、清正 |
| 军务 | 军事 military | 政略、清正 |
| 御史台/刑名 | 清正 integrity | 政略、才学 |
| 无属 none | 四维均衡（各 0.25） | — |

## 三、Selectors（只读，不改 state、不消耗随机数、不自动授官）

`getEligibleOfficialCandidates` / `getCandidatesByExaminationYear` / `getLatestExaminationResult`（PR3A）；
新增 `getUnacknowledgedExaminationResults`、`getVacantPostsForCandidate`（按 fit 降序）、
`rankCandidatesForPost`（eligible only，fit→榜次→id 稳定）、`candidatePostFit`。已 appointed/expired/
withdrawn 绝不进入授官来源；榜单历史仍能显示已 appointed/已退出者。

## 四、榜单 acknowledged

`acknowledgeExaminationResult(state, year)` 纯、幂等：只改对应榜单 `acknowledged`，不触碰候补/官员。store
命令同名；UI 在「打开某年榜单」时经 effect（非 render 写）调用，成功后 `onCommitted` 落盘。入口角标用
`getUnacknowledgedExaminationResults().length`。

## 五、UI（宣政殿 → 科举与候补）

与「官员名册」并列，未查看榜单时带角标。两 tab：
- **科举榜单**：历年（默认最新），按 `candidateIds`（即榜次）展示名次/姓名/年齿/家世/四维/状态；打开即
  acknowledged + autosave。
- **候补池**：仅 eligible，可按榜次/年份/综合分/年齿排序；点击进详情，列可授空缺（按 fit 降序，显示品级/
  部门/剩余席位/适配度），确认后授官；成功→候补转正进名册、官位表占用更新、候补出 eligible 池、notice、
  autosave；失败→state 不变、确认面板不关、显示错误。移动端 390×844 整行可点。

## 六、与既有系统对接 / 硬约束

复用 PR2A/2B 空缺 selector、正式官员 validator、officialHistory、App autosave seam、Result/error、save
schema/migration、trace source。不在 React 直接写 `state.officials`、不建第二套官位占用、不绕过
`seatCount`、不复用 candidate↔official id、不在 selector/render 改 acknowledged。

**授官、调任是行政行为，不算惩罚，绝不进入 PUNISH consequence。** 但保留硬约束：

> 皇帝亲自下令的惩戒性降职、降品、免官、褫夺权力等都算惩罚，必须进入既有 PUNISH consequence。PR3B 不实现
> 这些行为，也不添加任何绕过入口（PR3C 处理在任官员升迁/调任/降职时再统一接入）。

## 七、存档与校验

`SAVE_FORMAT_VERSION` 12→13；`MIGRATIONS[12]` 仅为 `officialHistory.appointment`（可选附加字段）重打版本，
旧条目天然无此字段、无需补值。`validateOfficialWorld` 新增授官一致性：`appointedOfficialId` 指向存在官员、
姓名继承一致、当前年龄不低于授官时年龄、familyId 一致（含寒门壳）、同一 official 不被两候补共指；每个
`appointed` 候补**恰有一条** `appointment` 溯源（officialId/状态 active/年份/榜次/`ageAtAppointment`/有品级
postId 全一致），且每条溯源反向指回 appointed 候补。配合 PR3A 既有不变量。

**`at` 语义**：溯源 `h.at` 是「首次进入正式官员体系」的历史快照；`official.appointedAt` 是「最近一次任职/
调任」时刻，调任（PR2B）或免职后重新授官会更新后者。故 validator **只要求 `appointedAt.dayIndex >= h.at.dayIndex`，
绝不要求二者相等**——否则候补出身官员一经正常调任即被误判存档损坏。

## 八、测试

引擎授官（成功/各失败码且失败 state 字节不变/寒门壳/继承家族/不可重复授官/loyalty 确定性）、fit（部门主
属性权重/0–100/和为 1/tie-break/无副作用）、selectors、store 命令（授官 + ack 幂等 + 失败引用不变）、
validator 篡改、save round-trip + v12→v13 迁移、UI（打开榜单 ack+autosave、候补池仅 eligible、空缺按 fit
排序、授官成功转正、失败面板不关）、长期 sweep（seeds 1..12 × 12 年 exam→确定性授官→validator/schema/席位/
round-trip 恒绿）。

## 九、下一阶段 PR3C

在任官员升迁/调任/降职规则——**皇帝亲自下令的降职/降品/免官等惩戒性处置全算惩罚**，必须接入既有 PUNISH
consequence，绝不新建绕过路径。

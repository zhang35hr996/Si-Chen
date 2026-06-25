# 官员惩戒与行政升迁（Phase 3 · PR3C-3a）

PR3C-3 的第一刀（引擎/store）：把**皇帝亲发的惩戒性降职/免官**正确接入既有 PUNISH 记录体系，并提供
**行政升迁**入口。叙事事件（侍君请求提拔亲族、侍君获罪牵连家族、紫宸殿人事奏折）与其 UI 留 **PR3C-3b**。

> **硬约束（贯穿 PR3C）**：皇帝亲自下令的惩戒性降职/降品/免官**都算惩罚**，必须进入既有 PUNISH
> consequence（punishmentId + PunishmentRecord + officialHistory + CourtEvent + 后果）。**授官/调任/升迁
> 是行政行为，不算惩罚，绝不创建 PunishmentRecord。**

## 一、PunishmentRecord 域中性化（target-discriminated）

把原本侍君专用的 `PunishmentRecord` 泛化为**目标域判别**：`PunishmentBase` 增 `targetKind: "consort" |
"official"`。新增官员目标变体（即时 `completed`）：
- `official_demotion` — `details: { fromPostId, toPostId }`（降到更低品级官职）。
- `official_dismissal` — `details: { fromPostId }`（免官为无职）。

侍君变体全部标 `targetKind: "consort"`，语义不变。`SAVE_FORMAT_VERSION` 15→16，`MIGRATIONS[15]` 给旧档
惩罚记录补 `targetKind: "consort"`。`OfficialHistoryEntry` 增可选 `punishmentId`（惩戒性变迁专有）。

## 二、官员惩戒 `punishOfficial`（独立后果，绝不经侍君属性）

`punishOfficial(state, db, command, at)` 原子（失败 state 不变）：
1. 校验官员在任且占职；降职须指定更低品级有空席官职，免官去职为无职（仍 active）。
2. 分配 `punishmentId`，写 `PunishmentRecord`（targetKind=official，completed/immediate，actorId=player）。
3. **独立官员后果**：官员**忠心↓**（降职 −15 / 免官 −28）、其家族**皇恩 imperialFavor↓**（−8 / −14）。
   **绝不**调用 `planPunishmentConsequences` 或 `adjust_consort_attr`——官员目标走独立分支。
4. 移动官员 + 写 `officialHistory`（status active、vacatedPostId、免官 reason=dismissal、**带 punishmentId**）。
5. 追加 `punished` `CourtEvent`（payload 携 punishmentId/kind/from-to）。
6. **事后自动补缺** `resolveOfficialVacancies`，**排除被罚者**（不得同事务被升回原职）。

store 命令 `punishOfficial(db, command)` → 提交并返回 `{ punishmentId }`。**只有此显式惩戒 API 才创建
PunishmentRecord**；普通 `assignOfficialPost`/`dismissOfficial`/吏部考课（PR3C-2）一律非惩罚、不写记录。

## 三、行政升迁 `promoteOfficialAdministratively`（不算惩罚）

把在任官员提到更高有空席官职：常规 `officialHistory`（**无 punishmentId**）、行政奖励（忠心 +8、家族皇恩
+6）、自动补缺旧职。**绝不创建 PunishmentRecord**。store 命令同名。

## 四、校验

`validateOfficialWorld` 新增：`officialHistory.punishmentId` ↔ 必须有对应 `official` 目标 PunishmentRecord
且 targetId 一致；每条 `targetKind:"official"` 惩罚记录的 targetId 须是存在官员。`justice` 详情校验补
`official_demotion`（fromPostId 非空且 ≠ toPostId）/`official_dismissal`（fromPostId 非空）。

## 五、测试

降职/免官（记录 targetKind/kind/completed、忠心↓、家族皇恩↓、history+punishmentId、punished 事件、自动补缺、
**未触碰任何侍君 standing**、被罚者不被补回原职）；失败原子性；行政升迁（升职、奖励↑、**无 PunishmentRecord**、
history 无 punishmentId）；store 提交 + save/load round-trip；v15→v16 迁移回填 `targetKind:"consort"`。

## 六、PR3C-3b（后续）

侍君请求提拔亲族（行政升迁入口）、侍君获罪是否牵连家族（玩家亲选降职/免官 → 经本 PR 的 `punishOfficial`）、
紫宸殿人事奏折、官员/家族反应与记忆、对应 UI。届时复用本 PR 的 `punishOfficial`/`promoteOfficialAdministratively`，
不另建惩罚路径。

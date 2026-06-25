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

侍君变体全部标 `targetKind: "consort"`，语义不变。`SAVE_FORMAT_VERSION` 16→17，`MIGRATIONS[16]` 给旧档
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

## 四、被免官者不自动复任

吏部考课自动补缺的 tier-1（无职 active 官员）**排除最近一次离任 reason="dismissal" 者**
（`wasLastVacatedByDismissal`）——被免官/罢免者须经**明确重新授任**（`assignOfficialPost` 或后续事件）
才能复职，年度补缺绝不自动起复，使玩家的惩戒决定不被系统撤销。

## 五、即时完成 + 完整闭环校验

官员 PunishmentRecord 的 `lifecycle` 类型收紧为 `ImmediatePunishmentLifecycle`（仅 `completed/immediate`），
`official_demotion.details.toPostId` 为非空 `string`。`validateOfficialWorld` 强制**完整闭环**：每条
`targetKind:"official"` 惩罚记录 → 目标官员存在；from/to 官职有效有品级、降职 toGrade<fromGrade；
lifecycle completed/immediate 且 `resolvedAt===imposedAt`；**恰一条** officialHistory（target/at/vacatedPostId
===fromPostId、免官 reason=dismissal **且降职 reason≠dismissal**、punishmentId 不复用）；**恰一条** `punished`
CourtEvent **且内容一致**（occurredAt===imposedAt、participant=目标且 role 与 kind 一致、payload kind/from/to
一致、publicity scope 与记录 publicity 映射一致）。`justice` 详情校验补官员变体。

明确重新授任经 `assignOfficialPost`（现对任何实际授官/调任/卸任都写一条 plain active officialHistory），故
免官者重新授任后「最近一次离任」不再是 dismissal——自动补缺限制真正解除，而非靠历史遮蔽。

## 六、待决告老清理 + 公开范围一致

`punishOfficial`/`promoteOfficialAdministratively` 落地时**撤回该官员未决告老**（与生命周期一致，避免悬挂
请求）。`PunishmentRecord.publicity` 与 `punished` CourtEvent 范围**单一事实源映射**：secret→circle(目标)、
palace→palace/institutional、public→realm/institutional。

## 五、测试

降职/免官（记录 targetKind/kind/completed、忠心↓、家族皇恩↓、history+punishmentId、punished 事件、自动补缺、
**未触碰任何侍君 standing**、被罚者不被补回原职）；失败原子性；行政升迁（升职、奖励↑、**无 PunishmentRecord**、
history 无 punishmentId）；store 提交 + save/load round-trip；v15→v16 迁移回填 `targetKind:"consort"`。

## 六、PR3C-3b（后续）

侍君请求提拔亲族（行政升迁入口）、侍君获罪是否牵连家族（玩家亲选降职/免官 → 经本 PR 的 `punishOfficial`）、
紫宸殿人事奏折、官员/家族反应与记忆、对应 UI。届时复用本 PR 的 `punishOfficial`/`promoteOfficialAdministratively`，
不另建惩罚路径。

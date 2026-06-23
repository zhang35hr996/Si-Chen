# 官员生命周期、官位空缺与基础任免（Phase 2 · PR2A：引擎内核）

让官员从静态名册变成会衰老、离职、死亡并留下官位空缺的长期人物。本 PR 只做引擎，不做正式 UI。
**未实现**：科举、候补池、自动升迁、政绩、派系、弹劾、求情、家族晋封惩罚联动、赐婚、株连、月度国家贡献。

## 一、状态机

```
active ──retire──▶ retired
       ──imprison▶ imprisoned
       ──exile───▶ exiled
       ──markDead▶ dead
       ──dismiss─▶ active(无职)   # 罢免：去职但仍可任用
retired/imprisoned/exiled ──restore──▶ active(postId=null)
任意非 dead ──markDead──▶ dead   # 终态，绝不删除人物
不变量：status !== "active" ⇒ postId === null（校验器强制 OFFICIAL_INACTIVE_SEATED）
```

所有状态变化必经 `engine/officials/lifecycle.ts` 的服务（`retireOfficial` / `imprisonOfficial` /
`exileOfficial` / `dismissOfficial` / `markOfficialDead` / `restoreOfficialToActive`），均返回
`Result<GameState, GameError>`，统一：释放席位（postId→null）、改状态、写 `statusChangedAt` /
`statusReason` /（死亡）`deathAt`、追加 `officialHistory`、撤回该官员未决告老、原子性。
**任命复用 `assignOfficialPost`**（不另建平行 appoint 系统）；`restore*` 只复状态不授官。

`Official` 新增：`statusChangedAt?` / `statusReason?`（受控枚举 retirement/dismissal/imprisonment/
exile/natural_death/execution）/ `deathAt?`。`FamilyMember` 新增 `deceasedAt?`（死亡标记，不删除）。

## 二、年度推进（正月上旬统一一次）

时间事务跨入「新年第一月」时调用 `buildOfficialYearlyTick`（`store/officialsLifecycleTick.ts`），
顺序：**增龄 → 官员自然死亡 → 家族成员自然死亡 → 告老请求**。不依赖玩家是否打开界面。

- 增龄 `ageOfficialsOneYear`：存活官员 + 未故家族成员 `age+1`；dead/deceased 冻结；侍君用自身年龄系统，不重复推进。
- 自然死亡：仅年龄曲线（`lifecycleRules.naturalDeathChance`，<50 极低 …70+ 明显上升），独立确定性 seed
  `official:lifecycle:<year>:<id>`，不消耗其它随机流；死亡走正式 `markOfficialDead(natural_death)`。
- 告老：`isRetirementAgeEligible`（55+）+ `retirementChance`（55–59 低 / 60–64 中 / 65+ 高），seed
  `official:retire:<year>:<id>`，**只生成 `pendingRetirements` 请求**，不在 tick 中静默退休。

批准/挽留由 store 命令 `approveRetirement`（→ retireOfficial）/ `retainRetirement`（撤回请求、留任）处理，
UI 留 PR2B。

## 三、官位空缺 selector

`getPostOccupancy` / `getVacantSeatCount` / `isPostVacant` / `getVacantPosts`。占用只计 active 在任者；
多席官职返回剩余席位数而非 boolean。

## 四、确定性与校验

- 年度 tick 纯函数、同种子同结果；读档不重随机（tick 是离散一次性变更，不 sticky）。
- 校验器新增：状态↔原因/时刻一致性、dead⇒deathAt、非 active⇒reason+time、pendingRetirements 指向
  active 且不重复、officialHistory 引用有效 + id 唯一。
- **年龄区间修正**：持久校验只做运行期合理性（1–120）；母女/配偶「数值年龄差」属生成期合理性
  （`validateGeneratedAges`），**移出 load/persist 路径**——官员逐年增龄、侍君静态年龄、死者冻结会令
  差值合法漂移，否则会误隔离合法老档。

## 五、存档

`gameStateSchema` 纳入 `pendingRetirements` / `officialHistory` + Official 新可选字段 + FamilyMember
`deceasedAt`。`SAVE_FORMAT_VERSION` 10→11；`MIGRATIONS[10]` 给旧档补两个空数组（官员既有形状不变、
新字段皆 optional），旧档可平滑载入。

## 六、完成的闭环（测试覆盖）

```
增龄 → 告老请求 → approveRetirement → retired + 席位释放 → 空缺可查 → assignOfficialPost 另一名 active 官员补任 → 席位不超额 → 存档稳定
官员死亡 → dead → 释放席位 → 保留家族与亲缘 → 宫中侍君仍查得已故生母 → 不再被进献/殿选/任免源选中（getActiveSeatedOfficials）
```

## 七、下一阶段（PR2B）

空缺处理与基础任免 UI：名册按状态筛选、官位表按部门展示、免职/调任/恢复/准告老/挽留操作、高位空缺
进 pending 提醒队列。升迁规则属 Phase 3。

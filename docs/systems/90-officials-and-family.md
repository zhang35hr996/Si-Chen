# 官员与家族系统（第一阶段：数据底座与开局生成）

本阶段只建立可存档、可查询、可与侍君建立母族关系的官员/家族底座，不实现政治玩法
（升迁、科举、赐婚、求情、告老、株连等一律不做，仅预留字段与接口）。

## 一、核心概念分离

| 概念 | 位置 | 含义 | 生命周期 |
|------|------|------|----------|
| 官职 `OfficialPost` | content（world.json） | 朝廷稳定席位：名称/品级 `gradeOrder`/部门 `department`/席位数 `seatCount` | 永久存在，人去职后席位空缺、官职仍在 |
| 官员 `Official` | `state.officials` | 占据官职的具体女性人物：`postId\|null`、`age`、`familyId`、`loyalty`、`status`、`appointedAt?` | 运行态，可空缺 `postId` |
| 家族 `OfficialFamily` | `state.officialFamilies` | 母系政治/亲缘实体：`surname`、`influence` 门第、`imperialFavor` 圣眷（**不存 memberIds**，成员一律派生） | 长期存在 |
| 家族成员 `FamilyMember` | `state.familyMembers` | 非官员、非在宫侍君的近亲（母亲/内卿/女儿/男郎/姐妹） | 运行态 |
| 亲缘边 `KinshipRelation` | `state.kinship` | 正式有向关系边（含对称反向边） | 随档持久 |

权势三分离：官员个人 `loyalty`、家族 `influence/imperialFavor`、官职品级（`power(post,id)` 派生）
互不混用。家族影响不反向篡改官职定义；侍君晋封未来只改家族影响，不改官员品级（本阶段仅预留）。

## 二、世界观硬约束（已落实）

- 官员恒为女性（`Official` 无 sex 字段即女性）；男性 `FamilyMember`（内卿/男郎）绝不挂 `postId`，校验器强制。
- 母系结构：子女归母族（同姓）；侍君为帝王男性侍御，出身官员家族即官员之「子」。
- 内卿（官员正室，男性，赘入）可异姓——数据结构不阻碍未来「男子赘入女方家」。
- 不按姓名推断亲缘：一切走稳定 id + 亲缘边。

## 三、人物 id 命名空间（全局唯一、与显示名解耦、读档不重生成）

- 家族：**显式稳定 familyId**。authored 家族由 `maternalClan.familyId` 声明（如 `fam_shen_main`），
  worldtime 直接复用；无关联随机家族用 `fam_gen_NNNN`（与 authored id 去碰撞）。
- 官员：`official_<familyId>`（family 头官，如 `official_fam_shen_main`）
- 家族成员：`person_<familyId 去 fam_ 前缀>_{mat|nei|dauK|sonK|sis}`
- 侍君：复用角色 charId（content / generatedConsorts）

> 家族身份**绝不按 surname 推断**：不同 `familyId` 可同姓；同一 `familyId` 内 surname 与初始
> 头官 postId 必须一致，冲突由 ContentLoader 报 `BAD_REF`。

## 四、开局生成顺序（`engine/officials/worldgen.ts`，纯函数）

1. 收集 authored 侍君母族，**按 `maternalClan.familyId` 分组**（按 charId 稳定排序后按 familyId 聚合）。
2. 每组建家族（runtime id = 该 familyId）：头官（取 `maternalClan.postId`）→ 核心成员
   （母亲/内卿/女儿/男郎/姐妹）→ 侍君连为官员之子（`birthFamilyId` + 亲缘边）。
3. 再生成 `UNLINKED_FAMILY_COUNT` 个无关联家族（`fam_gen_*`）填充朝堂，席位按 `seatCount` 不超额。
4. 建亲缘索引（母↔子女/子、配偶、同胞，对称关系两向落库）。
5. `newGame` 写入 state；`standing.birthFamilyId` 落于对应侍君。

年龄/身份约束集中于 `engine/officials/constraints.ts`。生成时官员年龄取自合法窗口：
满足品级最低年龄，且对所有 linked 侍君母子年龄差 ∈ `[MIN_GAP, MAX_GAP]` 且 ≤ `OFFICIAL_MAX_AGE`；
子女年龄取 `[headAge-MAX_GAP, headAge-MIN_GAP]`；窗口为空即抛出生成约束错误（绝不静默回退非法年龄）。

## 五、确定性随机

- 复用项目 `gestationRoll(seed:string)`（FNV-1a 哈希取模，不动 `rngSeed`）。
- 官员系统所有种子串以 `off:${rngSeed}` 前缀派生 → 与孕育/殿选/进献等随机流隔离，
  新增官员系统不导致既有随机结果漂移。
- 同种子必得同一官员/家族/亲缘；读档不重随机；查询/UI selector 不消耗随机数。

## 六、查询（`engine/officials/selectors.ts`，只读）

`getFamilyByPersonId` / `getOfficialsByFamilyId` / `getConsortsByFamilyId` /
`getFamilyMembers` / `getCloseRelatives` / `getPalaceRelativesOfOfficial` /
`getOfficialRelativesOfConsort` / `resolvePerson`。无背景者返回空，不报错。

## 七、校验（`engine/officials/validation.ts`，收集式诊断）

成员归属唯一真相 = 各人物 `familyId`/`birthFamilyId`（无 memberIds）。校验覆盖：record key 与对象
`id` 一致、全局人物 id 唯一（authored characters / generatedConsorts / officials / familyMembers
四命名空间）、官职/家族引用存在、席位不超额、`isValidOfficialAge`、家族成员引用有效、sex↔role 一致、
家族 surname 一致（内卿可异姓）、亲缘两端存在、无重复边、无矛盾生母、**mother 反向边类型须与
child 实际性别严格匹配（male→son、female→daughter）**、sibling/spouse 对称、母女/配偶年龄、
**母子 canonical familyId 一致（KIN_FAMILY_MISMATCH）**、侍君 `birthFamilyId` 与 `maternalClan.familyId`
一致且有对应母亲边、**非 active 官员不得占职（OFFICIAL_INACTIVE_SEATED）**。

**接入加载链路**：`validateSave`（`readSlot` 内）在 Zod 形状校验通过后调用 `validateOfficialWorld`，
任一 error 级诊断 → 拒绝并 quarantine（`OFFICIAL_INTEGRITY`，context 含全部诊断）。Zod 只管形状，
跨集合不变量归 world validator。新建游戏由测试保证生成结果通过 validator（不在生产路径重复扫描）。

## 八、存档与迁移

- `gameStateSchema` 纳入 `officials`（扩展形状）/`officialFamilies`/`familyMembers`/`kinship`
  及 `standing.birthFamilyId`；`OfficialFamily` 无 `memberIds`。
- 内容侧 `maternalClan` 增 `familyId`。
- save content-id cross-check 解析动态侍君用 `db.characters[id] ?? state.generatedConsorts[id]`，
  避免殿选侍君存档被误判 missing。
- `SAVE_FORMAT_VERSION` 8 → 9。按 **no-save-backcompat** 政策（pre-release）**不写 v8→v9 迁移**：
  旧档命中缺失的 `MIGRATIONS[8]` 即隔离（quarantine），绝不在加载旧档时重随机一套官员世界。
  新档以 v9 round-trip，重复读写稳定。

## 八之二、安全任免与在任官员 selector

- 任免官职唯一入口 `assignOfficialPost(state, db, officialId, postId|null): Result`，校验官员/官职
  存在、`seatCount` 未满、**仅 active 可授官（非 active 仅允许 null 去职）**、同职幂等；
  `GameStore.assignOfficialPost` 经其 Result 落库，绝不裸写 postId。
- `getActiveSeatedOfficials(state, db)`（status=active 且 postId 有效）为依赖在任官员的系统统一取人：
  殿选世家候选来源、大臣进献。
- 殿选世家子弟：候选生成即把完整母族写入 `content.maternalClan`（`familyId/postId` + 确定性
  `legitimate/birthOrder`），生母只取自年龄合规的在任有效官员；`addGeneratedConsort` 返回
  `Result`，原子写入母族关联与亲缘，重复提交幂等、身份冲突拒绝（不覆盖留旧亲缘）。入宫/读档后
  `familyText()` 持续显示母官品级/官职/嫡庶/排行，不退化为「平民之子」。
- authored 母家席位双重保护：ContentLoader 按唯一 familyId 统计每官职占用、超 `seatCount` 报
  `SEAT_OVERFLOW`、拒绝 `commoner` 作母家；worldgen 授官前再做防御式上限检查；
  `createNewGameState` 末尾对完整 state 跑一次 `validateOfficialWorld` fail-fast。

## 九、UI（只读开发者入口）

`ui/officials/OfficialRoster` + `OfficialDetail`，按部门分组、移动端整行可点，挂于调试面板
（` 反引号开关）。取舍：本阶段不动 2400 行的 `App.tsx` 主流程，底层 selector/数据已完备，
promotion 到正式界面只需更换挂载点。

## 十、后续阶段可复用的接口

- 任命/升迁/告老：`assignOfficialPost`（已强制席位不变量）+ `getActiveSeatedOfficials`。
- 株连/抄家/流放：`Official.status` 枚举 + 校验「死亡官员不在任」。
- 赐婚/赘入：`FamilyMember`(`consort_in`) + `KinshipRelation('spouse')`，已不阻碍男子赘入女方家。
- 侍君晋封影响家族：改 `OfficialFamily.influence/imperialFavor`，不动官职品级。
- 传代：派生成员（selector）+ 亲缘边 + 上一代 `matriarch`。

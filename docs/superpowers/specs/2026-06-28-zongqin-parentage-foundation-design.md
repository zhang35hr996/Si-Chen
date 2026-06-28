# 宗亲府邸与宗祧系统 — Slice A：亲缘数据基础（Parentage Foundation）

> 设计日期：2026-06-28
> 状态：评审中（本轮修订完成 + 用户确认后转「已确认设计」，再进 writing-plans）
> 范围：本 spec **只**覆盖 Slice A（数据基础）。其余切片各自单独 spec → plan → build。

---

## 0. 背景与全局分解

「宗亲府邸与宗祧系统」是皇嗣成年玩法的延伸，承载家族经营、伴读婚配、宗亲政治、谋反调查、绝嗣过继五类功能。它不是单一特性，而是约 7 个互相耦合的子系统。按依赖顺序分解，每个切片独立 spec → plan → build：

| # | 切片 | 依赖 |
|---|------|------|
| **A** | **亲缘数据基础** — `CharacterParentage`（血缘/法统分离）、`AdoptionRecord`、`RoyalResidence` 类型与空态、存档迁移、selectors、不变量 | — |
| B | 宗亲府邸导航 + 府邸只读界面（京城入口 → 高官住所 board `gaoguanzhusuo` 早/黄昏/晚 → 选府 → 府邸页 `zhufu` 背景；近况/家眷/子女/宗牒 tabs） | A |
| C | 成年皇嗣成家 → 自动建府 + 周期府邸事件（宗支生命周期可能在此抽象为 `LineageBranch`） | A, B |
| D | 奉先殿过继（宗祧）三阶段流程；`adoptIntoHousehold` / `revokeAdoption` 命令；法统变化的政治后果 | A |
| E | 宗亲子女：伴读 + 婚配（真实血缘距离判定 + 法统姊妹禁限） | A, C |
| F | 国家数值：宗亲 + 宗室不满（明面 + 后台） | A |
| G | 谋反/异常调查（**接入现有血滴子/investigation 系统**，不重造） | A, F, 现有 investigation |

**本 spec = 切片 A。** 它建立亲缘的数据权威和查询基座，**不实现任何宗亲玩法**。

### 设定要点（影响数据语义）

本作为母系/性别反转设定：

- **皇帝（sovereign）= 女性**，是其所有亲生皇嗣的**生身母亲**。她无 `db.characters` id，由哨兵 `"sovereign"` 表示，状态在 `state.resources.sovereign`。
- `Heir.fatherId` = 承嗣君（男性侍君 charId）= **生身父亲**；`null` = 自孕（无父）。
- `Heir.bearer`/`carrier` = **承养/孕育**（`"sovereign"`=自孕，否则承载侍君 charId，妊娠转移）。这是孕育历史，**不是亲缘**——无论谁承载，生身母亲都是皇帝。
- `Heir.adoptiveFatherId` = 养父/抚养侍君（驱动 `custodianBond`/`neglect`/性格养成）= **抚养/监护关系**，**不是**奉先殿宗祧过继。
- 凤主=女性宗亲，贵主=男性宗亲（对应 daughter/son 线）。

---

## 1. 架构总则（硬性规则）

> **`state.parentage` 是所有「已建模父母—子女关系」生身亲缘与法统亲缘的唯一权威来源。**
> `Heir` 字段、人物详情、宗亲府列表、`kinship` 图中的相关字段都只能是**投影或派生索引**，不得反向修改 `parentage`。

**权威范围（重要）**：Slice A 的完整性约束**仅要求每个 `Heir` 具备 parentage**。现有其他人物池（`familyMembers` / `officials` / `generatedConsorts` / `officialCandidates`）暂**不**要求具备 parentage——它们尚非「真实宗亲家庭成员」。未来某切片在这些人物成为真实宗亲家庭成员时再为其接入 parentage。把权威说成「所有角色」会与实际 validation（仅校验 Heir）冲突。

为什么不扩展现有 `kinship` 图：`kinship` 适合表达广义关系（姊妹、配偶、姻亲、伴读、过继后的法统亲属……），但**父母身份**有更严格的不变量（生身永不可覆盖、法统可因过继变化、二者可并存、婚配沿血缘链、继承沿法统链）。拆成多条边易出现缺边/重复边/双向不同步/过继误删生身边/查询漏 `lineage` 条件。故 `kinship` 仅作后续查询索引，不作亲缘身份的唯一存储。

三类关系彼此独立、互不覆盖：

| 关系 | 回答 | 存储（Slice A） | 可变性 |
|------|------|----------------|--------|
| **生身亲缘** | 孩子是谁所生 | `parentage.biological*` | 初始化后**不可变** |
| **法统亲缘** | 宗牒上是谁的子女 / 属哪宗支 / 继承谁 / 法统称谓 | `parentage.legal*` | 仅**正式过继**可改（命令在 Slice D） |
| **抚养/监护** | 谁实际抚养、积累 `custodianBond`、担失照料责任 | `Heir.custodianId`（过渡字段） | 可更换（命令在后续切片） |

承养/孕育历史（`bearer`）在 Slice A **保持现状**（留在 `Heir.bearer`）；独立 `GestationRecord` 延后。

---

## 2. 数据结构（Slice A 新增）

```ts
type CharacterId = string;
type AdoptionRecordId = string;   // adopt_NNNNNN
type RoyalResidenceId = string;   // res_NNNNNN
type PersonId = CharacterId;      // 含 SOVEREIGN_PERSON_ID 哨兵；不保证存在于 db.characters

/** 皇帝（女性，生身/法统母亲）的规范引用值。无 db.characters 实体。 */
export const SOVEREIGN_PERSON_ID = "sovereign";

interface CharacterParentage {
  // 不存 characterId：map key 即 characterId（避免重复真相）。

  // 生身：初始化后不可变。
  //   PersonId      = 确定父母（含 sovereign 哨兵）
  //   null          = 确定无（自孕，仅 father 适用）
  //   字段必填，禁止 optional —— undefined 仅代表“损坏/未建立”，不得作为业务值
  biologicalMotherId: PersonId;          // 皇帝亲生恒为 SOVEREIGN_PERSON_ID
  biologicalFatherId: PersonId | null;   // null = 自孕

  // 法统：出生时显式 = 生身；仅正式过继可改（命令属 Slice D）
  legalMotherId: PersonId;
  legalFatherId: PersonId | null;

  // 当前生效过继；无过继时 undefined
  activeAdoptionRecordId?: AdoptionRecordId;
}

type AdoptionReason = "imperial_succession" | "preserve_branch" | "political_settlement";

interface AdoptionRecord {        // Slice A 仅定义类型 + 空 map；不写流程
  id: AdoptionRecordId;
  childId: CharacterId;

  // 法统父母快照，沿用 parentage 的 null/undefined 规则：必填，father 可为 null（无父）。
  previousLegalMotherId: PersonId;
  previousLegalFatherId: PersonId | null;
  newLegalMotherId: PersonId;
  newLegalFatherId: PersonId | null;

  fromResidenceId?: RoyalResidenceId;
  toResidenceId?: RoyalResidenceId;

  effectiveAt: GameTime;          // 代码库惯用 ...At（无 ...Date）
  reason: AdoptionReason;
  status: "active" | "revoked" | "superseded";
}

type RoyalResidenceTitleType =
  | "fengzhu" | "guizhu"
  | "zhang_fengzhu" | "zhang_guizhu"
  | "dazhang_fengzhu" | "dazhang_guizhu";

interface RoyalResidence {        // Slice A 仅定义类型 + 空 map；不写生命周期
  id: RoyalResidenceId;
  holderId: CharacterId;
  titleType: RoyalResidenceTitleType;

  spouseIds: CharacterId[];
  // childIds 不持久化：法统子女真相在 parentage，Slice A 无缓存刷新机制也无消费者；
  // 需要时由 getLegalChildren 派生（见 §4）。
  legalHeirId?: CharacterId;

  // 临时内联宗支字段；Slice C 若证明宗支需独立生命周期，再抽成 LineageBranch
  lineage: {
    founderId: CharacterId;
    parentResidenceId?: RoyalResidenceId;
  };
}
```

`GameState` 顶层新增三个权威容器：

```ts
interface GameState {
  // ...existing...
  parentage: Record<CharacterId, CharacterParentage>;
  adoptionRecords: Record<AdoptionRecordId, AdoptionRecord>;   // 空 map
  royalResidences: Record<RoyalResidenceId, RoyalResidence>;   // 空 map
  adoptionNextSeq: number;        // 初始 1；分配 adopt_NNNNNN（与 haremInvestigationNextSeq 同模式）
  royalResidenceNextSeq: number;  // 初始 1；分配 res_NNNNNN
}
```

ID 分配采用项目既有的显式 `nextSeq` 计数器模式（如 `haremInvestigationNextSeq`），**不**用「扫描最大后缀 +1」。记录永不物理删除（`status` 置 `revoked`/`superseded`）。两个计数器随 v38 一并加入，故 Slice C/D 无需再改根状态形状。

`Heir` 字段调整：

```ts
interface Heir {
  // ...
  fatherId: string | null;        // @deprecated 持久化镜像；必须满足 §3 约束 7 一致性不变量；不得作为亲缘真相读取
  bearer: "sovereign" | string;   // 保持现状（承养历史）；GestationRecord 延后
  custodianId?: CharacterId;      // 由 adoptiveFatherId 重命名而来（抚养/监护）
  faction: HeirFaction;           // 枚举值 "adoptive" → "custodian"（见 §3 约束 5、§5 迁移）
  // adoptiveFatherId: 删除
}
```

`AdoptionRecord` / `RoyalResidence` 类型保持克制：只保存稳定事实身份，**不**提前塞入审批流状态机、府中经济、家眷状态或谋反指标。`RoyalResidence.childIds` 是法统 parentage 的派生缓存，不是权威；任何读取法统子女的逻辑应优先走 selector（§4）。

---

## 3. 约束（必须在实现中落实）

### 约束 1：`establishBirthParentage` 只能初始化，不能更新
不是普通 setter。若 `state.parentage[childId]` 已存在则抛 `PARENTAGE_ALREADY_ESTABLISHED`。修复坏数据走迁移/开发工具，**不**走运行时命令。

### 约束 2：生身不可变需两层保护，不能只靠 `stateValidation`
- 命令层：**不提供**修改 biological parent 的接口；**不存在** 通用 `setParentageField`。
- reducer/effect 层：parentage 只允许初始化。
- 若项目存在通用 patch effect，明确禁止其寻址 `parentage.*.biologicalMotherId` / `parentage.*.biologicalFatherId`。
- `stateValidation`：检查结构完整性与引用有效性。

### 约束 3：所有现有皇嗣必须有 parentage
迁移后强不变量：`∀ heir ∈ state.heirs, state.parentage[heir.id] != null`。缺 parentage 的皇嗣**不能**通过 state validation。正式 selector **禁止** `parentage?.biologicalFatherId ?? heir.fatherId` 这类静默 fallback（只能存在于迁移函数内部）。

### 约束 4：`legal` 字段显式填充，不使用隐式回退
v38 对每个皇嗣显式写四个字段（见 §5）。selector **不得**解释为 `legalFatherId ?? biologicalFatherId`——过继上线后会掩盖不完整数据。`undefined` = 未知，**永不**意味「与生身相同」。

### 约束 5：`custodian` 是全仓语义迁移，不是新增别名
v38：`heir.custodianId = legacyHeir.adoptiveFatherId; delete heir.adoptiveFatherId;`。

**验收口径（不靠手工清单，靠 grep）：** 除 v38 迁移读取旧存档、以及历史设计文档外，运行时代码、runtime/content schema、测试 fixture/工厂、chronicle 文案、当前系统文档中**不得再出现** `adoptiveFatherId`。实现者以 `grep -rn adoptiveFatherId src tests docs content` 为唯一真相驱动改写。当前已知消费面（2026-06-28 sweep，可能随主分支变化，实现时须重跑）：

- 引擎/存档：`src/engine/effects/funnel.ts`、`src/engine/content/schemas.ts`、`src/engine/save/saveSystem.ts`、`src/engine/save/stateSchema.ts`、`src/engine/state/types.ts`
- store：`src/store/heirCustody.ts`、`src/store/adoption.ts`（见下）
- UI：`src/ui/components/HeirListModal.tsx`、`src/ui/components/HeirSummonPicker.tsx`、`src/ui/components/CharacterProfileDrawer.tsx`、`src/ui/components/ConsortListModal.tsx`、`src/ui/screens/FengxiandianScreen.tsx`

**`src/store/adoption.ts` 必须改名/迁移。** 它实际实现的是 *择养父*（抚养关系：`eligibleAdoptiveFathers` / `bioFatherAvailable` / `buildAdoptionReaction`，且直接读 `heir.fatherId`），**不是**奉先殿宗祧过继。继续占用 "adoption" 名会与 Slice D 正式过继领域撞名。Slice A 将其重命名为抚养语义（如 `src/store/fosterFather.ts`，确切文件名留给 plan），相应 API（`eligibleAdoptiveFathers` 等）与 `tests/.../adoption.test.ts` 同步改名；其 `heir.fatherId` 读取改走 `getBiologicalParents`/`bioFather` selector。

**`HeirFaction` 枚举值 `"adoptive"` → `"custodian"`**（当前义为「依附承养人」）。正式过继加入后 "adoptive" 会歧义；v38 已在做，顺手迁移成本最低（见 §5）。

**仅** `MIGRATIONS[37]` 允许读取 legacy `adoptiveFatherId` / `faction:"adoptive"`（无需长期保留的 legacy decoder）；v38 runtime `gameStateSchema` 直接**拒绝**旧字段与旧枚举值，并拒绝新状态中同时存在 `custodianId` 与 `adoptiveFatherId`。

### 约束 6：空容器只建形状，不预设行为
`adoptionRecords` / `royalResidences`（+ `adoptionNextSeq` / `royalResidenceNextSeq`）在 Slice A 加入，使 v38 一次性完成顶层状态形状升级，后续 C/D 不必再改存档根结构；相关 selector/validation 可提前认识这些字段。类型保持克制（见 §2）。两个 state constructor（`createInitialState` @ `src/engine/state/initialState.ts`、`createNewGameState` @ `src/engine/state/newGame.ts`）与常用测试 fixture 都必须初始化这三个新 map 与两个计数器。

### 约束 7：`Heir.fatherId` 持久化镜像一致性不变量
只要 `Heir.fatherId` 仍存在于存档，就有两份持久化副本。故强不变量：

```ts
heir.fatherId === state.parentage[heir.id].biologicalFatherId   // null 亦须相等
```

- 所有业务读取改走 `getBiologicalParents`；`fatherId` 仅由**出生**与 **v38 迁移**写入。
- state validation 拒绝镜像不一致。
- Slice D 修改法统父母时**绝不**修改 `fatherId`。

### 约束 8：state validation 不变量清单
「不卡死」与「合法状态」是两回事。`gameStateSchema` 之外的 cross-link validation（载入存档/runtime 均适用）至少包括：

**parentage 自洽 + 无环：**
```text
childId ∉ { biologicalMotherId, biologicalFatherId, legalMotherId, legalFatherId }   // 不自指
biological 图无环
legal 图无环
biological/legal mother/father 引用要么是 SOVEREIGN_PERSON_ID，要么是已知人物（不强制存在于 db.characters 仅对 sovereign 豁免）
```

**activeAdoptionRecordId 交叉不变量**（即使正常流程产生空 `adoptionRecords`，载入的旧档也不得放任悬空/矛盾记录）：
```text
指向的 record 必须存在
record.childId === parentage key
record.status === "active"
record.newLegalMotherId === 当前 legalMotherId 且 record.newLegalFatherId === 当前 legalFatherId
同一 child 至多一条 active record
```

**map key 自洽：** `adoptionRecords[k].id === k`；`royalResidences[k].id === k`。

`SOVEREIGN_PERSON_ID` 作为合法父母引用通过校验，**不**要求其存在于 `db.characters` / `state.standing`；普通角色解析器不得假定所有 parent id 都能在 `db.characters` 找到。

---

## 4. Selectors（纯查询，不含业务裁决）

纳入 Slice A：

父母**通过结构表达，不靠数组位置**（数组会丢失母/父角色，也无法表达 `null` father）：

```ts
interface ParentPair {
  motherId: PersonId;            // 可为 SOVEREIGN_PERSON_ID
  fatherId: PersonId | null;     // null = 自孕
}

getBiologicalParents(state, characterId): ParentPair | undefined  // undefined = 该 id 无 parentage 记录
getLegalParents(state, characterId): ParentPair | undefined

getBiologicalChildren(state, parentId: PersonId): CharacterId[]   // 按 child id 排序，稳定
getLegalChildren(state, parentId: PersonId): CharacterId[]        // 按 child id 排序，稳定

getBiologicalAncestors(state, characterId, maxDepth?): PersonId[] // 按层级、母系优先的固定顺序
getLegalDescendants(state, characterId, maxDepth?): CharacterId[] // descendants 即 parentage map 的 child keys

getCurrentCustodian(state, childId): CharacterId | undefined      // 读 Heir.custodianId
```

**结果顺序稳定**：parents 由结构表达；children / descendants 按 ID 升序；ancestors 按层级 + 母系优先的固定规则。

**`getCurrentCustodian` 语义**：返回**当前登记**的抚养人，**不**判断其是否死亡/禁足/入冷宫/仍具抚养资格。Slice A 是行为保持型 rename——资格判断留给 custody policy（后续切片）；若在此 selector 里掺入资格过滤，会暗中改变现有的忽视度/养成等行为。

**防循环**：所有链遍历（bio 与 legal 两侧的 ancestors / descendants）从一开始就带 `visited: Set<PersonId>`，即使坏存档含环也不无限递归。注意「不卡死」≠「合法」——环本身由 validation（§3 约束 8）拒绝。

暂不纳入（属 C/D/E，会把 policy 混进基础 selector）：
`isEligibleForAdoption` / `isEligibleToInheritThrone` / `canMarry` / `chooseLineageHeir`。

**消费者改写**：所有原本读取 `Heir.adoptiveFatherId` 的逻辑改读 `getCurrentCustodian`，包括 `custodianBond`、`neglect`、抚养人性格对养成的影响、抚养人死亡/失势后的无人照料、皇帝召见频率补偿、皇嗣与养父互动、皇嗣详情「抚养人」。这些**不得**读 `parentage.legalFatherId`（否则过继后会把新法统父亲误当实际照料者）。所有亲缘读取不再直接依赖 `Heir.fatherId`。

---

## 5. v38 存档迁移

`SAVE_FORMAT_VERSION` 由 37 → 38，新增 `MIGRATIONS[37]`。固定顺序：

`MIGRATIONS[37]` 函数本身**只转换 state、提升版本并重算 checksum**——它**不**自行跑 schema 校验。现有加载管线为 `parse → envelope/version → migrations → checksum → state schema → content-id cross-check`，故 `gameStateSchema` 与 parentage cross-link validation（§3 约束 8）由迁移链结束后的统一阶段执行。

```text
1. 初始化 parentage / adoptionRecords / royalResidences（后两者为空 map）+ adoptionNextSeq=1 / royalResidenceNextSeq=1
2. 遍历所有 heirs，生成 parentage
3. adoptiveFatherId → custodianId；faction "adoptive" → "custodian"
4. 删除旧 adoptiveFatherId 字段
5. 返回 formatVersion=38 并重算 checksum
6. 后续由正常 load pipeline 执行 gameStateSchema + parentage cross-link validation（约束 3、4、7、8）
```

映射：

```ts
import { SOVEREIGN_PERSON_ID } from "...";

parentage[heir.id] = {
  biologicalMotherId: SOVEREIGN_PERSON_ID,
  biologicalFatherId: heir.fatherId,          // 保留 null（自孕），不转 undefined
  legalMotherId: SOVEREIGN_PERSON_ID,
  legalFatherId: heir.fatherId,               // 显式 = 生身
};

heir.custodianId = heir.adoptiveFatherId;     // 可能 undefined
delete heir.adoptiveFatherId;

if (heir.faction === "adoptive") heir.faction = "custodian";
```

明确禁止：`legalFatherId = heir.adoptiveFatherId`；不为旧 `adoptiveFatherId` 创建 `AdoptionRecord`。`biologicalFatherId`/`legalFatherId` 必须**原样保留 `null`**（自孕），不得写成 `undefined`。

> 注：`biologicalMotherId = "sovereign"` 表示「皇帝亲生」。Slice A 现存皇嗣均为皇帝亲生，故此映射成立。未来引入非皇帝亲生的宗亲子女时，其 parentage 由对应出生/导入流程负责，不影响本迁移。

---

## 6. 出生流程接入

新生皇嗣出生后**立即**经 `establishBirthParentage` 写入完整 parentage（`biological = legal`，母 = `SOVEREIGN_PERSON_ID`，父 = 承嗣君 charId 或自孕则显式 `null`）。`Heir.fatherId` 作为持久化镜像继续写，须满足约束 7 一致性。出生若有承养/抚养安排，`custodianId` 一并设置。

**双生与原子性**：`resolveBirth` 可一次产出两名皇嗣（`twinSex`）。`establishBirthParentage` 必须对两个新 id **分别**调用，整个 birth effect 保持原子；两条 parentage 互不覆盖、不复用同一 key。难产结局 `child_dies` / `both` **不产生 Heir**，因此**不产生悬空 parentage**。

**不新增默认抚养政策**：Slice A **不得**从 `fatherId` 或 `bearer` 自动推导 `custodianId`；仅当现有流程明确指定抚养人时才设置 `custodianId`。

**皇后抚养≠法统过继**：现有 `heir_custody` effect 在抚养人为皇后时会把 `legitimate` 改为 `true`（funnel.ts）。这仍是抚养，不是宗祧过继——`legalFatherId` 保持 = `biologicalFatherId`，**不**生成 `AdoptionRecord`。实现者不得因「告宗庙、列为嫡出」把 custody 误解为 legal adoption。

**错误经 Result 通道，不抛异常**：`establishBirthParentage` 的重复建立（`PARENTAGE_ALREADY_ESTABLISHED`）必须经现有 `Result<GameState, GameError[]>` / effect validation 通道返回，**不**从 `applyEffects` 抛未捕获异常；失败时输入 state 保持不变。

---

## 7. 验收标准

1. 新生皇嗣出生后**立即**具有完整 parentage。
2. 未过继皇嗣满足两组分别相等：`legalMotherId === biologicalMotherId` 且 `legalFatherId === biologicalFatherId`。
3. 含旧 `adoptiveFatherId` 的存档迁移后：`custodianId` 正确；`legalFatherId === fatherId`；**未**生成 adoption record。
4. 现有抚养 bond、neglect、funnel、chronicle 行为**不变**（改读 `getCurrentCustodian` 后回归一致）。
5. 所有亲缘读取不再直接依赖 `Heir.fatherId`。
6. 运行时**不能**第二次建立或修改 biological parentage（`PARENTAGE_ALREADY_ESTABLISHED`）。
7. 缺少 parentage 的皇嗣**不能**通过 state validation。
8. 生身祖先（`getBiologicalAncestors`）与法统后代（`getLegalDescendants`）selector 能正确区分两条链。
9. v37 存档可迁移；v38 round-trip 后状态中**不再出现** `adoptiveFatherId`。
10. 空的 `adoptionRecords`、`royalResidences` 可正常保存与加载。
11. 双生出生**同时**建立两条独立 parentage（不同 key，互不覆盖）。
12. 自孕皇嗣的 `biologicalFatherId` 与 `legalFatherId` 显式为 `null`（非 `undefined`）。
13. `SOVEREIGN_PERSON_ID` 能通过 parentage 的 cross-link validation（不要求其存在于 `db.characters`）。
14. `Heir.fatherId` 与 `parentage.biologicalFatherId` 不一致时 validation **失败**（含 null 对比）。
15. 皇后抚养导致 `legitimate` 变化时，`legalFatherId` 不变且**无** `AdoptionRecord`。
16. 生产代码中旧 `adoptiveFatherId` 仅允许出现在 v38 legacy migration（`grep` 验收）；`faction:"adoptive"` 同理。
17. `src/store/adoption.ts` 及其 API 不再表示普通抚养关系（已改名为抚养语义，"adoption" 名释放给 Slice D）。
18. `createInitialState`、`createNewGameState` 及常用测试 fixture 均初始化三个新 map 与两个 `nextSeq` 计数器。
19. v38 round-trip 后 strict schema **不保留**任何旧字段/旧枚举值。
20. 双链 selector 测试使用**人工构造的 bio/legal 分歧数据**（而非仅未过继状态），证明两链可区分。
21. biological/legal 自环或祖先环**不能**通过 validation。
22. 悬空、错 child、非 active 的 `activeAdoptionRecordId`**不能**通过 validation。

---

## 8. 交付策略（PR 边界）

**Slice A 不可拆成 ①类型 ②迁移 ③rename ④selectors 四个各自合并到 `main` 的独立 PR。** 当前 runtime schema 为 `strictObject` 且 v37 是唯一在用版本——v38 必须与新 schema、两个 constructor、Heir 字段 rename、全部消费者、validation **同批**进入主分支，否则任何中间态都无法通过 strict 校验/类型检查。

落地方式（二选一，均为一个原子 Slice A）：

1. **单 PR，按 commit 分层**：类型/schema/空容器/两 constructor → v38 migration → `establishBirthParentage` + 出生接入 → 完整 custodian/adoption 旧术语迁移 → selectors → state validation → 全部消费者/fixture/测试/当前系统文档。
2. **stacked PR**：同上分层，但作为**依赖栈**（后者基于前者），不得各自直接合并到 `main`。

---

## 9. 延后项（明确不在 Slice A）

抚养关系历史（`GuardianshipRecord`）、承养/孕育历史实体（`GestationRecord`）、独立宗支实体（`LineageBranch`）、宗亲府生命周期、奉先殿过继命令（`adoptIntoHousehold`/`revokeAdoption`）、撤销/替换过继、法统变化事件与政治后果、京城导航与府邸 UI。各自由首个需要它的切片引入。

**人物池接入**：现有人物池（`familyMembers` / `officials` / `generatedConsorts` / `officialCandidates`）接入 parentage、以及正式「宗亲家庭成员」模型的整合/替换，**不属于** Slice A——待这些人物成为真实宗亲家庭成员的切片再处理。Slice A 的 parentage 完整性约束只覆盖 `Heir`。

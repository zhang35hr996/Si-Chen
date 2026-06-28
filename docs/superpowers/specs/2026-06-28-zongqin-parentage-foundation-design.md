# 宗亲府邸与宗祧系统 — Slice A：亲缘数据基础（Parentage Foundation）

> 设计日期：2026-06-28
> 状态：已确认设计，待写实现计划（writing-plans）
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

- **皇帝（sovereign）= 女性**，是其所有亲生皇嗣的**生身母亲**。她无 `db.characters` id，由哨兵 `"sovereign"` 表示，状态在 `state.sovereign`。
- `Heir.fatherId` = 承嗣君（男性侍君 charId）= **生身父亲**；`null` = 自孕（无父）。
- `Heir.bearer`/`carrier` = **承养/孕育**（`"sovereign"`=自孕，否则承载侍君 charId，妊娠转移）。这是孕育历史，**不是亲缘**——无论谁承载，生身母亲都是皇帝。
- `Heir.adoptiveFatherId` = 养父/抚养侍君（驱动 `custodianBond`/`neglect`/性格养成）= **抚养/监护关系**，**不是**奉先殿宗祧过继。
- 凤主=女性宗亲，贵主=男性宗亲（对应 daughter/son 线）。

---

## 1. 架构总则（硬性规则）

> **`state.parentage` 是所有角色生身亲缘与法统亲缘的唯一权威来源。**
> `Heir` 字段、人物详情、宗亲府列表、`kinship` 图中的相关字段都只能是**投影或派生索引**，不得反向修改 `parentage`。

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

interface CharacterParentage {
  characterId: CharacterId;

  // 生身：初始化后不可变
  biologicalMotherId?: CharacterId;
  biologicalFatherId?: CharacterId;

  // 法统：出生时 = 生身；仅正式过继可改（命令属 Slice D）
  legalMotherId?: CharacterId;
  legalFatherId?: CharacterId;

  // 当前生效过继；无过继时 undefined
  activeAdoptionRecordId?: AdoptionRecordId;
}

type AdoptionReason = "imperial_succession" | "preserve_branch" | "political_settlement";

interface AdoptionRecord {        // Slice A 仅定义类型 + 空 map；不写流程
  id: AdoptionRecordId;
  childId: CharacterId;

  previousLegalMotherId?: CharacterId;
  previousLegalFatherId?: CharacterId;
  newLegalMotherId?: CharacterId;
  newLegalFatherId?: CharacterId;

  fromResidenceId?: RoyalResidenceId;
  toResidenceId?: RoyalResidenceId;

  effectiveDate: GameTime;
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
  childIds: CharacterId[];
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
}
```

`Heir` 字段调整：

```ts
interface Heir {
  // ...
  fatherId: string | null;        // @deprecated 派生自 parentage.biologicalFatherId；不得作为亲缘真相读取
  bearer: "sovereign" | string;   // 保持现状（承养历史）；GestationRecord 延后
  custodianId?: CharacterId;      // 由 adoptiveFatherId 重命名而来（抚养/监护）
  // adoptiveFatherId: 删除
}
```

`AdoptionRecord` / `RoyalResidence` 类型保持克制：只保存稳定事实身份，**不**提前塞入审批流状态机、府中经济、家眷状态或谋反指标。

---

## 3. 六条约束（必须在实现中落实）

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

### 约束 5：`custodianId` 是完整 rename，不是新增别名
v38：`heir.custodianId = legacyHeir.adoptiveFatherId; delete heir.adoptiveFatherId;`。运行时代码、fixture、内容 schema、测试工厂、chronicle 文案全部改用 `custodianId`。旧存档 decoder 可接受 `adoptiveFatherId` 输入，但**新序列化结果不得**再写旧字段。schema 拒绝新状态中同时存在 `custodianId` 与 `adoptiveFatherId`。

### 约束 6：空容器只建形状，不预设行为
`adoptionRecords` / `royalResidences` 在 Slice A 加入，使 v38 一次性完成顶层状态形状升级，后续 C/D 不必再改存档根结构；相关 selector/validation 可提前认识这些字段。类型保持克制（见 §2）。

---

## 4. Selectors（纯查询，不含业务裁决）

纳入 Slice A：

```ts
getBiologicalParents(state, characterId): CharacterId[]
getLegalParents(state, characterId): CharacterId[]

getBiologicalChildren(state, characterId): CharacterId[]
getLegalChildren(state, characterId): CharacterId[]

getBiologicalAncestors(state, characterId, maxDepth?): CharacterId[]
getLegalDescendants(state, characterId, maxDepth?): CharacterId[]

getCurrentCustodian(state, childId): CharacterId | undefined  // 读 Heir.custodianId
```

**防循环**：legal parent 后续可因过继改变，故 `getLegalDescendants`（及任何 legal 链遍历）从一开始就带 `visited: Set<CharacterId>`，即使坏存档含环也不无限递归。

暂不纳入（属 C/D/E，会把 policy 混进基础 selector）：
`isEligibleForAdoption` / `isEligibleToInheritThrone` / `canMarry` / `chooseLineageHeir`。

**消费者改写**：所有原本读取 `Heir.adoptiveFatherId` 的逻辑改读 `getCurrentCustodian`，包括 `custodianBond`、`neglect`、抚养人性格对养成的影响、抚养人死亡/失势后的无人照料、皇帝召见频率补偿、皇嗣与养父互动、皇嗣详情「抚养人」。这些**不得**读 `parentage.legalFatherId`（否则过继后会把新法统父亲误当实际照料者）。所有亲缘读取不再直接依赖 `Heir.fatherId`。

---

## 5. v38 存档迁移

`SAVE_FORMAT_VERSION` 由 37 → 38，新增 `MIGRATIONS[37]`。固定顺序：

```text
1. 初始化 parentage / adoptionRecords / royalResidences（后两者为空 map）
2. 遍历所有 heirs，生成 parentage
3. adoptiveFatherId 重命名为 custodianId
4. 删除旧 adoptiveFatherId 字段
5. 运行迁移后 validation
6. 重新序列化为 v38（重算 checksum）
```

映射：

```ts
const sovereignId = "sovereign"; // 哨兵；生身/法统母亲

parentage[heir.id] = {
  characterId: heir.id,
  biologicalMotherId: sovereignId,
  biologicalFatherId: heir.fatherId ?? undefined,
  legalMotherId: sovereignId,
  legalFatherId: heir.fatherId ?? undefined,
};

heir.custodianId = heir.adoptiveFatherId; // 可能 undefined
delete heir.adoptiveFatherId;
```

明确禁止：`legalFatherId = heir.adoptiveFatherId`；不为旧 `adoptiveFatherId` 创建 `AdoptionRecord`。

> 注：`biologicalMotherId = "sovereign"` 表示「皇帝亲生」。Slice A 现存皇嗣均为皇帝亲生，故此映射成立。未来引入非皇帝亲生的宗亲子女时，其 parentage 由对应出生/导入流程负责，不影响本迁移。

---

## 6. 出生流程接入

新生皇嗣出生后**立即**经 `establishBirthParentage` 写入完整 parentage（`biological = legal`，母 = `"sovereign"`，父 = 承嗣君或自孕则 `undefined`）。`Heir.fatherId` 作为 `@deprecated` 派生镜像可继续写（便于渐进迁移），但**不得**被任何亲缘 selector 当作真相读取。出生若有承养/抚养安排，`custodianId` 一并设置。

---

## 7. 验收标准

1. 新生皇嗣出生后**立即**具有完整 parentage。
2. 未过继皇嗣满足 `legal === biological`（四字段显式相等）。
3. 含旧 `adoptiveFatherId` 的存档迁移后：`custodianId` 正确；`legalFatherId === fatherId`；**未**生成 adoption record。
4. 现有抚养 bond、neglect、funnel、chronicle 行为**不变**（改读 `getCurrentCustodian` 后回归一致）。
5. 所有亲缘读取不再直接依赖 `Heir.fatherId`。
6. 运行时**不能**第二次建立或修改 biological parentage（`PARENTAGE_ALREADY_ESTABLISHED`）。
7. 缺少 parentage 的皇嗣**不能**通过 state validation。
8. biological / legal ancestor selector 能正确区分两条链。
9. v37 存档可迁移；v38 round-trip 后状态中**不再出现** `adoptiveFatherId`。
10. 空的 `adoptionRecords`、`royalResidences` 可正常保存与加载。

---

## 8. 延后项（明确不在 Slice A）

抚养关系历史（`GuardianshipRecord`）、承养/孕育历史实体（`GestationRecord`）、独立宗支实体（`LineageBranch`）、宗亲府生命周期、奉先殿过继命令（`adoptIntoHousehold`/`revokeAdoption`）、撤销/替换过继、法统变化事件与政治后果、京城导航与府邸 UI。各自由首个需要它的切片引入。

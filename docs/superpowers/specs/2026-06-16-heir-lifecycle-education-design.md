# 子嗣系统完善：命名 · 教育 · 养父 — 设计 (Spec)

**Date:** 2026-06-16
**Branch:** feat/heir-lifecycle-system
**Status:** Implemented (2026-06-17)

## 1. 背景与目标

现状：皇嗣（`Heir`）出生后只有出生序号派生名（`大皇子`/`二皇郎`）、宠爱度、嫡庶标记。
缺少：姓名、养成属性、成长阶段互动、养父归属。

本设计为皇嗣补全一条「出生 → 命名 → 婴幼 → 开蒙 → 教育 → 养父」的生命周期，并新增两处主图入口（**上书房**、**奉先殿**）。

设定为性别倒置：玩家为女性**帝王**，侍君为男性；`皇子`=女儿(daughter)、`皇郎`=儿子(son)；`凤后`=男性正宫；冷宫居民以 `defaultLocation === "lenggong"` 静态标记，死亡以 `standing.lifecycle === "deceased"` 标记。

### 不做（YAGNI）
- 太后（皇帝生父）角色：本期不建，养父池暂不含太后。
- 动态贬入冷宫机制：沿用现有静态 `defaultLocation`。
- AI 生成台词：全部用脚本模板台词（与现有对话/侍寝/位分反应同构）。
- 皇嗣婚配、成年、夺嫡等后续玩法。

## 2. 架构约束（必须遵守）

1. **唯一写路径**：所有状态变更只经 `applyEffects` 漏斗；新机制 = 新 `EventEffect` 类型 + `eventEffectSchema` 校验分支 + funnel apply 分支。
2. **纯函数派生**：年龄、阶段、到期判定（百日宴/开蒙）为纯派生函数，不存冗余状态。
3. **脚本台词**：经 `ReactionScreen` 重放纯台词数组；装配层（`src/store/*.ts`）解析配置→裁决→组装 effects+lines。
4. **确定性**：随机（随机小名）走种子化 `gestationRoll`/同类工具，不用 `Math.random`。
5. **存档迁移**：`saveSystem`/`stateSchema` 增字段须带向后兼容默认值（与现有 V2 迁移同构），旧档可读。
6. **±10 通用 cap**：内容声明的 delta 仍 ±10；本期 UI/引擎构造的皇嗣效果自带边界、直接 clamp 0–100，不经 `cappedDelta`。

## 3. 数据模型

### 3.1 `Heir` 扩展（`src/engine/state/types.ts`）

```ts
export interface HeirEducation {
  /** 学问 0–100 */ scholarship: number;
  /** 骑射 0–100 */ martial: number;
  /** 品行 0–100 */ virtue: number;
}

export interface Heir {
  id: string;
  sex: HeirSex;
  fatherId: string | null;
  bearer: "sovereign" | string;
  birthAt: GameTime;
  favor: number;
  legitimate: boolean;
  // ── 新增 ──
  /** 小名（2 字），出生时设。 */
  petName: string;
  /** 正名/姓名（2 字），百日宴设；未命名为 undefined。 */
  givenName?: string;
  /** 养成属性。 */
  education: HeirEducation;
  /** 养父 charId；未指定为 undefined。 */
  adoptiveFatherId?: string;
}
```

初始 `education`：`{ scholarship: 5, martial: 5, virtue: 5 }`（低起点，靠教育成长）。

### 3.2 存档兼容

- `stateSchema` 的 heir 子 schema 增 `petName`（默认 `""`）、`givenName?`、`education`（默认 `{5,5,5}`）、`adoptiveFatherId?`。
- 旧档读取：缺字段补默认值；`petName===""` 视作「未起小名」，列表回退显示序号名。

## 4. 派生函数（`src/engine/characters/heirs.ts`）

```ts
/** 月龄：按 monthOrdinal 差。 */
heirAgeMonths(heir, now): number  // monthOrdinal(now) − monthOrdinal(birthAt)

type HeirStage = "infant" | "toddler" | "schooling";
/** [0,3岁)=infant；[3,5岁)=toddler；≥5岁=schooling。年龄用 heirAge（周岁）。 */
heirStage(heir, now): HeirStage

/** 百日宴待办：月龄≥3 且 petName 已起但 givenName 未定 且 child 存活。 */
centennialDue(heir, now): boolean

/** 开蒙：heirStage === "schooling"（≥5 周岁）。 */
isEnrolled(heir, now): boolean
```

阶段→立绘 key：`infant`/`toddler` → `child/baby.png`；`schooling` → `child/child.png`（经 AssetRegistry，需在 `assets/manifest.json` 注册两张立绘）。

## 5. 新增效果（`schemas.ts` + `funnel.ts`）

| effect | 字段 | 边界 / 校验 | apply |
|---|---|---|---|
| `heir_name` | `heirId`, `field: "pet"\|"given"`, `name: string(2)` | heir 存在；name 1–2 字 | 设 `petName`/`givenName` |
| `heir_summon` | `heirId` | heir 存在 | `favor = clamp(favor + 20)` |
| `heir_educate` | `heirId`, `subject: "scholarship"\|"martial"\|"virtue"`, `attrDelta`, `favorDelta` | heir 存在；delta 0–20 | `education[subject] += attrDelta`（clamp）；`favor += favorDelta`（clamp） |
| `heir_adopt` | `heirId`, `fatherId: string` | heir 存在；fatherId 为在宫(非冷宫)、非 deceased 的 consort | 设 `adoptiveFatherId` |

所有新增效果直接 clamp 0–100，不经 `cappedDelta`（与 `child_favor` 的 ±10 cap 区分开——`child_favor` 维持原样供 ±5 手动微调）。

## 6. 命名流程

### 6.1 出生起小名
- birth 提交后（heir 已入 `bloodline.heirs`），App 取**最新一胎**弹「起小名」modal：
  - 文本框（限 2 字）+「随机」按钮。随机取自内置 2 字名库（`src/engine/characters/heirNames.ts`，种子 = `rngSeed + heir.id`），`gestationRoll` 选词，确定性。
  - 确认 → `heir_name {field:"pet"}`。
- 出生播报顺序：BirthScreen 台词 → commitBirth(effect) → 起小名 modal → 既有产后晋升/凤后贺词反应。

### 6.2 百日宴赐名
- App 每次渲染检测 `centennialDue` 的第一名皇嗣（多胎逐个），自动弹「百日宴·赐名」modal（与「孕三月宗正寺」自动弹窗同构，可「稍后再说」临时收起，换旬/换地图重置）：
  - 文本框（限 2 字）正名 → `heir_name {field:"given"}`。
  - 司礼官一句贺词经 ReactionScreen。

### 6.3 列表显示（`HeirListModal`）
行格式：`{序号名}{（嫡）?}：{givenName ?? "—"}{（petName）?}`
例：`大皇子（嫡）：长安（环环）`；未行百日宴：`二皇郎：—（团团）`；未起小名：`二皇郎`。
另显月龄/周岁、承嗣者、宠爱、三项养成属性（开蒙后）、养父（若有）。

## 7. 御书房·召见皇嗣（P2）

- `HeirListModal`（御书房入口已有「子嗣」按钮）每行加「召见」按钮，`disabled` 当 `ap < 1`。
- 点选 → 装配层 `buildHeirSummon(db,state,heirId)` 返回 `{ effects:[heir_summon], lines }`：
  - `infant`：襁褓之趣脚本（baby.png）。
  - `toddler`：天真烂漫童趣对答脚本（baby.png），按 favor 深浅 2–3 档。
  - `schooling`：已能对答脚本（child.png）。
- 流程：扣 1 AP（`SPEND_AP`）→ applyEffects(+20 favor) → autosave → ReactionScreen 播台词。立绘以皇嗣 stage 选 child/baby|child.png。`rolledOver` 时按现有 `reactionRollover` 补跑 time_advance checkpoint。

## 8. 上书房（P3）

### 8.1 地点 (`content/locations/shangshufang.json`)
travel 地点，`zone:"palace"`，`backgroundKey:"bg.shangshufang"`，主图 node（位置待定）。需在 world.json `mapBoards`/位置体系内可达；`assets/manifest.json` 注册 `bg.shangshufang`。

### 8.2 屏内行动（仿御书房 menu 段，均 1 AP）
- **问先生读书情况**：选一名开蒙皇嗣 → 先生（`sili_nvguan` 立绘/官员）按三项属性高低分支脚本汇报，不改属性（纯汇报）或仅极小 favor。
- **召见开蒙皇嗣问功课**：仅 `isEnrolled` 皇嗣 → `buildHeirLesson` 返回 `heir_educate`（随机/轮换一科 +N、favor +M）+ child.png 脚本台词。

无开蒙皇嗣时显「尚无皇嗣开蒙」空态。

## 9. 奉先殿（P4）

### 9.1 地点 (`content/locations/fengxiandian.json`)
travel 地点，`zone:"palace"`，`backgroundKey:"bg.fengxiandian"`，主图 node。注册 `bg.fengxiandian`。祭祖描述文案。

### 9.2 择养父行动
- 屏内「为皇嗣择养父」→ 选皇嗣 → 选养父（modal）。
- **养父候选池**：`db.characters` 中 `kind==="consort"` 且 `defaultLocation !== "lenggong"` 且 `standing.lifecycle !== "deceased"`，含 `feng_hou`。排除该皇嗣自身生父亦可（生父在宫时仍可改立他人；是否允许立生父为养父 → 允许但无意义，UI 可不禁）。
- 应用 `heir_adopt` → 谢恩播报，分两路：
  - **原无可依生父**（`fatherId===null` ∥ 生父 `deceased` ∥ 生父 `defaultLocation==="lenggong"`）：养父前来谢恩，承诺教养皇子/皇郎。
  - **生父尚在宫中**（生父存活且非冷宫）：养父谢恩 + 司礼官加报「听闻生父泪如雨下」（两段台词经 ReactionScreen）。
- 判定生父可依性的纯函数：`bioFatherAvailable(db,state,heir): boolean`。

## 10. 分期与测试

每期 TDD（先测后码，参照现有 `tests/effects/funnel.*.test.ts`、`tests/store/*.test.ts`、`tests/state/*.test.ts`、`tests/save/migration*.test.ts`）：

- **P1 基础**：`Heir` 扩展 + 派生函数 + `heir_name` 效果 + 出生起小名 + 百日宴 + 列表显示 + 存档迁移。
  测试：funnel `heir_name` 校验/apply、`heirStage`/`centennialDue`/`heirAgeMonths`、迁移旧档补默认。
- **P2 御书房召见**：`heir_summon` 效果 + `buildHeirSummon` + UI 接线。
  测试：+20 favor clamp、阶段台词选择、AP 扣减。
- **P3 上书房**：地点 + `heir_educate` 效果 + `buildHeirLesson`/问先生 + UI。
  测试：`heir_educate` 校验/apply（属性+favor clamp）、开蒙过滤、地点 schema。
- **P4 奉先殿**：地点 + `heir_adopt` 效果 + `bioFatherAvailable` + 谢恩分支 + UI。
  测试：`heir_adopt` 候选池校验（拒冷宫/已故）、两路播报分支、地点 schema。

## 11. 风险与缓解
- **存档破坏**：新字段必须有迁移默认值；新增 migration 测试覆盖「旧档无新字段」。
- **+20 越过 ±10 cap**：用专用 `heir_summon` 效果绕开 `cappedDelta`，并加测试钉死 +20 不被截断。
- **百日宴/小名弹窗与现有自动弹窗（宗正寺/生产）叠放**：复用现有「逐条 due + 可临时收起 + 换旬重置」编排，确保优先级不冲突（生产 > 百日宴 > 普通事件）。
- **主图新增 node 位置/可达性**：参照现有 `yushufang` 的 zone/connections/travelCost 与 map node 渲染。

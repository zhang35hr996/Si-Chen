# 御书房交互重构 — 设计文档

**日期：** 2026-06-18
**主题：** 御书房（yushufang）菜单与子嗣/侍君/翻牌子交互重构

## Context（背景）

御书房当前由通用 `LocationScreen.tsx` 渲染，内联塞了两块：「行动」（批阅奏折 / 独自休息）与「后宫名册」（翻牌子按钮 + 召见太医/宗正寺/子嗣 + 一长串侍君 roster，每行带管理/候选承嗣按钮）。信息散乱、层级不清，且把所有侍君铺平展示，缺少「召见」的代入感。

本次重构把御书房整理成一个清晰的 **5 项主菜单 + 杂务分组**，并将「查看」与「召见」分离：查看（子嗣/侍君）零行动点，召见/对话/侍寝才扣点。翻牌子改为更具仪式感的「牌子托盘」，选牌后侍君被召至御书房再决定对话或侍寝。

**约束：** 仅改 UI 层与少量 App 状态接线；不改引擎逻辑、掷骰、行动点与孕事流程——全部复用现有 store handler。

## 主菜单（御书房）

替换 `LocationScreen.tsx` 中 `location.id === "yushufang"` 的内联「行动」「后宫名册」两 `<section>`，改为一个动作菜单，5 个主选项：

| 选项 | 行为 | 复用 handler | 行动点 |
|---|---|---|---|
| 奏折 | 批阅奏折 | `onReviewMemorials` (`reviewMemorials`) | 2（AP<2 禁用）|
| 休息 | 独自休息（弃当旬剩余 AP 进次旬）| `onRestAlone` (`restAlone`) | — |
| 查看子嗣 | 打开子嗣弹窗 | `onOpenHeirs`（`heirListOpen`）| 0 |
| 查看侍君 | 打开侍君弹窗 | 新 `onOpenConsorts` | 0 |
| 翻牌子 | 打开牌子托盘 | `onFlipTablet`（`flipOpen`）| 翻牌 0，侍寝时扣 1 |

**杂务分组**（仅条件满足时渲染对应按钮）：
- 召见太医 — `onSummonPhysician`（保持现状，常驻）
- 召见宗正寺 — `onSummonZongzheng`（仅 `canSummonZongzheng` 时传入）

候选承嗣（设为/取消）属于「按角色」的操作，移入「查看侍君」详情（仅帝王自孕 `sovereignPregnant` 时显示），不放杂务组。

旧的内联侍君 roster（含每行「管理」「候选承嗣」按钮）整体移除，其功能迁入「查看侍君」。

## 查看子嗣（弹窗内钻取）

改造 `HeirListModal.tsx`，新增 `view: "list" | "detail"` 局部状态。

- **列表态**：沿用皇子（daughter）/ 皇郎（son）两表，每行显示名号 + 小名/正名 + 岁数。整行可点 → 进入该皇嗣详情。
- **详情态**：
  - 立绘：`heirPortraitSet(heir, calendar)` → `"child_baby" | "child_school"`，经 `registry.portrait(set, "neutral")` 渲染（与 `ChildReactionScreen` 同法）。需给 `HeirListModal` 新增 `registry` prop。
  - 年龄：`heirAge` 岁；幼年（infant/toddler）附 `heirAgeMonths` 月龄。
  - 承嗣：`bearerLabel`（自孕/承嗣君，已故标注）；养父：`adoptiveFatherId`（若有）。
  - 嫡、生辰、宠爱（**只读**，无 ± 调整）。
  - 学问/骑射/品行：`isEnrolled` 时显示。
  - **召见** 按钮：`onSummon`（`summonHeir`，1 行动点，`canSummon` 即 AP≥1 时可用）。
  - 返回：回到列表态。

移除原 ± 宠爱调整：删 `onAdjust` prop 与 `App.adjustHeirFavor` 接线（`child_favor` 引擎效果保留供事件使用）。

打开弹窗、钻取、查看属性均为纯渲染，零行动点。

## 查看侍君（弹窗内钻取）

新增 `src/ui/components/ConsortListModal.tsx`，结构与 `HeirListModal` 对称（`view: "list" | "detail"`）。

- **列表态**：宫中侍君——`kind === "consort"` 且 `lifecycle !== "deceased"` 且 `defaultLocation !== "lenggong"`（与翻牌子同一过滤，排除冷宫与已故），含凤后，按 `effectiveOrder` 位分降序。整行可点 → 详情。
- **详情态**：
  - 立绘：`registry.portrait(character.portraitSet, "neutral")`。
  - 位分（rank）+ 封号（`standing.title`）。
  - 五维属性：容貌/才情/家世/健康/承养（`character.attributes`，复用 `CharacterCard` 的 `ATTRIBUTE_LABELS` 顺序，提取为共享常量或就地重列）。
  - 恩宠档 + 侍寝频次：`computeFavorStats` + `FAVOR_TIER_LABEL`（复用 `CharacterCard` 逻辑）。
  - 抚养的皇嗣：`heirs.filter(h => h.fatherId === id || h.adoptiveFatherId === id)`，列名号/小名。
  - 按钮：
    - 封号管理 — `onManage(id)`（`setManageCharId` → `RankAdminModal`）；凤后（`feng_hou`）隐藏。
    - 召见 — `onSummon(id)`：召至御书房（见下）。
    - 候选承嗣开关 — `sovereignPregnant` 时：`onAddCandidate`/`onRemoveCandidate`（依 `lifecycle`）。
  - 返回：回到列表态。

零行动点查看。

## 翻牌子（牌子托盘）

改造 `BedchamberPicker.tsx`：

- 候选过滤：`kind === "consort"` 且 `lifecycle !== "deceased"` 且 `defaultLocation !== "lenggong"`（新增排除冷宫）。沿用 `effectiveOrder` 排序，保留凤后。
- 视觉：一个托盘容器，内排每位侍君一块**竖刻名牌**——`writing-mode: vertical-rl` 的姓名，下方小字位分。
- 行为：点牌子 → `onPick(id)`，语义改为**召至御书房**（不再直接进侍寝模式选择）。

## 召见到御书房（新瞬时状态）

`App.tsx` 新增 `summonedConsortId: string | null`。

- 触发：翻牌子选牌（`onPick`）或查看侍君「召见」→ `setSummonedConsortId(id)` 并关闭对应弹窗。召见本身**零行动点**。
- 呈现：`LocationScreen` 收 `summonedConsortId` prop；当处于御书房且该 id 有效且其角色不在 `present` 中时，把该侍君并入在场列表，渲染其 `CharacterCard`。卡上按钮（均已存在）：对话（`converse`，1 AP）、侍寝（`beginBedchamber` → 侍寝流程，提交时扣 1 AP）、管理位分/封号（`onManage`，凤后隐藏）。新增「退下」清除召见。
- 清除：对话/侍寝提交后（`converse` 末尾、`commitBedchamber`）、离开御书房（视图切换）或点「退下」时 `setSummonedConsortId(null)`。

`beginBedchamber` 已含 `setFlipOpen(false)`，沿用；`onPick` 由「直接 beginBedchamber」改为「setSummonedConsortId」。

## 行动点规则汇总

- 零消耗：打开查看子嗣/侍君、列表↔详情钻取、查看属性、翻牌子开盘与选牌、召见到御书房、退下。
- 扣点：奏折（2）、召见皇嗣（1）、对话（1）、侍寝（提交 1）。休息走 `SKIP_REMAINDER`。

## 文件改动清单

- `src/ui/screens/LocationScreen.tsx` — 御书房菜单重构 + 召见卡渲染（新 props：`onOpenConsorts`、`summonedConsortId`、`onDismissSummon`）。
- `src/ui/components/HeirListModal.tsx` — 列表/详情钻取；新增 `registry` prop；移除 `onAdjust` 与 ± UI。
- `src/ui/components/ConsortListModal.tsx` — 新建。
- `src/ui/components/BedchamberPicker.tsx` — 牌子托盘 + 排除冷宫 + 召见语义。
- 抽共享 helper（如 `src/engine/characters/standing.ts` 内 `inPalaceConsorts(db, state)`）：`kind === "consort" && lifecycle !== "deceased" && defaultLocation !== "lenggong"`，按 `effectiveOrder` 降序；查看侍君与翻牌子共用，避免过滤漂移。
- `src/ui/App.tsx` — `summonedConsortId` 状态与接线；`onOpenConsorts`；翻牌子 `onPick` 改为召见；清除时机；移除 `adjustHeirFavor`。
- `src/ui/styles.css` — 御书房菜单、子嗣/侍君详情、牌子托盘样式（沿用既有朱砂鎏金主题令牌）。
- 引擎/store：不改。

## 测试与验证

- `npm run typecheck` 通过；`npm run test` 既有用例不回归。
- Playwright 手测端到端：
  1. 进入御书房 → 见 5 主选项 +（孕期时）杂务组。
  2. 查看子嗣 → 点皇嗣 → 见立绘（按年龄 baby/school）、年龄、属性；宠爱只读；召见扣 1 AP。
  3. 查看侍君 → 列表仅宫中侍君（冷宫/已故不出现）→ 点侍君 → 见五维、恩宠、抚养皇嗣、封号管理、召见；孕期见候选承嗣开关。
  4. 翻牌子 → 牌子托盘竖排名牌（同样冷宫/已故不出现）→ 点牌 → 御书房出现该侍君卡 → 对话/侍寝可用并各扣 1 AP；退下清除。
  5. 查看类操作前后 AP 不变。

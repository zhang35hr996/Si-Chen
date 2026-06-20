# UI / BGM / 后宫院子 重构 — 设计

日期：2026-06-19
范围：六项独立改动（属性删除、地图红点删除、直接进入 + 后宫院子、翻牌子全屏、BGM 系统、设置菜单）。
约束：处于发布前，存档不做向后兼容迁移（见 memory `no-save-backcompat`）。

---

## 1 · 删除属性：后宫和睦/妒意 + 宗嗣合法性

完全从数据模型移除，而非仅隐藏。

- `harem` 支柱仅含 `harmony` / `jealousy` 两项 → **整个 `harem` 支柱删除**。
- `bloodline.legitimacy` 删除；`bloodline` 其余字段（pregnancy / gestations / heirs / menstrualStatus）保留。

涉及文件：
- `src/engine/state/types.ts` — 删 `HaremResources`（harmony/jealousy）与 `bloodline.legitimacy`；删 `Resources.harem`。
- `src/engine/content/schemas.ts` — 删 harem field 枚举（`harmony`/`jealousy`）的 resource effect 分支、`legitimacy` effect 分支；删 world `startingResources.harem` 与 `bloodline.legitimacy`；从 pillar 枚举移除 `harem`。
- `src/engine/save/stateSchema.ts` — 删 `harem` 与 `legitimacy`。
- `src/engine/state/initialState.ts` — 删 `harem` 与 `legitimacy` 初值。
- `content/world.json` — 删 `startingResources.harem`、`bloodline.legitimacy`。
- `src/engine/effects/funnel.ts` — 删 legitimacy 累加分支与 harem harmony/jealousy 应用分支。
- `src/store/taihou.ts` — 删 harem harmony effect。
- `src/ui/components/ResourcePanel.tsx` — 删三条 Bar（和睦/妒意/宗嗣合法性）。
- `src/ui/debug/DebugPanel.tsx` — 删 harmony 调试控制。

内容脚本：删除引用这些 field 的 effect 行（脚本保留，仅去掉失效 effect）：
- `content/scenes/sc_taihou_converse.json`（legitimacy）
- `content/scenes/sc_court_zhenzai.json`（legitimacy）
- `content/scenes/sc_shen_neglect.json`（jealousy ×2）
- `content/scenes/sc_fenghou_rules.json`（harmony ×2）
- `content/scenes/sc_menses_rite.json`（legitimacy ×2）

测试：同步更新引用这些 field 的断言（funnel / schemas / initialState / loader 等）。

> ⚠️ 注意：`harem` 一词有两处无关用法。要删的是**资源支柱** `resources.harem`（harmony/jealousy）。位分 `ranks[].domain: "harem"`（恩宠域）与 `bedchamber` 等是另一概念，**保留不动**。

---

## 2 · 删除主地图事件红点

`src/ui/screens/MapScreen.tsx`：移除节点上的 `map-node__event` 标记（`renderNode` 中 `showEvent` 分支），含宣政殿"可上朝"那枚红点。地图节点只保留名称。相关样式 `.map-node__event` 一并清理。

---

## 3 · 直接点击进入 + 后宫院子

### 3a 主地图直接进入
`MapScreen` 删掉右侧 `LocationInfoPanel` 与 `selected` 选中态。点击节点即行动：
- 可达据点（travel ok）→ 直接执行 `travel()` 并进入，**需行动点者静默扣点、不二次确认**。
- 免行动点据点（`entry === "free"`，如宣政殿）→ 直接 `onOpenView`（或对应进入逻辑）。
- 不可达据点 → 点击无效（可保留禁用视觉/toast，但不弹面板）。
- 城门/出宫 portal（京城，扣 1 行动点）与 board portal（后宫/郊外）保留现有 AP 语义，点击即进入。

### 3b 后宫院子（新增 `CourtyardScreen`）
新增 view `"courtyard"`，由 `App` 持有 `courtyardLocId`。后宫网格（`HaremGrid`）点某宫 → `setCourtyardLoc(locId)` → `view="courtyard"`（不再走右侧信息栏选中）。

`CourtyardScreen` 渲染：
- 背景 `bg.gongdian_yuanzi`（早/黄昏/晚三时段，复用 `registry.resolveVariant` + `timeOfDay`）。
- **7 座设宫室居所**（`CHAMBERED_PALACES`）：左→右排 5 个殿入口
  `西偏殿｜西侧殿｜主殿(居中)｜东侧殿｜东偏殿`，对应 `CHAMBERS`（west_annex/west_side/main/east_side/east_annex）。
  每殿按 `chamberOf(standing)` 找住客：有人显名（点击进入该侍君场景），空置显"空置"（点击无动作）。
- **3 座特殊宫**（坤宁/长门/储秀）：院子只渲染居中的**主殿**入口，住客为该宫住客（单居所）。

点某殿入口 → 进入该侍君场景：触发对该宫的 travel（沿用现有 AP 语义），进入后 `CharacterScene` 直接聚焦该住客（新增 `focusConsortId`/`initialChamber` 入参，跳过顶部宫室切换条的默认选中）。

院子结构为日后"院中剧情"预留（本次不实现具体事件，只搭 view 结构）。

返回：院子 → 后宫网格。

---

## 4 · 翻牌子全屏化

`src/ui/components/BedchamberPicker.tsx` 由 modal 小窗改为全屏：
- 背景 `bg.fanpaizi`。
- 画面中央一个托盘容器，现有侍君名牌平铺其上。
- 点名牌即选定 → 沿用现有 `onPick(id)`。
- 保留关闭/返回。

需在 manifest 注册 `bg.fanpaizi`。

---

## 5 · BGM 系统（新增）

新增 `AudioController`（单例 + 一个常驻循环 `<audio>`），按当前场景切歌、循环播放、切场景换歌。

场景 → 曲目：

| 场景 | 文件 |
|---|---|
| 开始画面（view `title`） | `bgm/main.mp3` |
| 后宫（hougong board / 院子 / 后宫居所 location） | `bgm/hougong.mp3` |
| 郊外（jingjiao board / zone） | `bgm/jiaowai.mp3` |
| 京城（jingcheng board / zone） | `bgm/market.mp3` |
| 其余（紫禁城内廷、御书房、事件等） | `bgm/wenqing.mp3` |

实现：
- 集中函数 `trackFor(view, board/zone)` → trackId。`App` 在 view/board/playerLocation 变化时调用 controller 切歌（同曲不重启）。
- 循环播放（`loop`）。切歌即停旧放新（可选淡入淡出，最小实现可直接切）。
- 音量 / 静音持久化到 `localStorage`，由设置菜单控制。
- 浏览器自动播放策略：首次用户交互（如点"新游戏"）后启动播放。

资源整理：
- 删除 `public/assets/bgm/*.Zone.Identifier` 杂项文件。
- 把 `Market of the Prosperous.mp3` 重命名为 `market.mp3`（避免空格 URL 问题）。

---

## 6 · 右上角"存档" → "设置"

- `src/ui/components/TopStatusBar.tsx`：将"存档"按钮改为"设置"，回调 `onOpenSettings`。
- 新增全屏设置菜单（背景 `bg.game_setting`），4 个选项：
  1. **读档** → `SaveLoadScreen` `mode="load"`（仅读取 + 从文件导入；无保存按钮）。
  2. **存档** → `SaveLoadScreen` `mode="save"`（仅保存 + 导出；无读取按钮）。
  3. **音乐** → 音量滑块 + 静音开关（驱动 `AudioController`，持久化）。
  4. **返回游戏主界面** → 离开前 `doAutosave()`，再 `setView("title")`。
- `SaveLoadScreen` 增加 `mode: "load" | "save"` 入参，按模式过滤动作与导入/导出区。
- `App` 中 `onOpenSave` 链路改为 `onOpenSettings`；各屏透传同步更新。

需在 manifest 注册 `bg.game_setting`。

---

## 资产注册清单（manifest）

需新增 `assets/manifest.json` 条目：
- `bg.gongdian_yuanzi`（morning，默认）、`bg.gongdian_yuanzi.twilight`、`bg.gongdian_yuanzi.night`
- `bg.fanpaizi`
- `bg.game_setting`

（对应 `public/assets/backgrounds/` 已存在的 PNG。）

---

## 影响面 / 模块边界

- **纯 UI 新增**：`CourtyardScreen`、设置菜单组件、`AudioController`。边界清晰，可独立测试。
- **UI 改动**：`MapScreen`（删面板/红点/直接进入）、`HaremGrid`（点宫→院子）、`BedchamberPicker`（全屏）、`TopStatusBar`（设置）、`SaveLoadScreen`（mode）、`CharacterScene`（focus 入参）。
- **引擎/内容**：属性删除（types/schemas/state/funnel/world/scenes/tests）—— 横切但机械。
- 存档不迁移。

## 测试策略

- 属性删除：更新现有 funnel/schemas/initialState/loader 测试，确保移除字段后类型与校验通过。
- `trackFor` 映射：纯函数单测（各 view/board → 期望 trackId）。
- 院子住客映射：`chamberOf` 已有；CourtyardScreen 可对"哪个殿显示哪位住客/空置"做组件级断言。
- 其余 UI 行为以手动验证为主。

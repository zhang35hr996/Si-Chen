# 库房（国库）数据模型 + 库房UI + 赏赐流程 — 设计

> Spec A（共两部分）。A=本文：铜钱字段改造 + 物品目录 + 库存 + 库房UI + 赏赐流程。
> B（后续单独 spec）=五种获取途径（属地进贡 / 大臣进献 / 秋猎 / 万宝楼 / 醉仙楼）。

## 目标

新增「国库」入口：打开后进入库房管理菜单。顶部显示国库铜钱数量（如「铜钱：10,000 两」），
下方列出库房里的各种物品（珠宝/首饰/书画/妆品/香/绸缎/皮毛/文房/乐器/玩器/点心/茶饮/珍味/
器玩/珍禽异兽），每行「名称 ×数量」附一枚「赏赐」按钮。点击赏赐打开 3-tab 选人弹窗
（侍君 / 皇嗣 / 宗亲，宗亲暂空），选一人确认后扣 1 件库存、提升目标恩宠（侍君另加好感）。

## 1. 铜钱：treasury 从 0–100 改为纯数字

当前 `nation.treasury` 是 0–100 充盈度抽象。本 spec 将其改为**纯数字铜钱（单位：两）**，初始 **10000**。
这是赏赐/采买经济的货币本位。波及面（全部在本 spec 内完成）：

| 文件 | 改动 |
|---|---|
| `content/world.json` | `nation.treasury` 50 → **10000** |
| `src/engine/state/initialState.ts` | `treasury: 50` → `10000` |
| `src/engine/save/saveSystem.ts` | 旧档回填默认 `treasury: 50` → `10000` |
| `src/engine/content/schemas.ts` | `startingResources.nation.treasury` 由 `percent` → 非负整数 schema（`z.number().int().min(0)`） |
| `src/engine/save/stateSchema.ts` | 同上，`treasury: percent` → 非负整数 |
| `src/engine/state/types.ts` | 注释「国库（0–100 充盈度抽象）」→「国库（铜钱，单位：两）」 |
| `src/engine/effects/funnel.ts` | **关键**：当前 L282 对所有 nation 字段 `clampPct`(0–100)。treasury 改为只 `Math.max(0, …)`（无上限、不破百），其余 nation 字段维持 `clampPct` |
| `src/store/temple.ts` | 上香「大吉」的 `nat("treasury", 4..6)` 在百分制下是「+4~6 充盈度」，纯数字下意为「+4~6 两」（过小）。改为 coin 量级 `mag(key,"ex",200,400)`（+200~400 两） |
| `src/ui/components/ResourcePanel.tsx` | 「国库」行已是 `NumberLine`（非形容词）。改为显示「{千分位} 两」 |

> `treasury` 保留在 `resource/nation` 效果枚举中（authored 效果仍可加减国库），只是其钳制改为「下限 0、无上限」。
> 采买/赏赐走专用 helper（见 §3），不依赖该通用效果路径。

## 2. 物品目录（content/items.json + db.items）

新内容文件 `content/items.json`，由 loader 装入 `db.items: Record<string, ItemDef>`，Zod 校验。

```ts
interface ItemDef {
  id: string;        // luozidai
  name: string;      // 螺子黛
  category: ItemCategory;
  tier: "common" | "fine" | "treasure" | "marvel"; // 普通/上乘/珍品/宝物
  tags: string[];    // 命中侍君 likes 触发「投其所好」，如 ["文房","古籍"]
}
type ItemCategory =
  | "妆品" | "香" | "绸缎" | "皮毛" | "文房" | "乐器"
  | "玩器" | "点心" | "茶饮" | "珍味" | "器玩" | "珍禽异兽";
```

本 spec 即把需求中列出的全部物品（约 200 项，A、B 共用此目录）录入，逐项指定 `tier` 与 `tags`。
tier 编录原则示例：兔毛/野雉尾羽=common，貂皮/鹿皮=fine，狐皮/虎皮=treasure，银狼皮/南海夜明珠/
御制龙香墨=marvel；古籍孤本=`tags:["文房","古籍"]` 等。

## 3. 赏赐与铜钱逻辑（src/store/treasury.ts，纯函数，TDD）

```ts
// 基础值按 tier
const TIER_BASE = { common: 2, fine: 4, treasure: 7, marvel: 12 } as const;
```

- **`bestow(state, db, itemId, recipientKind, recipientId)`** → 新 state（或错误）
  - 库存 `items[itemId]` 不足或物品未知 → 返回错误（不改 state）。
  - 扣 1 件（减到 0 删除该 key）。
  - `base = TIER_BASE[item.tier]`。
  - **侍君**（含皇后）：`standing[id].favor += base`（恩宠）；`standing[id].affection += round(base/2)`（好感）；
    **投其所好**：item.tags 与该侍君 `attributes.likes` 有交集 → 好感再 `+round(base/2)`（即好感翻倍）。
    `favor`、`affection` 均 0–100 截断。（`affection` 为新增运行时字段，见 §3a。）
  - **皇嗣**（在世）：`heir.favor += base`；`heir.closeness += round(base/2)`。0–100 截断。
  - **宗亲**：暂无目标，UI 占位。
- **`spendCoins(state, amount)`** / **`grantCoins(state, amount)`** → 操作 `nation.treasury`，下限 0，无上限（供 Spec B 采买、进贡入库等用）。
- **`grantItem(state, itemId, count=1)`** → 库存 +count（供 Spec B 各获取途径用）。
- **赏赐不消耗行动点。**

## 3a. 好感（affection）接入运行时

现状：`hidden.affection` 仅为 authored 初值，`CharacterProfileDrawer` 直接读内容定义，GameState 无可写字段。
为支持「赏赐侍君 +好感」且不沦为「写而不读的死属性」（见 commit 3bd12dd），将 affection 接入运行时：

- `CharacterStanding` 新增 `affection?: number`（0–100，仅侍君有）。
- `newGame` / `initialState`：为每名侍君把 `standing[id].affection` 播种为该角色 `hidden.affection` 初值
  （与 favor/rank 由 `initialStanding` 播种同构）。
- `CharacterProfileDrawer` 的「情意」改读运行时值：`standing[id].affection ?? character.hidden.affection`（缺省回退 authored）。
- `bestow` 写 `standing[id].affection`。
- 持久化：`affection` 随 `CharacterStanding` 落 `stateSchema`/`saveSystem`。

## 4. 库房 UI（StorehouseScreen，新 view `storehouse`）

- 顶部一行：「铜钱：{nation.treasury 千分位} 两」。
- 物品列表：遍历 `storehouse.items`（数量>0），每行 `{db.items[id].name} ×{count}` + 「赏赐」按钮；空库显示「库房空空如也」。
- 点「赏赐」打开**赏赐弹窗**：
  - 3 个 tab：**侍君**（在世侍君，含皇后；按显示名）/ **皇嗣**（在世皇嗣，按小名/正名）/ **宗亲**（占位「暂无宗亲」，不可选）。
  - 选中一人高亮 → 「确认赏赐」按钮可用 → 调 `bestow`，成功后库存减 1、弹窗关闭，列表刷新。
- 入口：在 `TopStatusBar`（国情/设置按钮旁）加「国库」按钮，经 `GameShell` 透传 `onOpenStorehouse`，
  App 路由到 `storehouse` 视图。凡使用 GameShell 的画面皆可打开。

## 5. 持久化 / 初始化

- `resources.storehouse: { items: Record<string, number> }` 纳入 `stateSchema` 与 `saveSystem` 持久化。
- 按既定「预发布不做旧档兼容」（[[no-save-backcompat]]），不写迁移。
- `newGame` / `initialState`：`treasury = 10000`；`storehouse.items` 播一小撮**种子物品**（约 5 件，便于 Spec B 落地前即可演示赏赐），种子取自目录中跨类别的若干项。

## 6. 测试（先红后绿，目标 ≥80%）

- treasury 转换：world/initial/save 初始为 10000；funnel 对 treasury 只取下限 0、可超 100；其余 nation 仍 0–100。
- affection 运行时：newGame 播种为 authored 初值；drawer 读运行时值；存档往返保留。
- `bestow` 侍君：favor+base、affection+round(base/2)、投其所好好感翻倍、双双 0–100 截断。
- `bestow` 皇嗣：favor+base、closeness+round(base/2)、截断。
- `bestow` 扣减到 0 删 key；库存不足 / 未知物品 → 错误且 state 不变。
- `spendCoins` 下溢截断 0；`grantCoins`/`grantItem` 累加。
- `items.json` 装载成功；非法 tier / category 被拒。
- 存档往返保留 `storehouse.items` 与 treasury 纯数字。

## 非目标（留给 Spec B）

属地进贡、大臣进献、秋猎、万宝楼、醉仙楼五种获取途径；乘风汇报里的「赏赐 / 收进库房」二选一（复用本 spec 的 `bestow` / `grantItem`）。

## 关键默认（已确认）

1. 钱 = `nation.treasury`，纯数字，初始 10000，国情面板也显示纯数字「X 两」。
2. 赏赐增量「品阶 + 投其所好」：tier 定基础值，tag∈likes 时好感翻倍。
3. 皇嗣赏赐同时加 favor 与 closeness。
4. 国库入口 = TopStatusBar 按钮（非地图地点）。
5. 铜钱千分位显示「10,000 两」。

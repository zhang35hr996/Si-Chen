# 物品获取途径（五种）— 设计（Spec B）

> Spec B（共两部分）。A（已合并）=库房数据模型+赏赐流程。
> B=本文：五种获取途径——属地进贡 / 大臣进献 / 秋猎 / 万宝楼 / 醉仙楼。

## 目标

为库房系统补充物品来源。五种途径全部把物品送进 `storehouse.items`（复用 Spec A 的
`grantItem`），采买扣 `nation.treasury`（`spendCoins`），报告里的「赏赐」复用 `bestow`。

## 复用 Spec A

- `grantItem(state, itemId, count?)` — 入库。
- `spendCoins(state, amount)` — 采买扣钱（不足返回 {ok:false}）。
- `bestow(state, db, itemId, recipient)` — 赏赐结算。
- `db.items` 目录的 `category` / `tier` 字段用于分池与定价。
- 乘风报告复用 `GossipPlan { effects, beat }` 模式，经 `ReactionScreen` 的 choices 呈现。

## 1. 时间槽辅助（共享纯函数，src/engine/calendar/time.ts 扩展或新文件）

时间模型一旬=一个行动日，6 槽：早上(卯/slot0) / 上午(辰/slot1) / 下午(申/slot2) / 黄昏(酉) /
晚上(戌) / 深夜(子)。「中午」无对应槽，统一映到**下午(申/slot2)**。新增：

- `isMorningSlot(calendar): boolean` — slot1（上午/辰时）。
- `isAfternoonSlot(calendar): boolean` — slot2（下午/申时）。

（slot = `apMax - ap`，见现有 `shichenSlot`。）

## 2. 乘风报告类（概率触发，复用 gossip 机制）

新增 `src/store/tribute.ts`：`buildTributeReport(db, state, seedKey): GossipPlan | null`，与
`buildChengFengGossip` 并行，由同一 per-AP 钩子调用。到对应时机按**动态概率**（随国情属性浮动，
见下）出一条报告。

**动态概率（纯函数，0–100 属性，每点偏离 50 计 ±0.1%，夹在 [3, 40]）：**
- `tributeChance(state)` = clamp( **10** + 0.1·((productivity−50)+(publicSupport−50)+(prestige−50)), 3, 40)
  —— 生产力(nation.productivity)、民心(nation.publicSupport)、威望(sovereign.prestige) 越高越易进贡，越低越少。
- `ministerTributeChance(state)` = clamp( **10** + 0.1·((ministerLoyalty−50)+(corruption−50)+(prestige−50)), 3, 40)
  —— 大臣忠心(nation.ministerLoyalty)、贪腐(nation.corruption)、威望(sovereign.prestige) 越高越易进献。
- 命中判定：`gestationRoll(seedKey) % 100 < round(chance)`。

报告经 `ReactionScreen` 给**两个选项**：
- **①赏赐** → 打开赏赐选人弹窗（复用 Spec A 的 3-tab 选人）；确认后对该 tribute 物品执行
  `grantItem` 后立即 `bestow`（净效果：库存不变、目标属性提升）。
- **②知道了，收进库房** → `grantItem(state, itemId)`。

两个来源共用上述机制，区别在**触发时机**与**物品池/文案**：

### 2a. 属地进贡（每日**上午**触发）
- 触发：`isMorningSlot` 且 `tributeChance(state)` 命中；不耗 AP。
- 物品池：非食物非珍宝的属地贡物 categories = 妆品/香/绸缎/皮毛/文房/乐器/玩器。
- 文案模板：「陛下，{属地}进贡了{物品名}，是否收进私库？」`{属地}` 从一组地名（蜀地/江南/岭南/
  西域/闽地…）确定性取。

### 2b. 大臣进献（每**旬下午**触发，不耗 AP）
- 触发：`isAfternoonSlot` 且当旬尚未出过此报告且 `ministerTributeChance(state)` 命中。
- **读取官员名册** `state.officials` 中**有名字**的官员，确定性取一名作进献者；名册空则不触发。
- 物品池：珍宝 categories = 器玩/珍禽异兽。
- 文案模板：「陛下，{官职}{姓名}进献了{物品名}，是否收进私库？」

## 3. 秋猎（年度事件，耗 1AP）

`src/store/autumnHunt.ts`。触发：`calendar.month === 9` 且 `period === "mid"`（中旬）且
`isAfternoonSlot`，且玩家在御书房(`wenzhaodian`)或主地图，且 `flags["autumnHunt:<year>"]` 未设。
**必现**——乘风询问「是否参与今年秋猎？」给两选项：

- **参加** → `SPEND_AP(1)`；按皇帝**武力**(`resources.sovereign.martial`)分档随机得 2–3 件皮毛：
  - `martial < 40`：{兔毛, 野雉尾羽}
  - `40 ≤ martial < 70`：{貂皮, 鹿皮, 鹿茸}
  - `martial ≥ 70`：{狐皮, 虎皮, 银狼皮}
  - 高档档次有 25% 概率额外掉一件下一档物。
  逐件 `grantItem`。设 `flags["autumnHunt:<year>"] = true`。
- **不参加** → 仅设 `flags["autumnHunt:<year>"] = true`，无消耗。

掉落用 `gestationRoll(seed)` 确定性。皮毛 id 取自 Spec A 目录（兔毛/野雉尾羽/貂皮/鹿皮/鹿茸/
狐皮/虎皮/银狼皮——实现时按目录实际 id 对齐）。

## 4. 京城商铺（万宝楼 / 醉仙楼，进店扣 1AP）

### 4a. 新地点（content/locations/）
京城（`jingcheng` board）现无节点。新增两座，`zone: "jingcheng"`：
- `wanbaolou.json`：name 万宝楼，`backgroundKey: "bg.wanbaolou"`，`position`。
- `zuixianlou.json`：name 醉仙楼，`backgroundKey: "bg.zuixianlou"`，`position`。

### 4b. 背景注册
`assets/manifest.json` 加 `"bg.wanbaolou": { path: "backgrounds/wanbaolou.png", kind: "background", placeholder: false }`，
醉仙楼同理（PNG 已在 `public/assets/backgrounds/` 且已提交）。这样 `manifestCheck.test` 的
「real manifest + complete disk + real content = zero errors」对新地点通过。

### 4c. 进店与采买
- 进店扣 1AP（参照出宫耗 AP 移动的现有路径；店内浏览/购买不再额外扣 AP）。
- **货架**：每次进店从该店类别池**随机轮替一批 6–10 件**，按 `日期(dayIndex)+店id+seed` 确定性抽样
  （同一旬同一店稳定，跨旬轮换）。
  - 万宝楼池：非食物 categories（妆品/香/绸缎/皮毛/文房/乐器/玩器/器玩/珍禽异兽）。
  - 醉仙楼池：食物三类（点心/茶饮/珍味）。
- **定价**（纯函数 `priceOf(item, seedKey)`，按 tier 区间确定性随机，落 10–500）：
  - common 10–50 / fine 50–150 / treasure 150–350 / marvel 350–500。
- 购买：点「购买」→ `spendCoins(state, price)`（不足则按钮禁用/失败提示）+ `grantItem`。
- 商铺屏（ShopScreen）复用库房屏风格：顶部显示余额铜钱，货架每行 名称·价格·「购买」。

## 5. Flag / 数据

- `flags["autumnHunt:<year>"]: true` — 当年秋猎已问。
- 当旬大臣进献去重：用 per-旬 flag `flags["tributeMinister:<dayIndex>"] = true`（出过即设，当旬不再出）。
- 不新增持久化字段（物品/铜钱已在 Spec A 落档持久化）。

## 6. 接线点（per-AP 钩子 / 地图 / 京城板）

- 进贡/进献报告挂到现有 per-AP 乘风掷点处（与 `buildChengFengGossip` 同一调用点）：**先掷 `buildTributeReport`，命中则呈现该报告；未命中再回退普通 gossip**（每行动点至多一条乘风报告）。
- 秋猎检查挂到进入御书房/主地图的时机（或同 per-AP 钩子按地点+时间判定）。
- 万宝楼/醉仙楼作为 `jingcheng` 板上的地图节点，点击进入 ShopScreen（新 view）。

## 7. 测试（先红后绿，≥80%）

- 时间槽：`isMorningSlot`/`isAfternoonSlot` 对各 ap 值正确。
- 动态概率：`tributeChance`/`ministerTributeChance` 在低/中(50)/高属性下的值与单调性正确、夹在 [3,40]；中性 50 → 10。
- 进贡报告：上午触发、池筛选（非食物）、两选项 effects（赏赐=grantItem+bestow；收库=grantItem）。
- 进献报告：下午触发、命中**具名**官员、名册空不触发、珍宝池。
- 秋猎：武力三档掉落集合正确、2–3 件、高档 25% 额外掉落确定性、年度 flag 去重、参加扣 1AP、不参加不扣。
- 商铺：货架确定性轮替（同旬稳定/跨旬变化）、`priceOf` 落对应 tier 区间且 ∈[10,500]、spendCoins 不足拒绝、grantItem 入库。
- 新地点装载 + `bg.wanbaolou`/`bg.zuixianlou` manifest 解析无误。

## 默认（已确认）

1. 中午→下午(申/slot2)；属地进贡=上午(辰/slot1)。
2. 报告类**动态概率**触发：属地进贡随 生产力/民心/威望 浮动；大臣进献随 大臣忠心/贪腐/威望 浮动；基准 10、每点 ±0.1%、夹 [3,40]。
3. 进店扣 1AP，店内随便买。
4. 价格按品阶派生（区间随机）。
5. 货架每次随机一批（轮替）。
6. 秋猎必现（每年一次）。
7. 物品池：属地进贡=非食物非珍宝；大臣进献=器玩/珍禽；食物只在醉仙楼买。
8. 报告「赏赐」走 grantItem→bestow，复用 Spec A 选人弹窗。

## 非目标

- 宗亲赏赐（Spec A 已占位，仍空）。
- 物品稀有度衰减、商铺议价、秋猎小游戏等扩展。

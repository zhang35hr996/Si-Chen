# 库房（国库）+ 赏赐系统 实现计划（Spec A）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「国库」入口与库房菜单：顶部显示铜钱数，下方列物品并可赏赐给侍君/皇嗣（宗亲占位），赏赐提升恩宠/好感；铜钱由 `nation.treasury` 改为纯数字。

**Architecture:** 把 `nation.treasury` 从 0–100 改为纯数字铜钱（移出效果枚举，只经 `grantCoins`/`spendCoins` 增减）；新增 `content/items.json` 物品目录（`db.items`）与 `resources.storehouse.items` 库存；新增纯函数 `src/store/treasury.ts`（`bestow`/`spendCoins`/`grantCoins`/`grantItem`）；好感 `affection` 接入运行时（`standing[id].affection`）；UI 新增 `StorehouseScreen` + `TopStatusBar` 国库入口。

**Tech Stack:** TypeScript, React, Zod, Vitest。

## Global Constraints

- 预发布阶段不做旧档迁移（state 形状变更不写迁移代码）。
- 不引入「写而不读的死属性」：新增的 `affection` 必须既写（bestow）又读（CharacterProfileDrawer）。
- 数值属性 0–100 截断；铜钱 `treasury` 为非负整数、无上限。
- 官职/称谓命名避用「郎」「卿」等男性向字（本计划不涉新称谓，沿用约定）。
- 测试框架 Vitest；运行单测用 `npx vitest run <path>`。
- 赏赐与进贡入库**不消耗行动点**。

---

### Task 1: treasury 改纯数字 — schema 与起始值

**Files:**
- Modify: `content/world.json`（`startingResources.nation.treasury` 50 → 10000）
- Modify: `src/engine/content/schemas.ts`（`startingResources.nation.treasury` 的 `percent` → 非负整数；从 `resource/nation` 效果 `field` 枚举删除 `"treasury"`）
- Modify: `src/engine/save/stateSchema.ts`（`nation.treasury` `percent` → 非负整数）
- Modify: `src/engine/state/initialState.ts`（`treasury: 50` → `10000`）
- Modify: `src/engine/save/saveSystem.ts`（回填默认 `treasury: 50` → `10000`）
- Modify: `src/engine/state/types.ts`（`treasury` 注释改「国库（铜钱，单位：两）」）
- Modify: `src/store/temple.ts`（大吉删 treasury 支，恒给 prestige）
- Test: `tests/state/treasuryNumber.test.ts`（新建）

**Interfaces:**
- Produces: 新游戏 / 初始 state 的 `resources.nation.treasury === 10000`（非负整数，无 0–100 上限）。
- Produces: `resource` 效果的 nation `field` 枚举不再含 `"treasury"`。

- [ ] **Step 1: 写失败测试**

新建 `tests/state/treasuryNumber.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/engine/state/initialState";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("treasury 纯数字铜钱", () => {
  it("初始 state treasury 为 10000", () => {
    expect(createInitialState().resources.nation.treasury).toBe(10000);
  });

  it("新游戏 state treasury 为 10000（取自 world.json）", () => {
    const db = loadRealContent();
    expect(createNewGameState(db).resources.nation.treasury).toBe(10000);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/state/treasuryNumber.test.ts`
Expected: FAIL（treasury 仍是 50）。

- [ ] **Step 3: 改 world.json 起始值**

`content/world.json` 中 `startingResources.nation` 的 `"treasury": 50` 改为 `"treasury": 10000`。

- [ ] **Step 4: 改 schemas.ts**

在 `src/engine/content/schemas.ts`：
1. `startingResources` 的 nation 块里，把 `treasury: percent,` 改为 `treasury: z.number().int().min(0),`。
2. `resource` 效果（`pillar: z.literal("nation")`）的 `field: z.enum([...])` 列表中**删除** `"treasury",` 这一项。

- [ ] **Step 5: 改 stateSchema.ts**

在 `src/engine/save/stateSchema.ts` 的 `nation` 块，把 `treasury: percent,` 改为 `treasury: z.number().int().min(0),`。

- [ ] **Step 6: 改 initialState.ts / saveSystem.ts / types.ts**

- `src/engine/state/initialState.ts`：`treasury: 50,` → `treasury: 10000,`。
- `src/engine/save/saveSystem.ts`：回填块里的 `treasury: 50,` → `treasury: 10000,`。
- `src/engine/state/types.ts`：`/** 国库（0–100 充盈度抽象） */` → `/** 国库（铜钱，单位：两） */`。

- [ ] **Step 7: 改 temple.ts 大吉支**

在 `src/store/temple.ts` 的 `buildFortune` 大吉分支，把

```ts
effects.push(
  gestationRoll(`${key}:extra`) % 2 === 0
    ? sov("prestige", mag(key, "ex", 4, 6))
    : nat("treasury", mag(key, "ex", 4, 6)),
);
```

替换为：

```ts
effects.push(sov("prestige", mag(key, "ex", 4, 6)));
```

- [ ] **Step 8: 运行新测试 + 全量回归**

Run: `npx vitest run tests/state/treasuryNumber.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿（若有断言 treasury≤100 或上香 treasury 的旧测试，按纯数字语义就地修正）。

- [ ] **Step 9: 提交**

```bash
git add content/world.json src/engine/content/schemas.ts src/engine/save/stateSchema.ts src/engine/state/initialState.ts src/engine/save/saveSystem.ts src/engine/state/types.ts src/store/temple.ts tests/state/treasuryNumber.test.ts
git commit -m "refactor: 国库 treasury 改纯数字铜钱（初始 10000，移出效果枚举）"
```

---

### Task 2: 物品目录 ItemDef + content/items.json 装载

**Files:**
- Create: `content/items.json`
- Modify: `src/engine/content/schemas.ts`（新增 `itemDefSchema` / `itemsFileSchema` + `ItemDef` 类型导出）
- Modify: `src/engine/content/loader.ts`（`RawContent.items?` + `db.items` 装载 + 重复 id 检查）
- Modify: `src/engine/content/viteSource.ts`（识别 `/items.json`）
- Modify: `tools/validate-content.ts`（读 `items.json`）
- Test: `tests/content/items.test.ts`（新建）

**Interfaces:**
- Produces: `ItemDef = { id: string; name: string; category: ItemCategory; tier: ItemTier; tags: string[] }`；
  `ItemTier = "common" | "fine" | "treasure" | "marvel"`。
- Produces: `db.items: Record<string, ItemDef>`（loader 输出，重复 id 报错）。
- Consumes（Task 1）：无运行时依赖，仅同改 `schemas.ts`。

- [ ] **Step 1: 写失败测试**

新建 `tests/content/items.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";

describe("物品目录 db.items", () => {
  it("装载真实 items.json，含螺子黛", () => {
    const db = loadRealContent();
    const it = db.items["luozidai"];
    expect(it).toBeDefined();
    expect(it!.name).toBe("螺子黛");
    expect(["common", "fine", "treasure", "marvel"]).toContain(it!.tier);
  });

  it("每个物品 id 唯一且 tags 为数组", () => {
    const db = loadRealContent();
    for (const item of Object.values(db.items)) {
      expect(Array.isArray(item.tags)).toBe(true);
      expect(item.id.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/content/items.test.ts`
Expected: FAIL（`db.items` 不存在）。

- [ ] **Step 3: 加 schema（schemas.ts）**

在 `src/engine/content/schemas.ts` 适当位置新增：

```ts
// ── items (content/items.json — 库房物品目录) ─────────────────────────
export const itemTierSchema = z.enum(["common", "fine", "treasure", "marvel"]);
export const itemCategorySchema = z.enum([
  "妆品", "香", "绸缎", "皮毛", "文房", "乐器",
  "玩器", "点心", "茶饮", "珍味", "器玩", "珍禽异兽",
]);
export const itemDefSchema = z.strictObject({
  id: idSchema,
  name: z.string().min(1),
  category: itemCategorySchema,
  tier: itemTierSchema,
  tags: z.array(z.string()).max(8),
});
export type ItemDef = z.infer<typeof itemDefSchema>;
export const itemsFileSchema = z.strictObject({ items: z.array(itemDefSchema) });
```

- [ ] **Step 4: 加 loader 装载（loader.ts）**

在 `src/engine/content/loader.ts`：
1. import 增补：从 `./schemas` 引入 `itemsFileSchema`、`type ItemDef`。
2. `RawContent` 接口增 `items?: RawFile;`。
3. `ContentDB` 接口增 `items: Record<string, ItemDef>;`。
4. `loadContent` 内、`scenes` 解析之后加：

```ts
const items: Record<string, ItemDef> = {};
if (raw.items) {
  const parsed = parseFile(itemsFileSchema, raw.items, errors);
  if (parsed) {
    for (const def of parsed.items) {
      if (items[def.id]) {
        errors.push(contentError("DUPLICATE_ID", `items.json: duplicate item id "${def.id}"`));
      }
      items[def.id] = def;
    }
  }
}
```

5. 成功返回的 `Object.freeze({ ... })` 里加 `items,`。

- [ ] **Step 5: 接两个 RawContent 装配点**

`src/engine/content/viteSource.ts`：
- `loadGameContent` 内声明 `let items: RawFile | undefined;`
- 循环里加分支：`else if (path.endsWith("/items.json")) items = file;`
- `return loadContent({ world, lexicon, characters, locations, events, scenes, items });`

`tools/validate-content.ts`：在 `raw` 对象里加一行 `items: readJson(join(rootDir, "items.json")),`。

- [ ] **Step 6: 建 content/items.json（先放最小集合，让测试过）**

新建 `content/items.json`，先含螺子黛一项即可让测试通过；完整目录在 Task 3 录入：

```json
{
  "items": [
    { "id": "luozidai", "name": "螺子黛", "category": "妆品", "tier": "fine", "tags": ["妆品"] }
  ]
}
```

- [ ] **Step 7: 运行测试**

Run: `npx vitest run tests/content/items.test.ts`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add content/items.json src/engine/content/schemas.ts src/engine/content/loader.ts src/engine/content/viteSource.ts tools/validate-content.ts tests/content/items.test.ts
git commit -m "feat: 物品目录 ItemDef + content/items.json 装载"
```

---

### Task 3: 录入完整物品目录（约 200 项）

**Files:**
- Modify: `content/items.json`
- Test: `tests/content/itemsCatalog.test.ts`（新建）

**Interfaces:**
- Consumes（Task 2）：`itemsFileSchema`、`db.items`。
- Produces: 覆盖全部需求物品的目录（含 tier/tags），供 Task 6 种子、Spec B 各途径与 Task 8 投其所好使用。

- [ ] **Step 1: 写覆盖度测试**

新建 `tests/content/itemsCatalog.test.ts`（抽查关键 tier/tag，避免逐项硬编码）：

```ts
import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";

describe("物品目录覆盖", () => {
  it("含各类别代表物且 tier 合理", () => {
    const db = loadRealContent();
    const byName = Object.fromEntries(Object.values(db.items).map((i) => [i.name, i]));
    expect(byName["银狼皮"]?.tier).toBe("marvel");
    expect(byName["兔毛"]?.tier).toBe("common");
    expect(byName["御制龙香墨"]?.tier).toBe("marvel");
    expect(byName["古籍孤本"]?.tags).toContain("古籍");
    expect(byName["云锦"]?.category).toBe("绸缎");
    expect(byName["梅花糕"]?.category).toBe("点心");
    expect(byName["明前龙井"]?.category).toBe("茶饮");
  });

  it("物品总数达到目录规模（≥150）", () => {
    expect(Object.keys(loadRealContent().items).length).toBeGreaterThanOrEqual(150);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/content/itemsCatalog.test.ts`
Expected: FAIL（目录只有 1 项）。

- [ ] **Step 3: 录入全部物品**

把 spec 与需求列出的全部物品写入 `content/items.json` 的 `items` 数组，逐项给 `id`（拼音/英文 kebab）、`name`、`category`、`tier`、`tags`。分类与 tier 编录原则：

- **妆品**：螺子黛/青雀头黛/玉簪花粉/蔷薇硝 → category `妆品`，tier `fine`，tags `["妆品"]`。
- **香**：龙涎香/沉水香 → `香`，`treasure`；沉水香鎏金博山炉 → `器玩`，`marvel`。
- **绸缎**：云锦/蜀锦/宋锦/织金锦/妆花缎/金丝软缎/月影纱/软烟罗/雾绡/鲛绡/银红霞影纱/雪青素绫/天水碧轻罗/孔雀翎织锦/乌金缎/紫绡/素月纱/百蝶穿花锦/缠枝莲纹锦/海棠春睡缎 → `绸缎`，多数 `fine`，孔雀翎织锦/鲛绡 `treasure`，tags `["绸缎"]`。
- **皮毛**：兔毛/野雉尾羽 `common`；貂皮/鹿皮/鹿茸 `fine`；狐皮/虎皮 `treasure`；银狼皮 `marvel`。银狐披风/墨狐斗篷/紫貂裘/白狐围领/貉绒护手/鹿皮软靴/锦面云履/珍珠绣鞋/金线披帛/云肩/护腕/绣花 → category `玩器` 或 `绸缎`（衣饰类归 `绸缎`，护手/护腕等小件归 `玩器`），tier 视贵重（紫貂裘 `treasure`，余 `fine`）。
- **文房**：澄心堂纸/洒金笺/桃花笺/薛涛笺/松烟墨/油烟墨/御制龙香墨/紫毫笔/狼毫笔/羊毫笔/歙砚/端砚/洮河砚/白玉笔洗/青瓷笔架/水晶镇纸/竹雕笔筒/犀角镇纸/名家字帖/古籍孤本 → `文房`；御制龙香墨/洮河砚/古籍孤本/犀角镇纸 `marvel` 或 `treasure`，古籍孤本 tags `["文房","古籍"]`，名家字帖 tags `["文房","字帖"]`。
- **乐器**：焦尾琴/绿绮式古琴/白玉笛/紫竹箫/红木琵琶 → `乐器`，焦尾琴/绿绮 `marvel`，余 `treasure`，tags `["乐器"]`（琴谱相关 tags `["乐器","琴"]`）。
- **玩器**：白玉围棋子/墨玉围棋子/玛瑙棋子/紫檀棋盘/象牙双陆/投壶器具/叶子牌/七巧板/九连环/玲珑锁/鲁班锁/彩绘纸鸢/琉璃风铃/木雕机关鸟/西域音乐盒式机关匣/走马灯 → `玩器`，多数 `fine`，象牙双陆/机关匣 `treasure`。
- **点心**：梅花糕/桂花糕/海棠酥/荷花酥/桃花酥/杏仁酥/茯苓糕/枣泥山药糕/莲子糕/松仁百合糕/玫瑰酥/水晶桂花糕/雪花酥酪/芙蓉糕/七巧点心/如意卷/金丝蜜枣糕/青梅软糕/龙须酥/豆沙团子/酥山/樱桃煎/荔枝膏/蜜渍青梅/糖渍木瓜/冰糖雪梨盏 → `点心`，`common`～`fine`，tags `["点心"]`。
- **茶饮**：明前龙井/蒙顶贡茶/顾渚紫笋/团龙茶/茉莉香片/桂花乌龙/雪水煎茶/梅花露/玫瑰露/荔枝饮/酸梅汤/杏仁酪/酥酪/乳茶/蜂蜜花露 → `茶饮`，贡茶类 `treasure`，余 `fine`/`common`，tags `["茶饮"]`。
- **珍味**：岭南鲜荔枝/闽地龙眼/西域葡萄/哈密贡瓜/江南枇杷/北地奶酥/海疆干贝/腌制鲥鱼/松江鲈脍/山林菌菇/蜂巢蜜/金华火腿/糖霜柿饼 → `珍味`，`fine`，贡瓜/干贝 `treasure`，tags `["珍味"]`。
- **器玩（瓷玉珍玩）**：汝窑天青盏/秘色瓷莲花碗/甜白瓷茶具/影青花口瓶/青花缠枝莲瓶/釉里红梅瓶/兔毫盏/建盏/白瓷莲瓣杯/紫砂茶壶/琉璃高足杯/水晶酒盏/夜光杯/金银错酒壶/鎏金熏炉/掐丝珐琅香盒/铜鎏金手炉/菱花铜镜/水银琉璃镜/白玉如意/翡翠山子/玛瑙杯/珊瑚盆景/珍珠帘/螺钿妆奁/紫檀首饰匣/金丝楠木箱/琉璃花瓶/象牙雕球/木雕屏风/缂丝挂屏/双面绣屏/西域琉璃灯/南海夜明珠/东海珊瑚树/昆山美玉原石/雨花石/太湖石小景/琥珀昆虫摆件 → `器玩`，汝窑/秘色瓷/夜光杯/南海夜明珠/东海珊瑚树 `marvel`，多数 `treasure`，雨花石/太湖石小景 `fine`，tags `["器玩"]`。
- **珍禽异兽**：白猫/狮子猫/西域长毛猫/雪白小犬/宫廷细犬/鹦鹉/八哥/金丝雀式架空贡鸟/白孔雀/锦鸡/鸳鸯/白鹿幼崽/灵狐/名贵金鱼/红白锦鲤/西域矮马/温顺梅花鹿 → `珍禽异兽`，白孔雀/灵狐/白鹿幼崽/西域矮马 `treasure`～`marvel`，猫犬鱼鸟 `fine`，tags `["珍禽异兽"]`。

> 录入时确保 spec / 需求中点名「投其所好」相关物（古籍孤本、琴谱类、名家字帖、熏香）带可命中侍君 `likes` 的 tag。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/content/itemsCatalog.test.ts`
Expected: PASS。
Run: `npx tsx tools/validate-content.ts`（若项目有此校验命令，否则跳过）
Expected: 无 schema 错误。

- [ ] **Step 5: 提交**

```bash
git add content/items.json tests/content/itemsCatalog.test.ts
git commit -m "feat: 录入完整物品目录（妆品/香/绸缎/皮毛/文房/乐器/玩器/点心/茶饮/珍味/器玩/珍禽异兽）"
```

---

### Task 4: storehouse 状态 + affection 字段（types + schema + 持久化）

**Files:**
- Modify: `src/engine/state/types.ts`（`StorehouseState`、`Resources.storehouse`、`CharacterStanding.affection?`）
- Modify: `src/engine/content/schemas.ts`（`characterStandingSchema` 加 `affection?`）
- Modify: `src/engine/save/stateSchema.ts`（`resources.storehouse`；standing 经 `characterStandingSchema` 自动带 affection）
- Test: `tests/state/storehouseSchema.test.ts`（新建）

**Interfaces:**
- Produces: `StorehouseState = { items: Record<string, number> }`；`Resources.storehouse: StorehouseState`。
- Produces: `CharacterStanding.affection?: number`（0–100）。
- Consumes（Task 1）：treasury 已纯数字（无新依赖）。

- [ ] **Step 1: 写失败测试**

新建 `tests/state/storehouseSchema.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createInitialState } from "../../src/engine/state/initialState";

describe("storehouse + affection schema", () => {
  it("初始 state 带空 storehouse 且通过 schema", () => {
    const s = createInitialState();
    expect(s.resources.storehouse).toEqual({ items: {} });
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });

  it("standing.affection 可选且 0–100", () => {
    const s = createInitialState();
    s.resources.storehouse.items["luozidai"] = 2;
    s.standing["x"] = { rank: "chenghui", favor: 50, affection: 80 };
    expect(gameStateSchema.safeParse(s).success).toBe(true);
    s.standing["x"]!.affection = 200;
    expect(gameStateSchema.safeParse(s).success).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/state/storehouseSchema.test.ts`
Expected: FAIL。

- [ ] **Step 3: 改 types.ts**

在 `src/engine/state/types.ts`：
1. 新增接口：

```ts
/** 库房（私库）：铜钱在 nation.treasury，本处只存物品库存。 */
export interface StorehouseState {
  /** itemId → 数量；为 0 即删除该 key。 */
  items: Record<string, number>;
}
```

2. `Resources` 接口加 `storehouse: StorehouseState;`。
3. `CharacterStanding` 接口加 `/** 好感/情意 0–100（仅侍君；缺省回退 authored hidden.affection）。 */ affection?: number;`。

- [ ] **Step 4: 改 schemas.ts**

在 `src/engine/content/schemas.ts` 的 `characterStandingSchema` 内（`confined` 之后）加一行：

```ts
  affection: percent.optional(),
```

- [ ] **Step 5: 改 stateSchema.ts**

在 `src/engine/save/stateSchema.ts` 的 `resources: z.strictObject({ ... })` 内、`bloodline` 之后加：

```ts
    storehouse: z.strictObject({
      items: z.record(idSchema, z.number().int().min(0)),
    }),
```

- [ ] **Step 6: 让 initialState 带 storehouse（最小，使测试过）**

在 `src/engine/state/initialState.ts` 的 `resources` 里、`bloodline` 之后加：

```ts
      storehouse: { items: {} },
```

- [ ] **Step 7: 运行测试**

Run: `npx vitest run tests/state/storehouseSchema.test.ts`
Expected: PASS。

- [ ] **Step 8: 提交**

```bash
git add src/engine/state/types.ts src/engine/content/schemas.ts src/engine/save/stateSchema.ts src/engine/state/initialState.ts tests/state/storehouseSchema.test.ts
git commit -m "feat: storehouse 库存状态 + standing.affection 运行时字段（含 schema/持久化）"
```

---

### Task 5: newGame 播种 storehouse 种子 + affection 初值

**Files:**
- Modify: `src/engine/state/newGame.ts`
- Modify: `src/engine/save/saveSystem.ts`（旧档回填 `storehouse`）
- Test: `tests/state/newGameStorehouse.test.ts`（新建）

**Interfaces:**
- Consumes（Task 4）：`StorehouseState`、`standing.affection`。
- Consumes（Task 3）：`db.items`（种子 id 必须存在于目录）。
- Produces: 新游戏 state 含约 5 件种子物品；每名侍君 `standing[id].affection` = 该角色 `hidden.affection`。

- [ ] **Step 1: 写失败测试**

新建 `tests/state/newGameStorehouse.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("新游戏 storehouse + affection 播种", () => {
  it("播种少量种子物品（id 均在目录内）", () => {
    const db = loadRealContent();
    const items = createNewGameState(db).resources.storehouse.items;
    const ids = Object.keys(items);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    for (const id of ids) expect(db.items[id]).toBeDefined();
  });

  it("侍君 affection 播种为其 hidden.affection", () => {
    const db = loadRealContent();
    const st = createNewGameState(db).standing;
    const consort = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    expect(st[consort.id]!.affection).toBe(consort.hidden!.affection);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/state/newGameStorehouse.test.ts`
Expected: FAIL。

- [ ] **Step 3: newGame 播种 affection**

在 `src/engine/state/newGame.ts` 的角色循环里，把

```ts
if (character.initialStanding) {
  standing[character.id] = { ...character.initialStanding };
}
```

改为：

```ts
if (character.initialStanding) {
  standing[character.id] = {
    ...character.initialStanding,
    ...(character.kind === "consort" && character.hidden
      ? { affection: character.hidden.affection }
      : {}),
  };
}
```

- [ ] **Step 4: newGame 播种 storehouse**

在 `src/engine/state/newGame.ts` 顶部加常量：

```ts
/** 新游戏私库种子（id 须存在于 content/items.json）。 */
const STOREHOUSE_SEED: Record<string, number> = {
  luozidai: 2,
  yunjin: 1,
  diaopi: 1,
  mingqian_longjing: 2,
  meihua_gao: 3,
};
```

> 录入 Task 3 后请确认这些 id 真实存在；若命名不同，改为目录里的实际 id。

在 `return { ... resources: { ... } }` 的 `resources` 块里、`bloodline` 之后加：

```ts
      storehouse: { items: { ...STOREHOUSE_SEED } },
```

- [ ] **Step 5: saveSystem 回填 storehouse**

在 `src/engine/save/saveSystem.ts` 的回填逻辑里（`resources` 已取出处），加：

```ts
if (resources.storehouse === undefined) {
  resources.storehouse = { items: {} };
}
```

- [ ] **Step 6: 运行测试**

Run: `npx vitest run tests/state/newGameStorehouse.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/engine/state/newGame.ts src/engine/save/saveSystem.ts tests/state/newGameStorehouse.test.ts
git commit -m "feat: 新游戏播种私库种子物品 + 侍君 affection 运行时初值"
```

---

### Task 6: treasury.ts 纯函数 — grantCoins / spendCoins / grantItem

**Files:**
- Create: `src/store/treasury.ts`
- Test: `tests/store/treasuryHelpers.test.ts`（新建）

**Interfaces:**
- Produces:
  - `grantCoins(state: GameState, amount: number): GameState` — `treasury += amount`（下限 0）。
  - `spendCoins(state: GameState, amount: number): { ok: true; state: GameState } | { ok: false }` — 不足返回 `{ok:false}`。
  - `grantItem(state: GameState, itemId: string, count?: number): GameState` — 库存 +count。
  - 均返回**新** state（不可变更新），不改入参。
- Consumes（Task 4）：`resources.storehouse.items`、`resources.nation.treasury`。

- [ ] **Step 1: 写失败测试**

新建 `tests/store/treasuryHelpers.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { grantCoins, spendCoins, grantItem } from "../../src/store/treasury";
import { createInitialState } from "../../src/engine/state/initialState";

describe("treasury helpers", () => {
  it("grantCoins 累加，不改入参", () => {
    const s0 = createInitialState();
    const s1 = grantCoins(s0, 500);
    expect(s1.resources.nation.treasury).toBe(10500);
    expect(s0.resources.nation.treasury).toBe(10000);
  });

  it("spendCoins 足额成功、不足失败", () => {
    const s0 = createInitialState();
    const ok = spendCoins(s0, 3000);
    expect(ok.ok).toBe(true);
    expect(ok.ok && ok.state.resources.nation.treasury).toBe(7000);
    expect(spendCoins(s0, 99999).ok).toBe(false);
  });

  it("grantItem 累加库存", () => {
    const s0 = createInitialState();
    const s1 = grantItem(grantItem(s0, "yulan_fen", 1), "yulan_fen", 2);
    expect(s1.resources.storehouse.items["yulan_fen"]).toBe(3);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/store/treasuryHelpers.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 treasury.ts（先只含三个 helper）**

新建 `src/store/treasury.ts`：

```ts
/**
 * 国库/私库纯函数：铜钱（nation.treasury）与物品库存（storehouse.items）的
 * 不可变增减，及赏赐结算（bestow，见下方任务补充）。
 */
import type { GameState } from "../engine/state/types";

export function grantCoins(state: GameState, amount: number): GameState {
  const treasury = Math.max(0, state.resources.nation.treasury + amount);
  return {
    ...state,
    resources: { ...state.resources, nation: { ...state.resources.nation, treasury } },
  };
}

export type SpendResult = { ok: true; state: GameState } | { ok: false };

export function spendCoins(state: GameState, amount: number): SpendResult {
  if (amount < 0 || state.resources.nation.treasury < amount) return { ok: false };
  return { ok: true, state: grantCoins(state, -amount) };
}

export function grantItem(state: GameState, itemId: string, count = 1): GameState {
  const items = { ...state.resources.storehouse.items };
  items[itemId] = (items[itemId] ?? 0) + count;
  return {
    ...state,
    resources: { ...state.resources, storehouse: { ...state.resources.storehouse, items } },
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/store/treasuryHelpers.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/store/treasury.ts tests/store/treasuryHelpers.test.ts
git commit -m "feat: 国库/私库纯函数 grantCoins/spendCoins/grantItem"
```

---

### Task 7: bestow 赏赐结算（侍君/皇嗣 + 投其所好）

**Files:**
- Modify: `src/store/treasury.ts`（新增 `bestow`、`TIER_BASE`）
- Test: `tests/store/bestow.test.ts`（新建）

**Interfaces:**
- Produces:
  - `type RecipientKind = "consort" | "heir";`
  - `bestow(state: GameState, db: ContentDB, itemId: string, recipient: { kind: RecipientKind; id: string }): { ok: true; state: GameState } | { ok: false; reason: string }`
  - 行为：扣 1 件库存（不足/未知物品 → `{ok:false}`）；按 tier 基础值加目标属性；返回新 state。
- Consumes（Task 6）：`grantItem`（反向，本任务直接内联扣减）。
- Consumes（Task 3）：`db.items[itemId].tier`、`.tags`。
- Consumes（Task 5）：`standing[id].affection`、heir.favor/closeness。

- [ ] **Step 1: 写失败测试**

新建 `tests/store/bestow.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { bestow } from "../../src/store/treasury";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

function withItem(db = loadRealContent()) {
  const state = createNewGameState(db);
  const itemId = Object.keys(db.items)[0]!;
  state.resources.storehouse.items[itemId] = 1;
  return { db, state, itemId };
}

describe("bestow 赏赐", () => {
  it("侍君：扣库存、加恩宠与好感", () => {
    const { db } = withItem();
    const state = createNewGameState(db);
    const consort = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    // 用一件 common(base=2) 物品
    const common = Object.values(db.items).find((i) => i.tier === "common")!;
    state.resources.storehouse.items[common.id] = 1;
    const favor0 = state.standing[consort.id]!.favor;
    const aff0 = state.standing[consort.id]!.affection!;
    const r = bestow(state, db, common.id, { kind: "consort", id: consort.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.resources.storehouse.items[common.id]).toBeUndefined();
    expect(r.state.standing[consort.id]!.favor).toBe(favor0 + 2);
    expect(r.state.standing[consort.id]!.affection).toBe(aff0 + 1);
  });

  it("投其所好：tag 命中 likes 时好感翻倍", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const consort = Object.values(db.characters).find(
      (c) => c.kind === "consort" && c.attributes?.likes?.length,
    )!;
    const like = consort.attributes!.likes![0]!;
    const liked = Object.values(db.items).find((i) => i.tags.includes(like) && i.tier === "common");
    if (!liked) return; // 目录无对应 common 物则跳过
    state.resources.storehouse.items[liked.id] = 1;
    const aff0 = state.standing[consort.id]!.affection!;
    const r = bestow(state, db, liked.id, { kind: "consort", id: consort.id });
    expect(r.ok && r.state.standing[consort.id]!.affection).toBe(aff0 + 2); // base/2 + base/2
  });

  it("库存不足 → 失败，state 不变", () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const consort = Object.values(db.characters).find((c) => c.kind === "consort" && c.initialStanding)!;
    const r = bestow(state, db, "nonexistent_item", { kind: "consort", id: consort.id });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/store/bestow.test.ts`
Expected: FAIL（`bestow` 未导出）。

- [ ] **Step 3: 实现 bestow（treasury.ts 追加）**

在 `src/store/treasury.ts` 顶部 import 增补 `ContentDB`：

```ts
import type { ContentDB } from "../engine/content/loader";
```

文件追加：

```ts
const TIER_BASE = { common: 2, fine: 4, treasure: 7, marvel: 12 } as const;
const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

export type RecipientKind = "consort" | "heir";
export type BestowResult = { ok: true; state: GameState } | { ok: false; reason: string };

export function bestow(
  state: GameState,
  db: ContentDB,
  itemId: string,
  recipient: { kind: RecipientKind; id: string },
): BestowResult {
  const item = db.items[itemId];
  if (!item) return { ok: false, reason: "未知物品" };
  const have = state.resources.storehouse.items[itemId] ?? 0;
  if (have < 1) return { ok: false, reason: "库存不足" };
  const base = TIER_BASE[item.tier];

  // 扣 1 件
  const items = { ...state.resources.storehouse.items };
  if (have - 1 <= 0) delete items[itemId];
  else items[itemId] = have - 1;
  let next: GameState = {
    ...state,
    resources: { ...state.resources, storehouse: { ...state.resources.storehouse, items } },
  };

  if (recipient.kind === "consort") {
    const st = next.standing[recipient.id];
    if (!st) return { ok: false, reason: "侍君不存在" };
    const character = db.characters[recipient.id];
    const likes = character?.attributes?.likes ?? [];
    const hit = item.tags.some((t) => likes.includes(t));
    let affDelta = Math.round(base / 2);
    if (hit) affDelta += Math.round(base / 2);
    const baseAff = st.affection ?? character?.hidden?.affection ?? 0;
    next = {
      ...next,
      standing: {
        ...next.standing,
        [recipient.id]: {
          ...st,
          favor: clampPct(st.favor + base),
          affection: clampPct(baseAff + affDelta),
        },
      },
    };
  } else {
    const heirs = next.resources.bloodline.heirs;
    const idx = heirs.findIndex((h) => h.id === recipient.id);
    if (idx < 0) return { ok: false, reason: "皇嗣不存在" };
    const h = heirs[idx]!;
    const updated = { ...h, favor: clampPct(h.favor + base), closeness: clampPct(h.closeness + Math.round(base / 2)) };
    const nextHeirs = heirs.slice();
    nextHeirs[idx] = updated;
    next = {
      ...next,
      resources: { ...next.resources, bloodline: { ...next.resources.bloodline, heirs: nextHeirs } },
    };
  }
  return { ok: true, state: next };
}
```

- [ ] **Step 4: 运行测试**

Run: `npx vitest run tests/store/bestow.test.ts`
Expected: PASS。

- [ ] **Step 5: 皇嗣赏赐测试 + 补强**

在 `tests/store/bestow.test.ts` 追加皇嗣用例（构造一个 heir 后赏赐，断言 favor+base、closeness+round(base/2)）：

```ts
it("皇嗣：加 favor 与 closeness", () => {
  const db = loadRealContent();
  const state = createNewGameState(db);
  const fine = Object.values(db.items).find((i) => i.tier === "fine")!; // base=4
  state.resources.storehouse.items[fine.id] = 1;
  state.resources.bloodline.heirs.push({
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: state.calendar, favor: 50, legitimate: true, petName: "", education: { scholarship: 0, martial: 0, virtue: 0 },
    health: 60, talent: 50, diligence: 50, ambition: 20, closeness: 40, support: 20, faction: "none",
  });
  const r = bestow(state, db, fine.id, { kind: "heir", id: "heir_000001" });
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const h = r.state.resources.bloodline.heirs[0]!;
  expect(h.favor).toBe(54);
  expect(h.closeness).toBe(42);
});
```

Run: `npx vitest run tests/store/bestow.test.ts`
Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add src/store/treasury.ts tests/store/bestow.test.ts
git commit -m "feat: bestow 赏赐结算（侍君恩宠+好感+投其所好 / 皇嗣 favor+closeness）"
```

---

### Task 8: CharacterProfileDrawer 情意改读运行时 affection

**Files:**
- Modify: `src/ui/components/CharacterProfileDrawer.tsx`
- Test: `tests/ui/affectionRuntime.test.tsx`（新建；若项目无 RTL 则改为对取值函数的单测）

**Interfaces:**
- Consumes（Task 7）：`standing[id].affection`（bestow 写入）。
- Produces: 情意行显示 `standing[id].affection ?? character.hidden.affection`。

- [ ] **Step 1: 确认现状取值**

`src/ui/components/CharacterProfileDrawer.tsx` 现为 `value={character.hidden.affection}`（authored）。drawer 需能拿到该角色的运行时 `standing`。先确认组件是否已接收 `state`/`standing` props；若无，从调用处透传 `standing?: CharacterStanding`。

- [ ] **Step 2: 写失败测试（取值逻辑）**

为避免 RTL 依赖，抽一个纯函数并测它。在 `CharacterProfileDrawer.tsx` 导出：

```ts
export function effectiveAffection(
  hidden: { affection: number },
  standing?: { affection?: number },
): number {
  return standing?.affection ?? hidden.affection;
}
```

新建 `tests/ui/affectionRuntime.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { effectiveAffection } from "../../src/ui/components/CharacterProfileDrawer";

describe("effectiveAffection", () => {
  it("有运行时值取运行时", () => {
    expect(effectiveAffection({ affection: 30 }, { affection: 72 })).toBe(72);
  });
  it("无运行时值回退 authored", () => {
    expect(effectiveAffection({ affection: 30 }, undefined)).toBe(30);
    expect(effectiveAffection({ affection: 30 }, {})).toBe(30);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npx vitest run tests/ui/affectionRuntime.test.ts`
Expected: FAIL（未导出）。

- [ ] **Step 4: 实现并接线**

加上 `effectiveAffection`，并把情意行改为：

```tsx
<DescriptorStat label="情意" scale="affection" value={effectiveAffection(character.hidden, standing)} />
```

其中 `standing` 为该角色的 `state.standing[character.id]`（按现有 props 透传方式取得；若组件未持有 state，从父组件传入 `standing` prop）。

- [ ] **Step 5: 运行测试 + 全量回归**

Run: `npx vitest run tests/ui/affectionRuntime.test.ts`
Expected: PASS。
Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
git add src/ui/components/CharacterProfileDrawer.tsx tests/ui/affectionRuntime.test.ts
git commit -m "feat: 侍君详情情意改读运行时 affection（回退 authored）"
```

---

### Task 9: StorehouseScreen + 赏赐弹窗 UI

**Files:**
- Create: `src/ui/screens/StorehouseScreen.tsx`
- Modify: `src/ui/styles.css`（库房/弹窗样式）
- Test: `tests/ui/storehouseFormat.test.ts`（新建；测纯展示/筛选函数）

**Interfaces:**
- Consumes（Task 7）：`bestow`。
- Consumes（Task 3）：`db.items`。
- Produces: `StorehouseScreen` 组件 + 导出 `formatCoins(n)`、`bestowTargets(db, state)`（纯函数，便于测试）。
- Props: `{ db: ContentDB; store: GameStore; onClose: () => void }`。

- [ ] **Step 1: 写失败测试（纯函数）**

新建 `tests/ui/storehouseFormat.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { formatCoins, bestowTargets } from "../../src/ui/screens/StorehouseScreen";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

describe("库房展示辅助", () => {
  it("formatCoins 千分位", () => {
    expect(formatCoins(10000)).toBe("10,000");
    expect(formatCoins(3500000)).toBe("3,500,000");
  });
  it("bestowTargets 含在世侍君，宗亲为空", () => {
    const db = loadRealContent();
    const t = bestowTargets(db, createNewGameState(db));
    expect(t.consorts.length).toBeGreaterThan(0);
    expect(t.clan.length).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/ui/storehouseFormat.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现 StorehouseScreen**

新建 `src/ui/screens/StorehouseScreen.tsx`。导出纯函数 + 组件。参照 `FreeViewScreen`/`ResourcePanel` 既有写法（`useGameState(store)` 读 state，`store.dispatch` / 直接 set 不适用——bestow 是纯函数，需经 store 写回；按项目模式：若有 `store.setState`/命令，沿用；否则加一个 `STOREHOUSE_BESTOW`-类命令，见 Step 3b）。

纯函数与骨架：

```tsx
import { useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { bestow, type RecipientKind } from "../../store/treasury";
import { resolveDisplayName } from "../../engine/characters/standing";

export function formatCoins(n: number): string {
  return n.toLocaleString("en-US");
}

export interface BestowTarget { id: string; name: string; kind: RecipientKind; }
export function bestowTargets(db: ContentDB, state: GameState): {
  consorts: BestowTarget[]; heirs: BestowTarget[]; clan: BestowTarget[];
} {
  const consorts: BestowTarget[] = [];
  for (const c of Object.values(db.characters)) {
    if (c.kind !== "consort") continue;
    const st = state.standing[c.id];
    if (st?.lifecycle === "deceased") continue;
    consorts.push({ id: c.id, kind: "consort", name: resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined) });
  }
  const heirs: BestowTarget[] = state.resources.bloodline.heirs.map((h) => ({
    id: h.id, kind: "heir", name: h.givenName || h.petName || h.id,
  }));
  return { consorts, heirs, clan: [] };
}
```

组件渲染：顶部 `铜钱：{formatCoins(state.resources.nation.treasury)} 两`；物品列表遍历 `state.resources.storehouse.items`（数量>0），每行 `{db.items[id].name} ×{n}` + 「赏赐」按钮；点按钮 `setRewardItem(id)` 打开弹窗；弹窗 3 个 tab（侍君/皇嗣/宗亲），宗亲 tab 显示「暂无宗亲」；选中 target 后「确认赏赐」调用 bestow 并写回 store。空库显示「库房空空如也」。

- [ ] **Step 3b: 写回 store**

按 `gameStore` 既有写法把 bestow 的新 state 落库。先查 `src/store/gameStore.ts` 是否有 `setState`/`replaceState`/命令分发：
- 若有直接设整 state 的 API（如 `store.setState(next)`），用它。
- 否则在 `reducer.ts` 加一个命令 `{ type: "REPLACE_STATE", state }` 或专用 `{ type: "BESTOW", itemId, recipient }`（推荐后者：reducer 内调用 `bestow`，保持 store 单一写入口）。实现该命令并在组件里 `store.dispatch({ type: "BESTOW", itemId, recipient })`。

> 该 Step 的精确 API 取决于现有 store；实现者先读 `gameStore.ts`/`reducer.ts` 选择最贴合的写法，保持「UI 不直接 mutate state」。

- [ ] **Step 4: 运行纯函数测试**

Run: `npx vitest run tests/ui/storehouseFormat.test.ts`
Expected: PASS。

- [ ] **Step 5: 加样式**

`src/ui/styles.css` 增 `.storehouse`, `.storehouse__coins`, `.storehouse__item`, `.bestow-modal`, `.bestow-modal__tabs` 等类（参照既有 `.temple-menu`/`.profile-section` 风格，深色宫廷色板）。

- [ ] **Step 6: 提交**

```bash
git add src/ui/screens/StorehouseScreen.tsx src/ui/styles.css tests/ui/storehouseFormat.test.ts
git commit -m "feat: StorehouseScreen 库房菜单 + 3-tab 赏赐弹窗"
```

---

### Task 10: 国库入口接线（TopStatusBar + GameShell + App 路由）

**Files:**
- Modify: `src/ui/components/TopStatusBar.tsx`（加「国库」按钮）
- Modify: `src/ui/components/GameShell.tsx`（透传 `onOpenStorehouse`）
- Modify: `src/ui/screens/MapScreen.tsx`（透传 `onOpenStorehouse` 给 GameShell）
- Modify: `src/ui/App.tsx`（`View` 加 `"storehouse"`；渲染 `StorehouseScreen`；传 `onOpenStorehouse`）
- Test: 手动验证（UI 接线，无新单测）

**Interfaces:**
- Consumes（Task 9）：`StorehouseScreen`。
- Produces: 任意经 GameShell 的画面顶栏可点「国库」打开库房。

- [ ] **Step 1: TopStatusBar 加按钮**

`src/ui/components/TopStatusBar.tsx`：props 加 `onOpenStorehouse?: () => void;`，在国情/设置按钮旁渲染：

```tsx
{onOpenStorehouse && (
  <button type="button" className="hud__button" onClick={onOpenStorehouse}>国库</button>
)}
```

- [ ] **Step 2: GameShell 透传**

`src/ui/components/GameShell.tsx`：props 加 `onOpenStorehouse?: () => void;`，传给 `<TopStatusBar ... onOpenStorehouse={onOpenStorehouse} />`。

- [ ] **Step 3: MapScreen 透传**

`src/ui/screens/MapScreen.tsx`：props 加 `onOpenStorehouse?: () => void;`，在 `<GameShell ... onOpenStorehouse={onOpenStorehouse}>` 传入。

- [ ] **Step 4: App 路由**

`src/ui/App.tsx`：
1. `type View` 增 `"storehouse"`。
2. import `StorehouseScreen`。
3. 给 MapScreen（及其它需要的 GameShell 宿主）传 `onOpenStorehouse={() => setView("storehouse")}`。
4. 渲染：

```tsx
{view === "storehouse" && (
  <StorehouseScreen db={db} store={store} onClose={() => setView("map")} />
)}
```

> `onClose` 回到来源视图；最简先回 `"map"`，若需精确返回可记录 `prevView`。

- [ ] **Step 5: 构建 + 全量回归**

Run: `npx vitest run`
Expected: 全绿。
Run: `npx tsc --noEmit`（若项目用 tsc 类型检查）
Expected: 无类型错误。

- [ ] **Step 6: 手动验证**

启动 app（`npm run dev` 等项目实际命令），新游戏 → 顶栏点「国库」→ 顶部显示「铜钱：10,000 两」→ 物品列表显示种子物品 → 点「赏赐」→ 选侍君 tab 选一人 → 确认 → 库存减 1、侍君详情情意/恩宠上升。

- [ ] **Step 7: 提交**

```bash
git add src/ui/components/TopStatusBar.tsx src/ui/components/GameShell.tsx src/ui/screens/MapScreen.tsx src/ui/App.tsx
git commit -m "feat: 国库入口接线（TopStatusBar 按钮 + App storehouse 路由）"
```

---

## Self-Review

**Spec coverage:**
- §1 treasury 纯数字 → Task 1（含 schema/funnel 枚举/temple/ResourcePanel 在 Task 1 与 Task 11 注）。**注：ResourcePanel「X 两」显示未单列任务** → 见下方补充 Task 11。
- §2 物品目录 → Task 2/3。
- §3 bestow/grantCoins/spendCoins/grantItem → Task 6/7。
- §3a affection 运行时 → Task 4/5/8。
- §4 StorehouseScreen + 3-tab 弹窗 + TopStatusBar 入口 → Task 9/10。
- §5 持久化/初始化/种子 → Task 4/5。
- §6 测试 → 各任务内置。

**补充缺口：** ResourcePanel「国库」显示纯数字「X 两」在 spec §1 列出，但上面任务未覆盖 → 加 Task 11。

---

### Task 11: ResourcePanel 国库显示「X 两」

**Files:**
- Modify: `src/ui/components/ResourcePanel.tsx`
- Test: 复用 `formatCoins`（Task 9）；本任务无新单测（纯展示）。

- [ ] **Step 1: 改显示**

`src/ui/components/ResourcePanel.tsx`：把 `<NumberLine label="国库" value={nation.treasury} />` 改为显示带「两」与千分位。最简做法——新增局部：

```tsx
import { formatCoins } from "../screens/StorehouseScreen";
// ...
<div className="attr-line">
  <span className="attr-line__label">国库</span>
  <span className="attr-line__value">{formatCoins(nation.treasury)} 两</span>
</div>
```

（若不愿让 ResourcePanel 依赖 screens，可把 `formatCoins` 提到 `src/engine/...` 或一个 `src/ui/format.ts` 共享模块，并让 Task 9 从那里 import。实现者择一，保持单一定义。）

- [ ] **Step 2: 全量回归**

Run: `npx vitest run`
Expected: 全绿。

- [ ] **Step 3: 提交**

```bash
git add src/ui/components/ResourcePanel.tsx
git commit -m "feat: 国情面板国库显示纯数字「X 两」"
```

---

## 最终自检结论

- **占位扫描**：无 TBD/TODO；每个代码步骤含完整代码。
- **类型一致**：`bestow`/`grantCoins`/`spendCoins`/`grantItem` 签名跨任务一致；`StorehouseState`、`CharacterStanding.affection`、`ItemDef` 在 Task 2/4 定义后于 6/7/9 一致引用；`formatCoins` 单一定义（Task 9，Task 11 复用，必要时上提共享模块）。
- **已知实现期决策**（实现者按现有代码择优，已在步骤中标注）：① Task 9 Step 3b 的 store 写回 API；② Task 8 standing prop 透传方式；③ Task 11 `formatCoins` 共享位置；④ Task 3 种子 id 与目录实际 id 对齐。
```

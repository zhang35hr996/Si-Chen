# 母家 / 官员系统 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 后台朝臣名册（轻量运行态实体）+ 侍君母家关联，使家世/母家忠心/母家权势由关联官员派生，并提供改品级接口。

**Architecture:** 静态官职表（放 world.json，复用 ranks 的装载方式）→ 运行态 `GameState.officials` 名册（新游戏按种子生成）→ 侍君手写 `maternalClan` 关联同姓母家主 → 纯函数派生家世文本与母家权势/忠心 → CharacterProfileDrawer 改读派生值。先搭官员基础设施（不动旧字段），最后一个任务统一切换（删 family/clanLoyalty/clanPower + 重接 UI），保证每步 typecheck/测试绿。

**Tech Stack:** React 18 + TypeScript + Vite + zod + vitest。确定性随机用 `gestationRoll(seedString): number`（0–99，src/engine/characters/gestation.ts）。

## Global Constraints

- 发布前不做存档兼容迁移（memory `no-save-backcompat`）：状态形态变更无需迁移旧档。
- 官职/官员名称避用「郎」「卿」等男性向字（memory `official-naming-rule`）：用「正」「副正」「副尚书」「中丞」「祭酒」等中性称。
- funnel `AXIS_CAP = 10`：本计划不新增资源 effect，无关；但派生值范围 0–100。
- 每个姓至多一名母家主，同姓侍君共享（v1 暂定，spec §3.2）。
- 权势随品级派生、不落字段（升降职自动跟随）；忠心独立存储。
- NEVER `git add -A` / `git add .` —— 逐文件 targeted add。
- 官职表放 `world.json`（数组，复用 `ranks` 的装载路径），**不**新建 content/officials/ 目录（spec §2.2 原写独立文件，此处为简化集成的实现选择）。

---

### Task 1: 官职表 schema + world.json 数据 + 装载

**Files:**
- Modify: `src/engine/content/schemas.ts`（加 `officialPostSchema`、`OfficialPost` 类型、worldSchema 加 `officialPosts`）
- Modify: `src/engine/content/loader.ts`（ContentDB 加 `officialPosts`，按 ranks 模式装入）
- Modify: `content/world.json`（加 `officialPosts` 数组）
- Test: `tests/content/officials.test.ts`（新）

**Interfaces:**
- Produces: `officialPostSchema`, `type OfficialPost = { id: string; name: string; grade: string; gradeOrder: number }`, `ContentDB.officialPosts: Record<string, OfficialPost>`

- [ ] **Step 1: 写失败测试**

```ts
// tests/content/officials.test.ts
import { describe, expect, it } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("officialPosts table", () => {
  it("loads into ContentDB keyed by id, with valid gradeOrder bounds", () => {
    const posts = db.officialPosts;
    expect(Object.keys(posts).length).toBeGreaterThan(10);
    for (const p of Object.values(posts)) {
      expect(p.gradeOrder).toBeGreaterThanOrEqual(0);
      expect(p.gradeOrder).toBeLessThanOrEqual(18);
    }
    expect(posts["commoner"]?.gradeOrder).toBe(0);
    expect(posts["bingbu_shangshu"]).toMatchObject({ name: "兵部尚书", grade: "从二品" });
  });

  it("no post name contains the male-leaning 郎/卿 (official-naming-rule)", () => {
    for (const p of Object.values(db.officialPosts)) {
      expect(p.name.includes("郎")).toBe(false);
      expect(p.name.includes("卿")).toBe(false);
    }
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/content/officials.test.ts`
Expected: FAIL（`db.officialPosts` undefined）

- [ ] **Step 3: 加 schema**

`src/engine/content/schemas.ts`，在 `characterRankSchema` 附近加：

```ts
export const officialPostSchema = z.strictObject({
  id: idSchema,
  name: nonEmpty,
  grade: nonEmpty,
  gradeOrder: z.number().int().min(0).max(18),
});
export type OfficialPost = z.infer<typeof officialPostSchema>;
```

在 `worldSchema`（z.strictObject 内，紧跟 `ranks` 之后）加：

```ts
  officialPosts: z.array(officialPostSchema).min(1),
```

- [ ] **Step 4: loader 装入 ContentDB**

`src/engine/content/loader.ts`：`ContentDB` 接口加（在 `ranks` 之后）：

```ts
  officialPosts: Record<string, OfficialPost>;
```

import 加 `OfficialPost`、`officialPostSchema` 不必（用类型即可）。在构建 ranks 的同段之后，仿照 ranks 构建（`world` 已解析）：

```ts
  const officialPosts: Record<string, OfficialPost> = {};
  for (const post of world.officialPosts) {
    if (officialPosts[post.id]) {
      errors.push(contentError("DUPLICATE_ID", `world.json: duplicate official post id "${post.id}"`));
    }
    officialPosts[post.id] = post;
  }
```

把 `officialPosts` 加进**两处** ContentDB 字面量（成功返回与早返回的 `ok({...})`，与 `ranks` 并列）。import 顶部 `OfficialPost` 来自 `./schemas`。

- [ ] **Step 5: 写 world.json 官职表**

`content/world.json` 加顶层 `"officialPosts": [...]`（在 `ranks` 之后）。完整条目（id/name/grade/gradeOrder）：

```
丞相 正一品 18 | 太傅 从一品 17 | 太保 从一品 17 | 大都督 从一品 17 |
御史大夫 正二品 16 | 左丞 正二品 16 | 右丞 正二品 16 |
吏部尚书 从二品 15 | 户部尚书 从二品 15 | 礼部尚书 从二品 15 | 兵部尚书 从二品 15 | 刑部尚书 从二品 15 | 工部尚书 从二品 15 |
宗正寺正 正三品 14 | 大理寺正 正三品 14 | 太常寺正 正三品 14 | 国子监祭酒 正三品 14 | 指挥使 正三品 14 |
布政使 从三品 13 | 按察使 从三品 13 | 都指挥同知 从三品 13 |
六部副尚书 正四品 12 | 大理寺副正 正四品 12 | 太常寺副正 正四品 12 | 宗正寺副正 正四品 12 |
知府 从四品 11 | 御史中丞 从四品 11 |
部司正 正五品 10 | 同知 正五品 10 | 千户 正五品 10 |
部司副正 从五品 9 | 知州 从五品 9 | 百户 从五品 9 |
通判 正六品 8 | 司业 正六品 8 |
主事 从六品 7 | 县丞 从六品 7 |
知县 正七品 6 | 博士 正七品 6 |
典簿 从七品 5 | 经历 从七品 5 |
巡检 正八品 4 | 学正 正八品 4 |
照磨 从八品 3 | 训导 从八品 3 |
主簿 正九品 2 | 典史 从九品 1 |
平民 无 0
```

对应 id 见 spec §2.2 表（`chengxiang/taifu/taibao/dadudu/yushi_dafu/zuo_cheng/you_cheng/libu_shangshu/hubu_shangshu/libu2_shangshu/bingbu_shangshu/xingbu_shangshu/gongbu_shangshu/zongzheng_si_zheng/dali_si_zheng/taichang_si_zheng/guozijian_jijiu/zhihui_shi/buzhengshi/anchashi/duzhihui_tongzhi/liubu_fu_shangshu/dali_si_fuzheng/taichang_si_fuzheng/zongzheng_si_fuzheng/zhifu/yushi_zhongcheng/bushi_zheng/tongzhi/qianhu/bushi_fuzheng/zhizhou/baihu/tongpan/siye/zhushi/xiancheng/zhixian/boshi/dianbu/jingli/xunjian/xuezheng/zhaomo/xundao/zhubo/dianshi/commoner`）。平民 grade 用 `"无"`。

- [ ] **Step 6: 运行测试确认通过 + 全量 typecheck/test**

Run: `npx vitest run tests/content/officials.test.ts && npm run typecheck`
Expected: PASS（注意 `tests/content/boot.test.ts` 若断言 world 字段数可能需同步——若失败，把 officialPosts 计入）

- [ ] **Step 7: 提交**

```bash
git add src/engine/content/schemas.ts src/engine/content/loader.ts content/world.json tests/content/officials.test.ts
git commit -m "feat: 官职表 officialPosts（world.json + schema + 装载）"
```

---

### Task 2: 品级 → 权势 派生

**Files:**
- Create: `src/engine/officials/power.ts`
- Test: `tests/officials/power.test.ts`（新）

**Interfaces:**
- Consumes: `OfficialPost`（Task 1）、`gestationRoll`
- Produces: `powerOf(post: OfficialPost, officialId: string): number`

- [ ] **Step 1: 写失败测试**

```ts
// tests/officials/power.test.ts
import { describe, expect, it } from "vitest";
import { powerOf } from "../../src/engine/officials/power";
import type { OfficialPost } from "../../src/engine/content/schemas";

const post = (gradeOrder: number): OfficialPost => ({ id: "p", name: "x", grade: "g", gradeOrder });

describe("powerOf", () => {
  it("rises monotonically with gradeOrder", () => {
    expect(powerOf(post(18), "a")).toBeGreaterThan(powerOf(post(6), "a"));
    expect(powerOf(post(6), "a")).toBeGreaterThan(powerOf(post(0), "a"));
  });
  it("stays within 0–100 and is stable per id", () => {
    for (const g of [0, 6, 12, 18]) {
      const v = powerOf(post(g), "x");
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      expect(powerOf(post(g), "x")).toBe(v); // deterministic
    }
  });
  it("commoner (gradeOrder 0) is low", () => {
    expect(powerOf(post(0), "x")).toBeLessThanOrEqual(10);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/officials/power.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

```ts
// src/engine/officials/power.ts
import { gestationRoll } from "../characters/gestation";
import type { OfficialPost } from "../content/schemas";

/** 权势随品级单调（0–100），同品按 official id 给确定性 ±3 人差。 */
export function powerOf(post: OfficialPost, officialId: string): number {
  const base = Math.round((post.gradeOrder / 18) * 92) + 5;
  const jitter = (gestationRoll(`power:${officialId}`) % 7) - 3; // [-3, +3]
  return Math.max(0, Math.min(100, base + jitter));
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/officials/power.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/engine/officials/power.ts tests/officials/power.test.ts
git commit -m "feat: 品级→权势 派生 powerOf"
```

---

### Task 3: Official 实体 + GameState.officials + 存档/初始

**Files:**
- Modify: `src/engine/state/types.ts`（`Official` 接口 + `GameState.officials`）
- Modify: `src/engine/save/stateSchema.ts`（officials 校验）
- Modify: `src/engine/state/initialState.ts`（`officials: {}`）
- Modify: `src/engine/state/newGame.ts`（`officials: {}` 占位，Task 6 再换成生成）
- Test: `tests/save/saveSystem.test.ts`（既有，确认 round-trip 不破）+ 复用 `tests/state/initialState.test.ts`

**Interfaces:**
- Produces: `interface Official { id: string; surname: string; givenName: string; postId: string; loyalty: number }`，`GameState.officials: Record<string, Official>`

- [ ] **Step 1: 写失败测试**

`tests/state/initialState.test.ts` 既有「starts with empty collections」用例加一行：

```ts
    expect(state.officials).toEqual({});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/state/initialState.test.ts`
Expected: FAIL（`officials` 不存在）

- [ ] **Step 3: 加类型**

`src/engine/state/types.ts`，在 `// ── Per-character runtime state` 段加：

```ts
/** 朝臣名册条目（轻量运行态）。权势不落字段——由 postId→品级 派生。 */
export interface Official {
  id: string;
  surname: string;
  givenName: string;
  postId: string;
  loyalty: number; // 忠心 0–100
}
```

`GameState` 接口加（在 `standing` 附近）：

```ts
  officials: Record<string, Official>;
```

- [ ] **Step 4: stateSchema + initialState + newGame**

`src/engine/save/stateSchema.ts`：加 `officialSchema` 并在 state 字面量里（standing 之后）加 `officials`：

```ts
const officialSchema = z.strictObject({
  id: idSchema,
  surname: z.string().min(1),
  givenName: z.string().min(1),
  postId: idSchema,
  loyalty: percent,
});
// ... 在大对象内：
  officials: z.record(z.string(), officialSchema),
```

`src/engine/state/initialState.ts`：`standing: {}` 之后加 `officials: {}`。
`src/engine/state/newGame.ts`：返回对象 `standing,` 之后加 `officials: {},`（Task 6 替换为生成结果）。

- [ ] **Step 5: 运行确认通过 + 全量**

Run: `npx vitest run tests/state/initialState.test.ts && npm run typecheck && npm test`
Expected: PASS（saveSystem round-trip 自动覆盖 officials 空对象）

- [ ] **Step 6: 提交**

```bash
git add src/engine/state/types.ts src/engine/save/stateSchema.ts src/engine/state/initialState.ts src/engine/state/newGame.ts tests/state/initialState.test.ts
git commit -m "feat: Official 实体 + GameState.officials（存档/初始空名册）"
```

---

### Task 4: 姓名池 + 确定性取名

**Files:**
- Create: `src/engine/officials/namePool.ts`
- Test: `tests/officials/namePool.test.ts`（新）

**Interfaces:**
- Consumes: `gestationRoll`
- Produces: `OFFICIAL_SURNAME_POOL: readonly string[]`、`OFFICIAL_GIVEN_NAME_POOL: readonly string[]`、`pickGivenName(seed: string): string`、`pickSurname(seed: string, used: ReadonlySet<string>): string`

- [ ] **Step 1: 写失败测试**

```ts
// tests/officials/namePool.test.ts
import { describe, expect, it } from "vitest";
import {
  OFFICIAL_SURNAME_POOL, OFFICIAL_GIVEN_NAME_POOL, pickGivenName, pickSurname,
} from "../../src/engine/officials/namePool";

describe("official name pools", () => {
  it("pools are non-empty and contain no 郎/卿 (official-naming-rule)", () => {
    expect(OFFICIAL_SURNAME_POOL.length).toBeGreaterThan(10);
    expect(OFFICIAL_GIVEN_NAME_POOL.length).toBeGreaterThan(10);
    for (const n of [...OFFICIAL_SURNAME_POOL, ...OFFICIAL_GIVEN_NAME_POOL]) {
      expect(n.includes("郎") || n.includes("卿")).toBe(false);
    }
  });
  it("pickGivenName is deterministic", () => {
    expect(pickGivenName("s")).toBe(pickGivenName("s"));
    expect(OFFICIAL_GIVEN_NAME_POOL).toContain(pickGivenName("s"));
  });
  it("pickSurname avoids used surnames", () => {
    const used = new Set(OFFICIAL_SURNAME_POOL.slice(0, OFFICIAL_SURNAME_POOL.length - 1));
    expect(used.has(pickSurname("k", used))).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/officials/namePool.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**（姓名池取自 spec §4；given 用双字名池）

```ts
// src/engine/officials/namePool.ts
import { gestationRoll } from "../characters/gestation";

export const OFFICIAL_SURNAME_POOL: readonly string[] = [
  "王", "谢", "崔", "卢", "郑", "裴", "韦", "柳", "沈", "顾", "陆", "萧",
  "薛", "杜", "苏", "宋", "温", "秦", "江", "许", "徐", "韩", "杨", "周",
  "程", "林", "叶", "白", "孟", "方", "纪", "贺", "陶", "卫", "霍", "钟",
  "颜", "虞", "傅", "乔", "姜", "殷", "姚", "范", "邵", "赵", "陈",
  "司马", "上官", "欧阳", "诸葛", "长孙", "宇文", "皇甫", "公孙", "夏侯", "尉迟",
];

// 双字名为主，庄重；避用「郎」「卿」（official-naming-rule）。
export const OFFICIAL_GIVEN_NAME_POOL: readonly string[] = [
  "安石", "居正", "守仁", "守义", "守礼", "守正", "经邦", "济世", "治平", "安国",
  "定国", "辅国", "靖国", "兴国", "怀政", "秉政", "修政", "明政", "正则", "正言",
  "正度", "克明", "克勤", "克俭", "允中", "允正", "允文", "弘道", "弘文", "弘济",
  "弘毅", "弘正", "端方", "端谨", "端肃", "端正", "秉直", "秉正", "秉公", "秉义",
  "怀忠", "怀义", "怀信", "怀正", "敬之", "敬德", "敬义", "敬文", "慎行", "慎言",
  "文正", "文忠", "文肃", "文清", "书衡", "书正", "书远", "清献", "清端", "清正",
  "明允", "明道", "明礼", "明远", "知远", "知礼", "知章", "知政",
];

export function pickGivenName(seed: string): string {
  return OFFICIAL_GIVEN_NAME_POOL[gestationRoll(`given:${seed}`) % OFFICIAL_GIVEN_NAME_POOL.length]!;
}

/** 从姓氏池取一个未被占用的姓；从 hash 起点线性探查。 */
export function pickSurname(seed: string, used: ReadonlySet<string>): string {
  const n = OFFICIAL_SURNAME_POOL.length;
  const start = gestationRoll(`surname:${seed}`) % n;
  for (let i = 0; i < n; i++) {
    const s = OFFICIAL_SURNAME_POOL[(start + i) % n]!;
    if (!used.has(s)) return s;
  }
  return OFFICIAL_SURNAME_POOL[start]!; // 全占用兜底（不应发生：池 > K + 母家姓数）
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/officials/namePool.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/engine/officials/namePool.ts tests/officials/namePool.test.ts
git commit -m "feat: 官员姓名池 + 确定性取名"
```

---

### Task 5: 侍君 maternalClan 字段 + 内容补写（旧字段暂留）

**Files:**
- Modify: `src/engine/content/schemas.ts`（characterSchema 加 `maternalClan` optional）
- Modify: 各侍君内容文件加 `maternalClan`（`content/characters/shen_zhibai.json` / `xu_qinghuan.json` / `lu_huaijin.json` / `wenya.json` 等所有 consort）
- Test: `tests/content/officials.test.ts`（追加）

**Interfaces:**
- Produces: `CharacterContent.maternalClan?: { postId: string; legitimate: boolean; birthOrder: number }`

> 本任务**只加不删**：family / clanLoyalty / clanPower 暂留（Task 10 统一删）。这样派生（Task 7）有 maternalClan 可读，而 UI 仍读旧字段不报错。

- [ ] **Step 1: 写失败测试**

`tests/content/officials.test.ts` 追加：

```ts
describe("consort maternalClan", () => {
  it("each consort with a surname declares a maternalClan referencing a real post", () => {
    const db = loadRealContent();
    const consorts = Object.values(db.characters).filter((c) => c.kind === "consort" && c.profile.surname);
    expect(consorts.length).toBeGreaterThan(0);
    for (const c of consorts) {
      expect(c.maternalClan, c.id).toBeDefined();
      expect(db.officialPosts[c.maternalClan!.postId], c.id).toBeDefined();
      expect(c.maternalClan!.birthOrder).toBeGreaterThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/content/officials.test.ts`
Expected: FAIL（maternalClan 未定义）

- [ ] **Step 3: schema 加字段**

`src/engine/content/schemas.ts` characterSchema（`stances` 附近）加：

```ts
    maternalClan: z
      .strictObject({
        postId: idSchema,
        legitimate: z.boolean(),
        birthOrder: z.number().int().min(1),
      })
      .optional(),
```

- [ ] **Step 4: 各侍君内容补 maternalClan**

对每个 `kind:"consort"` 且有 `surname` 的角色文件加（值按人设，postId 取 world.json 官职表的 id）。示例（徐清欢，对应 spec「从一品兵部尚书嫡次子」）：

```json
  "maternalClan": { "postId": "bingbu_shangshu", "legitimate": true, "birthOrder": 2 },
```

逐个文件按既有人设与位分高低选官职：高门→尚书/丞相级，低位→知府/知县级；冷宫/平民出身可省略 maternalClan（家世「平民之子」）。沈知白（凤后）取高门（如 `libu_shangshu` 嫡长）。确保**同姓侍君 postId 一致**（v1 一姓一母家主）。

- [ ] **Step 5: 运行确认通过 + 全量**

Run: `npx vitest run tests/content/officials.test.ts && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/engine/content/schemas.ts content/characters/*.json tests/content/officials.test.ts
git commit -m "feat: 侍君 maternalClan 字段 + 各侍君母家补写"
```

---

### Task 6: 名册生成 + 接入新游戏

**Files:**
- Create: `src/engine/officials/generate.ts`
- Modify: `src/engine/state/newGame.ts`（调用 generateOfficials）
- Test: `tests/officials/generate.test.ts`（新）

**Interfaces:**
- Consumes: `ContentDB`、`pickGivenName`、`pickSurname`、`gestationRoll`、`Official`
- Produces: `generateOfficials(db: ContentDB, rngSeed: number): Record<string, Official>`
- `createNewGameState` 的 `officials` 从空改为 `generateOfficials(db, rngSeed)`

- [ ] **Step 1: 写失败测试**

```ts
// tests/officials/generate.test.ts
import { describe, expect, it } from "vitest";
import { generateOfficials } from "../../src/engine/officials/generate";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("generateOfficials", () => {
  it("is deterministic for a given seed", () => {
    expect(generateOfficials(db, 1)).toEqual(generateOfficials(db, 1));
  });
  it("creates exactly one head per consort surname-with-maternalClan, matching postId", () => {
    const officials = generateOfficials(db, 1);
    const consorts = Object.values(db.characters).filter((c) => c.kind === "consort" && c.maternalClan && c.profile.surname);
    const surnames = new Set(consorts.map((c) => c.profile.surname!));
    for (const surname of surnames) {
      const head = Object.values(officials).find((o) => o.surname === surname);
      expect(head, surname).toBeDefined();
      const consort = consorts.find((c) => c.profile.surname === surname)!;
      expect(head!.postId).toBe(consort.maternalClan!.postId);
    }
  });
  it("adds 8 unlinked officials beyond the heads, with unique surnames", () => {
    const officials = generateOfficials(db, 1);
    const headSurnames = new Set(
      Object.values(db.characters).filter((c) => c.kind === "consort" && c.maternalClan && c.profile.surname).map((c) => c.profile.surname),
    );
    const unlinked = Object.values(officials).filter((o) => !headSurnames.has(o.surname));
    expect(unlinked).toHaveLength(8);
    const allSurnames = Object.values(officials).map((o) => o.surname);
    expect(new Set(allSurnames).size).toBe(allSurnames.length); // no surname collision
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/officials/generate.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 generate**

```ts
// src/engine/officials/generate.ts
import { gestationRoll } from "../characters/gestation";
import type { ContentDB } from "../content/loader";
import type { Official } from "../state/types";
import { pickGivenName, pickSurname } from "./namePool";

const UNLINKED_COUNT = 8;

export function generateOfficials(db: ContentDB, rngSeed: number): Record<string, Official> {
  const officials: Record<string, Official> = {};
  const used = new Set<string>();

  // 母家主：每个 (有 surname + maternalClan) 的姓一名，postId 取该姓侍君（首个）的 maternalClan.postId
  const headPost = new Map<string, string>();
  for (const c of Object.values(db.characters)) {
    if (c.kind !== "consort" || !c.maternalClan || !c.profile.surname) continue;
    if (!headPost.has(c.profile.surname)) headPost.set(c.profile.surname, c.maternalClan.postId);
  }
  for (const [surname, postId] of headPost) {
    const id = `official_${surname}`;
    officials[id] = {
      id, surname, postId,
      givenName: pickGivenName(`${rngSeed}:${surname}`),
      loyalty: gestationRoll(`loyal:${rngSeed}:${surname}`),
    };
    used.add(surname);
  }

  // 无关联官员：K 名填充朝堂
  const nonCommoner = Object.values(db.officialPosts).filter((p) => p.gradeOrder > 0);
  for (let i = 0; i < UNLINKED_COUNT; i++) {
    const surname = pickSurname(`${rngSeed}:${i}`, used);
    used.add(surname);
    const post = nonCommoner[gestationRoll(`post:${rngSeed}:${i}`) % nonCommoner.length]!;
    const id = `official_${String(i + 1).padStart(6, "0")}`;
    officials[id] = {
      id, surname, postId: post.id,
      givenName: pickGivenName(`${rngSeed}:u${i}`),
      loyalty: gestationRoll(`loyal:${rngSeed}:u${i}`),
    };
  }
  return officials;
}
```

- [ ] **Step 4: 接入 newGame**

`src/engine/state/newGame.ts`：import `generateOfficials`；把返回对象里的 `officials: {},` 改为 `officials: generateOfficials(db, rngSeed),`。

- [ ] **Step 5: 运行确认通过 + 全量**

Run: `npx vitest run tests/officials/generate.test.ts && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/engine/officials/generate.ts src/engine/state/newGame.ts tests/officials/generate.test.ts
git commit -m "feat: 名册种子生成 generateOfficials + 接入新游戏"
```

---

### Task 7: 派生函数（家世/母家权势/母家忠心）

**Files:**
- Create: `src/engine/officials/derive.ts`
- Test: `tests/officials/derive.test.ts`（新）

**Interfaces:**
- Consumes: `ContentDB`、`GameState`、`CharacterContent`、`Official`、`powerOf`
- Produces:
  - `maternalHead(state: GameState, consort: CharacterContent): Official | undefined`
  - `familyText(db: ContentDB, state: GameState, consort: CharacterContent): string`
  - `maternalPower(db: ContentDB, state: GameState, consort: CharacterContent): number`
  - `maternalLoyalty(state: GameState, consort: CharacterContent): number`

- [ ] **Step 1: 写失败测试**

```ts
// tests/officials/derive.test.ts
import { describe, expect, it } from "vitest";
import { familyText, maternalHead, maternalLoyalty, maternalPower } from "../../src/engine/officials/derive";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const state = createNewGameState(db);
const xu = db.characters["xu_qinghuan"]!; // surname 徐, maternalClan{bingbu_shangshu, 嫡, 次}

describe("maternal derivations", () => {
  it("familyText = 品级+官职+嫡庶+排行子", () => {
    expect(familyText(db, state, xu)).toBe("从二品兵部尚书嫡次子");
  });
  it("maternalPower equals the head's powerOf; loyalty equals head loyalty", () => {
    const head = maternalHead(state, xu)!;
    expect(head.surname).toBe("徐");
    expect(maternalLoyalty(state, xu)).toBe(head.loyalty);
    expect(maternalPower(db, state, xu)).toBeGreaterThan(0);
  });
  it("a consort without maternalClan reads 平民之子 / 0", () => {
    const fake = { ...xu, maternalClan: undefined, profile: { ...xu.profile, surname: undefined } };
    expect(familyText(db, state, fake)).toBe("平民之子");
    expect(maternalPower(db, state, fake)).toBe(0);
    expect(maternalLoyalty(state, fake)).toBe(0);
  });
});
```

> 注：`从二品兵部尚书` 取决于 Task 1 表里 bingbu_shangshu 的 grade（从二品）。若 Task 5 给徐清欢的 postId 不同，按实际调整断言。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/officials/derive.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 derive**

```ts
// src/engine/officials/derive.ts
import type { ContentDB } from "../content/loader";
import type { CharacterContent } from "../content/schemas";
import type { GameState, Official } from "../state/types";
import { powerOf } from "./power";

const ORDINAL = ["长", "次", "三", "四", "五", "六", "七", "八", "九", "十"];
function ordinalChar(n: number): string {
  return ORDINAL[n - 1] ?? `第${n}`;
}

export function maternalHead(state: GameState, consort: CharacterContent): Official | undefined {
  const surname = consort.profile.surname;
  if (!surname) return undefined;
  return Object.values(state.officials).find((o) => o.surname === surname);
}

export function familyText(db: ContentDB, state: GameState, consort: CharacterContent): string {
  const mc = consort.maternalClan;
  const head = maternalHead(state, consort);
  if (!mc || !head) return "平民之子";
  const post = db.officialPosts[head.postId];
  if (!post || post.gradeOrder === 0) return "平民之子";
  const xi = mc.legitimate ? "嫡" : "庶";
  return `${post.grade}${post.name}${xi}${ordinalChar(mc.birthOrder)}子`;
}

export function maternalPower(db: ContentDB, state: GameState, consort: CharacterContent): number {
  const head = maternalHead(state, consort);
  if (!head) return 0;
  const post = db.officialPosts[head.postId];
  return post ? powerOf(post, head.id) : 0;
}

export function maternalLoyalty(state: GameState, consort: CharacterContent): number {
  return maternalHead(state, consort)?.loyalty ?? 0;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/officials/derive.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/engine/officials/derive.ts tests/officials/derive.test.ts
git commit -m "feat: 母家派生（家世文本/母家权势/母家忠心）"
```

---

### Task 8: loader 跨引用校验（postId + 同姓一致）

**Files:**
- Modify: `src/engine/content/loader.ts`（校验 maternalClan.postId 存在；同姓侍君 postId 一致）
- Test: `tests/content/loader.test.ts`（追加用例）

**Interfaces:**
- Consumes: ContentDB.officialPosts、characters

- [ ] **Step 1: 写失败测试**

`tests/content/loader.test.ts`，仿现有 cross-reference 用例结构（构造含坏引用的最小 universe），加：

```ts
  it("maternalClan referencing an unknown post is reported", () => {
    // 在最小 fixture 的某 consort 上加 maternalClan.postId="post_ghost"
    // 期望 errors 含 MISSING_REF（character/post）
  });
  it("two same-surname consorts with conflicting maternalClan.postId is reported", () => {
    // 两名 surname 相同、postId 不同的 consort
    // 期望 errors 含 BAD_REF/冲突
  });
```

> 实现者按 loader.test.ts 既有最小 universe 构造法补全 fixture（参考文件内 `makeUniverse`/现有 cross-ref 用例）。错误码用既有 `missingRef` + 新增一条 `contentError("CONFLICT", ...)` 或复用既有码。

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/content/loader.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现校验**

`src/engine/content/loader.ts`，在 `checkCharacterRefs`（或同级 character 校验段）内，对每个有 `maternalClan` 的 character：

```ts
  // maternalClan.postId 必须存在
  const surnamePost = new Map<string, string>();
  for (const c of Object.values(characters)) {
    if (!c.maternalClan) continue;
    if (!officialPosts[c.maternalClan.postId]) {
      errors.push(missingRef(`characters/${c.id}.json`, "officialPost", c.maternalClan.postId));
    }
    const surname = c.profile.surname;
    if (surname) {
      const prev = surnamePost.get(surname);
      if (prev && prev !== c.maternalClan.postId) {
        errors.push(contentError("BAD_REF", `characters/${c.id}.json: 同姓「${surname}」母家官职冲突（${prev} vs ${c.maternalClan.postId}）`));
      } else if (!prev) surnamePost.set(surname, c.maternalClan.postId);
    }
  }
```

把 `officialPosts` 传入该校验函数（调用处补参数）。`missingRef` 第二参为类目字符串，沿用既有签名。

- [ ] **Step 4: 运行确认通过 + 全量**

Run: `npx vitest run tests/content/loader.test.ts && npm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/engine/content/loader.ts tests/content/loader.test.ts
git commit -m "feat: loader 校验 maternalClan.postId + 同姓母家一致"
```

---

### Task 9: 改品级接口 + store action

**Files:**
- Create: `src/engine/officials/changeGrade.ts`
- Modify: `src/store/gameStore.ts`（暴露 action，按现有 store 形态）
- Test: `tests/officials/changeGrade.test.ts`（新）

**Interfaces:**
- Produces: `changeOfficialGrade(state: GameState, officialId: string, newPostId: string): GameState`（纯函数，返回新 state；postId 变、power 随派生跟随、loyalty 不变）

- [ ] **Step 1: 写失败测试**

```ts
// tests/officials/changeGrade.test.ts
import { describe, expect, it } from "vitest";
import { changeOfficialGrade } from "../../src/engine/officials/changeGrade";
import { powerOf } from "../../src/engine/officials/power";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("changeOfficialGrade", () => {
  it("changes postId and keeps loyalty; power follows the new post; input not mutated", () => {
    const state = createNewGameState(db);
    const id = Object.keys(state.officials)[0]!;
    const before = state.officials[id]!;
    const next = changeOfficialGrade(state, id, "zhixian"); // 正七品
    expect(next.officials[id]!.postId).toBe("zhixian");
    expect(next.officials[id]!.loyalty).toBe(before.loyalty);
    expect(state.officials[id]!.postId).toBe(before.postId); // 不可变
    const post = db.officialPosts["zhixian"]!;
    expect(powerOf(post, id)).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx vitest run tests/officials/changeGrade.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```ts
// src/engine/officials/changeGrade.ts
import type { GameState } from "../state/types";

/** 改某官员的官职（→品级→权势派生跟随）。返回新 state；未知 id/post 时原样返回。 */
export function changeOfficialGrade(state: GameState, officialId: string, newPostId: string): GameState {
  const cur = state.officials[officialId];
  if (!cur) return state;
  return {
    ...state,
    officials: { ...state.officials, [officialId]: { ...cur, postId: newPostId } },
  };
}
```

> store action（gameStore）：按现有 mutation 模式加一个薄封装（参考 `setEraName`），调用 `changeOfficialGrade` 并 `emit()`。v1 无 UI 调用方，仅留接口。若 store 形态不便，可在本任务仅交付纯函数 + 一个 store 方法骨架，标注未接 UI。

- [ ] **Step 4: 运行确认通过**

Run: `npx vitest run tests/officials/changeGrade.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/engine/officials/changeGrade.ts src/store/gameStore.ts tests/officials/changeGrade.test.ts
git commit -m "feat: 改品级接口 changeOfficialGrade + store action"
```

---

### Task 10: 切换——drawer/card 改读派生 + 删旧字段

**Files:**
- Modify: `src/ui/components/CharacterProfileDrawer.tsx`（家世→familyText、母家忠心→maternalLoyalty、母家权势→maternalPower）
- Modify: `src/ui/components/CharacterCard.tsx`（ATTRIBUTE_LABELS 去掉 family）
- Modify: `src/engine/content/schemas.ts`（consortAttributesSchema 删 `family`；consortHiddenSchema 删 `clanLoyalty`/`clanPower`）
- Modify: 各侍君内容文件（删 `family` / `clanLoyalty` / `clanPower`）
- Modify: 受影响测试（如断言 family/clan 的用例）
- Test: 全量 `npm test`

**Interfaces:**
- Consumes: Task 7 的 `familyText`/`maternalPower`/`maternalLoyalty`

> 本任务一次性切换，保证 typecheck 绿：先把 UI 改成读派生，再删 schema 字段与内容字段。

- [ ] **Step 1: drawer 改读派生**

`CharacterProfileDrawer.tsx`：
- attrs tab「才貌」段：把 `<Stat label="家世" value={attrs.family} />` 换成 `<Field label="家世" value={familyText(db, state, character)} />`（家世现为文本，用 Field 不用 Stat）。
- 暗属性段：把 `<Stat label="母家忠心" value={character.hidden.clanLoyalty} />`、`<Stat label="母家权势" value={character.hidden.clanPower} />` 换成 `<Stat label="母家忠心" value={maternalLoyalty(state, character)} />`、`<Stat label="母家权势" value={maternalPower(db, state, character)} />`（仍数字；形容词化留下一份 spec）。
- import `familyText, maternalLoyalty, maternalPower` from `../../engine/officials/derive`。

- [ ] **Step 2: card 去 family**

`CharacterCard.tsx`：`ATTRIBUTE_LABELS` 删 `["family", "家世"]` 这一项（及类型里的 `"family"`）。

- [ ] **Step 3: 删 schema 字段**

`schemas.ts`：`consortAttributesSchema` 删 `family: percent,`；`consortHiddenSchema` 删 `clanLoyalty`/`clanPower` 两行。

- [ ] **Step 4: 删内容字段**

各 consort 文件删 `attributes.family`、`hidden.clanLoyalty`、`hidden.clanPower`。可用逐文件 Edit；删后 `node -e "require('./content/characters/X.json')"` 验 JSON。

- [ ] **Step 5: 修受影响测试 + 全量**

Run: `npm run typecheck && npm test`
Expected: 先红（断言 family/clan 的用例 + schemas.test/loader.test fixtures 含这些字段），逐个修：fixtures 去掉 family/clanLoyalty/clanPower，断言改读派生或删除。直至 PASS。

- [ ] **Step 6: build 验证**

Run: `npm run build`
Expected: 成功

- [ ] **Step 7: 提交**

```bash
git add src/ui/components/CharacterProfileDrawer.tsx src/ui/components/CharacterCard.tsx src/engine/content/schemas.ts content/characters/*.json tests/
git commit -m "refactor: 家世/母家忠心/母家权势改读派生，删 family/clanLoyalty/clanPower 静态字段"
```

---

## 自查

- **spec 覆盖**：官职表(T1)、权势派生(T2)、Official 实体/状态(T3)、姓名池(T4)、maternalClan(T5)、生成(T6)、派生(T7)、loader 校验(T8)、改品级(T9)、UI 切换+删旧字段(T10)。spec §1–§8 各项均有任务。
- **占位符**：无 TBD；T5 各侍君具体 postId/嫡庶/排行由实现者按人设填，T8 fixture 按 loader.test 既有构造法补全——均为内容/测试细节，非逻辑空缺。
- **类型一致**：`Official`/`OfficialPost`/`maternalClan` 字段与签名跨任务一致；`powerOf(post, id)`、`familyText(db,state,consort)` 等签名在 Interfaces 块声明并被后续任务引用。
- **绿色保证**：旧字段(family/clan)在 T1–T9 全程保留，T10 才删并同步 UI——每个任务结束 typecheck/test 可绿。

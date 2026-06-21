# 大选（三年一次殿选）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每三年一次的后宫大选：乘风按日历提醒，殿选随机生成 8–12 位秀男供挑选，选中者落库为持久侍君，五月起可侍寝。

**Architecture:** 秀男为运行时随机生成的 `CharacterContent`，存于 `GameState.generatedConsorts`，由 App 用 `useMemo` 合并进 `db.characters` 让全部调用点可见。纯逻辑（触发判定、候选生成、推荐位分、落库、NPC 自留）放在 `src/store/grandSelection.ts` 并以 vitest 测试；殿选界面与 App 接线为薄壳，靠 `tsc` + 手测验证。

**Tech Stack:** TypeScript、React、Zod、Vitest。确定性随机用 `gestationRoll`/`gestationRollRaw`（FNV-1a，不改 `rngSeed`）。

## Global Constraints

- 设计依据：`docs/superpowers/specs/2026-06-21-grand-selection-design.md`（本计划逐节实现它）。
- 大选年：`(year - 1) % 3 === 0`（元年、四年、七年…）。
- 二月报告槽位：`month===2 && period==="early" && shichenSlot===MORNING_SLOT(=1)`；flag `daxuan:announce:{year}` 一次性。
- 四月殿选 prompt 槽位：`month===4 && period==="late" && shichenSlot===MORNING_SLOT`；flag `daxuan:dianxuan:{year}` 一次性。
- 候选数量 8–12；id 形如 `xiunan_{year}_{i}`（合 `idSchema`：小写 snake_case）。
- 推荐位分（皇后标准，`gradeOrder` 18=正一品 … 1=最低）：`≥17→guiren(贵人)`、`≥13→meiren(美人)`、`≥9→changzai(常在)`、`≥5→daying(答应)`、其余/平民→`gengyi(更衣)`。
- 玩家可选位分范围：位分表 `order` 50（更衣）– 180（皇贵君），排除 `fenghou`（order 1000）。
- 初始恩宠：`clamp(10 + round(10 * (order - 50) / 130), 10, 20)`（更衣 10 → 皇贵君 20）。
- 侍寝门槛：`standing.availableFromMonth = monthOrdinal({year, month:5})`；`monthOrdinal(now) < availableFromMonth` 时不可侍寝。
- NPC 自留：委托 20% 留 1–2 位随机；早退场 20% 留 1 位随机（从剩余未审阅者取）；按推荐位分自动定。
- 殿选进殿扣 **1 AP**；委托不扣 AP。
- 落库侍君 `defaultLocation`/`residence` = `chuxiu_gong`，`chamber` = `main`。
- 抬头/才艺描述为模板化确定性文案（不调 LLM）。
- pre-release，不迁移旧存档（memory `no-save-backcompat`）。
- 测试目录 `tests/` 镜像 `src/`；测试用 `loadGameContent()`（`src/engine/content/viteSource`）取真实内容。

---

### Task 1: GameState 新字段（generatedConsorts + availableFromMonth）

**Files:**
- Modify: `src/engine/state/types.ts`（`CharacterStanding`、`GameState`）
- Modify: `src/engine/content/schemas.ts`（`characterStandingSchema`）
- Modify: `src/engine/save/stateSchema.ts`（`gameStateSchema`）
- Modify: `src/engine/state/newGame.ts`（`createNewGameState` 返回值）
- Modify: `src/engine/state/initialState.ts`（`createInitialState` 返回值）
- Test: `tests/save/stateSchema.grandSelection.test.ts`

**Interfaces:**
- Produces: `CharacterStanding.availableFromMonth?: number`；`GameState.generatedConsorts: Record<string, CharacterContent>`。

- [ ] **Step 1: Write the failing test**

```ts
// tests/save/stateSchema.grandSelection.test.ts
import { describe, expect, it } from "vitest";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("generatedConsorts in GameState", () => {
  it("createNewGameState seeds an empty generatedConsorts map", () => {
    const s = createNewGameState(db);
    expect(s.generatedConsorts).toEqual({});
  });

  it("a state carrying a generated consort + availableFromMonth round-trips through the save schema", () => {
    const s = createNewGameState(db);
    const sample = db.characters["lu_huaijin"]!;
    const withGen = {
      ...s,
      generatedConsorts: { xiunan_1_0: { ...sample, id: "xiunan_1_0", defaultLocation: "chuxiu_gong" } },
      standing: { ...s.standing, xiunan_1_0: { rank: "gengyi", favor: 10, residence: "chuxiu_gong", chamber: "main" as const, availableFromMonth: 5 } },
    };
    const parsed = gameStateSchema.safeParse(withGen);
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/save/stateSchema.grandSelection.test.ts`
Expected: FAIL — `generatedConsorts` undefined / strict schema rejects unknown key.

- [ ] **Step 3: Add the type fields**

In `src/engine/state/types.ts`, inside `interface CharacterStanding`, after the `affection?` line add:

```ts
  /** 殿选新晋侍君的侍寝解禁月序（monthOrdinal）；缺省即无门槛。 */
  availableFromMonth?: number;
```

In the same file, inside `interface GameState`, after the `standing` line add:

```ts
  /** 殿选运行时生成并落库的侍君（content 之外）；App 合并进 db.characters。 */
  generatedConsorts: Record<string, CharacterContent>;
```

Add the import at the top of `types.ts` (next to existing imports):

```ts
import type { CharacterContent } from "../content/schemas";
```

- [ ] **Step 4: Extend the content standing schema**

In `src/engine/content/schemas.ts`, inside `characterStandingSchema` strictObject, after `affection: percent.optional(),` add:

```ts
  availableFromMonth: z.number().int().min(1).optional(),
```

- [ ] **Step 5: Extend the save schema**

In `src/engine/save/stateSchema.ts`: at the top ensure `characterSchema` is imported from content schemas:

```ts
import { characterStandingSchema, characterSchema } from "../content/schemas";
```

Then inside `gameStateSchema` strictObject, immediately after the `standing: z.record(idSchema, characterStandingSchema),` line add:

```ts
  generatedConsorts: z.record(idSchema, characterSchema),
```

- [ ] **Step 6: Seed the field in both state constructors**

In `src/engine/state/newGame.ts`, in the returned object after `standing,` add:

```ts
    generatedConsorts: {},
```

In `src/engine/state/initialState.ts`, in the returned object after `standing: {},` add:

```ts
    generatedConsorts: {},
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run tests/save/stateSchema.grandSelection.test.ts`
Expected: PASS (both tests).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If other constructors of `GameState` exist in test helpers, add `generatedConsorts: {}` there too.)

- [ ] **Step 9: Commit**

```bash
git add src/engine/state/types.ts src/engine/content/schemas.ts src/engine/save/stateSchema.ts src/engine/state/newGame.ts src/engine/state/initialState.ts tests/save/stateSchema.grandSelection.test.ts
git commit -m "feat: GameState 新增 generatedConsorts + standing.availableFromMonth"
```

---

### Task 2: 侍寝门槛遵守 availableFromMonth

**Files:**
- Modify: `src/store/bedchamber.ts`（`canSummon`、`passionAllowed`）
- Test: `tests/store/bedchamber.grandSelection.test.ts`

**Interfaces:**
- Consumes: `CharacterStanding.availableFromMonth`（Task 1）。
- Produces: `canSummon(state, charId)` / `passionAllowed(state, charId)` 在 `monthOrdinal(now) < availableFromMonth` 时为 `false`。

- [ ] **Step 1: Write the failing test**

```ts
// tests/store/bedchamber.grandSelection.test.ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { canSummon, passionAllowed } from "../../src/store/bedchamber";
import { monthOrdinal } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("availableFromMonth gates 侍寝", () => {
  it("blocks before the unlock month, allows on/after", () => {
    const s = createNewGameState(db); // 元年一月
    const unlock = monthOrdinal({ year: s.calendar.year, month: 5 });
    const id = "xiunan_1_0";
    const blocked = { ...s, standing: { ...s.standing, [id]: { rank: "gengyi", favor: 10, availableFromMonth: unlock } } };
    expect(canSummon(blocked, id)).toBe(false);
    expect(passionAllowed(blocked, id)).toBe(false);

    const inMay = { ...blocked, calendar: { ...blocked.calendar, month: 5, period: "early" as const } };
    expect(canSummon(inMay, id)).toBe(true);
    expect(passionAllowed(inMay, id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/bedchamber.grandSelection.test.ts`
Expected: FAIL — `canSummon` ignores `availableFromMonth` (returns true).

- [ ] **Step 3: Implement the gate**

In `src/store/bedchamber.ts`, replace the body of `canSummon`:

```ts
/** 可召侍寝：非已故、且已过侍寝解禁月。 */
export function canSummon(state: GameState, charId: string): boolean {
  const st = state.standing[charId];
  if (!st || st.lifecycle === "deceased") return false;
  if (st.availableFromMonth !== undefined && monthOrdinal(state.calendar) < st.availableFromMonth) return false;
  return true;
}
```

In the same file, in `passionAllowed`, after the existing `recoverUntilMonth` guard add:

```ts
  if (st.availableFromMonth !== undefined && monthOrdinal(state.calendar) < st.availableFromMonth) return false;
```

(`monthOrdinal` is already imported in this file — it is used by `passionAllowed`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/bedchamber.grandSelection.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full bedchamber suite (no regressions)**

Run: `npx vitest run tests/store/bedchamber.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/bedchamber.ts tests/store/bedchamber.grandSelection.test.ts
git commit -m "feat: 侍寝门槛遵守 standing.availableFromMonth"
```

---

### Task 3: grandSelection 核心纯函数（触发判定 / 推荐位分 / 初始恩宠 / 可选位分）

**Files:**
- Create: `src/store/grandSelection.ts`
- Test: `tests/store/grandSelection.core.test.ts`

**Interfaces:**
- Produces:
  - `isDaxuanYear(year: number): boolean`
  - `daxuanAnnounceFlagKey(year: number): string` → `"daxuan:announce:{year}"`
  - `daxuanDianxuanFlagKey(year: number): string` → `"daxuan:dianxuan:{year}"`
  - `recommendRank(grade: number | "commoner"): string`（返回 rank id）
  - `initialFavorForRank(order: number): number`
  - `pickableRanks(db: ContentDB): CharacterRank[]`（order 50–180，排除 fenghou，降序）

- [ ] **Step 1: Write the failing test**

```ts
// tests/store/grandSelection.core.test.ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import {
  isDaxuanYear, daxuanAnnounceFlagKey, daxuanDianxuanFlagKey,
  recommendRank, initialFavorForRank, pickableRanks,
} from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("大选年判定", () => {
  it("元年/四年/七年为大选年；二三五六年不是", () => {
    expect([1, 4, 7, 10].map(isDaxuanYear)).toEqual([true, true, true, true]);
    expect([2, 3, 5, 6, 8].map(isDaxuanYear)).toEqual([false, false, false, false, false]);
  });
  it("flag key 拼接", () => {
    expect(daxuanAnnounceFlagKey(4)).toBe("daxuan:announce:4");
    expect(daxuanDianxuanFlagKey(4)).toBe("daxuan:dianxuan:4");
  });
});

describe("recommendRank 家世→位分", () => {
  it("按官品分档", () => {
    expect(recommendRank(18)).toBe("guiren");   // 正一品
    expect(recommendRank(17)).toBe("guiren");   // 从一品
    expect(recommendRank(16)).toBe("meiren");   // 正二品
    expect(recommendRank(13)).toBe("meiren");   // 从三品
    expect(recommendRank(12)).toBe("changzai"); // 正四品
    expect(recommendRank(9)).toBe("changzai");  // 从五品
    expect(recommendRank(8)).toBe("daying");    // 正六品
    expect(recommendRank(5)).toBe("daying");    // 从七品
    expect(recommendRank(4)).toBe("gengyi");    // 八品以下
    expect(recommendRank("commoner")).toBe("gengyi");
  });
});

describe("initialFavorForRank", () => {
  it("更衣 10、皇贵君 20、中间线性、夹在 10–20", () => {
    expect(initialFavorForRank(50)).toBe(10);   // 更衣
    expect(initialFavorForRank(180)).toBe(20);  // 皇贵君
    expect(initialFavorForRank(115)).toBe(15);  // 中点附近
    const v = initialFavorForRank(1000);        // 越界（凤后）仍夹住
    expect(v).toBeLessThanOrEqual(20);
    expect(v).toBeGreaterThanOrEqual(10);
  });
});

describe("pickableRanks", () => {
  it("含更衣与皇贵君、不含凤后，降序", () => {
    const ranks = pickableRanks(db);
    const ids = ranks.map((r) => r.id);
    expect(ids).toContain("gengyi");
    expect(ids).toContain("huangguijun");
    expect(ids).not.toContain("fenghou");
    const orders = ranks.map((r) => r.order);
    expect(orders).toEqual([...orders].sort((a, b) => b - a));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/grandSelection.core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module with the core functions**

```ts
// src/store/grandSelection.ts
/**
 * 大选（三年一次殿选）：日历门控触发、候选秀男生成、推荐位分、落库、NPC 自留。
 * 纯逻辑集中于此；殿选界面与 App 接线只调用本模块。确定性随机走 gestationRoll。
 */
import type { ContentDB } from "../engine/content/loader";
import type { CharacterRank } from "../engine/content/schemas";

/** 大选年：元年、四年、七年…（每三年）。 */
export function isDaxuanYear(year: number): boolean {
  return (year - 1) % 3 === 0;
}

export function daxuanAnnounceFlagKey(year: number): string {
  return `daxuan:announce:${year}`;
}

export function daxuanDianxuanFlagKey(year: number): string {
  return `daxuan:dianxuan:${year}`;
}

/** 皇后推荐位分：父官品(gradeOrder 18=正一品…) 或平民 → rank id。 */
export function recommendRank(grade: number | "commoner"): string {
  if (grade === "commoner") return "gengyi";
  if (grade >= 17) return "guiren";   // 一品/皇亲
  if (grade >= 13) return "meiren";   // 二三品
  if (grade >= 9) return "changzai";  // 四五品
  if (grade >= 5) return "daying";    // 六七品
  return "gengyi";                    // 八品以下
}

/** 初始恩宠随位分缩放：更衣(50)→10，皇贵君(180)→20，线性，夹在 10–20。 */
export function initialFavorForRank(order: number): number {
  const raw = 10 + Math.round((10 * (order - 50)) / 130);
  return Math.max(10, Math.min(20, raw));
}

/** 玩家可选位分：order 50（更衣）–180（皇贵君），排除凤后；降序。 */
export function pickableRanks(db: ContentDB): CharacterRank[] {
  return Object.values(db.ranks)
    .filter((r) => r.domain === "harem" && r.id !== "fenghou" && r.order >= 50 && r.order <= 180)
    .sort((a, b) => b.order - a.order);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/grandSelection.core.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/grandSelection.ts tests/store/grandSelection.core.test.ts
git commit -m "feat: 大选核心纯函数（触发/推荐位分/初始恩宠/可选位分）"
```

---

### Task 4: 候选秀男生成 + 抬头/才艺描述

**Files:**
- Modify: `src/store/grandSelection.ts`（追加生成池、`Candidate`、`generateCandidates`、`describeRaiseHead`、`describeTalent`）
- Test: `tests/store/grandSelection.generate.test.ts`

**Interfaces:**
- Consumes: `gestationRoll`/`gestationRollRaw`（`src/engine/characters/gestation`）、`chineseNumeral`（`src/engine/calendar/time`）、`characterSchema`、`state.officials`。
- Produces:
  - `interface Candidate { content: CharacterContent; fatherOfficialId?: string; grade: number | "commoner"; announce: string }`
  - `generateCandidates(db: ContentDB, state: GameState, year: number): Candidate[]`
  - `describeRaiseHead(content: CharacterContent): string`
  - `describeTalent(content: CharacterContent): string`

- [ ] **Step 1: Write the failing test**

```ts
// tests/store/grandSelection.generate.test.ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { characterSchema } from "../../src/engine/content/schemas";
import { generateCandidates, describeRaiseHead, describeTalent } from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("generateCandidates", () => {
  it("生成 8–12 位、id 唯一、皆过 characterSchema、住储秀宫", () => {
    const s = createNewGameState(db);
    const cands = generateCandidates(db, s, 1);
    expect(cands.length).toBeGreaterThanOrEqual(8);
    expect(cands.length).toBeLessThanOrEqual(12);
    const ids = cands.map((c) => c.content.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of cands) {
      expect(c.content.id).toMatch(/^xiunan_1_\d+$/);
      expect(c.content.defaultLocation).toBe("chuxiu_gong");
      expect(c.content.kind).toBe("consort");
      expect(characterSchema.safeParse(c.content).success).toBe(true);
      expect(c.announce.length).toBeGreaterThan(0);
      if (c.fatherOfficialId) expect(s.officials[c.fatherOfficialId]).toBeDefined();
    }
  });

  it("确定性：同 seed/year 同结果", () => {
    const s = createNewGameState(db);
    const a = generateCandidates(db, s, 4);
    const b = generateCandidates(db, s, 4);
    expect(a.map((c) => c.content.id)).toEqual(b.map((c) => c.content.id));
    expect(a.map((c) => c.announce)).toEqual(b.map((c) => c.announce));
  });
});

describe("抬头/才艺描述", () => {
  it("依容貌/性格/特长产出非空确定性文案", () => {
    const s = createNewGameState(db);
    const c = generateCandidates(db, s, 1)[0]!.content;
    expect(describeRaiseHead(c)).toBe(describeRaiseHead(c));
    expect(describeRaiseHead(c).length).toBeGreaterThan(0);
    expect(describeTalent(c)).toContain(c.attributes!.specialty);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/grandSelection.generate.test.ts`
Expected: FAIL — `generateCandidates` not exported.

- [ ] **Step 3: Implement generation in `grandSelection.ts`**

Add imports at the top of `src/store/grandSelection.ts`:

```ts
import { gestationRoll, gestationRollRaw } from "../engine/characters/gestation";
import { chineseNumeral } from "../engine/calendar/time";
import { characterSchema, type CharacterContent } from "../engine/content/schemas";
import {
  ARISTOCRATIC_SURNAME_POOL,
  ARISTOCRATIC_MALE_GIVEN_NAME_POOL,
} from "../engine/characters/shijunNames";
import type { GameState } from "../engine/state/types";
```

(`CharacterRank` import from `../engine/content/schemas` already added in Task 3 — merge the two import lines so `CharacterContent`, `CharacterRank`, `characterSchema` come from one statement.)

Append to the module:

```ts
// ── 生成池（确定性取样） ──────────────────────────────────────────────
const SPECIALTY_POOL = ["古筝", "琵琶", "书法", "丹青", "刺绣", "烹茶", "棋艺", "舞乐", "诗赋", "骑射"];
const TRAIT_POOL = ["温婉", "活泼", "沉静", "孤傲", "机敏", "腼腆", "爽利", "细腻", "执拗", "娴雅"];
const LIKES_POOL = ["玉器", "香料", "古籍", "骏马", "茶饮", "花木", "字画", "珠玉", "琴谱", "棋具"];
const PORTRAIT_SETS = ["consort1", "consort2", "consort3", "consort4", "consort5", "consort6"];

function pick<T>(pool: readonly T[], seed: string): T {
  return pool[gestationRollRaw(seed) % pool.length]!;
}

/** 候选秀男（生成态，未落库）。 */
export interface Candidate {
  content: CharacterContent;
  fatherOfficialId?: string;
  /** 父官品 gradeOrder，或平民。驱动皇后推荐位分。 */
  grade: number | "commoner";
  /** 礼官宣读词。 */
  announce: string;
}

/** 用 gestationRoll 确定性生成 8–12 位候选秀男。 */
export function generateCandidates(db: ContentDB, state: GameState, year: number): Candidate[] {
  const base = `daxuan:gen:${year}`;
  const count = 8 + (gestationRollRaw(`${base}:n`) % 5); // 8–12
  const officialIds = Object.keys(state.officials);
  const out: Candidate[] = [];

  for (let i = 0; i < count; i++) {
    const seed = `${base}:${i}`;
    const isShijia = officialIds.length > 0 && gestationRollRaw(`${seed}:shijia`) % 100 < 60;

    let surname: string;
    let fatherOfficialId: string | undefined;
    let grade: number | "commoner";
    let announce: string;

    const givenName = pick(ARISTOCRATIC_MALE_GIVEN_NAME_POOL, `${seed}:given`);
    const age = 14 + (gestationRollRaw(`${seed}:age`) % 9); // 14–22

    if (isShijia) {
      fatherOfficialId = officialIds[gestationRollRaw(`${seed}:father`) % officialIds.length]!;
      const father = state.officials[fatherOfficialId]!;
      surname = father.surname;
      grade = db.officialPosts[father.postId]?.gradeOrder ?? "commoner";
      const postName = db.officialPosts[father.postId]?.name ?? "官员";
      announce = `${postName}之男 ${surname}${givenName}，年${chineseNumeral(age)}。`;
    } else {
      surname = pick(ARISTOCRATIC_SURNAME_POOL, `${seed}:surname`);
      grade = "commoner";
      announce = `良家子 ${surname}${givenName}，年${chineseNumeral(age)}。`;
    }

    const traitCount = 2 + (gestationRollRaw(`${seed}:tc`) % 2); // 2–3
    const traits: string[] = [];
    for (let t = 0; t < traitCount; t++) {
      const tr = pick(TRAIT_POOL, `${seed}:trait:${t}`);
      if (!traits.includes(tr)) traits.push(tr);
    }
    const specialty = pick(SPECIALTY_POOL, `${seed}:spec`);
    const likes = [pick(LIKES_POOL, `${seed}:like0`), pick(LIKES_POOL, `${seed}:like1`)]
      .filter((v, idx, arr) => arr.indexOf(v) === idx);

    const content: CharacterContent = {
      id: `xiunan_${year}_${i}`,
      kind: "consort",
      attributes: {
        appearance: 40 + (gestationRoll(`${seed}:app`) % 56), // 40–95
        health: 50 + (gestationRoll(`${seed}:hp`) % 46),       // 50–95
        nurture: 40 + (gestationRoll(`${seed}:nur`) % 56),     // 40–95
        specialty,
        likes,
      },
      hidden: {
        affection: 30 + (gestationRoll(`${seed}:aff`) % 31),   // 30–60
        fear: 20 + (gestationRoll(`${seed}:fear`) % 41),       // 20–60
        ambition: 20 + (gestationRoll(`${seed}:amb`) % 61),    // 20–80
      },
      profile: {
        name: `${surname}${givenName}`,
        surname,
        age,
        role: isShijia ? "殿选新晋，世家出身" : "殿选新晋，良家子",
        appearance: "眉目清秀，举止拘谨，初入宫闱，难掩怯意。",
        personalityTraits: traits,
        coreFacts: [isShijia ? "经三年大选入宫，初居储秀宫" : "良家子，经大选入宫，初居储秀宫"],
        goals: ["在宫中站稳脚跟", "得陛下垂顾"],
        speechStyle: "语气谨慎，言辞守礼。",
      },
      defaultLocation: "chuxiu_gong",
      portraitSet: pick(PORTRAIT_SETS, `${seed}:portrait`),
      expressions: ["neutral"],
      voice: { register: "formal", quirks: [], tabooTopics: [] },
      initialMemories: [],
      secrets: [],
    };

    const parsed = characterSchema.safeParse(content);
    if (!parsed.success) continue; // 极端取样下不合法则跳过该位
    out.push({ content: parsed.data, fatherOfficialId, grade, announce });
  }
  return out;
}

// ── 抬头/才艺 模板化描述（确定性） ───────────────────────────────────
export function describeRaiseHead(content: CharacterContent): string {
  const app = content.attributes?.appearance ?? 50;
  const trait = content.profile.personalityTraits[0] ?? "腼腆";
  const looks = app >= 75 ? "眉目如画、容色出众" : app >= 50 ? "面目清秀" : "样貌寻常却也周正";
  return `秀男${trait}地微微抬头，是个${looks}的小男儿。`;
}

export function describeTalent(content: CharacterContent): string {
  const specialty = content.attributes?.specialty ?? "女红";
  return `秀男恭敬回道：小男儿自幼习${specialty}，略通一二，让陛下见笑了。`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/grandSelection.generate.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/grandSelection.ts tests/store/grandSelection.generate.test.ts
git commit -m "feat: 候选秀男确定性生成 + 抬头/才艺模板描述"
```

---

### Task 5: 大选 prompt 构造 + PromptAction 扩展

**Files:**
- Modify: `src/store/prompt.ts`（`PromptAction`、`isPromptAction`）
- Modify: `src/store/grandSelection.ts`（追加 `buildDaxuanAnnounce`、`buildDaxuanDianxuanPrompt`）
- Test: `tests/store/grandSelection.prompt.test.ts`

**Interfaces:**
- Consumes: `MORNING_SLOT`、`shichenSlot`（`src/engine/calendar/time`）；`DecreeReaction`（`src/store/empressDecree`）；`EventEffect`、`ChengFengPrompt`。
- Produces:
  - `PromptAction` 新增 `{ type: "daxuanEnter"; year: number } | { type: "daxuanDelegate"; year: number }`
  - `buildDaxuanAnnounce(db, state): { effects: EventEffect[]; beats: DecreeReaction[] } | null`
  - `buildDaxuanDianxuanPrompt(db, state): ChengFengPrompt | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/store/grandSelection.prompt.test.ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildDaxuanAnnounce, buildDaxuanDianxuanPrompt } from "../../src/store/grandSelection";
import { MORNING_SLOT } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** 把日历摆到指定 月/旬/slot（slot = apMax - ap）。 */
function at(s = createNewGameState(db), month: number, period: "early" | "mid" | "late", slot: number) {
  return { ...s, calendar: { ...s.calendar, month, period, ap: s.calendar.apMax - slot } };
}

describe("二月报告 buildDaxuanAnnounce", () => {
  it("大选年二月上旬辰时出报告；非大选年/已报过 → null", () => {
    const s = at(createNewGameState(db), 2, "early", MORNING_SLOT); // 元年=大选年
    const r = buildDaxuanAnnounce(db, s);
    expect(r).not.toBeNull();
    expect(r!.effects.some((e) => e.type === "flag" && e.key === "daxuan:announce:1")).toBe(true);
    expect(r!.beats[0]!.lines.length).toBeGreaterThan(0);

    const asked = { ...s, flags: { ...s.flags, "daxuan:announce:1": true } };
    expect(buildDaxuanAnnounce(db, asked)).toBeNull();

    const notYear = { ...s, calendar: { ...s.calendar, year: 2 } };
    expect(buildDaxuanAnnounce(db, notYear)).toBeNull();

    const wrongMonth = at(createNewGameState(db), 3, "early", MORNING_SLOT);
    expect(buildDaxuanAnnounce(db, wrongMonth)).toBeNull();
  });
});

describe("四月殿选 prompt buildDaxuanDianxuanPrompt", () => {
  it("大选年四月下旬辰时出 prompt（两选项）；已决/非大选年 → null", () => {
    const s = at(createNewGameState(db), 4, "late", MORNING_SLOT);
    const p = buildDaxuanDianxuanPrompt(db, s);
    expect(p).not.toBeNull();
    expect(p!.choices.map((c) => c.action.type).sort()).toEqual(["daxuanDelegate", "daxuanEnter"]);

    const done = { ...s, flags: { ...s.flags, "daxuan:dianxuan:1": true } };
    expect(buildDaxuanDianxuanPrompt(db, done)).toBeNull();

    const notYear = { ...s, calendar: { ...s.calendar, year: 3 } };
    expect(buildDaxuanDianxuanPrompt(db, notYear)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/grandSelection.prompt.test.ts`
Expected: FAIL — builders not exported.

- [ ] **Step 3: Extend PromptAction**

In `src/store/prompt.ts`, add to the `PromptAction` union:

```ts
  | { type: "daxuanEnter"; year: number }     // 前往体元殿殿选：扣 1AP + 开殿选
  | { type: "daxuanDelegate"; year: number }; // 让太后皇后决定：不扣 AP
```

(Move the trailing `;` onto the last member.) Then in `isPromptAction` extend the check:

```ts
  return (
    t === "stash" || t === "gift" || t === "huntJoin" || t === "huntDecline" ||
    t === "daxuanEnter" || t === "daxuanDelegate"
  );
```

- [ ] **Step 4: Implement the builders in `grandSelection.ts`**

Add imports (merge with existing time import):

```ts
import { MORNING_SLOT, shichenSlot } from "../engine/calendar/time";
import type { EventEffect } from "../engine/content/schemas";
import type { DecreeReaction } from "./empressDecree";
import type { ChengFengPrompt } from "./prompt";
```

Append:

```ts
/** 二月上旬辰时、大选年、未报过 → 凤后遣人禀告大选已备妥（设 flag + 节拍）。否则 null。 */
export function buildDaxuanAnnounce(
  _db: ContentDB,
  state: GameState,
): { effects: EventEffect[]; beats: DecreeReaction[] } | null {
  const cal = state.calendar;
  if (!isDaxuanYear(cal.year)) return null;
  if (cal.month !== 2 || cal.period !== "early") return null;
  if (shichenSlot(cal) !== MORNING_SLOT) return null;
  if (state.flags[daxuanAnnounceFlagKey(cal.year)]) return null;
  return {
    effects: [{ type: "flag", key: daxuanAnnounceFlagKey(cal.year), value: true }],
    beats: [
      {
        speakerId: "cheng_feng",
        lines: [
          "陛下，凤后娘娘遣人来禀——三年一度的大选已备得差不多了，秀男们都已入住储秀宫，正学着宫里的规矩呢。",
        ],
      },
    ],
  };
}

/** 四月下旬辰时、大选年、未决 → 殿选 prompt（前往 / 委托）。否则 null。 */
export function buildDaxuanDianxuanPrompt(_db: ContentDB, state: GameState): ChengFengPrompt | null {
  const cal = state.calendar;
  if (!isDaxuanYear(cal.year)) return null;
  if (cal.month !== 4 || cal.period !== "late") return null;
  if (shichenSlot(cal) !== MORNING_SLOT) return null;
  if (state.flags[daxuanDianxuanFlagKey(cal.year)]) return null;
  return {
    speakerId: "cheng_feng",
    line: "陛下，礼部来报，殿选已准备完毕，请陛下移驾体元殿选看秀男，皇后娘娘与太后娘娘都已到了。",
    choices: [
      { label: "前往体元殿", action: { type: "daxuanEnter", year: cal.year } },
      { label: "让太后皇后决定", action: { type: "daxuanDelegate", year: cal.year } },
    ],
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/store/grandSelection.prompt.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/store/prompt.ts src/store/grandSelection.ts tests/store/grandSelection.prompt.test.ts
git commit -m "feat: 大选二月报告/四月殿选 prompt 构造 + PromptAction 扩展"
```

---

### Task 6: NPC 自留（委托 + 早退场）

**Files:**
- Modify: `src/store/grandSelection.ts`（追加 `npcKeepOnDelegate`、`npcKeepOnLeave`、`KeptConsort`）
- Test: `tests/store/grandSelection.npc.test.ts`

**Interfaces:**
- Produces:
  - `interface KeptConsort { candidate: Candidate; rank: string }`
  - `npcKeepOnDelegate(db, state, year): KeptConsort[]`（0 或 1–2 位，按推荐位分）
  - `npcKeepOnLeave(remaining: Candidate[], state, year): KeptConsort | null`（20% 取 1 位）

- [ ] **Step 1: Write the failing test**

```ts
// tests/store/grandSelection.npc.test.ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { generateCandidates, npcKeepOnDelegate, npcKeepOnLeave, recommendRank } from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("npcKeepOnDelegate", () => {
  it("返回 0 或 1–2 位，位分按家世推荐，确定性", () => {
    const s = createNewGameState(db);
    const kept = npcKeepOnDelegate(db, s, 1);
    expect(kept.length).toBeLessThanOrEqual(2);
    for (const k of kept) expect(k.rank).toBe(recommendRank(k.candidate.grade));
    expect(npcKeepOnDelegate(db, s, 1).map((k) => k.candidate.content.id))
      .toEqual(kept.map((k) => k.candidate.content.id));
  });
});

describe("npcKeepOnLeave", () => {
  it("从剩余者取 0 或 1 位（确定性）", () => {
    const s = createNewGameState(db);
    const remaining = generateCandidates(db, s, 1).slice(2);
    const a = npcKeepOnLeave(remaining, s, 1);
    const b = npcKeepOnLeave(remaining, s, 1);
    expect(a?.candidate.content.id).toBe(b?.candidate.content.id);
    if (a) expect(remaining.some((c) => c.content.id === a.candidate.content.id)).toBe(true);
  });
  it("剩余为空 → null", () => {
    const s = createNewGameState(db);
    expect(npcKeepOnLeave([], s, 1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/grandSelection.npc.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement NPC keep in `grandSelection.ts`**

Append:

```ts
/** NPC（太后/皇后）留下的秀男及自动定的位分。 */
export interface KeptConsort {
  candidate: Candidate;
  rank: string;
}

/** 委托路径：20% 几率留 1–2 位随机秀男，按家世推荐位分；否则空。 */
export function npcKeepOnDelegate(db: ContentDB, state: GameState, year: number): KeptConsort[] {
  const cands = generateCandidates(db, state, year);
  if (cands.length === 0) return [];
  if (gestationRoll(`daxuan:npc:delegate:${year}`) >= 20) return [];
  const n = 1 + (gestationRollRaw(`daxuan:npc:delegate:n:${year}`) % 2); // 1–2
  const picked: KeptConsort[] = [];
  for (let i = 0; i < n && i < cands.length; i++) {
    const idx = gestationRollRaw(`daxuan:npc:delegate:pick:${year}:${i}`) % cands.length;
    const cand = cands[idx]!;
    if (picked.some((k) => k.candidate.content.id === cand.content.id)) continue;
    picked.push({ candidate: cand, rank: recommendRank(cand.grade) });
  }
  return picked;
}

/** 早退场：20% 几率从剩余未审阅者中留 1 位随机，按家世推荐位分；否则 null。 */
export function npcKeepOnLeave(remaining: Candidate[], state: GameState, year: number): KeptConsort | null {
  if (remaining.length === 0) return null;
  if (gestationRoll(`daxuan:npc:leave:${year}`) >= 20) return null;
  const idx = gestationRollRaw(`daxuan:npc:leave:pick:${year}`) % remaining.length;
  const cand = remaining[idx]!;
  return { candidate: cand, rank: recommendRank(cand.grade) };
}
```

> 注：`state` 参数当前未直接读取，但保留以便后续按朝局调权重；ESLint 若报未用，前缀 `_state`。
> 若 lint 失败，将两个函数签名的 `state` 改为 `_state` 并同步引用。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/grandSelection.npc.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npm run typecheck`
Expected: no errors. (If `state` unused error: rename to `_state`.)

- [ ] **Step 6: Commit**

```bash
git add src/store/grandSelection.ts tests/store/grandSelection.npc.test.ts
git commit -m "feat: 大选 NPC 自留（委托 20%/早退场 20%）"
```

---

### Task 7: 落库（addGeneratedConsort 纯函数 + GameStore 方法）

**Files:**
- Modify: `src/store/grandSelection.ts`（追加 `addGeneratedConsort`）
- Modify: `src/store/gameStore.ts`（追加 `commitDaxuanConsort`、`commitDaxuanKept`、`setFlag`）
- Test: `tests/store/grandSelection.commit.test.ts`

**Interfaces:**
- Consumes: `monthOrdinal`、`toGameTime`（`src/engine/calendar/time`）；`memoryEntryId`（`src/engine/state/newGame`）；`initialFavorForRank`。
- Produces:
  - `addGeneratedConsort(state, content, rank): GameState`（写 generatedConsorts + standing + memories + bedchamber）
  - `GameStore.commitDaxuanConsort(candidate: Candidate, rank: string): void`
  - `GameStore.commitDaxuanKept(kept: KeptConsort[]): void`
  - `GameStore.setFlag(key: string, value: boolean): void`

- [ ] **Step 1: Write the failing test**

```ts
// tests/store/grandSelection.commit.test.ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { generateCandidates, addGeneratedConsort } from "../../src/store/grandSelection";
import { monthOrdinal } from "../../src/engine/calendar/time";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("addGeneratedConsort", () => {
  it("写入 generatedConsorts/standing/memories/bedchamber，含 availableFromMonth=五月", () => {
    const s = createNewGameState(db); // 元年
    const cand = generateCandidates(db, s, 1)[0]!;
    const next = addGeneratedConsort(s, cand.content, "guiren");
    const id = cand.content.id;

    expect(next.generatedConsorts[id]).toBeDefined();
    expect(next.standing[id]!.rank).toBe("guiren");
    expect(next.standing[id]!.residence).toBe("chuxiu_gong");
    expect(next.standing[id]!.chamber).toBe("main");
    expect(next.standing[id]!.availableFromMonth).toBe(monthOrdinal({ year: 1, month: 5 }));
    expect(next.standing[id]!.favor).toBeGreaterThanOrEqual(10);
    expect(next.standing[id]!.favor).toBeLessThanOrEqual(20);
    expect(next.memories[id]!.entries.length).toBe(1);
    expect(next.bedchamber[id]).toEqual({ encounters: [] });
    // 不可变：原 state 未被改动
    expect(s.generatedConsorts[id]).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/grandSelection.commit.test.ts`
Expected: FAIL — `addGeneratedConsort` not exported.

- [ ] **Step 3: Implement `addGeneratedConsort`**

`favor` 由调用方（GameStore，持有 `db.ranks`）算好后传入，使本函数保持纯净、不依赖 `db`。

Add imports (merge with existing):

```ts
import { monthOrdinal, toGameTime } from "../engine/calendar/time";
import { memoryEntryId } from "../engine/state/newGame";
```

Append:

```ts
/** 把一位殿选中选秀男落库：generatedConsorts + standing + memories + bedchamber（不可变）。
 *  favor 由调用方按位分算好传入（见 GameStore.commitDaxuanConsort）。 */
export function addGeneratedConsort(
  state: GameState,
  content: CharacterContent,
  rank: string,
  favor: number,
): GameState {
  const id = content.id;
  const now = toGameTime(state.calendar);
  return {
    ...state,
    generatedConsorts: { ...state.generatedConsorts, [id]: content },
    standing: {
      ...state.standing,
      [id]: {
        rank,
        favor,
        residence: "chuxiu_gong",
        chamber: "main",
        availableFromMonth: monthOrdinal({ year: state.calendar.year, month: 5 }),
      },
    },
    memories: {
      ...state.memories,
      [id]: {
        entries: [{
          id: memoryEntryId(id, 1),
          kind: "event",
          summary: "殿选承恩，蒙陛下留牌子，迁入储秀宫。",
          salience: 60,
          createdAt: now,
          tags: ["daxuan", "player"],
          participants: ["player", id],
          source: "scene_outcome",
          protected: false,
        }],
        nextSeq: 2,
      },
    },
    bedchamber: { ...state.bedchamber, [id]: { encounters: [] } },
  };
}
```

Update the test's call to pass favor: change `addGeneratedConsort(s, cand.content, "guiren")` to `addGeneratedConsort(s, cand.content, "guiren", 18)` and keep the 10–20 assertions (18 satisfies them).

- [ ] **Step 4: Add GameStore methods**

In `src/store/gameStore.ts`, add imports:

```ts
import { addGeneratedConsort, initialFavorForRank, type Candidate, type KeptConsort } from "./grandSelection";
```

Add methods to the `GameStore` class (near `applyAutumnHunt`):

```ts
  /** 设/清一个布尔 flag（大选一次性标记）。 */
  setFlag(key: string, value: boolean): void {
    this.state = { ...this.state, flags: { ...this.state.flags, [key]: value } };
    this.emit();
  }

  /** 殿选留牌子：按所选位分落库一位秀男（恩宠随位分缩放）。 */
  commitDaxuanConsort(db: ContentDB, candidate: Candidate, rank: string): void {
    const favor = initialFavorForRank(db.ranks[rank]?.order ?? 50);
    this.state = addGeneratedConsort(this.state, candidate.content, rank, favor);
    this.emit();
  }

  /** 批量落库 NPC 留下的秀男（按各自推荐位分）。 */
  commitDaxuanKept(db: ContentDB, kept: KeptConsort[]): void {
    let next = this.state;
    for (const k of kept) {
      const favor = initialFavorForRank(db.ranks[k.rank]?.order ?? 50);
      next = addGeneratedConsort(next, k.candidate.content, k.rank, favor);
    }
    this.state = next;
    this.emit();
  }
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/store/grandSelection.commit.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/store/grandSelection.ts src/store/gameStore.ts tests/store/grandSelection.commit.test.ts
git commit -m "feat: 殿选落库（addGeneratedConsort + GameStore commit 方法）"
```

---

### Task 8: 殿选界面 DianxuanScreen

**Files:**
- Create: `src/ui/screens/DianxuanScreen.tsx`
- Test: `tests/store/grandSelection.flow.test.ts`（界面用的纯流程断言；界面壳本身靠 tsc + 手测）

**Interfaces:**
- Consumes: `Candidate`、`describeRaiseHead`、`describeTalent`、`recommendRank`、`pickableRanks`（`grandSelection`）；`AssetRegistry`、`ContentDB`、`GameStore`。
- Produces: `DianxuanScreen({ registry, db, store, candidates, year, onDone })`，其中
  `onDone(kept: { candidate: Candidate; rank: string }[], leftEarly: boolean, reviewedCount: number): void`。

> 设计要点：组件自身只管「呈现当前秀男 + 收集留/撂 + 选位分」；落库、NPC 早退场判定、
> autosave 都在 App 的 `onDone` 回调里做（Task 9）。这样界面无副作用、易于替换。

- [ ] **Step 1: Write the failing test (flow invariants the screen relies on)**

```ts
// tests/store/grandSelection.flow.test.ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { generateCandidates, recommendRank, pickableRanks, describeRaiseHead } from "../../src/store/grandSelection";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("殿选流程依赖的不变量", () => {
  it("每位候选都能算出皇后推荐位分，且该位分在可选列表内", () => {
    const s = createNewGameState(db);
    const cands = generateCandidates(db, s, 1);
    const pickable = new Set(pickableRanks(db).map((r) => r.id));
    for (const c of cands) {
      const rec = recommendRank(c.grade);
      expect(pickable.has(rec)).toBe(true);
      expect(describeRaiseHead(c.content).length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails (or passes trivially if deps exist)**

Run: `npx vitest run tests/store/grandSelection.flow.test.ts`
Expected: PASS once `pickableRanks`/`recommendRank` exist (Task 3). If FAIL, finish Task 3 first.

- [ ] **Step 3: Create the screen**

```tsx
// src/ui/screens/DianxuanScreen.tsx
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import {
  describeRaiseHead, describeTalent, recommendRank, pickableRanks,
  type Candidate,
} from "../../store/grandSelection";

interface KeptPick { candidate: Candidate; rank: string }

export function DianxuanScreen({ registry, db, candidates, onDone }: {
  registry: AssetRegistry;
  db: ContentDB;
  store: GameStore;
  candidates: Candidate[];
  year: number;
  onDone: (kept: KeptPick[], leftEarly: boolean, reviewedCount: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [kept, setKept] = useState<KeptPick[]>([]);
  const [reveal, setReveal] = useState<string | null>(null); // 抬头/才艺旁白
  const [pickingRank, setPickingRank] = useState(false);

  const bg = registry.resolveVariant("bg.tiyuandian", "day", "background");
  const cur = candidates[idx];

  if (!cur) { onDone(kept, false, idx); return null; }

  const portrait = registry.portrait(cur.content.portraitSet, "neutral");
  const ranks = pickableRanks(db);
  const recommended = recommendRank(cur.grade);
  const recommendedName = db.ranks[recommended]?.name ?? "更衣";

  const advance = () => { setReveal(null); setPickingRank(false); setIdx((i) => i + 1); };

  const keep = (rank: string) => {
    setKept((k) => [...k, { candidate: cur, rank }]);
    advance();
  };

  return (
    <main className="dialogue-screen" style={bg ? { backgroundImage: `url("${bg.url}")` } : undefined}>
      <img className="dialogue-screen__portrait" src={portrait.url} alt={cur.content.profile.name}
           data-fallback={portrait.isFallback || undefined} />
      <section className="dialogue-screen__box">
        <p className="dialogue-screen__speaker">礼官</p>
        <p className="dialogue-screen__line">{cur.announce}</p>
        <p className="dialogue-screen__line">秀男上前行礼：参见陛下、太后、皇后，吾皇万福金安。</p>
        {reveal && <p className="dialogue-screen__line">{reveal}</p>}

        {!pickingRank ? (
          <div className="dialogue-screen__choices">
            <button type="button" onClick={() => setReveal(describeRaiseHead(cur.content))}>抬起头来</button>
            <button type="button" onClick={() => setReveal(describeTalent(cur.content))}>问才艺</button>
            <button type="button" onClick={() => setPickingRank(true)}>留牌子</button>
            <button type="button" onClick={advance}>撂牌子</button>
            <button type="button" onClick={() => onDone(kept, true, idx)}>离开体元殿</button>
          </div>
        ) : (
          <div className="dialogue-screen__choices">
            <p className="dialogue-screen__line">皇后：陛下，臣侍觉得封为{recommendedName}比较合适。</p>
            {ranks.map((r) => (
              <button key={r.id} type="button" onClick={() => keep(r.id)}>
                {r.name}{r.id === recommended ? "（皇后所荐）" : ""}
              </button>
            ))}
            <button type="button" onClick={() => setPickingRank(false)}>再想想</button>
          </div>
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/DianxuanScreen.tsx tests/store/grandSelection.flow.test.ts
git commit -m "feat: 殿选界面 DianxuanScreen（逐位审阅+定位分）"
```

---

### Task 9: App 接线（合并 db / 大选 prompt / 殿选 View / 二月报告）

**Files:**
- Modify: `src/ui/App.tsx`
- Manual verification（无新增单测；靠 `tsc`、`vitest run` 全量、手测）

**Interfaces:**
- Consumes: Task 1–8 全部产物；`ChengFengPromptScreen`、`DianxuanScreen`、`buildDaxuanAnnounce`、`buildDaxuanDianxuanPrompt`、`generateCandidates`、`npcKeepOnDelegate`、`npcKeepOnLeave`、`daxuanDianxuanFlagKey`、`isPromptAction`/`PromptAction`。

- [ ] **Step 1: Merge generatedConsorts into the effective db**

In `src/ui/App.tsx`, find `const db = content.value;` (≈ line 140). The component already subscribes to state via `useGameState` elsewhere; ensure a live state handle exists in this scope. Replace the single line with a memo that merges generated consorts:

```tsx
  const liveStateForDb = useGameState(store);
  const baseDb = content.value;
  const db = useMemo(
    () => ({ ...baseDb, characters: { ...baseDb.characters, ...liveStateForDb.generatedConsorts } }),
    [baseDb, liveStateForDb.generatedConsorts],
  );
```

> If `App` already calls `useGameState(store)` into a variable (search for `useGameState(store)`), reuse that variable instead of adding `liveStateForDb`, and just wrap `db` in the `useMemo`. Do not create two subscriptions with the same name.

- [ ] **Step 2: Add imports**

At the top of `App.tsx` add:

```tsx
import { ChengFengPromptScreen } from "./screens/ChengFengPromptScreen";
import { DianxuanScreen } from "./screens/DianxuanScreen";
import {
  buildDaxuanAnnounce, buildDaxuanDianxuanPrompt, generateCandidates,
  npcKeepOnDelegate, npcKeepOnLeave, daxuanDianxuanFlagKey,
  type Candidate,
} from "../store/grandSelection";
import type { ChengFengPrompt, PromptAction } from "../store/prompt";
```

- [ ] **Step 3: Add view + state for prompt and 殿选**

Extend the `View` union with `"dianxuan"`:

```tsx
type View = "title" | "coronation" | "location" | "map" | "freeview" | "event" | "court" | "wenzhaodian" | "yuqing_gong" | "fengxiandian" | "cining_gong" | "courtyard" | "storehouse" | "dianxuan";
```

Add component state (near the other `useState` declarations):

```tsx
  const [daxuanPrompt, setDaxuanPrompt] = useState<ChengFengPrompt | null>(null);
  const [dianxuan, setDianxuan] = useState<{ candidates: Candidate[]; year: number } | null>(null);
```

- [ ] **Step 4: Add the 二月报告 producer into spendAp pipeline**

In `App.tsx`, add a helper next to `rollChengFeng`:

```tsx
  /** 二月大选报告（节拍，设 flag）；每大选年一次。返回节拍。 */
  const rollDaxuanAnnounce = (): DecreeReaction[] => {
    const r = buildDaxuanAnnounce(db, store.getState());
    if (!r) return [];
    const applied = store.applyEffects(db, r.effects);
    if (!applied.ok) return [];
    return r.beats;
  };
```

In `spendAp`, after the `rollChengFeng` line, add:

```tsx
    if (spend.ok) decreeBeats = [...decreeBeats, ...rollDaxuanAnnounce()];
```

- [ ] **Step 5: Evaluate the 四月 prompt when at a room (declarative effect)**

Add this effect below the existing BGM `useEffect`:

```tsx
  const liveState = useGameState(store); // 若已存在同名变量则复用，勿重复声明
  useEffect(() => {
    if (view !== "location" || daxuanPrompt || dianxuan) return;
    const p = buildDaxuanDianxuanPrompt(db, store.getState());
    if (p) setDaxuanPrompt(p);
  }, [view, liveState.calendar.year, liveState.calendar.month, liveState.calendar.period, liveState.calendar.ap, db, daxuanPrompt, dianxuan]);
```

> 若 App 顶部已有 `const liveState = useGameState(store);`，删掉这里的重复声明，仅保留 `useEffect`。

- [ ] **Step 6: Handle the prompt action**

Add a handler:

```tsx
  const onDaxuanChoose = (action: PromptAction) => {
    setDaxuanPrompt(null);
    if (action.type === "daxuanEnter") {
      // 设决定 flag + 扣 1AP，打开殿选
      store.setFlag(daxuanDianxuanFlagKey(action.year), true);
      const { spend, decreeBeats } = spendAp(1);
      if (!spend.ok) return;
      const cands = generateCandidates(db, store.getState(), action.year);
      setDianxuan({ candidates: cands, year: action.year });
      setView("dianxuan");
      // 殿选为原子流程：扣点产生的节拍并入殿选结束后再处理（此处先忽略 decreeBeats 的串播，
      // 若需要可在 onDianxuanDone 后 playReactions(decreeBeats, spend.value.rolledOver)）
      void decreeBeats;
    } else if (action.type === "daxuanDelegate") {
      store.setFlag(daxuanDianxuanFlagKey(action.year), true);
      const kept = npcKeepOnDelegate(db, store.getState(), action.year);
      if (kept.length > 0) store.commitDaxuanKept(db, kept);
      const beats: DecreeReaction[] = kept.length > 0
        ? kept.map((k) => ({
            speakerId: "cheng_feng",
            lines: [`陛下，太后与皇后做主，留了${k.candidate.content.profile.name}的牌子，封为${db.ranks[k.rank]?.name ?? ""}，已迁入储秀宫。`],
          }))
        : [{ speakerId: "cheng_feng", lines: ["陛下，此次大选，太后与皇后看过，未有特别中意的，便都撂了牌子。"] }];
      doAutosave();
      const [first, ...rest] = beats;
      if (first) { setReaction(first); setReactionQueue(rest); }
    }
  };
```

> `spendAp`、`playReactions`、`setReaction`、`setReactionQueue`、`doAutosave`、`DecreeReaction` 均为 App 内既有符号。

- [ ] **Step 7: Handle 殿选结束**

Add:

```tsx
  const onDianxuanDone = (
    kept: { candidate: Candidate; rank: string }[],
    leftEarly: boolean,
    reviewedCount: number,
  ) => {
    const year = dianxuan?.year ?? store.getState().calendar.year;
    for (const k of kept) store.commitDaxuanConsort(db, k.candidate, k.rank);
    const beats: DecreeReaction[] = [];
    if (leftEarly && dianxuan) {
      const reviewedIds = new Set(kept.map((k) => k.candidate.content.id));
      const remaining = dianxuan.candidates
        .slice(reviewedCount)
        .filter((c) => !reviewedIds.has(c.content.id));
      const npc = npcKeepOnLeave(remaining, store.getState(), year);
      if (npc) {
        store.commitDaxuanKept(db, [npc]);
        beats.push({
          speakerId: "cheng_feng",
          lines: [`陛下留步——有一位${npc.candidate.announce.replace(/，年.*$/, "")}颇得太后青眼，太后留了他的牌子，封为${db.ranks[npc.rank]?.name ?? ""}。`],
        });
      }
    }
    setDianxuan(null);
    doAutosave();
    goHome();
    if (beats.length > 0) { const [f, ...rest] = beats; setReaction(f!); setReactionQueue(rest); }
  };
```

> `goHome` 为 App 内既有函数（事件结束回主图）。若殿选应回到上一个房间而非主图，改用对应的返回逻辑；与既有 prompt 收尾保持一致即可。

- [ ] **Step 8: Render the prompt overlay and 殿选 view**

Where other top-level views/overlays are rendered (near the `firstNightPrompt` modal / the big `view === ...` switch), add:

```tsx
      {daxuanPrompt && (
        <ChengFengPromptScreen registry={registry} db={db} store={store} prompt={daxuanPrompt} onChoose={onDaxuanChoose} />
      )}
```

And in the view switch, add a branch:

```tsx
      {view === "dianxuan" && dianxuan && (
        <DianxuanScreen
          registry={registry}
          db={db}
          store={store}
          candidates={dianxuan.candidates}
          year={dianxuan.year}
          onDone={onDianxuanDone}
        />
      )}
```

- [ ] **Step 9: Typecheck + full test suite + lint**

Run: `npm run typecheck && npx vitest run && npm run lint`
Expected: typecheck clean; all tests pass; lint clean.

- [ ] **Step 10: Manual smoke test**

Run: `npm run dev`，然后用调试面板把日历推到元年四月下旬辰时（或借 DebugPanel 的强制手段），确认：
1. 进入房间时弹出殿选 prompt；
2. 「前往体元殿」→ 背景为体元殿、逐位秀男、抬头/才艺出文案、留牌子可选位分（皇后所荐高亮）；
3. 留牌子后该侍君出现在储秀宫；推进到五月前不可侍寝，五月起可侍寝；
4. 「让太后皇后决定」不扣行动点，约 20% 出 NPC 留人汇报；
5. 二月上旬辰时出现凤后大选报告节拍。

- [ ] **Step 11: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: App 接入大选（合并 db / 殿选 prompt / 体元殿 / 二月报告）"
```

---

## Self-Review

**Spec coverage:**
- §1 触发节奏 → Task 5（buildDaxuanAnnounce/Dianxuan）+ Task 9（接线、二月报告、四月 prompt）。✓
- §2 候选生成 → Task 4。✓（含家世挂现有官员、确定性、schema 校验）
- §3 殿选界面（礼官宣读/行礼/抬头/才艺/留撂/定位分/早退场）→ Task 8 + Task 9（onDianxuanDone 早退场 NPC 留人）。✓
- §3.1 原子性（进殿扣 1AP、结束才落库+autosave）→ Task 9 Step 6/7。✓
- §4 委托路径 → Task 9 Step 6（daxuanDelegate）+ Task 6（npcKeepOnDelegate）。✓
- §5 推荐位分 + 玩家自由选 → Task 3（recommendRank/pickableRanks）+ Task 8（位分按钮）。✓
- §6 落库 + db 合并 + 侍寝门槛 → Task 1（字段/schema）+ Task 2（门槛）+ Task 7（落库）+ Task 9 Step 1（合并 db）。✓
- §7 接线（只接大选）→ Task 5（PromptAction）+ Task 9。✓ 秋猎/进贡 prompt 不动。✓
- §8 测试要点 → Task 1–7 各自单测覆盖；UI（8/9）靠 tsc + 手测。✓
- §9 默认值（age 14–22、平民宣读、四五品→常在、favor 10–20、随机留人）→ Task 4/3/6 落实。✓

**Placeholder scan:** 无 TBD/TODO/「类似上文」。所有需要代码的步骤都给出完整代码；`addGeneratedConsort` 仅保留单一最终签名 `(state, content, rank, favor)`。

**Type consistency:**
- `Candidate`、`KeptConsort` 字段（`content`/`fatherOfficialId`/`grade`/`announce`；`candidate`/`rank`）在 Task 4/6/7/8/9 一致。
- `addGeneratedConsort(state, content, rank, favor)` 四参签名在 Task 7（定义）与 GameStore 调用一致；测试调用已同步为四参。
- `onDone(kept, leftEarly, reviewedCount)` 在 Task 8（定义）与 Task 9（onDianxuanDone）签名一致。
- `recommendRank` 返回值（rank id）∈ `pickableRanks` 集合（Task 8 flow 测试验证）。
- prompt action 字面量 `daxuanEnter`/`daxuanDelegate` 在 prompt.ts、builders、App handler 三处一致。

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-21-grand-selection.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - 每个任务派发新子代理，任务间复核，迭代快。

**2. Inline Execution** - 本会话内按 executing-plans 批量执行，带复核检查点。

**Which approach?**

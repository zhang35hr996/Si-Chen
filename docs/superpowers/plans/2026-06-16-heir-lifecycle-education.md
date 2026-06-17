# 子嗣系统完善（命名 · 教育 · 养父）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为皇嗣补全「出生命名 → 婴幼召见 → 开蒙教育 → 择养父」生命周期，并新增上书房、奉先殿两处主图入口。

**Architecture:** 全部状态变更经 `applyEffects` 漏斗（新增 4 个 `EventEffect`：`heir_name`/`heir_summon`/`heir_educate`/`heir_adopt`）；年龄/阶段/到期为纯派生函数；台词为脚本模板经 `ReactionScreen`/专用子屏重放；存档加字段走版本迁移（v2→v3）。

**Tech Stack:** TypeScript, React, Zod (content + save schema), Vitest。测试命令统一 `npx vitest run <file>`，类型检查 `npm run typecheck`。

参考 spec：`docs/superpowers/specs/2026-06-16-heir-lifecycle-education-design.md`

---

## File Structure

**Phase 1（基础：数据模型 + 命名）**
- Modify `src/engine/state/types.ts` — `Heir` 加字段 + `HeirEducation`
- Modify `src/engine/characters/heirs.ts` — 派生 `heirAgeMonths`/`heirStage`/`centennialDue`/`isEnrolled` + 阶段→立绘 key
- Create `src/engine/characters/heirNames.ts` — 种子化随机 2 字小名
- Modify `src/engine/content/schemas.ts` — `heir_name` 效果
- Modify `src/engine/effects/funnel.ts` — `heir_name` 校验/应用 + birth 初始化新字段
- Modify `src/engine/save/stateSchema.ts` — heir 子 schema 加字段
- Modify `src/engine/save/saveSystem.ts` — `SAVE_FORMAT_VERSION=3` + v2→v3 迁移
- Modify `src/ui/components/HeirListModal.tsx` — 列表显示（名/属性/养父）
- Create `src/ui/components/HeirNameModal.tsx` — 起小名 / 百日宴赐名通用命名框
- Modify `src/ui/App.tsx` — 出生起小名 + 百日宴编排

**Phase 2（御书房召见）**
- Modify `src/engine/content/schemas.ts` / `funnel.ts` — `heir_summon` 效果
- Create `src/store/heirInteraction.ts` — `buildHeirSummon`（阶段台词）
- Create `src/ui/screens/ChildReactionScreen.tsx` — 带显式立绘的子嗣台词子屏
- Modify `src/ui/components/HeirListModal.tsx` / `src/ui/App.tsx` — 召见按钮 + 接线
- Modify `assets/manifest.json` — `portrait.child_baby` / `portrait.child_school`

**Phase 3（上书房）**
- Create `content/locations/shangshufang.json`；Modify `content/locations/yushufang.json`（return edge）
- Modify `assets/manifest.json` — `bg.shangshufang`
- Modify `src/engine/content/schemas.ts` / `funnel.ts` — `heir_educate` 效果
- Modify `src/store/heirInteraction.ts` — `buildHeirLesson` / `buildTutorReport`
- Create `src/ui/screens/ShangshufangScreen.tsx`；Modify `src/ui/App.tsx`

**Phase 4（奉先殿）**
- Create `content/locations/fengxiandian.json`；Modify `content/locations/yushufang.json`（return edge）
- Modify `assets/manifest.json` — `bg.fengxiandian`
- Modify `src/engine/content/schemas.ts` / `funnel.ts` — `heir_adopt` 效果
- Create `src/store/adoption.ts` — `bioFatherAvailable` / `eligibleAdoptiveFathers` / `buildAdoptionReaction`
- Create `src/ui/screens/FengxiandianScreen.tsx`；Modify `src/ui/App.tsx`

---

# PHASE 1 — 数据模型 + 命名

### Task 1: 扩展 `Heir` 类型

**Files:**
- Modify: `src/engine/state/types.ts:49-65`

- [ ] **Step 1: 加 `HeirEducation` 与 `Heir` 新字段**

在 `src/engine/state/types.ts`，把 `export interface Heir { ... }`（49–65 行）替换为：

```ts
export type HeirSex = "daughter" | "son";

/** 皇嗣养成属性（上书房问功课提升）。 */
export interface HeirEducation {
  /** 学问 0–100 */
  scholarship: number;
  /** 骑射 0–100 */
  martial: number;
  /** 品行 0–100 */
  virtue: number;
}

/** 落地子嗣。 */
export interface Heir {
  /** "heir_000001" 单调 */
  id: string;
  sex: HeirSex; // daughter→皇子(女) / son→皇郎(男)
  /** 承嗣君 charId；null=自孕 */
  fatherId: string | null;
  /** 谁承载生产；"sovereign"=自孕 */
  bearer: "sovereign" | string;
  birthAt: GameTime;
  /** 宠爱度 0–100 */
  favor: number;
  /** 嫡 */
  legitimate: boolean;
  /** 小名（≤2 字），出生时设；未起为 ""。 */
  petName: string;
  /** 正名/姓名（≤2 字），百日宴设；未命名为 undefined。 */
  givenName?: string;
  /** 养成属性。 */
  education: HeirEducation;
  /** 养父 charId；未指定为 undefined。 */
  adoptiveFatherId?: string;
}
```

- [ ] **Step 2: 类型检查（预期此时其他文件因缺字段而报错，下一任务修复）**

Run: `npm run typecheck`
Expected: 报错集中在 `funnel.ts`（birth 构造缺 petName/education）与 `tests/characters/heirs.test.ts`（heir 工厂缺字段）。记录后继续。

- [ ] **Step 3: Commit**

```bash
git add src/engine/state/types.ts
git commit -m "feat: extend Heir with petName/givenName/education/adoptiveFatherId"
```

---

### Task 2: birth 应用初始化新字段 + 修复 heir 测试工厂

**Files:**
- Modify: `src/engine/effects/funnel.ts:364-374`
- Modify: `tests/characters/heirs.test.ts:6-15`
- Test: `tests/effects/funnel.birth.test.ts`

- [ ] **Step 1: 给现有 birth 测试加一条断言新字段**

在 `tests/effects/funnel.birth.test.ts` 的 `"safe → appends heir..."` 用例内，`expect(heirs[0]!.sex).toBe("daughter");` 之后加：

```ts
    expect(heirs[0]!.petName).toBe("");
    expect(heirs[0]!.givenName).toBeUndefined();
    expect(heirs[0]!.education).toEqual({ scholarship: 5, martial: 5, virtue: 5 });
    expect(heirs[0]!.adoptiveFatherId).toBeUndefined();
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/effects/funnel.birth.test.ts`
Expected: FAIL（birth 未初始化 petName/education）。

- [ ] **Step 3: birth apply 初始化新字段**

在 `src/engine/effects/funnel.ts` 的 `case "birth":` 内，`bl.heirs.push({ ... })`（约 365–373 行）替换为：

```ts
          bl.heirs.push({
            id: nextHeirId(bl.heirs.length),
            sex: effect.sex,
            fatherId: effect.fatherId,
            bearer: effect.bearer,
            birthAt: now,
            favor: effect.favor,
            legitimate: effect.legitimate,
            petName: "",
            education: { scholarship: 5, martial: 5, virtue: 5 },
          });
```

- [ ] **Step 4: 修复 heir 测试工厂**

在 `tests/characters/heirs.test.ts` 的 `heir` 工厂（6–15 行），在 `legitimate: true,` 之后加：

```ts
  petName: "",
  education: { scholarship: 5, martial: 5, virtue: 5 },
```

- [ ] **Step 5: 运行全套（含 round-trip / typecheck），确认通过**

Run: `npx vitest run && npm run typecheck`
Expected: PASS（funnel.birth、heirs、heirRoundTrip 全绿；类型无错）。

- [ ] **Step 6: Commit**

```bash
git add src/engine/effects/funnel.ts tests/characters/heirs.test.ts tests/effects/funnel.birth.test.ts
git commit -m "feat: initialize petName/education on birth"
```

---

### Task 3: 皇嗣派生函数（月龄 / 阶段 / 百日宴 / 开蒙 / 立绘）

**Files:**
- Modify: `src/engine/characters/heirs.ts`
- Test: `tests/characters/heirs.test.ts`

- [ ] **Step 1: 写失败测试**

在 `tests/characters/heirs.test.ts` 顶部 import 改为：

```ts
import {
  heirName, heirAge, nextHeirId, listHeirsBySex,
  heirAgeMonths, heirStage, centennialDue, isEnrolled, heirPortraitSet,
} from "../../src/engine/characters/heirs";
```

文件末尾追加：

```ts
describe("heirAgeMonths", () => {
  it("counts whole months by monthOrdinal difference", () => {
    const h = heir({ birthAt: makeGameTime(1, 1, "early") });
    expect(heirAgeMonths(h, makeGameTime(1, 1, "late"))).toBe(0);
    expect(heirAgeMonths(h, makeGameTime(1, 4, "early"))).toBe(3);
    expect(heirAgeMonths(h, makeGameTime(2, 1, "early"))).toBe(12);
  });
});

describe("heirStage", () => {
  it("infant <3y, toddler 3–4y, schooling ≥5y", () => {
    const born = makeGameTime(1, 1, "early");
    expect(heirStage(heir({ birthAt: born }), makeGameTime(3, 1, "early"))).toBe("infant"); // 2 岁
    expect(heirStage(heir({ birthAt: born }), makeGameTime(4, 1, "early"))).toBe("toddler"); // 3 岁
    expect(heirStage(heir({ birthAt: born }), makeGameTime(6, 1, "early"))).toBe("schooling"); // 5 岁
  });
});

describe("centennialDue", () => {
  it("true once ≥3 months old and not yet formally named", () => {
    const born = makeGameTime(1, 1, "early");
    expect(centennialDue(heir({ birthAt: born }), makeGameTime(1, 2, "early"))).toBe(false); // 1 月
    expect(centennialDue(heir({ birthAt: born }), makeGameTime(1, 4, "early"))).toBe(true); // 3 月
    expect(centennialDue(heir({ birthAt: born, givenName: "长安" }), makeGameTime(1, 4, "early"))).toBe(false);
  });
});

describe("isEnrolled", () => {
  it("true at 5 周岁", () => {
    const born = makeGameTime(1, 1, "early");
    expect(isEnrolled(heir({ birthAt: born }), makeGameTime(5, 1, "early"))).toBe(false); // 4 岁
    expect(isEnrolled(heir({ birthAt: born }), makeGameTime(6, 1, "early"))).toBe(true); // 5 岁
  });
});

describe("heirPortraitSet", () => {
  it("baby set under schooling, school set when enrolled", () => {
    const born = makeGameTime(1, 1, "early");
    expect(heirPortraitSet(heir({ birthAt: born }), makeGameTime(2, 1, "early"))).toBe("child_baby");
    expect(heirPortraitSet(heir({ birthAt: born }), makeGameTime(6, 1, "early"))).toBe("child_school");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/characters/heirs.test.ts`
Expected: FAIL（函数未定义）。

- [ ] **Step 3: 实现派生函数**

在 `src/engine/characters/heirs.ts` 顶部 import 改为：

```ts
import { chineseNumeral, monthOrdinal, type GameTime } from "../calendar/time";
```

文件末尾追加：

```ts
export type HeirStage = "infant" | "toddler" | "schooling";

/** 月龄：按 monthOrdinal 差（出生当月为 0）。 */
export function heirAgeMonths(heir: Heir, now: Pick<GameTime, "year" | "month">): number {
  return monthOrdinal(now) - monthOrdinal(heir.birthAt);
}

/** 成长阶段：[0,3岁)=infant；[3,5岁)=toddler；≥5岁=schooling。 */
export function heirStage(heir: Heir, now: Pick<GameTime, "year">): HeirStage {
  const years = heirAge(heir, now);
  if (years >= 5) return "schooling";
  if (years >= 3) return "toddler";
  return "infant";
}

/** 百日宴待办：满 3 月龄且尚未赐正名。 */
export function centennialDue(heir: Heir, now: Pick<GameTime, "year" | "month">): boolean {
  return heir.givenName === undefined && heirAgeMonths(heir, now) >= 3;
}

/** 是否已开蒙（≥5 周岁，可入上书房）。 */
export function isEnrolled(heir: Heir, now: Pick<GameTime, "year">): boolean {
  return heirStage(heir, now) === "schooling";
}

/** 阶段→立绘 portraitSet（婴幼共用襁褓立绘，开蒙后换学童立绘）。 */
export function heirPortraitSet(heir: Heir, now: Pick<GameTime, "year">): "child_baby" | "child_school" {
  return heirStage(heir, now) === "schooling" ? "child_school" : "child_baby";
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/characters/heirs.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/heirs.ts tests/characters/heirs.test.ts
git commit -m "feat: heir age/stage/centennial/enrollment derivations"
```

---

### Task 4: 随机小名生成器

**Files:**
- Create: `src/engine/characters/heirNames.ts`
- Test: `tests/characters/heirNames.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/characters/heirNames.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { randomPetName, PET_NAME_POOL } from "../../src/engine/characters/heirNames";

describe("randomPetName", () => {
  it("returns a 2-char name from the pool", () => {
    const name = randomPetName(12345, "heir_000001");
    expect(PET_NAME_POOL).toContain(name);
    expect([...name].length).toBe(2);
  });

  it("is deterministic for the same seed + heir id", () => {
    expect(randomPetName(7, "heir_000003")).toBe(randomPetName(7, "heir_000003"));
  });

  it("varies across heir ids", () => {
    const a = randomPetName(7, "heir_000001");
    const b = randomPetName(7, "heir_000002");
    // 不强制不等（池小可能撞），但至少调用合法且确定。
    expect(PET_NAME_POOL).toContain(a);
    expect(PET_NAME_POOL).toContain(b);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/characters/heirNames.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `src/engine/characters/heirNames.ts`:

```ts
/** 种子化随机 2 字小名（确定性，复用 gestationRoll 的 hash）。 */
import { gestationRoll } from "./gestation";

/** 宫闱小名常用 2 字叠词/吉名。 */
export const PET_NAME_POOL: readonly string[] = [
  "环环", "团团", "圆圆", "安安", "宁宁", "乐乐", "阿福", "阿宝",
  "念念", "锦锦", "瑞瑞", "盼盼", "灵灵", "婉婉", "朗朗", "暖暖",
];

/** 取池中一名；种子 = rngSeed ⊕ heirId。 */
export function randomPetName(rngSeed: number, heirId: string): string {
  const roll = gestationRoll(`petname:${rngSeed}:${heirId}`);
  return PET_NAME_POOL[roll % PET_NAME_POOL.length]!;
}
```

> 注：`gestationRoll(s: string): number` 已存在于 `src/engine/characters/gestation.ts`（birth.ts 已用其做确定性掷骰）。若导出名不同，按该文件实际导出调整 import。

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/characters/heirNames.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/heirNames.ts tests/characters/heirNames.test.ts
git commit -m "feat: deterministic random pet-name generator"
```

---

### Task 5: `heir_name` 效果（schema + funnel）

**Files:**
- Modify: `src/engine/content/schemas.ts:181`
- Modify: `src/engine/effects/funnel.ts`（validate + apply）
- Test: `tests/effects/funnel.heirName.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/effects/funnel.heirName.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function withOneHeir(): GameState {
  const s0 = createNewGameState(db);
  s0.resources.bloodline.heirs.push({
    id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor: 50, legitimate: true, petName: "", education: { scholarship: 5, martial: 5, virtue: 5 },
  });
  return s0;
}

describe("funnel: heir_name", () => {
  it("sets petName", () => {
    const r = applyEffects(db, withOneHeir(), [{ type: "heir_name", heirId: "heir_000001", field: "pet", name: "环环" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.petName).toBe("环环");
  });

  it("sets givenName", () => {
    const r = applyEffects(db, withOneHeir(), [{ type: "heir_name", heirId: "heir_000001", field: "given", name: "长安" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.givenName).toBe("长安");
  });

  it("rejects unknown heir", () => {
    expect(validateEffects(db, withOneHeir(), [{ type: "heir_name", heirId: "nope", field: "pet", name: "环环" }])).toHaveLength(1);
  });

  it("rejects names longer than 2 chars (schema)", () => {
    expect(validateEffects(db, withOneHeir(), [{ type: "heir_name", heirId: "heir_000001", field: "pet", name: "三个字" }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/effects/funnel.heirName.test.ts`
Expected: FAIL（`heir_name` 不在 union）。

- [ ] **Step 3: schema 加 `heir_name`**

在 `src/engine/content/schemas.ts` 的 `eventEffectSchema` union 内（`child_favor` 行 181 之前）加：

```ts
  z.strictObject({
    type: z.literal("heir_name"),
    heirId: nonEmpty,
    field: z.enum(["pet", "given"]),
    name: z.string().min(1).max(2),
  }),
```

- [ ] **Step 4: funnel 校验 + 应用**

在 `src/engine/effects/funnel.ts` 的 `validateEffects` switch 内，`case "child_favor":` 之前加：

```ts
      case "heir_name": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        break;
      }
```

在 `applyEffects` switch 内，`case "child_favor":` 之前加：

```ts
      case "heir_name": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        if (effect.field === "pet") heir.petName = effect.name;
        else heir.givenName = effect.name;
        break;
      }
```

- [ ] **Step 5: 运行，确认通过**

Run: `npx vitest run tests/effects/funnel.heirName.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.heirName.test.ts
git commit -m "feat: heir_name effect (pet/given name)"
```

---

### Task 6: 存档 schema 加字段 + v2→v3 迁移

**Files:**
- Modify: `src/engine/save/stateSchema.ts:72-82`
- Modify: `src/engine/save/saveSystem.ts:21,37-48`
- Test: `tests/save/migrationV3.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/save/migrationV3.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("save migration v2 → v3", () => {
  it("backfills petName/education on heirs lacking them", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    // inject a v2-shaped heir (no petName/education)
    (state.resources.bloodline.heirs as unknown as Record<string, unknown>[]).push({
      id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
      birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 }, favor: 50, legitimate: true,
    });
    const v3 = createSaveData(db, state, "slot1");
    const v2State = structuredClone(v3.state) as unknown as Record<string, unknown>;
    const bloodline = (v2State.resources as { bloodline: Record<string, unknown> }).bloodline;
    // strip the new fields to simulate an on-disk v2 heir
    for (const h of bloodline.heirs as Record<string, unknown>[]) {
      delete h.petName; delete h.givenName; delete h.education; delete h.adoptiveFatherId;
    }
    const envelope = { ...v3, formatVersion: 2, state: v2State, checksum: checksumOf(v2State) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const heir = loaded.value.state.resources.bloodline.heirs[0]!;
    expect(heir.petName).toBe("");
    expect(heir.education).toEqual({ scholarship: 5, martial: 5, virtue: 5 });
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/save/migrationV3.test.ts`
Expected: FAIL（当前 `SAVE_FORMAT_VERSION=2`，v2 档被当作当前版本，strict schema 因缺 petName 拒绝 → CORRUPT）。

- [ ] **Step 3: stateSchema 加字段**

在 `src/engine/save/stateSchema.ts` 的 heirs 数组 schema（72–82 行）替换为：

```ts
      heirs: z.array(
        z.strictObject({
          id: idSchema,
          sex: z.enum(["daughter", "son"]),
          fatherId: z.union([idSchema, z.null()]),
          bearer: z.union([z.literal("sovereign"), idSchema]),
          birthAt: gameTimeSchema,
          favor: percent,
          legitimate: z.boolean(),
          petName: z.string().max(2),
          givenName: z.string().min(1).max(2).optional(),
          education: z.strictObject({ scholarship: percent, martial: percent, virtue: percent }),
          adoptiveFatherId: idSchema.optional(),
        }),
      ),
```

- [ ] **Step 4: 迁移 + 版本号**

在 `src/engine/save/saveSystem.ts`：把 `export const SAVE_FORMAT_VERSION = 2;` 改为 `= 3;`。
在 `MIGRATIONS` 对象内（`1: (old) => {...}` 之后）加：

```ts
  2: (old) => {
    const env = old as SaveEnvelope;
    const state = structuredClone(env.state) as Record<string, unknown>;
    const bloodline = ((state.resources as Record<string, unknown> | undefined)?.bloodline ??
      {}) as Record<string, unknown>;
    const heirs = (bloodline.heirs as Record<string, unknown>[] | undefined) ?? [];
    for (const h of heirs) {
      if (h.petName === undefined) h.petName = "";
      if (h.education === undefined) h.education = { scholarship: 5, martial: 5, virtue: 5 };
    }
    return { ...env, formatVersion: 3, state, checksum: checksumOf(state) };
  },
```

- [ ] **Step 5: 运行（含全套存档测试），确认通过**

Run: `npx vitest run tests/save && npm run typecheck`
Expected: PASS（migrationV2、migrationV3、heirRoundTrip 全绿）。

- [ ] **Step 6: Commit**

```bash
git add src/engine/save/stateSchema.ts src/engine/save/saveSystem.ts tests/save/migrationV3.test.ts
git commit -m "feat: save v3 — heir name/education fields + v2→v3 migration"
```

---

### Task 7: 通用命名框组件 + 皇嗣列表显示

**Files:**
- Create: `src/ui/components/HeirNameModal.tsx`
- Modify: `src/ui/components/HeirListModal.tsx`

- [ ] **Step 1: 命名框组件**

Create `src/ui/components/HeirNameModal.tsx`:

```tsx
/** 通用皇嗣命名框：出生起小名 / 百日宴赐正名。限 2 字 + 可随机。 */
import { useState } from "react";

export function HeirNameModal({
  title,
  hint,
  confirmLabel,
  onRandom,
  onConfirm,
}: {
  title: string;
  hint: string;
  confirmLabel: string;
  /** 提供则显示「随机」按钮（出生起小名用）。 */
  onRandom?: () => string;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const valid = [...name.trim()].length >= 1 && [...name.trim()].length <= 2;
  return (
    <div className="modal-backdrop">
      <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{hint}</p>
        <input
          className="heir-name__input"
          value={name}
          maxLength={2}
          placeholder="二字名"
          onChange={(e) => setName(e.target.value)}
        />
        <div className="yushufang-actions">
          {onRandom && (
            <button type="button" onClick={() => setName(onRandom())}>随机</button>
          )}
          <button type="button" disabled={!valid} onClick={() => onConfirm(name.trim())}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 皇嗣列表显示名 + 属性 + 养父**

在 `src/ui/components/HeirListModal.tsx`：import 增补派生函数与养父名解析。把 `renderTable` 内每行 `<li>` 替换为：

```tsx
            {rows.map(({ heir, name }) => (
              <li key={heir.id} className="heir-list__row">
                <span className="heir-list__name">
                  {name}
                  {heir.legitimate ? "（嫡）" : ""}：
                  {heir.givenName ?? "—"}
                  {heir.petName ? `（${heir.petName}）` : ""}
                </span>
                <span>承嗣：{bearerLabel(heir)}</span>
                {heir.adoptiveFatherId && <span>养父：{nameOf(heir.adoptiveFatherId)}</span>}
                <span>
                  {heirAge(heir, state.calendar)}岁 · {formatGameTime(heir.birthAt)}
                </span>
                {isEnrolled(heir, state.calendar) && (
                  <span className="heir-list__edu">
                    学问{heir.education.scholarship}·骑射{heir.education.martial}·品行{heir.education.virtue}
                  </span>
                )}
                <span className="heir-list__favor">
                  宠爱 {heir.favor}
                  <button type="button" onClick={() => onAdjust(heir.id, 5)}>＋</button>
                  <button type="button" onClick={() => onAdjust(heir.id, -5)}>－</button>
                </span>
              </li>
            ))}
```

在文件顶部 import 改为：

```tsx
import { listHeirsBySex, heirAge, isEnrolled } from "../../engine/characters/heirs";
```

在 `bearerLabel` 旁加一个解析任意 charId 显示名的 `nameOf` helper（复用 `bearerLabel` 的解析逻辑）：

```tsx
  const nameOf = (charId: string): string => {
    const c = db.characters[charId];
    if (!c) return charId;
    const st = state.standing[charId];
    return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
  };
```

- [ ] **Step 3: 样式（最小）**

在 `src/ui/styles.css` 末尾加：

```css
.heir-name__input { width: 8rem; padding: 0.3rem 0.5rem; margin: 0.5rem 0; }
.heir-list__edu { color: #b89; font-size: 0.85em; }
```

- [ ] **Step 4: 类型检查 + 构建**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/HeirNameModal.tsx src/ui/components/HeirListModal.tsx src/ui/styles.css
git commit -m "feat: heir naming modal + list display (names/education/养父)"
```

---

### Task 8: 出生起小名 + 百日宴赐名编排（App）

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: 接出生起小名**

在 `src/ui/App.tsx` import 区加：

```tsx
import { HeirNameModal } from "./components/HeirNameModal";
import { centennialDue } from "../engine/characters/heirs";
import { randomPetName } from "../engine/characters/heirNames";
```

加状态（与其它 `useState` 同处）：

```tsx
  const [namePetHeirId, setNamePetHeirId] = useState<string | null>(null);
```

在 `commitBirth` 内，`doAutosave();` 之后、晋升分支之前，插入：取刚落地（存活）的最新一胎弹起小名：

```tsx
    const heirsNow = store.getState().resources.bloodline.heirs;
    const newborn = heirsNow[heirsNow.length - 1];
    if (newborn && plan.bearerOutcome !== "child_dies" && plan.bearerOutcome !== "both") {
      setNamePetHeirId(newborn.id);
    }
```

- [ ] **Step 2: 百日宴 due 派生 + 自动弹**

在 render 前（`liveState` 之后）加：

```tsx
  const centennialHeir =
    liveState.resources.bloodline.heirs.find((h) => centennialDue(h, liveState.calendar)) ?? null;
```

- [ ] **Step 3: 渲染两个命名框**

在 `App.tsx` JSX 末尾（`<DebugPanel ... />` 之前）加：

```tsx
      {namePetHeirId && (
        <HeirNameModal
          title="为新生皇嗣起个小名"
          hint="乳名一双字，亲昵相唤。"
          confirmLabel="起名"
          onRandom={() => randomPetName(store.getState().rngSeed, namePetHeirId)}
          onConfirm={(name) => {
            const id = namePetHeirId;
            setNamePetHeirId(null);
            const r = store.applyEffects(db, [{ type: "heir_name", heirId: id, field: "pet", name }]);
            if (r.ok) doAutosave();
          }}
        />
      )}
      {!namePetHeirId && centennialHeir && (
        <HeirNameModal
          title="百日宴 · 为皇嗣赐名"
          hint="皇嗣已满百日，请陛下赐下正名。"
          confirmLabel="赐名"
          onConfirm={(name) => {
            const r = store.applyEffects(db, [{ type: "heir_name", heirId: centennialHeir.id, field: "given", name }]);
            if (r.ok) {
              doAutosave();
              setReaction({ speakerId: "sili_nvguan", lines: [`司礼官高唱：皇嗣赐名「${name}」，宗祠登册，举宫同贺。`] });
            }
          }}
        />
      )}
```

> 优先级：起小名框（`namePetHeirId`）盖过百日宴框；二者均为模态，叠在生产播报之后。生产播报（`activeBirthPlan`）与之互斥（先播报 → commitBirth → 起小名）。

- [ ] **Step 4: 手动验证（无 UI 单测）**

Run: `npm run build`
Expected: 构建通过。随后 `npm run dev`，用 DebugPanel 强制一胎出生 → 应弹「起小名」（可随机/输入）→ 推进到孕后 3 月 → 应弹「百日宴赐名」→ 皇嗣列表显示 `大皇子（嫡）：长安（环环）`。

- [ ] **Step 5: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: birth pet-name prompt + 百日宴 formal-naming"
```

---

# PHASE 2 — 御书房召见皇嗣

### Task 9: `heir_summon` 效果（+20 宠爱，绕开 ±10 cap）

**Files:**
- Modify: `src/engine/content/schemas.ts`
- Modify: `src/engine/effects/funnel.ts`
- Test: `tests/effects/funnel.heirSummon.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/effects/funnel.heirSummon.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function heirWithFavor(favor: number): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push({
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor, legitimate: true, petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 },
  });
  return s;
}

describe("funnel: heir_summon", () => {
  it("adds 20 favor without the ±10 cap", () => {
    const r = applyEffects(db, heirWithFavor(50), [{ type: "heir_summon", heirId: "heir_000001" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(70);
  });

  it("clamps at 100", () => {
    const r = applyEffects(db, heirWithFavor(90), [{ type: "heir_summon", heirId: "heir_000001" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(100);
  });

  it("rejects unknown heir", () => {
    expect(validateEffects(db, heirWithFavor(50), [{ type: "heir_summon", heirId: "x" }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/effects/funnel.heirSummon.test.ts`
Expected: FAIL。

- [ ] **Step 3: schema + funnel**

`schemas.ts` union 内（`child_favor` 之前）加：

```ts
  z.strictObject({ type: z.literal("heir_summon"), heirId: nonEmpty }),
```

`funnel.ts` validate 内（`case "child_favor":` 之前）加：

```ts
      case "heir_summon": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        break;
      }
```

`funnel.ts` apply 内（`case "child_favor":` 之前）加（直接 clamp，不经 cappedDelta）：

```ts
      case "heir_summon": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        heir.favor = clampPct(heir.favor + 20);
        break;
      }
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/effects/funnel.heirSummon.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.heirSummon.test.ts
git commit -m "feat: heir_summon effect (+20 favor, uncapped)"
```

---

### Task 10: `buildHeirSummon` 装配（阶段台词）

**Files:**
- Create: `src/store/heirInteraction.ts`
- Test: `tests/store/heirInteraction.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/store/heirInteraction.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { buildHeirSummon } from "../../src/store/heirInteraction";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, Heir } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function stateAt(year: number): { state: GameState; heir: Heir } {
  const s = createNewGameState(db);
  // 把当前日历设为指定 year（其余沿用起始）
  (s.calendar as { year: number }).year = year;
  const heir: Heir = {
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: makeGameTime(1, 1, "early"), favor: 50, legitimate: true,
    petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 },
  };
  s.resources.bloodline.heirs.push(heir);
  return { state: s, heir };
}

describe("buildHeirSummon", () => {
  it("returns +20 favor effect and stage-specific lines + portrait", () => {
    const { state, heir } = stateAt(1); // 0 岁 infant
    const plan = buildHeirSummon(db, state, heir.id)!;
    expect(plan.effects).toEqual([{ type: "heir_summon", heirId: heir.id }]);
    expect(plan.portraitSet).toBe("child_baby");
    expect(plan.lines.length).toBeGreaterThan(0);
  });

  it("schooling heir uses school portrait", () => {
    const { state, heir } = stateAt(6); // 5 岁 schooling
    const plan = buildHeirSummon(db, state, heir.id)!;
    expect(plan.portraitSet).toBe("child_school");
  });

  it("returns null for unknown heir", () => {
    const { state } = stateAt(1);
    expect(buildHeirSummon(db, state, "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/store/heirInteraction.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `src/store/heirInteraction.ts`:

```ts
/** 御书房召见皇嗣 / 上书房问功课的装配层：纯台词 + effects，经子屏重放。 */
import { heirStage, heirPortraitSet, listHeirsBySex } from "../engine/characters/heirs";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState, Heir } from "../engine/state/types";

export interface HeirInteractionPlan {
  effects: EventEffect[];
  lines: string[];
  portraitSet: "child_baby" | "child_school";
  speakerName: string;
}

/** 该 heir 的「序号名（小名/正名）」用于子屏 speaker。 */
function heirDisplayName(state: GameState, heir: Heir): string {
  const rows = listHeirsBySex(state.resources.bloodline.heirs, heir.sex);
  const ord = rows.find((r) => r.heir.id === heir.id)?.name ?? "皇嗣";
  const nick = heir.givenName ?? (heir.petName || "");
  return nick ? `${ord}·${nick}` : ord;
}

/** 御书房召见：+20 宠爱 + 按阶段/恩宠的童趣台词。未知 heir 返回 null。 */
export function buildHeirSummon(db: ContentDB, state: GameState, heirId: string): HeirInteractionPlan | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir) return null;
  const stage = heirStage(heir, state.calendar);
  const name = heirDisplayName(state, heir);

  let lines: string[];
  if (stage === "infant") {
    lines = [
      `乳母抱来襁褓中的${name}，粉雕玉琢，见了陛下咯咯直笑，小手胡乱抓握。`,
      `陛下逗弄片刻，${name}伊伊呀呀，宫人皆道与陛下亲厚。`,
    ];
  } else if (stage === "toddler") {
    lines = heir.favor >= 50
      ? [
          `${name}迈着小短腿扑到陛下膝前，仰头脆生生道：“父…父皇！”惹得满殿失笑。`,
          `奶声奶气说了半日宫里趣事，黏着陛下不肯走，天真烂漫。`,
        ]
      : [
          `${name}被乳母牵来，怯生生行了个不成样子的礼，偷眼打量陛下。`,
          `陛下温言相询，半晌才敢小声答话，渐渐放开了些。`,
        ];
  } else {
    lines = [
      `${name}规规矩矩上前请安，举止已有几分皇家气度，应对从容。`,
      `陛下问起近日起居，${name}一一作答，眉宇间难掩孺慕。`,
    ];
  }

  return {
    effects: [{ type: "heir_summon", heirId }],
    lines,
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
  };
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/store/heirInteraction.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/store/heirInteraction.ts tests/store/heirInteraction.test.ts
git commit -m "feat: buildHeirSummon — stage-aware child summon lines"
```

---

### Task 11: 子嗣台词子屏（显式立绘）+ 立绘注册

**Files:**
- Create: `src/ui/screens/ChildReactionScreen.tsx`
- Modify: `assets/manifest.json`

- [ ] **Step 1: 注册立绘**

在 `assets/manifest.json` 的 `entries` 内加（紧随 `portrait.official.neutral` 一行）：

```json
    "portrait.child_baby.neutral": { "path": "portraits/child/baby.png", "kind": "portrait", "placeholder": false },
    "portrait.child_school.neutral": { "path": "portraits/child/child.png", "kind": "portrait", "placeholder": false },
```

- [ ] **Step 2: 子屏组件**

Create `src/ui/screens/ChildReactionScreen.tsx`:

```tsx
/** 皇嗣台词子屏：与 ReactionScreen 同布局，但立绘由 portraitSet 显式给出（皇嗣非 db.characters）。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function ChildReactionScreen({
  db,
  store,
  registry,
  portraitSet,
  speakerName,
  lines,
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  portraitSet: string;
  speakerName: string;
  lines: string[];
  onDone: () => void;
}) {
  const state = useGameState(store);
  const [index, setIndex] = useState(0);
  const portrait = registry.portrait(portraitSet, "neutral");
  const location = db.locations[state.playerLocation];
  const background = location
    ? registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background")
    : null;
  const text = lines[index] ?? "";
  const next = () => (index + 1 < lines.length ? setIndex(index + 1) : onDone());

  return (
    <main
      className="dialogue-screen"
      style={background ? { backgroundImage: `url("${background.url}")` } : undefined}
    >
      <img
        className="dialogue-screen__portrait"
        src={portrait.url}
        alt={speakerName}
        data-fallback={portrait.isFallback || undefined}
      />
      <section className="dialogue-screen__box" onClick={next}>
        <p className="dialogue-screen__speaker">{speakerName}</p>
        <p className="dialogue-screen__line">{text}</p>
        <div className="dialogue-screen__choices">
          <button type="button" onClick={next}>（继续）</button>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 3: 构建检查**

Run: `npm run build`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/ChildReactionScreen.tsx assets/manifest.json
git commit -m "feat: child reaction screen + child portraits"
```

---

### Task 12: 御书房召见接线（HeirListModal + App）

**Files:**
- Modify: `src/ui/components/HeirListModal.tsx`
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: HeirListModal 加召见回调与按钮**

`HeirListModal` props 加 `onSummon?: (heirId: string) => void;` 与 `canSummon: boolean;`。在每行 `宠爱` span 之前加：

```tsx
                {onSummon && (
                  <button type="button" disabled={!canSummon} onClick={() => onSummon(heir.id)}>
                    召见
                  </button>
                )}
```

- [ ] **Step 2: App 接线**

`App.tsx` import 加：

```tsx
import { buildHeirSummon, type HeirInteractionPlan } from "../store/heirInteraction";
import { ChildReactionScreen } from "./screens/ChildReactionScreen";
```

加状态：

```tsx
  const [childReaction, setChildReaction] = useState<HeirInteractionPlan | null>(null);
```

加处理函数（与 `converse` 同构，扣 1 AP）：

```tsx
  const summonHeir = (heirId: string) => {
    const plan = buildHeirSummon(db, store.getState(), heirId);
    if (!plan) return;
    const spend = store.dispatch({ type: "SPEND_AP", amount: 1 });
    if (!spend.ok) return; // 行动点不足
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    if (spend.value.rolledOver) setReactionRollover(true);
    setHeirListOpen(false);
    setChildReaction(plan);
  };
```

把 `HeirListModal` 渲染处补 props：

```tsx
      {heirListOpen && (
        <HeirListModal
          db={db}
          state={liveState}
          onAdjust={adjustHeirFavor}
          onSummon={summonHeir}
          canSummon={liveState.calendar.ap >= 1}
          onClose={() => setHeirListOpen(false)}
        />
      )}
```

在 JSX 末尾（`DebugPanel` 前）加子屏渲染（复用 `reactionRollover` 补跑逻辑）：

```tsx
      {childReaction && (
        <ChildReactionScreen
          db={db}
          store={store}
          registry={registry}
          portraitSet={childReaction.portraitSet}
          speakerName={childReaction.speakerName}
          lines={childReaction.lines}
          onDone={() => {
            setChildReaction(null);
            if (reactionRollover) {
              setReactionRollover(false);
              runCheckpoints(true);
            }
          }}
        />
      )}
```

- [ ] **Step 3: 手动验证**

Run: `npm run build` → PASS。`npm run dev`：御书房「子嗣」→ 某皇嗣「召见」（AP≥1）→ 立绘按阶段显示 baby/child.png，播童趣台词，宠爱 +20，扣 1 AP。

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/HeirListModal.tsx src/ui/App.tsx
git commit -m "feat: 御书房 summon heir (+20 favor, stage portrait & lines)"
```

---

# PHASE 3 — 上书房

### Task 13: 上书房地点 + 背景 + 主图可达

**Files:**
- Create: `content/locations/shangshufang.json`
- Modify: `content/locations/yushufang.json:9`
- Modify: `assets/manifest.json`
- Test: `tests/content/locations.test.ts`（若无则新建）

- [ ] **Step 1: 写失败测试（地点已加载且对称可达）**

Create（或追加）`tests/content/shangshufang.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error(`content failed: ${JSON.stringify(content.error)}`);
const db = content.value;

describe("上书房 location", () => {
  it("loads as a palace travel node connected to 御书房 (symmetric)", () => {
    const loc = db.locations["shangshufang"];
    expect(loc).toBeDefined();
    expect(loc!.zone).toBe("palace");
    expect(loc!.entry).toBe("travel");
    expect(loc!.connections).toContain("yushufang");
    expect(db.locations["yushufang"]!.connections).toContain("shangshufang");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/content/shangshufang.test.ts`
Expected: FAIL（地点不存在 → content load 抛错或断言失败）。

- [ ] **Step 3: 新建地点 + 回边 + 背景**

Create `content/locations/shangshufang.json`:

```json
{
  "id": "shangshufang",
  "name": "上书房",
  "description": "窗明几净，书声琅琅。皇子皇郎在此开蒙就学，先生执卷讲授，案上笔墨纸砚俱全。",
  "backgroundKey": "bg.shangshufang",
  "ambience": ["书声琅琅", "墨香清苦", "戒尺轻叩"],
  "position": { "x": 0.5, "y": 0.55 },
  "zone": "palace",
  "connections": ["yushufang"],
  "travelCost": { "ap": 1 }
}
```

把 `content/locations/yushufang.json` 第 9 行 `"connections": ["yuhuayuan"],` 改为：

```json
  "connections": ["yuhuayuan", "shangshufang", "fengxiandian"],
```

> 注：`fengxiandian` 在 Phase 4 才建；若先做 P3，可暂写 `["yuhuayuan", "shangshufang"]`，到 Task 17 再补 `fengxiandian`。

在 `assets/manifest.json` `entries` 内加：

```json
    "bg.shangshufang": { "path": "backgrounds/shangshufang.png", "kind": "background", "placeholder": false },
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/content/shangshufang.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add content/locations/shangshufang.json content/locations/yushufang.json assets/manifest.json tests/content/shangshufang.test.ts
git commit -m "feat: 上书房 location + background + map reachability"
```

---

### Task 14: `heir_educate` 效果

**Files:**
- Modify: `src/engine/content/schemas.ts`
- Modify: `src/engine/effects/funnel.ts`
- Test: `tests/effects/funnel.heirEducate.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/effects/funnel.heirEducate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function heirState(): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push({
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor: 40, legitimate: true, petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 },
  });
  return s;
}

describe("funnel: heir_educate", () => {
  it("raises one subject and favor, clamped", () => {
    const r = applyEffects(db, heirState(), [
      { type: "heir_educate", heirId: "heir_000001", subject: "scholarship", attrDelta: 8, favorDelta: 5 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const h = r.value.resources.bloodline.heirs[0]!;
    expect(h.education.scholarship).toBe(13);
    expect(h.education.martial).toBe(5);
    expect(h.favor).toBe(45);
  });

  it("rejects unknown heir and out-of-range delta", () => {
    expect(validateEffects(db, heirState(), [{ type: "heir_educate", heirId: "x", subject: "virtue", attrDelta: 5, favorDelta: 5 }])).toHaveLength(1);
    expect(validateEffects(db, heirState(), [{ type: "heir_educate", heirId: "heir_000001", subject: "virtue", attrDelta: 99, favorDelta: 5 }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/effects/funnel.heirEducate.test.ts`
Expected: FAIL。

- [ ] **Step 3: schema + funnel**

`schemas.ts` union 内（`child_favor` 之前）加：

```ts
  z.strictObject({
    type: z.literal("heir_educate"),
    heirId: nonEmpty,
    subject: z.enum(["scholarship", "martial", "virtue"]),
    attrDelta: z.number().int().min(0).max(20),
    favorDelta: z.number().int().min(0).max(20),
  }),
```

`funnel.ts` validate 内（`case "child_favor":` 之前）加：

```ts
      case "heir_educate": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        break;
      }
```

`funnel.ts` apply 内（`case "child_favor":` 之前）加（直接 clamp）：

```ts
      case "heir_educate": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        heir.education[effect.subject] = clampPct(heir.education[effect.subject] + effect.attrDelta);
        heir.favor = clampPct(heir.favor + effect.favorDelta);
        break;
      }
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/effects/funnel.heirEducate.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.heirEducate.test.ts
git commit -m "feat: heir_educate effect (subject + favor)"
```

---

### Task 15: `buildHeirLesson` + `buildTutorReport` 装配

**Files:**
- Modify: `src/store/heirInteraction.ts`
- Test: `tests/store/heirInteraction.test.ts`

- [ ] **Step 1: 写失败测试（追加）**

在 `tests/store/heirInteraction.test.ts` 顶部 import 改为：

```ts
import { buildHeirSummon, buildHeirLesson, buildTutorReport } from "../../src/store/heirInteraction";
```

追加：

```ts
describe("buildHeirLesson", () => {
  it("targets a subject, returns heir_educate effect + child portrait + lines", () => {
    const { state, heir } = stateAt(6); // schooling
    const plan = buildHeirLesson(db, state, heir.id)!;
    const eff = plan.effects[0]!;
    expect(eff.type).toBe("heir_educate");
    expect(plan.portraitSet).toBe("child_school");
    expect(plan.lines.length).toBeGreaterThan(0);
  });

  it("returns null for a non-enrolled heir", () => {
    const { state, heir } = stateAt(2); // 1 岁
    expect(buildHeirLesson(db, state, heir.id)).toBeNull();
  });
});

describe("buildTutorReport", () => {
  it("returns 先生 report lines for an enrolled heir (no attr change)", () => {
    const { state, heir } = stateAt(6);
    const lines = buildTutorReport(db, state, heir.id)!;
    expect(lines.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/store/heirInteraction.test.ts`
Expected: FAIL。

- [ ] **Step 3: 实现（追加到 `src/store/heirInteraction.ts`）**

顶部 import 加 `isEnrolled`：

```ts
import { heirStage, heirPortraitSet, isEnrolled, listHeirsBySex } from "../engine/characters/heirs";
import { gestationRoll } from "../engine/characters/gestation";
```

文件末尾追加：

```ts
const SUBJECTS = ["scholarship", "martial", "virtue"] as const;
const SUBJECT_LABEL: Record<(typeof SUBJECTS)[number], string> = {
  scholarship: "学问", martial: "骑射", virtue: "品行",
};

/** 上书房问功课：仅开蒙皇嗣。轮换一科 +（确定性）并增宠爱。未开蒙返回 null。 */
export function buildHeirLesson(db: ContentDB, state: GameState, heirId: string): HeirInteractionPlan | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || !isEnrolled(heir, state.calendar)) return null;
  const roll = gestationRoll(`lesson:${state.rngSeed}:${heirId}:${heir.favor}`);
  const subject = SUBJECTS[roll % SUBJECTS.length]!;
  const name = heirDisplayName(state, heir);
  return {
    effects: [{ type: "heir_educate", heirId, subject, attrDelta: 6, favorDelta: 4 }],
    lines: [
      `陛下移驾上书房，考较${name}的${SUBJECT_LABEL[subject]}。`,
      `${name}凝神应答，引经据典，颇见用功。陛下颔首嘉许，${name}受宠若惊，愈发勤勉。`,
    ],
    portraitSet: heirPortraitSet(heir, state.calendar),
    speakerName: name,
  };
}

/** 问先生该皇嗣读书情况：纯汇报，按三项属性高低分支，不改属性。未开蒙返回 null。 */
export function buildTutorReport(db: ContentDB, state: GameState, heirId: string): string[] | null {
  const heir = state.resources.bloodline.heirs.find((h) => h.id === heirId);
  if (!heir || !isEnrolled(heir, state.calendar)) return null;
  const name = heirDisplayName(state, heir);
  const e = heir.education;
  const best = SUBJECTS.reduce((a, b) => (e[b] > e[a] ? b : a));
  const total = e.scholarship + e.martial + e.virtue;
  const overall = total >= 180 ? "出类拔萃" : total >= 90 ? "稳步精进" : "尚需勤勉";
  return [
    `先生向陛下回禀${name}的功课：${overall}。`,
    `其中${SUBJECT_LABEL[best]}最为见长（学问${e.scholarship}·骑射${e.martial}·品行${e.virtue}），望陛下时加策励。`,
  ];
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/store/heirInteraction.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/store/heirInteraction.ts tests/store/heirInteraction.test.ts
git commit -m "feat: buildHeirLesson + buildTutorReport"
```

---

### Task 16: 上书房屏 + App 接线

**Files:**
- Create: `src/ui/screens/ShangshufangScreen.tsx`
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: 上书房屏组件**

Create `src/ui/screens/ShangshufangScreen.tsx`:

```tsx
/** 上书房：列开蒙皇嗣，可「问功课」（heir_educate）或「问先生」（汇报）。均 1 AP。 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import { isEnrolled, listHeirsBySex } from "../../engine/characters/heirs";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function ShangshufangScreen({
  db, store, registry, onOpenMap, onOpenSave, onLesson, onTutorReport,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSave: () => void;
  onLesson: (heirId: string) => void; onTutorReport: (heirId: string) => void;
}) {
  const state = useGameState(store);
  const location = db.locations["shangshufang"]!;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const enrolled = [...listHeirsBySex(state.resources.bloodline.heirs, "daughter"), ...listHeirsBySex(state.resources.bloodline.heirs, "son")]
    .filter((r) => isEnrolled(r.heir, state.calendar));
  const canAct = state.calendar.ap >= 1;

  return (
    <main className="location-screen">
      <header className="hud">
        <span className="hud__time">{formatGameTime(state.calendar)} · {formatShichen(state.calendar)}</span>
        <span className="hud__group">
          <button type="button" className="hud__button" onClick={onOpenSave}>存档</button>
          <button type="button" className="hud__button" onClick={onOpenMap}>宫城图</button>
        </span>
      </header>
      <section className="location-screen__stage" style={{ backgroundImage: `url("${background.url}")` }} data-fallback={background.isFallback || undefined}>
        <h1 className="location-screen__name">{location.name}</h1>
        <p className="location-screen__desc">{location.description}</p>
      </section>
      <section className="location-screen__roster">
        <h2>开蒙皇嗣</h2>
        {enrolled.length === 0 ? (
          <p className="location-screen__empty">尚无皇嗣开蒙。</p>
        ) : (
          enrolled.map(({ heir, name }) => (
            <div key={heir.id} className="roster-row">
              <span>{name}{heir.givenName ? `·${heir.givenName}` : ""}</span>
              <button type="button" disabled={!canAct} onClick={() => onLesson(heir.id)}>问功课</button>
              <button type="button" disabled={!canAct} onClick={() => onTutorReport(heir.id)}>问先生</button>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
```

- [ ] **Step 2: App 接线**

`App.tsx` import 加：

```tsx
import { ShangshufangScreen } from "./screens/ShangshufangScreen";
import { buildHeirLesson, buildTutorReport } from "../store/heirInteraction";
```

`View` 类型加 `"shangshufang"`：

```tsx
type View = "title" | "location" | "map" | "freeview" | "event" | "save" | "shangshufang";
```

加处理函数：

```tsx
  const heirLesson = (heirId: string) => {
    const plan = buildHeirLesson(db, store.getState(), heirId);
    if (!plan) return;
    const spend = store.dispatch({ type: "SPEND_AP", amount: 1 });
    if (!spend.ok) return;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    if (spend.value.rolledOver) setReactionRollover(true);
    setChildReaction(plan);
  };
  const tutorReport = (heirId: string) => {
    const lines = buildTutorReport(db, store.getState(), heirId);
    if (!lines) return;
    const spend = store.dispatch({ type: "SPEND_AP", amount: 1 });
    if (!spend.ok) return;
    doAutosave();
    if (spend.value.rolledOver) setReactionRollover(true);
    setReaction({ speakerId: "sili_nvguan", lines });
  };
```

把上书房接入地图进入流程：`MapScreen` 的 `onEnterCurrent`/travel 落到 `runCheckpoints` → `setView("location")`。上书房需要专屏。最小改法：在 `runCheckpoints` 末尾，`else` 分支改为按当前地点选屏：

```tsx
    if (pick) startEvent(pick.id);
    else if (store.getState().playerLocation === "shangshufang") setView("shangshufang");
    else setView("location");
```

并渲染：

```tsx
      {view === "shangshufang" && (
        <ShangshufangScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => { setMapAtRoot(false); setView("map"); }}
          onOpenSave={() => setView("save")}
          onLesson={heirLesson}
          onTutorReport={tutorReport}
        />
      )}
```

> 注：`MapScreen` 对当前所在节点的「进入此处」按钮回调 `onEnterCurrent` 固定 `setView("location")`。为让在上书房点「进入此处」也回到上书房专屏，把 `onEnterCurrent` 改为：`() => setView(store.getState().playerLocation === "shangshufang" ? "shangshufang" : "location")`（App 渲染 MapScreen 处）。

- [ ] **Step 3: 手动验证**

Run: `npm run build` → PASS。`npm run dev`：主图 → 上书房（需有皇嗣≥5岁，可用 DebugPanel 调时间/造嗣）→「问功课」属性+宠爱增、child.png 台词；「问先生」司礼官/先生汇报。无开蒙皇嗣显空态。

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/ShangshufangScreen.tsx src/ui/App.tsx
git commit -m "feat: 上书房 screen — 问功课 / 问先生"
```

---

# PHASE 4 — 奉先殿（择养父）

### Task 17: 奉先殿地点 + 背景 + 可达

**Files:**
- Create: `content/locations/fengxiandian.json`
- Modify: `content/locations/yushufang.json`（若 Task 13 未含 fengxiandian 则补）
- Modify: `assets/manifest.json`
- Test: `tests/content/fengxiandian.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/content/fengxiandian.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error(`content failed: ${JSON.stringify(content.error)}`);
const db = content.value;

describe("奉先殿 location", () => {
  it("loads as a palace travel node, symmetric with 御书房", () => {
    const loc = db.locations["fengxiandian"];
    expect(loc).toBeDefined();
    expect(loc!.zone).toBe("palace");
    expect(loc!.connections).toContain("yushufang");
    expect(db.locations["yushufang"]!.connections).toContain("fengxiandian");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/content/fengxiandian.test.ts`
Expected: FAIL。

- [ ] **Step 3: 新建地点 + 回边 + 背景**

Create `content/locations/fengxiandian.json`:

```json
{
  "id": "fengxiandian",
  "name": "奉先殿",
  "description": "殿内供奉历代先帝牌位，香烟缭绕，肃穆庄严。帝王于此祭祀祖先，亦在此为皇嗣择立养父，告于宗庙。",
  "backgroundKey": "bg.fengxiandian",
  "ambience": ["香烟缭绕", "牌位森然", "钟磬低回"],
  "position": { "x": 0.72, "y": 0.6 },
  "zone": "palace",
  "connections": ["yushufang"],
  "travelCost": { "ap": 1 }
}
```

确认 `content/locations/yushufang.json` 的 `connections` 含 `"fengxiandian"`（Task 13 已加；若当时省略，现补上）。

`assets/manifest.json` `entries` 内加：

```json
    "bg.fengxiandian": { "path": "backgrounds/fengxiandian.png", "kind": "background", "placeholder": false },
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/content/fengxiandian.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add content/locations/fengxiandian.json content/locations/yushufang.json assets/manifest.json tests/content/fengxiandian.test.ts
git commit -m "feat: 奉先殿 location + background + reachability"
```

---

### Task 18: `heir_adopt` 效果（养父池校验）

**Files:**
- Modify: `src/engine/content/schemas.ts`
- Modify: `src/engine/effects/funnel.ts`
- Test: `tests/effects/funnel.heirAdopt.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/effects/funnel.heirAdopt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function heirState(): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push({
    id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
    birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    favor: 40, legitimate: true, petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 },
  });
  return s;
}

describe("funnel: heir_adopt", () => {
  it("sets adoptiveFatherId for an in-palace consort", () => {
    const r = applyEffects(db, heirState(), [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "shen_chenghui" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.adoptiveFatherId).toBe("shen_chenghui");
  });

  it("rejects a deceased consort", () => {
    const s = heirState();
    s.standing.shen_chenghui!.lifecycle = "deceased";
    expect(validateEffects(db, s, [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "shen_chenghui" }])).toHaveLength(1);
  });

  it("rejects a cold-palace consort (defaultLocation lenggong)", () => {
    // wenya_shijun 默认在冷宫
    expect(validateEffects(db, heirState(), [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "wenya_shijun" }])).toHaveLength(1);
  });

  it("rejects unknown heir / non-consort", () => {
    expect(validateEffects(db, heirState(), [{ type: "heir_adopt", heirId: "x", fatherId: "shen_chenghui" }])).toHaveLength(1);
    expect(validateEffects(db, heirState(), [{ type: "heir_adopt", heirId: "heir_000001", fatherId: "sili_nvguan" }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/effects/funnel.heirAdopt.test.ts`
Expected: FAIL。

- [ ] **Step 3: schema + funnel**

`schemas.ts` union 内（`child_favor` 之前）加：

```ts
  z.strictObject({ type: z.literal("heir_adopt"), heirId: nonEmpty, fatherId: idSchema }),
```

`funnel.ts` validate 内（`case "child_favor":` 之前）加：

```ts
      case "heir_adopt": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        const ch = db.characters[e.fatherId];
        const st = state.standing[e.fatherId];
        if (!ch || ch.kind !== "consort" || !st) {
          bad(index, "BAD_EFFECT_TARGET", `heir_adopt needs a consort with standing: "${e.fatherId}"`, { char: e.fatherId });
        } else if (st.lifecycle === "deceased") {
          bad(index, "BAD_EFFECT_TARGET", `adoptive father is deceased: "${e.fatherId}"`, { char: e.fatherId });
        } else if (ch.defaultLocation === "lenggong") {
          bad(index, "BAD_EFFECT_TARGET", `adoptive father is in 冷宫: "${e.fatherId}"`, { char: e.fatherId });
        }
        break;
      }
```

`funnel.ts` apply 内（`case "child_favor":` 之前）加：

```ts
      case "heir_adopt": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        heir.adoptiveFatherId = effect.fatherId;
        break;
      }
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/effects/funnel.heirAdopt.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.heirAdopt.test.ts
git commit -m "feat: heir_adopt effect (in-palace consort pool)"
```

---

### Task 19: 养父选择装配（候选池 / 生父可依性 / 谢恩台词）

**Files:**
- Create: `src/store/adoption.ts`
- Test: `tests/store/adoption.test.ts`

- [ ] **Step 1: 写失败测试**

Create `tests/store/adoption.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { eligibleAdoptiveFathers, bioFatherAvailable, buildAdoptionReaction } from "../../src/store/adoption";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, Heir } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001", sex: "son", fatherId: null, bearer: "sovereign",
  birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
  favor: 40, legitimate: true, petName: "团团", education: { scholarship: 5, martial: 5, virtue: 5 }, ...over,
});

describe("eligibleAdoptiveFathers", () => {
  it("includes in-palace consorts + 凤后, excludes 冷宫 + deceased + officials", () => {
    const s = createNewGameState(db);
    const ids = eligibleAdoptiveFathers(db, s).map((c) => c.id);
    expect(ids).toContain("feng_hou");
    expect(ids).toContain("shen_chenghui");
    expect(ids).not.toContain("wenya_shijun"); // 冷宫
    expect(ids).not.toContain("sili_nvguan"); // official
  });
});

describe("bioFatherAvailable", () => {
  it("false for self-conceived (fatherId null)", () => {
    const s = createNewGameState(db);
    expect(bioFatherAvailable(db, s, heir({ fatherId: null }))).toBe(false);
  });
  it("false when bio father deceased or in 冷宫", () => {
    const s = createNewGameState(db);
    s.standing.shen_chenghui!.lifecycle = "deceased";
    expect(bioFatherAvailable(db, s, heir({ fatherId: "shen_chenghui" }))).toBe(false);
    expect(bioFatherAvailable(db, createNewGameState(db), heir({ fatherId: "wenya_shijun" }))).toBe(false);
  });
  it("true when bio father alive and in palace", () => {
    const s = createNewGameState(db);
    expect(bioFatherAvailable(db, s, heir({ fatherId: "shen_chenghui" }))).toBe(true);
  });
});

describe("buildAdoptionReaction", () => {
  it("no-bio-father path: adoptive father thanks (single speaker)", () => {
    const s = createNewGameState(db);
    const out = buildAdoptionReaction(db, s, heir({ fatherId: null }), "shen_chenghui");
    expect(out).toHaveLength(1);
    expect(out[0]!.speakerId).toBe("shen_chenghui");
  });
  it("bio-father-alive path: adoptive thanks + 司礼官 reports bio father weeps", () => {
    const s = createNewGameState(db);
    const out = buildAdoptionReaction(db, s, heir({ fatherId: "chu_jun" }), "shen_chenghui");
    expect(out).toHaveLength(2);
    expect(out[0]!.speakerId).toBe("shen_chenghui");
    expect(out[1]!.speakerId).toBe("sili_nvguan");
    expect(out[1]!.lines.join("")).toContain("生父");
  });
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `npx vitest run tests/store/adoption.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

Create `src/store/adoption.ts`:

```ts
/** 奉先殿择养父：候选池、生父可依性、谢恩/司礼官播报（脚本台词）。 */
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { CharacterContent } from "../engine/content/schemas";
import type { GameState, Heir } from "../engine/state/types";

const SEX_CHILD: Record<Heir["sex"], string> = { daughter: "皇子", son: "皇郎" };

function nameOf(db: ContentDB, state: GameState, charId: string): string {
  const c = db.characters[charId];
  if (!c) return charId;
  const st = state.standing[charId];
  return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
}

/** 养父候选：在宫(非冷宫)、非已故的侍君（含凤后）。 */
export function eligibleAdoptiveFathers(db: ContentDB, state: GameState): CharacterContent[] {
  return Object.values(db.characters).filter((c) => {
    if (c.kind !== "consort") return false;
    if (c.defaultLocation === "lenggong") return false;
    if (state.standing[c.id]?.lifecycle === "deceased") return false;
    return true;
  });
}

/** 生父是否仍可依（存活 + 在宫非冷宫）。自孕(fatherId null)恒 false。 */
export function bioFatherAvailable(db: ContentDB, state: GameState, heir: Heir): boolean {
  if (heir.fatherId === null) return false;
  const c = db.characters[heir.fatherId];
  if (!c || c.kind !== "consort") return false;
  if (c.defaultLocation === "lenggong") return false;
  return state.standing[heir.fatherId]?.lifecycle !== "deceased";
}

export interface AdoptionLine {
  speakerId: string;
  lines: string[];
}

/** 择养父后的播报：养父谢恩；若生父尚在宫中，加司礼官「生父泪如雨下」。 */
export function buildAdoptionReaction(
  db: ContentDB,
  state: GameState,
  heir: Heir,
  fatherId: string,
): AdoptionLine[] {
  const child = SEX_CHILD[heir.sex];
  const adoptive = nameOf(db, state, fatherId);
  const thanks: AdoptionLine = {
    speakerId: fatherId,
    lines: [
      `${adoptive}闻陛下择其抚育皇嗣，趋前叩谢天恩。`,
      `${adoptive}哽咽叩首：臣定当视如己出，倾心教养这${child}，不负陛下托付。`,
    ],
  };
  if (bioFatherAvailable(db, state, heir)) {
    return [
      thanks,
      {
        speakerId: "sili_nvguan",
        lines: [`司礼官低声回禀：择养父之事已告宗庙。臣听闻……生父闻讯，独坐宫中，泪如雨下。`],
      },
    ];
  }
  return [thanks];
}
```

- [ ] **Step 4: 运行，确认通过**

Run: `npx vitest run tests/store/adoption.test.ts && npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/store/adoption.ts tests/store/adoption.test.ts
git commit -m "feat: adoption pool + bio-father availability + thank-you lines"
```

---

### Task 20: 奉先殿屏 + 养父选择 + App 接线

**Files:**
- Create: `src/ui/screens/FengxiandianScreen.tsx`
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: 奉先殿屏**

Create `src/ui/screens/FengxiandianScreen.tsx`:

```tsx
/** 奉先殿：择一皇嗣 → 择一养父（在宫侍君+凤后），告于宗庙。1 AP。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import { listHeirsBySex } from "../../engine/characters/heirs";
import { resolveDisplayName } from "../../engine/characters/standing";
import { eligibleAdoptiveFathers } from "../../store/adoption";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function FengxiandianScreen({
  db, store, registry, onOpenMap, onOpenSave, onAdopt,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSave: () => void;
  onAdopt: (heirId: string, fatherId: string) => void;
}) {
  const state = useGameState(store);
  const location = db.locations["fengxiandian"]!;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const heirs = [...listHeirsBySex(state.resources.bloodline.heirs, "daughter"), ...listHeirsBySex(state.resources.bloodline.heirs, "son")];
  const fathers = eligibleAdoptiveFathers(db, state);
  const [picked, setPicked] = useState<string | null>(null);
  const canAct = state.calendar.ap >= 1;

  return (
    <main className="location-screen">
      <header className="hud">
        <span className="hud__time">{formatGameTime(state.calendar)} · {formatShichen(state.calendar)}</span>
        <span className="hud__group">
          <button type="button" className="hud__button" onClick={onOpenSave}>存档</button>
          <button type="button" className="hud__button" onClick={onOpenMap}>宫城图</button>
        </span>
      </header>
      <section className="location-screen__stage" style={{ backgroundImage: `url("${background.url}")` }} data-fallback={background.isFallback || undefined}>
        <h1 className="location-screen__name">{location.name}</h1>
        <p className="location-screen__desc">{location.description}</p>
      </section>
      <section className="location-screen__roster">
        <h2>为皇嗣择养父</h2>
        {heirs.length === 0 ? (
          <p className="location-screen__empty">尚无皇嗣。</p>
        ) : (
          heirs.map(({ heir, name }) => (
            <div key={heir.id} className="roster-row">
              <span>{name}{heir.givenName ? `·${heir.givenName}` : ""}
                {heir.adoptiveFatherId ? `（养父：${resolveDisplayName(db.characters[heir.adoptiveFatherId]!, state.standing[heir.adoptiveFatherId], state.standing[heir.adoptiveFatherId] ? db.ranks[state.standing[heir.adoptiveFatherId]!.rank] : undefined)}）` : ""}
              </span>
              <button type="button" disabled={!canAct} onClick={() => setPicked(heir.id)}>择养父</button>
            </div>
          ))
        )}
      </section>

      {picked && (
        <div className="modal-backdrop" onClick={() => setPicked(null)}>
          <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
            <h2>择养父</h2>
            {fathers.map((c) => {
              const st = state.standing[c.id];
              return (
                <button key={c.id} type="button" onClick={() => { onAdopt(picked, c.id); setPicked(null); }}>
                  {resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined)}
                </button>
              );
            })}
            <button type="button" onClick={() => setPicked(null)}>取消</button>
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: App 接线**

`App.tsx` import 加：

```tsx
import { FengxiandianScreen } from "./screens/FengxiandianScreen";
import { buildAdoptionReaction } from "../store/adoption";
```

`View` 类型加 `"fengxiandian"`。在 `runCheckpoints` 的 else 链补一支：

```tsx
    else if (store.getState().playerLocation === "fengxiandian") setView("fengxiandian");
```

并在 `onEnterCurrent` 选屏表达式补 `fengxiandian`（与 shangshufang 同样判断），或改为：

```tsx
          onEnterCurrent={() => {
            const loc = store.getState().playerLocation;
            setView(loc === "shangshufang" ? "shangshufang" : loc === "fengxiandian" ? "fengxiandian" : "location");
          }}
```

加状态 + 处理函数（择养父后逐条播报谢恩/司礼官；多段经 reaction 队列）：

```tsx
  const [adoptionQueue, setAdoptionQueue] = useState<{ speakerId: string; lines: string[] }[]>([]);

  const adoptHeir = (heirId: string, fatherId: string) => {
    const heir = store.getState().resources.bloodline.heirs.find((h) => h.id === heirId);
    if (!heir) return;
    const reactions = buildAdoptionReaction(db, store.getState(), heir, fatherId);
    const spend = store.dispatch({ type: "SPEND_AP", amount: 1 });
    if (!spend.ok) return;
    const applied = store.applyEffects(db, [{ type: "heir_adopt", heirId, fatherId }]);
    if (!applied.ok) return;
    doAutosave();
    if (spend.value.rolledOver) setReactionRollover(true);
    const [first, ...rest] = reactions;
    setAdoptionQueue(rest);
    if (first) setReaction(first);
  };
```

在 `ReactionScreen` 的 `onDone` 内，最前面加一段「先放队列里下一条」逻辑：

```tsx
          onDone={() => {
            setReaction(null);
            if (adoptionQueue.length > 0) {
              const [next, ...rest] = adoptionQueue;
              setAdoptionQueue(rest);
              setReaction(next!);
              return;
            }
            if (postBirthPromoteId) {
              // …（原有逻辑保持不变）
```

渲染奉先殿屏：

```tsx
      {view === "fengxiandian" && (
        <FengxiandianScreen
          db={db}
          store={store}
          registry={registry}
          onOpenMap={() => { setMapAtRoot(false); setView("map"); }}
          onOpenSave={() => setView("save")}
          onAdopt={adoptHeir}
        />
      )}
```

- [ ] **Step 3: 手动验证**

Run: `npm run build` → PASS。`npm run dev`：
- 自孕皇嗣（无生父）→ 奉先殿择养父 → 养父谢恩（单段）。
- 侍君生父尚在宫的皇嗣 → 择他人为养父 → 养父谢恩 + 司礼官报「生父泪如雨下」（两段）。
- 养父池不含冷宫/已故/官员，含凤后。

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/FengxiandianScreen.tsx src/ui/App.tsx
git commit -m "feat: 奉先殿 screen — 择养父 + 谢恩/司礼官播报"
```

---

## 收尾

- [ ] **全套测试 + 类型 + 构建**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: 全 PASS。

- [ ] **更新 spec 状态**：把 spec 顶部 `Status:` 改为 `Implemented`，commit `docs: mark heir-lifecycle spec implemented`。

---

## Self-Review 记录

**Spec 覆盖**：①数据模型→T1/T2/T6；②派生（月龄/阶段/百日宴/开蒙）→T3；③`heir_name`→T5、命名 UI→T7/T8；④`heir_summon`+召见→T9–T12；⑤上书房（地点/`heir_educate`/问功课/问先生）→T13–T16；⑥奉先殿（地点/`heir_adopt`/候选池/生父可依/谢恩+司礼官）→T17–T20；⑦存档迁移→T6；⑧立绘 baby/child→T11。全部有对应任务。

**类型一致性**：效果名 `heir_name`/`heir_summon`/`heir_educate`/`heir_adopt` 全程一致；派生函数名 `heirAgeMonths`/`heirStage`/`centennialDue`/`isEnrolled`/`heirPortraitSet` 在 heirs.ts 定义并在 store/UI 一致引用；`HeirInteractionPlan.portraitSet` ∈ `"child_baby"|"child_school"` 与 manifest key `portrait.child_baby`/`portrait.child_school` 对应。

**占位符扫描**：无 TODO/TBD；每个代码步骤含完整代码。唯一跨期依赖（yushufang.connections 含 fengxiandian）已在 T13 注明可暂缓、T17 补齐。

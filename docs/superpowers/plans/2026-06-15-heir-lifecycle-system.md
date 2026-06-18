# 承嗣 / 生产 / 子嗣系统（孕育生命周期）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simple「受孕→pending→选生父→怀胎」chain with a full 承嗣制 lifecycle: 敬事房候选承嗣 → 宗正寺传嗣给侍君（或帝王自孕）→ 太医流胎 → 生产（含难产四结局/提前生产）→ 子嗣落地命名嫡庶宠爱 → 产后晋升/凶讯。

**Architecture:** Pure deterministic engine logic (`gestation.ts`/`birth.ts`/`heirs.ts`) computes months, dystocia odds, outcomes, sex, favor, naming. All gameplay-state mutation flows through five new funnel effects (`heir_designate`, `pregnancy_transfer`, `pregnancy_abort`, `birth`, `child_favor`) plus a reworked `pregnancy` op. The `store/gestation.ts` layer assembles effect-batches + reaction lines for `App.tsx` to orchestrate as interception modals (same pattern as the existing `PregnancyModal`/`ReactionScreen` seams).

**Tech Stack:** TypeScript, React (no state lib — `GameStore` emitter), Zod strict schemas, Vitest, deterministic `fnv1a64Hex` randomness.

**Spec:** `docs/superpowers/specs/2026-06-15-heir-lifecycle-system-design.md`

---

## Conventions every task must follow

- **Engine purity (lint-enforced):** files under `src/engine/**` must NOT import React, `src/ui/**`, or `src/store/**`. Pure logic takes resolved config objects as parameters, never `db`.
- **Funnel is the only mutation path:** every new effect re-passes `eventEffectSchema` in `validateEffects`, validates targets against BOTH content and state, and applies in `applyEffects`. Reject-one-reject-all atomicity. `validateEffects` checks every effect against the ORIGINAL state — never assume an earlier effect in the same batch already mutated state.
- **Determinism:** all randomness via `fnv1a64Hex(seedString).slice(0,8)` → `parseInt(...,16) % N`, exactly like `src/engine/characters/conception.ts`. Never mutate `rngSeed`.
- **孕月数 anchor:** `孕月数 = monthOrdinal(now) − monthOrdinal(conceivedAt) + 1`. 受孕月=孕一月, 检出=孕二月, 传嗣最早=孕三月, 临盆=孕十月 (= conceived + 9).
- **TDD:** write the failing test, run it red, implement, run it green, commit. One commit per task.
- **Run from repo root** `/home/zhang35h/Si-Chen`. Test runner: `npx vitest run <path>`. Full gate: `npm run typecheck && npm run lint && npm test && npm run validate-content && npm run validate-manifest && npm run build`.
- Commit messages follow `feat:` / `refactor:` etc. (attribution disabled globally — no Co-Authored-By trailer).

---

## File Structure

**New engine files**
- `src/engine/characters/gestation.ts` — `gestationMonth`, `dystociaChance`, early-birth roll, planned birth month, birth AP-slot, recovery-month math.
- `src/engine/characters/birth.ts` — `resolveBirth` pure verdict (sex, dystocia outcome, favor init via 受宠 tier).
- `src/engine/characters/heirs.ts` — heir naming (大/二/三 + 皇子/皇郎), legitimacy, per-sex list derivation.

**Modified engine files**
- `src/engine/state/types.ts` — `PregnancyStatus` rename `expecting`→`carrying`; `PregnancyState.candidateIds`; `GestationState`; `Heir`; `ConsortLifecycle`; `CharacterStanding.lifecycle`/`recoverUntilMonth`; `BedchamberMode` += `companionship`; `BloodlineState.heirs: Heir[]`, `.gestation?`.
- `src/engine/content/schemas.ts` — 5 new effects + `companionship` in `bedchamber`/`bedchamberScript`; `world.gestation` config.
- `src/engine/effects/funnel.ts` — rework `pregnancy` op (begin/carry/clear) + validate & apply 5 new effects.
- `src/engine/save/stateSchema.ts` — persist `candidateIds`, `gestation`, `heirs`, `lifecycle`, `recoverUntilMonth`, `companionship`.
- `src/engine/state/newGame.ts`, `initialState.ts` — `candidateIds: []`, `heirs: []` typed.

**Modified store / new store**
- `src/store/bedchamber.ts` — companionship mode, 激情 gating, single-track conception block, deceased exclusion helper.
- `src/store/gestation.ts` (new) — `gestationConfig(db)`, `buildDesignate`/`buildTransfer`/`buildAbort`/`buildBirth` → effects + reaction lines.

**Content**
- `content/world.json` — `gestation` config + `bedchamberScript.companionship`.

**UI (new)** `src/ui/components/SuccessorModal.tsx`, `PhysicianModal.tsx`, `HeirListModal.tsx`; `src/ui/screens/BirthScreen.tsx`.
**UI (modified)** `JingshifangModal` (rename of `PregnancyModal`), `BedchamberModal`, `BedchamberPicker`, `CharacterCard`, `LocationScreen`, `App.tsx`.

---

## Task 1: State model — types, save schema, init

**Files:**
- Modify: `src/engine/state/types.ts`
- Modify: `src/engine/save/stateSchema.ts`
- Modify: `src/engine/state/newGame.ts:59-64`
- Modify: `src/engine/state/initialState.ts:20-27`
- Test: `tests/state/initialState.test.ts`, `tests/state/newGame.test.ts` (update existing assertions)

- [ ] **Step 1: Update `types.ts`** — replace lines 26–49 and 103 region.

Replace the `PregnancyStatus`/`PregnancyState` block (lines 28–36):

```ts
export type PregnancyStatus = "none" | "pending" | "carrying";

export interface PregnancyState {
  /** none=未孕/已传嗣后(健康); pending=已受孕未告知; carrying=帝王自孕中 */
  status: PregnancyStatus;
  conceivedAt?: GameTime;
  /** 候选承嗣 charIds（孕二月敬事房打标签；可为空） */
  candidateIds: string[];
}

/** 当前唯一在孕的胎息（单线孕育）。 */
export interface GestationState {
  /** "sovereign"=帝王自孕；否则承载侍君 charId */
  carrier: "sovereign" | string;
  conceivedAt: GameTime;
  /** 承嗣君 charId；自孕则不设 */
  fatherId?: string;
  /** 传嗣时的孕月（驱动难产几率）；自孕则不设 */
  transferredAtMonth?: number;
}

/** 落地子嗣。 */
export interface Heir {
  /** "heir_000001" 单调 */
  id: string;
  sex: "daughter" | "son"; // daughter→皇子(女) / son→皇郎(男)
  /** 承嗣君 charId；null=自孕 */
  fatherId: string | null;
  /** 谁承载生产；"sovereign"=自孕 */
  bearer: "sovereign" | string;
  birthAt: GameTime;
  /** 宠爱度 0–100 */
  favor: number;
  /** 嫡 */
  legitimate: boolean;
}
```

Replace `BloodlineState` (lines 38–49) `pregnancy`/`heirs` lines:

```ts
export interface BloodlineState {
  /** 宗嗣合法性 */
  legitimacy: number;
  /** 经血状态 */
  menstrualStatus: MenstrualStatus;
  /** 经血祭仪 scaffold */
  lastRiteAt?: GameTime;
  /** 帝王孕育状态 */
  pregnancy: PregnancyState;
  /** 当前在孕胎息（单线，至多一个）。 */
  gestation?: GestationState;
  /** 已落地子嗣。 */
  heirs: Heir[];
}
```

Add `ConsortLifecycle` and extend `CharacterStanding` (replace lines 66–73):

```ts
export type ConsortLifecycle = "normal" | "candidate" | "carrying" | "delivered" | "deceased";

export interface CharacterStanding {
  /** Rank id from world.json's 位分 table. */
  rank: string;
  /** 0–100 — 恩宠 (consort) / 圣眷 (official). */
  favor: number;
  /** 封号 (optional). */
  title?: string;
  /** 承嗣生命周期标记（缺省视作 "normal"）。 */
  lifecycle?: ConsortLifecycle;
  /** 产后休养（虚弱）截止月序 monthOrdinal；未达则激情不可选。 */
  recoverUntilMonth?: number;
}
```

Change `BedchamberMode` (line 103):

```ts
export type BedchamberMode = "passion" | "pleasure" | "companionship";
```

- [ ] **Step 2: Update `stateSchema.ts`** — replace the `bloodline` strictObject (lines 55–65) and the `bedchamber` encounter mode enum (line 78), and the `standing` record.

Replace bloodline block:

```ts
      bloodline: z.strictObject({
        legitimacy: percent,
        menstrualStatus: z.enum(["normal", "irregular", "absent"]),
        lastRiteAt: gameTimeSchema.optional(),
        pregnancy: z.strictObject({
          status: z.enum(["none", "pending", "carrying"]),
          conceivedAt: gameTimeSchema.optional(),
          candidateIds: z.array(idSchema),
        }),
        gestation: z
          .strictObject({
            carrier: z.union([z.literal("sovereign"), idSchema]),
            conceivedAt: gameTimeSchema,
            fatherId: idSchema.optional(),
            transferredAtMonth: z.number().int().min(1).optional(),
          })
          .optional(),
        heirs: z.array(
          z.strictObject({
            id: z.string().min(1),
            sex: z.enum(["daughter", "son"]),
            fatherId: z.union([idSchema, z.null()]),
            bearer: z.union([z.literal("sovereign"), idSchema]),
            birthAt: gameTimeSchema,
            favor: percent,
            legitimate: z.boolean(),
          }),
        ),
      }),
```

Replace the standing record (line 69) — `characterStandingSchema` itself is extended in Task 2; here just confirm the line stays `standing: z.record(idSchema, characterStandingSchema),` (no change needed, it inherits the extension).

Replace the bedchamber encounter mode (line 78):

```ts
        z.strictObject({ at: gameTimeSchema, mode: z.enum(["passion", "pleasure", "companionship"]) }),
```

- [ ] **Step 3: Update `newGame.ts`** — replace lines 59–64 bloodline literal:

```ts
      bloodline: {
        ...db.world.startingResources.bloodline,
        pregnancy: { status: "none", candidateIds: [] },
        heirs: [],
      },
```

- [ ] **Step 4: Update `initialState.ts`** — replace lines 20–27 bloodline literal:

```ts
      bloodline: {
        legitimacy: 60,
        menstrualStatus: "normal",
        pregnancy: { status: "none", candidateIds: [] },
        heirs: [],
      },
```

- [ ] **Step 5: Update the two existing init tests.** In `tests/state/initialState.test.ts:16-22` and `tests/state/newGame.test.ts:20-26`, replace the bloodline assertion object:

```ts
    expect(resources.bloodline).toEqual({
      legitimacy: 60,
      menstrualStatus: "normal",
      pregnancy: { status: "none", candidateIds: [] },
      heirs: [],
    });
```

(In `newGame.test.ts` the variable is `state.resources.bloodline` — keep that, only the object literal changes.)

- [ ] **Step 6: Typecheck — expect errors in funnel/bedchamber/App (fixed later).** Run:

```bash
npx vitest run tests/state/initialState.test.ts tests/state/newGame.test.ts
```

Expected: these two test files PASS. (Full `npm run typecheck` will still fail on `funnel.ts`/`bedchamber.ts`/`App.tsx` referencing `"expecting"` and old `fatherIds` — Tasks 6/12/14 fix those. That is expected at this point.)

- [ ] **Step 7: Commit**

```bash
git add src/engine/state/types.ts src/engine/save/stateSchema.ts src/engine/state/newGame.ts src/engine/state/initialState.ts tests/state/initialState.test.ts tests/state/newGame.test.ts
git commit -m "feat: heir lifecycle state model — gestation, heirs, consort lifecycle"
```

---

## Task 2: world.gestation config + companionship in schemas

**Files:**
- Modify: `src/engine/content/schemas.ts`
- Modify: `content/world.json`
- Test: `tests/content/worldGestation.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/content/worldGestation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";

describe("world.gestation content", () => {
  const content = loadGameContent();
  if (!content.ok) throw new Error("content failed to load");
  const g = content.value.world.gestation;

  it("loads gestation config", () => {
    expect(g).toBeDefined();
    expect(g!.termMonths).toBe(10);
    expect(g!.transferEarliestMonth).toBe(3);
    expect(g!.earlyBirth).toEqual({ month8: 10, month9: 20 });
    expect(g!.recovery).toEqual({ safeMonths: 1, dystociaMonths: 3 });
    expect(g!.dystocia.baseAtMonth3).toBe(5);
    expect(g!.dystocia.perMonthAfter).toBe(8);
    expect(g!.dystocia.outcomeSplit).toEqual({ childDies: 50, bearerDies: 30, both: 20 });
    expect(g!.childFavor.selfPregnancy).toBe(100);
    expect(g!.childFavor.fenghouBonus).toBe(30);
    expect(g!.childFavor.tierValues).toEqual({ abundant: 50, favored: 38, small: 25, fallen: 12, none: 0 });
  });

  it("loads a companionship script line", () => {
    expect(content.value.world.bedchamberScript!.companionship.lines.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/content/worldGestation.test.ts` → FAIL (`gestation` undefined / type error).

- [ ] **Step 3: Extend `characterStandingSchema`** in `schemas.ts` (replace lines 36–40):

```ts
export const characterStandingSchema = z.strictObject({
  rank: idSchema,
  favor: percent,
  title: nonEmpty.optional(),
  lifecycle: z.enum(["normal", "candidate", "carrying", "delivered", "deceased"]).optional(),
  recoverUntilMonth: z.number().int().min(1).optional(),
}) satisfies z.ZodType<CharacterStanding>;
```

- [ ] **Step 4: Add the `companionship` bedchamber mode** in the effect schema (replace lines 151–155):

```ts
  z.strictObject({
    type: z.literal("bedchamber"),
    char: idSchema,
    mode: z.enum(["passion", "pleasure", "companionship"]),
  }),
```

- [ ] **Step 5: Add `world.gestation` + companionship script** in `worldSchema` — replace the `bedchamberScript` block (lines 451–456) and append `gestation` before the closing `});`:

```ts
  /** 模板化侍寝体验台词（按 mode）。 */
  bedchamberScript: z
    .strictObject({
      passion: z.strictObject({ lines: z.array(nonEmpty).min(1).max(6) }),
      pleasure: z.strictObject({ lines: z.array(nonEmpty).min(1).max(6) }),
      companionship: z.strictObject({ lines: z.array(nonEmpty).min(1).max(6) }),
    })
    .optional(),
  /** 承嗣/生产/子嗣调参（缺省走引擎内置 fallback）。 */
  gestation: z
    .strictObject({
      termMonths: z.number().int().min(1),
      transferEarliestMonth: z.number().int().min(1),
      earlyBirth: z.strictObject({ month8: percent, month9: percent }),
      recovery: z.strictObject({ safeMonths: z.number().int().min(0), dystociaMonths: z.number().int().min(0) }),
      dystocia: z.strictObject({
        baseAtMonth3: percent,
        perMonthAfter: z.number().int().min(0),
        outcomeSplit: z.strictObject({ childDies: percent, bearerDies: percent, both: percent }),
      }),
      childFavor: z.strictObject({
        selfPregnancy: percent,
        fenghouBonus: percent,
        tierValues: z.strictObject({
          abundant: percent,
          favored: percent,
          small: percent,
          fallen: percent,
          none: percent,
        }),
      }),
    })
    .optional(),
```

- [ ] **Step 6: Add config + companionship script to `content/world.json`.** Replace the `bedchamberScript` object (currently ending the file at lines 54–68) so it gains a `companionship` array, and add a sibling `gestation` object:

```json
  "bedchamberScript": {
    "passion": {
      "lines": [
        "{name}闻召，颊上飞红，敛衽称是，缓步上前服侍帝王。",
        "帐暖香浓，{self}屏息承欢，曲意逢迎，不敢有半分懈怠。",
        "云收雨歇，陛下倦极而眠，只觉通体舒泰、神清气爽。"
      ]
    },
    "pleasure": {
      "lines": [
        "{name}奉召近前，执扇研墨、抚琴奉茶，柔声为帝王解乏。",
        "一夕清谈相伴，陛下心绪舒展，只觉神清气爽，并无他事。"
      ]
    },
    "companionship": {
      "lines": [
        "{name}近前相伴，理妆奉茶、轻声叙话，小心顾着腹中胎息，不敢劳动。",
        "一夕静好相守，陛下心绪安宁，{self}亦觉受用圣眷。"
      ]
    }
  },
  "gestation": {
    "termMonths": 10,
    "transferEarliestMonth": 3,
    "earlyBirth": { "month8": 10, "month9": 20 },
    "recovery": { "safeMonths": 1, "dystociaMonths": 3 },
    "dystocia": {
      "baseAtMonth3": 5,
      "perMonthAfter": 8,
      "outcomeSplit": { "childDies": 50, "bearerDies": 30, "both": 20 }
    },
    "childFavor": {
      "selfPregnancy": 100,
      "fenghouBonus": 30,
      "tierValues": { "abundant": 50, "favored": 38, "small": 25, "fallen": 12, "none": 0 }
    }
  }
```

(Keep the existing `bedchamber` object above it unchanged; mind the trailing commas — `bedchamber`, `bedchamberScript`, `gestation` are the last three keys of the root object.)

- [ ] **Step 7: Run green.** `npx vitest run tests/content/worldGestation.test.ts` → PASS.

- [ ] **Step 8: Validate content.** `npm run validate-content` → expect PASS (no schema errors).

- [ ] **Step 9: Commit**

```bash
git add src/engine/content/schemas.ts content/world.json tests/content/worldGestation.test.ts
git commit -m "feat: world.gestation config + companionship script & standing lifecycle schema"
```

---

## Task 3: gestation.ts — pure month/odds/slot/recovery logic

**Files:**
- Create: `src/engine/characters/gestation.ts`
- Test: `tests/characters/gestation.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/characters/gestation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";
import {
  DEFAULT_GESTATION,
  dystociaChance,
  earlyBirthHit,
  gestationMonth,
  plannedBirthMonth,
  birthSlot,
  recoverUntilMonth,
} from "../../src/engine/characters/gestation";

const at = (y: number, m: number) => makeGameTime(y, m, "early");

describe("gestationMonth (anchor +1)", () => {
  it("受孕月=孕一月, 次月=孕二月, +9月=孕十月", () => {
    const conceived = at(1, 1);
    expect(gestationMonth(at(1, 1), conceived)).toBe(1);
    expect(gestationMonth(at(1, 2), conceived)).toBe(2);
    expect(gestationMonth(at(1, 10), conceived)).toBe(10);
  });
  it("crosses the year boundary", () => {
    const conceived = at(1, 6);
    expect(gestationMonth(at(2, 3), conceived)).toBe(10);
  });
});

describe("dystociaChance", () => {
  it("孕三月=base, grows perMonthAfter, clamps 0–100", () => {
    expect(dystociaChance(3, DEFAULT_GESTATION)).toBe(5);
    expect(dystociaChance(4, DEFAULT_GESTATION)).toBe(13);
    expect(dystociaChance(9, DEFAULT_GESTATION)).toBe(53);
    expect(dystociaChance(2, DEFAULT_GESTATION)).toBe(5); // never below base
    expect(dystociaChance(99, DEFAULT_GESTATION)).toBe(100); // clamp
  });
});

describe("earlyBirthHit determinism", () => {
  it("same inputs → same result", () => {
    const a = earlyBirthHit(42, monthOrdinal(at(1, 8)), "shen", 8, DEFAULT_GESTATION);
    const b = earlyBirthHit(42, monthOrdinal(at(1, 8)), "shen", 8, DEFAULT_GESTATION);
    expect(a).toBe(b);
  });
  it("0% never, 100% always", () => {
    const cfg0 = { ...DEFAULT_GESTATION, earlyBirth: { month8: 0, month9: 0 } };
    const cfg100 = { ...DEFAULT_GESTATION, earlyBirth: { month8: 100, month9: 100 } };
    expect(earlyBirthHit(1, 5, "x", 8, cfg0)).toBe(false);
    expect(earlyBirthHit(1, 5, "x", 8, cfg100)).toBe(true);
  });
});

describe("plannedBirthMonth", () => {
  const conceived = at(1, 1); // 孕十月 = monthOrdinal(1,10)
  it("sovereign always 孕十月", () => {
    expect(plannedBirthMonth(1, conceived, "sovereign", { ...DEFAULT_GESTATION, earlyBirth: { month8: 100, month9: 100 } }))
      .toBe(monthOrdinal(at(1, 10)));
  });
  it("consort with 0% early → 孕十月", () => {
    const cfg = { ...DEFAULT_GESTATION, earlyBirth: { month8: 0, month9: 0 } };
    expect(plannedBirthMonth(1, conceived, "shen", cfg)).toBe(monthOrdinal(at(1, 10)));
  });
  it("consort with 100% month8 → 孕八月", () => {
    const cfg = { ...DEFAULT_GESTATION, earlyBirth: { month8: 100, month9: 100 } };
    expect(plannedBirthMonth(1, conceived, "shen", cfg)).toBe(monthOrdinal(at(1, 8)));
  });
});

describe("birthSlot", () => {
  it("is deterministic and within [0, apMax)", () => {
    const slot = birthSlot(7, monthOrdinal(at(1, 10)), 6);
    expect(slot).toBe(birthSlot(7, monthOrdinal(at(1, 10)), 6));
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(6);
  });
});

describe("recoverUntilMonth", () => {
  it("safe = birthMonth + safeMonths + 1; dystocia = birthMonth + dystociaMonths + 1", () => {
    const bm = monthOrdinal(at(1, 10));
    expect(recoverUntilMonth(bm, true, DEFAULT_GESTATION)).toBe(bm + 2);
    expect(recoverUntilMonth(bm, false, DEFAULT_GESTATION)).toBe(bm + 4);
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/characters/gestation.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/engine/characters/gestation.ts`:**

```ts
/**
 * 孕育生命周期纯逻辑：孕月数、难产几率、提前生产、生产月/行动点 slot、产后休养。
 * 全部确定性（fnv1a64Hex 取模，不改 rngSeed）。配置由调用方传入（保持引擎纯净）。
 */
import { fnv1a64Hex } from "../save/canonical";
import { monthOrdinal, type GameTime } from "../calendar/time";

export interface GestationConfig {
  termMonths: number;
  transferEarliestMonth: number;
  earlyBirth: { month8: number; month9: number };
  recovery: { safeMonths: number; dystociaMonths: number };
  dystocia: {
    baseAtMonth3: number;
    perMonthAfter: number;
    outcomeSplit: { childDies: number; bearerDies: number; both: number };
  };
  childFavor: {
    selfPregnancy: number;
    fenghouBonus: number;
    tierValues: { abundant: number; favored: number; small: number; fallen: number; none: number };
  };
}

export const DEFAULT_GESTATION: GestationConfig = {
  termMonths: 10,
  transferEarliestMonth: 3,
  earlyBirth: { month8: 10, month9: 20 },
  recovery: { safeMonths: 1, dystociaMonths: 3 },
  dystocia: { baseAtMonth3: 5, perMonthAfter: 8, outcomeSplit: { childDies: 50, bearerDies: 30, both: 20 } },
  childFavor: {
    selfPregnancy: 100,
    fenghouBonus: 30,
    tierValues: { abundant: 50, favored: 38, small: 25, fallen: 12, none: 0 },
  },
};

const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

/** 确定性 0–99 取模 roll。 */
export function gestationRoll(seedString: string): number {
  return parseInt(fnv1a64Hex(seedString).slice(0, 8), 16) % 100;
}

/** 孕月数（受孕月=1）。 */
export function gestationMonth(now: Pick<GameTime, "year" | "month">, conceivedAt: Pick<GameTime, "year" | "month">): number {
  return monthOrdinal(now) - monthOrdinal(conceivedAt) + 1;
}

/** 难产几率：base + max(0, atMonth−3)*perMonthAfter，钳 0–100。 */
export function dystociaChance(transferredAtMonth: number, cfg: GestationConfig): number {
  return clampPct(cfg.dystocia.baseAtMonth3 + Math.max(0, transferredAtMonth - 3) * cfg.dystocia.perMonthAfter);
}

/** 提前生产命中判定（孕八月用 month8，孕九月用 month9；其它月不判定）。 */
export function earlyBirthHit(
  rngSeed: number,
  birthMonthOrdinal: number,
  carrierId: string,
  gestMonth: 8 | 9,
  cfg: GestationConfig,
): boolean {
  const chance = gestMonth === 8 ? cfg.earlyBirth.month8 : cfg.earlyBirth.month9;
  if (chance <= 0) return false;
  if (chance >= 100) return true;
  return gestationRoll(`early:${rngSeed}:${birthMonthOrdinal}:${carrierId}:${gestMonth}`) < chance;
}

/**
 * 确定的生产月（monthOrdinal）。自孕固定孕十月；承嗣君孕八/九月各判一次提前。
 * carrier="sovereign" 或承载侍君 charId。
 */
export function plannedBirthMonth(
  rngSeed: number,
  conceivedAt: Pick<GameTime, "year" | "month">,
  carrier: string,
  cfg: GestationConfig,
): number {
  const base = monthOrdinal(conceivedAt);
  const term = base + (cfg.termMonths - 1); // 孕十月
  if (carrier === "sovereign") return term;
  const month8 = base + 7;
  const month9 = base + 8;
  if (earlyBirthHit(rngSeed, month8, carrier, 8, cfg)) return month8;
  if (earlyBirthHit(rngSeed, month9, carrier, 9, cfg)) return month9;
  return term;
}

/** 生产当月的确定性行动点 slot（0..apMax−1）。 */
export function birthSlot(rngSeed: number, birthMonthOrdinal: number, apMax: number): number {
  return gestationRoll(`birthslot:${rngSeed}:${birthMonthOrdinal}`) % apMax;
}

/** 产后休养截止月序：安产 +safeMonths+1；难产存活 +dystociaMonths+1（截止月当月仍虚弱）。 */
export function recoverUntilMonth(birthMonthOrdinal: number, safe: boolean, cfg: GestationConfig): number {
  const months = safe ? cfg.recovery.safeMonths : cfg.recovery.dystociaMonths;
  return birthMonthOrdinal + months + 1;
}
```

> Recovery math: 休养在 `monthOrdinal(now) < recoverUntilMonth` 时生效。安产 `safeMonths=1` ⇒ `recoverUntilMonth = bm+2`：生产次月(bm+1)虚弱、bm+2 恢复。难产存活 `dystociaMonths=3` ⇒ `bm+4`：bm+1..bm+3 虚弱。

- [ ] **Step 4: Run green.** `npx vitest run tests/characters/gestation.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/gestation.ts tests/characters/gestation.test.ts
git commit -m "feat: gestation pure logic — month anchor, dystocia odds, early birth, slot, recovery"
```

---

## Task 4: birth.ts — pure delivery verdict

**Files:**
- Create: `src/engine/characters/birth.ts`
- Test: `tests/characters/birth.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/characters/birth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";
import { DEFAULT_GESTATION } from "../../src/engine/characters/gestation";
import { DEFAULT_TIERS } from "../../src/engine/characters/favorTier";
import { resolveBirth } from "../../src/engine/characters/birth";
import type { BedchamberRecord } from "../../src/engine/state/types";

const now = makeGameTime(1, 10, "early);
const emptyRecord: BedchamberRecord = { encounters: [] };

describe("resolveBirth — self pregnancy", () => {
  it("safe, fatherId null, legitimate, favor=100", () => {
    const v = resolveBirth({
      rngSeed: 1,
      now,
      carrier: "sovereign",
      fatherId: null,
      transferredAtMonth: undefined,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord,
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    });
    expect(v.bearerOutcome).toBe("safe");
    expect(v.fatherId).toBeNull();
    expect(v.legitimate).toBe(true);
    expect(v.favor).toBe(100);
    expect(v.sex === "daughter" || v.sex === "son").toBe(true);
  });
});

describe("resolveBirth — consort carrier", () => {
  it("transfer at month 3 (5% dystocia) is usually safe; favor from tier none=0", () => {
    const v = resolveBirth({
      rngSeed: 1,
      now,
      carrier: "shen_chenghui",
      fatherId: "shen_chenghui",
      transferredAtMonth: 3,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord, // no encounters → tier none → 0
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    });
    expect(v.fatherId).toBe("shen_chenghui");
    expect(v.legitimate).toBe(false);
    if (v.bearerOutcome === "safe") expect(v.favor).toBe(0);
  });

  it("fenghou bearer adds +30 (capped 80) and is legitimate", () => {
    const v = resolveBirth({
      rngSeed: 1,
      now,
      carrier: "feng_hou",
      fatherId: "feng_hou",
      transferredAtMonth: 3,
      bearerIsFenghou: true,
      carrierRecord: emptyRecord, // tier none=0 → +30 = 30
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    });
    expect(v.legitimate).toBe(true);
    if (v.bearerOutcome === "safe") expect(v.favor).toBe(30);
  });

  it("100% dystocia yields a non-safe outcome from the split", () => {
    const cfg = { ...DEFAULT_GESTATION, dystocia: { ...DEFAULT_GESTATION.dystocia, baseAtMonth3: 100 } };
    const v = resolveBirth({
      rngSeed: 5,
      now,
      carrier: "shen_chenghui",
      fatherId: "shen_chenghui",
      transferredAtMonth: 3,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord,
      thresholds: DEFAULT_TIERS,
      cfg,
    });
    expect(["child_dies", "bearer_dies", "both"]).toContain(v.bearerOutcome);
  });

  it("is deterministic", () => {
    const input = {
      rngSeed: 9,
      now,
      carrier: "shen_chenghui",
      fatherId: "shen_chenghui",
      transferredAtMonth: 6,
      bearerIsFenghou: false,
      carrierRecord: emptyRecord,
      thresholds: DEFAULT_TIERS,
      cfg: DEFAULT_GESTATION,
    } as const;
    expect(resolveBirth(input)).toEqual(resolveBirth(input));
  });
});
```

> Note: fix the obvious typo when you create the file — `makeGameTime(1, 10, "early")` (closing quote).

- [ ] **Step 2: Run it red.** `npx vitest run tests/characters/birth.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/engine/characters/birth.ts`:**

```ts
/**
 * 生产裁决（纯函数，确定性）：性别、难产结局、子嗣宠爱初值。
 * 帝王自孕（carrier="sovereign"）永不难产。宠爱按生产当月承载侍君的受宠程度派生。
 */
import { monthOrdinal, type GameTime } from "../calendar/time";
import { computeFavorStats, type BedchamberThresholds, type FavorTier } from "./favorTier";
import { dystociaChance, gestationRoll, type GestationConfig } from "./gestation";
import type { BedchamberRecord } from "../state/types";

export type BearerOutcome = "safe" | "child_dies" | "bearer_dies" | "both";
export type HeirSex = "daughter" | "son";

export interface BirthInput {
  rngSeed: number;
  now: GameTime;
  carrier: "sovereign" | string;
  fatherId: string | null;
  transferredAtMonth: number | undefined;
  bearerIsFenghou: boolean;
  /** 承载侍君的侍寝日志（自孕传 undefined）。 */
  carrierRecord: BedchamberRecord | undefined;
  thresholds: BedchamberThresholds;
  cfg: GestationConfig;
}

export interface BirthVerdict {
  sex: HeirSex;
  fatherId: string | null;
  bearer: "sovereign" | string;
  legitimate: boolean;
  favor: number;
  bearerOutcome: BearerOutcome;
}

const FENGHOU_CAP = 80;

function tierValue(tier: FavorTier, cfg: GestationConfig): number {
  return cfg.childFavor.tierValues[tier];
}

function pickOutcome(roll: number, cfg: GestationConfig): Exclude<BearerOutcome, "safe"> {
  const { childDies, bearerDies } = cfg.dystocia.outcomeSplit;
  if (roll < childDies) return "child_dies";
  if (roll < childDies + bearerDies) return "bearer_dies";
  return "both";
}

export function resolveBirth(input: BirthInput): BirthVerdict {
  const { rngSeed, now, carrier, fatherId, transferredAtMonth, bearerIsFenghou } = input;
  const bm = monthOrdinal(now);

  const sex: HeirSex = gestationRoll(`sex:${rngSeed}:${bm}:${carrier}`) % 2 === 0 ? "daughter" : "son";
  const legitimate = bearerIsFenghou || carrier === "sovereign";

  // 宠爱初值
  let favor: number;
  if (carrier === "sovereign") {
    favor = input.cfg.childFavor.selfPregnancy;
  } else {
    const stats = computeFavorStats(input.carrierRecord, now, input.thresholds);
    favor = tierValue(stats.tier, input.cfg);
    if (bearerIsFenghou) favor = Math.min(FENGHOU_CAP, favor + input.cfg.childFavor.fenghouBonus);
  }

  // 难产裁决（自孕不判定）
  let bearerOutcome: BearerOutcome = "safe";
  if (carrier !== "sovereign") {
    const chance = dystociaChance(transferredAtMonth ?? input.cfg.transferEarliestMonth, input.cfg);
    const hit = chance > 0 && gestationRoll(`dystocia:${rngSeed}:${bm}:${carrier}`) < chance;
    if (hit) bearerOutcome = pickOutcome(gestationRoll(`outcome:${rngSeed}:${bm}:${carrier}`), input.cfg);
  }

  return { sex, fatherId, bearer: carrier, legitimate, favor, bearerOutcome };
}
```

- [ ] **Step 4: Run green.** `npx vitest run tests/characters/birth.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/birth.ts tests/characters/birth.test.ts
git commit -m "feat: birth verdict pure logic — sex, dystocia outcome, favor by 受宠 tier"
```

---

## Task 5: heirs.ts — naming + list derivation

**Files:**
- Create: `src/engine/characters/heirs.ts`
- Test: `tests/characters/heirs.test.ts`

- [ ] **Step 1: Write the failing test** — `tests/characters/heirs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import { heirName, heirAge, nextHeirId, listHeirsBySex } from "../../src/engine/characters/heirs";
import type { Heir } from "../../src/engine/state/types";

const heir = (over: Partial<Heir>): Heir => ({
  id: "heir_000001",
  sex: "daughter",
  fatherId: null,
  bearer: "sovereign",
  birthAt: makeGameTime(1, 5, "early"),
  favor: 50,
  legitimate: true,
  ...over,
});

describe("heirName", () => {
  it("ordinal 1→大, 2→二, 3→三 with 皇子/皇郎", () => {
    expect(heirName("daughter", 1)).toBe("大皇子");
    expect(heirName("daughter", 2)).toBe("二皇子");
    expect(heirName("son", 1)).toBe("大皇郎");
    expect(heirName("son", 3)).toBe("三皇郎");
  });
});

describe("listHeirsBySex", () => {
  it("orders by birth and numbers each sex table independently", () => {
    const heirs: Heir[] = [
      heir({ id: "heir_000001", sex: "daughter", birthAt: makeGameTime(1, 2, "early") }),
      heir({ id: "heir_000002", sex: "son", birthAt: makeGameTime(1, 3, "early") }),
      heir({ id: "heir_000003", sex: "daughter", birthAt: makeGameTime(1, 1, "early") }),
    ];
    const daughters = listHeirsBySex(heirs, "daughter");
    expect(daughters.map((h) => h.name)).toEqual(["大皇子", "二皇子"]);
    expect(daughters[0]!.heir.id).toBe("heir_000003"); // earliest birth first
    const sons = listHeirsBySex(heirs, "son");
    expect(sons.map((h) => h.name)).toEqual(["大皇郎"]);
  });
});

describe("heirAge", () => {
  it("birth year = 0 岁; later year subtracts", () => {
    expect(heirAge(heir({ birthAt: makeGameTime(1, 5, "early") }), makeGameTime(1, 12, "late"))).toBe(0);
    expect(heirAge(heir({ birthAt: makeGameTime(1, 5, "early") }), makeGameTime(3, 1, "early"))).toBe(2);
  });
});

describe("nextHeirId", () => {
  it("pads to 6 digits from current count", () => {
    expect(nextHeirId(0)).toBe("heir_000001");
    expect(nextHeirId(11)).toBe("heir_000012");
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/characters/heirs.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/engine/characters/heirs.ts`:**

```ts
/**
 * 子嗣命名 / 年龄 / 列表派生（纯逻辑）。两表（皇子=女 / 皇郎=男）各按出生序独立编号，
 * 1→大、≥2→中文数字。id 单调（heir_NNNNNN）。
 */
import { chineseNumeral, monthOrdinal, type GameTime } from "../calendar/time";
import type { Heir, HeirSex } from "../state/types";

const SEX_NOUN: Record<HeirSex, string> = { daughter: "皇子", son: "皇郎" };

/** ordinal 1-based → 大皇子 / 二皇郎 …。 */
export function heirName(sex: HeirSex, ordinal: number): string {
  const prefix = ordinal === 1 ? "大" : chineseNumeral(ordinal);
  return `${prefix}${SEX_NOUN[sex]}`;
}

export interface NamedHeir {
  heir: Heir;
  name: string;
  ordinal: number;
}

/** 某性别的子嗣，按出生序（dayIndex）升序编号。 */
export function listHeirsBySex(heirs: readonly Heir[], sex: HeirSex): NamedHeir[] {
  return heirs
    .filter((h) => h.sex === sex)
    .sort((a, b) => a.birthAt.dayIndex - b.birthAt.dayIndex)
    .map((heir, i) => ({ heir, name: heirName(sex, i + 1), ordinal: i + 1 }));
}

/** 周岁：出生当年记 0 岁，按年份差。 */
export function heirAge(heir: Heir, now: Pick<GameTime, "year">): number {
  return now.year - heir.birthAt.year;
}

/** 下一个子嗣 id（heirs 仅追加，故按当前数量递增）。 */
export function nextHeirId(currentCount: number): string {
  return `heir_${String(currentCount + 1).padStart(6, "0")}`;
}

/** monthOrdinal re-export convenience (keeps callers off calendar import when only listing). */
export { monthOrdinal };
```

> Add `HeirSex` to `types.ts` exports: in Task 1 the `Heir.sex` is inline `"daughter" | "son"`. Add `export type HeirSex = "daughter" | "son";` near the `Heir` interface in `types.ts` and change `Heir.sex: HeirSex`. Do this small edit now (it is referenced by `heirs.ts` and `birth.ts`). If `birth.ts` already declared its own `HeirSex`, import it from `types.ts` instead and delete the local one to avoid duplication.

- [ ] **Step 4: Reconcile `HeirSex`.** Edit `src/engine/state/types.ts`: add `export type HeirSex = "daughter" | "son";` above `interface Heir`, and change `sex: "daughter" | "son";` to `sex: HeirSex;`. Edit `src/engine/characters/birth.ts`: replace `export type HeirSex = "daughter" | "son";` with `import type { HeirSex } from "../state/types";` (add to the existing type import line) and remove the local declaration; keep `BirthVerdict.sex: HeirSex`.

- [ ] **Step 5: Run green.** `npx vitest run tests/characters/heirs.test.ts tests/characters/birth.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/characters/heirs.ts src/engine/characters/birth.ts src/engine/state/types.ts tests/characters/heirs.test.ts
git commit -m "feat: heir naming, age, list derivation (皇子/皇郎 independent ordinals)"
```

---

## Task 6: funnel — rework `pregnancy` op (begin/carry/clear) + GestationState

**Files:**
- Modify: `src/engine/content/schemas.ts:156-160`
- Modify: `src/engine/effects/funnel.ts:109-133` (validate), `222-236` (apply)
- Modify: `tests/effects/funnel.bedchamber.test.ts` (the `funnel: pregnancy` describe block)

- [ ] **Step 1: Update the `pregnancy` effect schema** (`schemas.ts` lines 156–160):

```ts
  z.strictObject({
    type: z.literal("pregnancy"),
    op: z.enum(["begin", "carry", "clear"]),
  }),
```

- [ ] **Step 2: Update funnel validation** — replace the `case "pregnancy"` block in `validateEffects` (`funnel.ts` lines 109–133):

```ts
      case "pregnancy": {
        const status = state.resources.bloodline.pregnancy.status;
        if (e.op === "begin" && status !== "none") {
          bad(index, "BAD_EFFECT", `pregnancy begin requires status "none", got "${status}"`, { status });
        } else if (e.op === "carry" && status !== "pending") {
          bad(index, "BAD_EFFECT", `pregnancy carry requires status "pending", got "${status}"`, { status });
        }
        break;
      }
```

- [ ] **Step 3: Update funnel apply** — replace the `case "pregnancy"` block in `applyEffects` (`funnel.ts` lines 222–236):

```ts
      case "pregnancy": {
        const p = next.resources.bloodline.pregnancy;
        if (effect.op === "begin") {
          next.resources.bloodline.pregnancy = { status: "pending", conceivedAt: now, candidateIds: [] };
        } else if (effect.op === "carry") {
          // pending → carrying: 帝王自孕，建单线 gestation。
          next.resources.bloodline.pregnancy = {
            status: "carrying",
            ...(p.conceivedAt !== undefined ? { conceivedAt: p.conceivedAt } : {}),
            candidateIds: [...p.candidateIds],
          };
          if (p.conceivedAt !== undefined) {
            next.resources.bloodline.gestation = { carrier: "sovereign", conceivedAt: p.conceivedAt };
          }
        } else {
          next.resources.bloodline.pregnancy = { status: "none", candidateIds: [] };
          delete next.resources.bloodline.gestation;
        }
        break;
      }
```

- [ ] **Step 4: Update the `funnel: pregnancy` tests** in `tests/effects/funnel.bedchamber.test.ts` — replace the whole `describe("funnel: pregnancy", ...)` block (lines 30–94) with:

```ts
describe("funnel: pregnancy", () => {
  it("begin → pending with conceivedAt + empty candidateIds", () => {
    const state = createNewGameState(db);
    const r = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.value.resources.bloodline.pregnancy;
    expect(p.status).toBe("pending");
    expect(p.conceivedAt?.month).toBe(state.calendar.month);
    expect(p.candidateIds).toEqual([]);
  });

  it("carry → carrying + sovereign gestation, keeps conceivedAt", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    const r = applyEffects(db, begun.value, [{ type: "pregnancy", op: "carry" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy.status).toBe("carrying");
    expect(r.value.resources.bloodline.gestation).toEqual({
      carrier: "sovereign",
      conceivedAt: begun.value.resources.bloodline.pregnancy.conceivedAt,
    });
  });

  it("rejects begin when not none, carry when not pending", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(validateEffects(db, begun.value, [{ type: "pregnancy", op: "begin" }])).toHaveLength(1);
    expect(validateEffects(db, state, [{ type: "pregnancy", op: "carry" }])).toHaveLength(1);
  });

  it("clear resets to none and drops gestation", () => {
    const state = createNewGameState(db);
    const begun = applyEffects(db, state, [{ type: "pregnancy", op: "begin" }]);
    if (!begun.ok) return;
    const carried = applyEffects(db, begun.value, [{ type: "pregnancy", op: "carry" }]);
    if (!carried.ok) return;
    const r = applyEffects(db, carried.value, [{ type: "pregnancy", op: "clear" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy).toEqual({ status: "none", candidateIds: [] });
    expect(r.value.resources.bloodline.gestation).toBeUndefined();
  });
});
```

- [ ] **Step 5: Run green.** `npx vitest run tests/effects/funnel.bedchamber.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.bedchamber.test.ts
git commit -m "refactor: pregnancy op begin/carry/clear + sovereign gestation (replaces confirm/expecting)"
```

---

## Task 7: funnel — `heir_designate` effect

**Files:**
- Modify: `src/engine/content/schemas.ts` (effect union)
- Modify: `src/engine/effects/funnel.ts` (validate + apply)
- Test: `tests/effects/funnel.heir.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/effects/funnel.heir.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("funnel: heir_designate", () => {
  it("tags consorts candidate + records candidateIds", () => {
    const state = createNewGameState(db);
    const r = applyEffects(db, state, [{ type: "heir_designate", charIds: ["shen_chenghui", "feng_hou"] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("candidate");
    expect(r.value.standing.feng_hou!.lifecycle).toBe("candidate");
    expect(r.value.resources.bloodline.pregnancy.candidateIds).toEqual(["shen_chenghui", "feng_hou"]);
  });

  it("rejects an official or unknown target", () => {
    const state = createNewGameState(db);
    expect(validateEffects(db, state, [{ type: "heir_designate", charIds: ["sili_nvguan"] }])).toHaveLength(1);
    expect(validateEffects(db, state, [{ type: "heir_designate", charIds: ["nobody"] }])).toHaveLength(1);
  });

  it("rejects a deceased consort", () => {
    const state = createNewGameState(db);
    state.standing.shen_chenghui!.lifecycle = "deceased";
    expect(validateEffects(db, state, [{ type: "heir_designate", charIds: ["shen_chenghui"] }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/effects/funnel.heir.test.ts` → FAIL.

- [ ] **Step 3: Add the effect schema.** In `schemas.ts`, inside the `eventEffectSchema` union (after the `pregnancy` entry), add:

```ts
  z.strictObject({ type: z.literal("heir_designate"), charIds: z.array(idSchema).min(1).max(8) }),
```

- [ ] **Step 4: Add validation.** In `funnel.ts` `validateEffects` switch, add a case:

```ts
      case "heir_designate": {
        for (const id of e.charIds) {
          const ch = db.characters[id];
          const st = state.standing[id];
          if (!ch || ch.kind !== "consort" || !st) {
            bad(index, "BAD_EFFECT_TARGET", `heir_designate needs a consort with standing: "${id}"`, { char: id });
          } else if (st.lifecycle === "deceased") {
            bad(index, "BAD_EFFECT_TARGET", `cannot designate a deceased consort: "${id}"`, { char: id });
          }
        }
        break;
      }
```

- [ ] **Step 5: Add apply.** In `funnel.ts` `applyEffects` switch, add a case:

```ts
      case "heir_designate": {
        for (const id of effect.charIds) next.standing[id]!.lifecycle = "candidate";
        next.resources.bloodline.pregnancy.candidateIds = [...effect.charIds];
        break;
      }
```

- [ ] **Step 6: Run green.** `npx vitest run tests/effects/funnel.heir.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.heir.test.ts
git commit -m "feat: heir_designate effect — tag 候选承嗣"
```

---

## Task 8: funnel — `pregnancy_transfer` effect

**Files:**
- Modify: `src/engine/content/schemas.ts`, `src/engine/effects/funnel.ts`
- Test: `tests/effects/funnel.transfer.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/effects/funnel.transfer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

/** helper: bring the sovereign to status carrying (self-pregnancy). */
function carrying() {
  const s0 = createNewGameState(db);
  const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
  if (!a.ok) throw new Error("begin failed");
  const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
  if (!b.ok) throw new Error("carry failed");
  return b.value;
}

describe("funnel: pregnancy_transfer", () => {
  it("moves carrier to consort, sets status none + lifecycle carrying", () => {
    const state = carrying();
    const r = applyEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy.status).toBe("none");
    expect(r.value.resources.bloodline.gestation).toEqual({
      carrier: "shen_chenghui",
      fatherId: "shen_chenghui",
      transferredAtMonth: 3,
      conceivedAt: state.resources.bloodline.gestation!.conceivedAt,
    });
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("carrying");
  });

  it("rejects when sovereign is not carrying", () => {
    const state = createNewGameState(db); // status none, no gestation
    expect(validateEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }])).toHaveLength(1);
  });

  it("rejects a deceased / non-consort carrier", () => {
    const state = carrying();
    state.standing.shen_chenghui!.lifecycle = "deceased";
    expect(validateEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }])).toHaveLength(1);
    expect(validateEffects(db, state, [{ type: "pregnancy_transfer", carrierId: "sili_nvguan", atMonth: 3 }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/effects/funnel.transfer.test.ts` → FAIL.

- [ ] **Step 3: Add schema.** In `schemas.ts` union add:

```ts
  z.strictObject({
    type: z.literal("pregnancy_transfer"),
    carrierId: idSchema,
    atMonth: z.number().int().min(1),
  }),
```

- [ ] **Step 4: Add validation** in `funnel.ts`:

```ts
      case "pregnancy_transfer": {
        const ch = db.characters[e.carrierId];
        const st = state.standing[e.carrierId];
        const preg = state.resources.bloodline.pregnancy;
        const gest = state.resources.bloodline.gestation;
        if (!ch || ch.kind !== "consort" || !st) {
          bad(index, "BAD_EFFECT_TARGET", `pregnancy_transfer needs a consort with standing: "${e.carrierId}"`, { char: e.carrierId });
        } else if (st.lifecycle === "deceased") {
          bad(index, "BAD_EFFECT_TARGET", `cannot transfer to a deceased consort: "${e.carrierId}"`, { char: e.carrierId });
        } else if (preg.status !== "carrying" || gest?.carrier !== "sovereign") {
          bad(index, "BAD_EFFECT", `pregnancy_transfer requires sovereign self-pregnancy`, { status: preg.status });
        }
        break;
      }
```

- [ ] **Step 5: Add apply** in `funnel.ts`:

```ts
      case "pregnancy_transfer": {
        const gest = next.resources.bloodline.gestation!;
        next.resources.bloodline.pregnancy = { status: "none", candidateIds: [] };
        next.resources.bloodline.gestation = {
          carrier: effect.carrierId,
          conceivedAt: gest.conceivedAt,
          fatherId: effect.carrierId,
          transferredAtMonth: effect.atMonth,
        };
        next.standing[effect.carrierId]!.lifecycle = "carrying";
        break;
      }
```

- [ ] **Step 6: Run green.** `npx vitest run tests/effects/funnel.transfer.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.transfer.test.ts
git commit -m "feat: pregnancy_transfer effect — 传嗣给承嗣君"
```

---

## Task 9: funnel — `pregnancy_abort` effect

**Files:**
- Modify: `src/engine/content/schemas.ts`, `src/engine/effects/funnel.ts`
- Test: `tests/effects/funnel.abort.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/effects/funnel.abort.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function carrying() {
  const s0 = createNewGameState(db);
  const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
  if (!a.ok) throw new Error();
  const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
  if (!b.ok) throw new Error();
  return b.value;
}

describe("funnel: pregnancy_abort", () => {
  it("clears self-pregnancy", () => {
    const r = applyEffects(db, carrying(), [{ type: "pregnancy_abort" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.pregnancy).toEqual({ status: "none", candidateIds: [] });
    expect(r.value.resources.bloodline.gestation).toBeUndefined();
  });

  it("rejects when carrier is a consort (承养不可弃)", () => {
    const transferred = applyEffects(db, carrying(), [
      { type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 },
    ]);
    if (!transferred.ok) return;
    expect(validateEffects(db, transferred.value, [{ type: "pregnancy_abort" }])).toHaveLength(1);
  });

  it("rejects when not pregnant", () => {
    expect(validateEffects(db, createNewGameState(db), [{ type: "pregnancy_abort" }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/effects/funnel.abort.test.ts` → FAIL.

- [ ] **Step 3: Add schema.** In `schemas.ts` union add:

```ts
  z.strictObject({ type: z.literal("pregnancy_abort") }),
```

- [ ] **Step 4: Add validation** in `funnel.ts`:

```ts
      case "pregnancy_abort": {
        const gest = state.resources.bloodline.gestation;
        if (!gest || gest.carrier !== "sovereign") {
          bad(index, "BAD_EFFECT", `pregnancy_abort requires sovereign self-pregnancy`, {});
        }
        break;
      }
```

- [ ] **Step 5: Add apply** in `funnel.ts`:

```ts
      case "pregnancy_abort": {
        next.resources.bloodline.pregnancy = { status: "none", candidateIds: [] };
        delete next.resources.bloodline.gestation;
        break;
      }
```

- [ ] **Step 6: Run green.** `npx vitest run tests/effects/funnel.abort.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.abort.test.ts
git commit -m "feat: pregnancy_abort effect — 自孕流胎（承养不可弃）"
```

---

## Task 10: funnel — `birth` effect

**Files:**
- Modify: `src/engine/content/schemas.ts`, `src/engine/effects/funnel.ts`
- Test: `tests/effects/funnel.birth.test.ts` (new)

The `birth` effect carries the precomputed verdict (sex, fatherId, bearer, legitimate, favor, bearerOutcome) plus `recoverUntilMonth`. The funnel: (a) appends an `Heir` iff the child survives (`safe`/`bearer_dies`); (b) migrates the carrier consort's lifecycle (`delivered`/`normal`/`deceased`) + `recoverUntilMonth`; (c) clears `gestation` and resets `pregnancy` to none.

Child-survival by outcome: `safe`→survives, `bearer_dies`→survives, `child_dies`→dies, `both`→dies. Bearer-survival: `safe`/`child_dies`→lives, `bearer_dies`/`both`→dies. Sovereign self-pregnancy is always `safe`.

- [ ] **Step 1: Write the failing test** — `tests/effects/funnel.birth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function consortCarrying(): GameState {
  const s0 = createNewGameState(db);
  const a = applyEffects(db, s0, [{ type: "pregnancy", op: "begin" }]);
  if (!a.ok) throw new Error();
  const b = applyEffects(db, a.value, [{ type: "pregnancy", op: "carry" }]);
  if (!b.ok) throw new Error();
  const c = applyEffects(db, b.value, [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }]);
  if (!c.ok) throw new Error();
  return c.value;
}

const baseBirth = {
  type: "birth" as const,
  sex: "daughter" as const,
  fatherId: "shen_chenghui",
  bearer: "shen_chenghui",
  legitimate: false,
  favor: 25,
  recoverUntilMonth: 20,
};

describe("funnel: birth", () => {
  it("safe → appends heir, carrier delivered + recoverUntilMonth, gestation cleared", () => {
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "safe" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const heirs = r.value.resources.bloodline.heirs;
    expect(heirs).toHaveLength(1);
    expect(heirs[0]!.id).toBe("heir_000001");
    expect(heirs[0]!.favor).toBe(25);
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("delivered");
    expect(r.value.standing.shen_chenghui!.recoverUntilMonth).toBe(20);
    expect(r.value.resources.bloodline.gestation).toBeUndefined();
  });

  it("child_dies → no heir, carrier normal", () => {
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "child_dies" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(0);
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("normal");
  });

  it("bearer_dies → heir survives, carrier deceased (no recovery)", () => {
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "bearer_dies" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(1);
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("deceased");
    expect(r.value.standing.shen_chenghui!.recoverUntilMonth).toBeUndefined();
  });

  it("both → no heir, carrier deceased", () => {
    const r = applyEffects(db, consortCarrying(), [{ ...baseBirth, bearerOutcome: "both" }]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs).toHaveLength(0);
    expect(r.value.standing.shen_chenghui!.lifecycle).toBe("deceased");
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/effects/funnel.birth.test.ts` → FAIL.

- [ ] **Step 3: Add schema.** In `schemas.ts` union add:

```ts
  z.strictObject({
    type: z.literal("birth"),
    sex: z.enum(["daughter", "son"]),
    fatherId: z.union([idSchema, z.null()]),
    bearer: z.union([z.literal("sovereign"), idSchema]),
    legitimate: z.boolean(),
    favor: percent,
    bearerOutcome: z.enum(["safe", "child_dies", "bearer_dies", "both"]),
    recoverUntilMonth: z.number().int().min(1).optional(),
  }),
```

- [ ] **Step 4: Add validation** in `funnel.ts` (structural: bearer/father must be valid when not sovereign/null):

```ts
      case "birth": {
        if (e.bearer !== "sovereign" && (!db.characters[e.bearer] || !state.standing[e.bearer])) {
          bad(index, "BAD_EFFECT_TARGET", `birth bearer is not a consort with standing: "${e.bearer}"`, { char: e.bearer });
        }
        if (e.fatherId !== null && (!db.characters[e.fatherId] || db.characters[e.fatherId]!.kind !== "consort")) {
          bad(index, "BAD_EFFECT_TARGET", `birth fatherId is not a consort: "${e.fatherId}"`, { char: e.fatherId });
        }
        break;
      }
```

- [ ] **Step 5: Add apply** in `funnel.ts` — add the import `nextHeirId` at the top (`import { nextHeirId } from "../characters/heirs";`), then:

```ts
      case "birth": {
        const bl = next.resources.bloodline;
        const childSurvives = effect.bearerOutcome === "safe" || effect.bearerOutcome === "bearer_dies";
        const bearerSurvives = effect.bearerOutcome === "safe" || effect.bearerOutcome === "child_dies";
        if (childSurvives) {
          bl.heirs.push({
            id: nextHeirId(bl.heirs.length),
            sex: effect.sex,
            fatherId: effect.fatherId,
            bearer: effect.bearer,
            birthAt: now,
            favor: effect.favor,
            legitimate: effect.legitimate,
          });
        }
        if (effect.bearer !== "sovereign") {
          const st = next.standing[effect.bearer]!;
          if (!bearerSurvives) {
            st.lifecycle = "deceased";
            delete st.recoverUntilMonth;
          } else if (effect.bearerOutcome === "safe") {
            st.lifecycle = "delivered";
            if (effect.recoverUntilMonth !== undefined) st.recoverUntilMonth = effect.recoverUntilMonth;
          } else {
            // child_dies, bearer survives → 不晋升，回 normal，难产三月休养
            st.lifecycle = "normal";
            if (effect.recoverUntilMonth !== undefined) st.recoverUntilMonth = effect.recoverUntilMonth;
          }
        }
        bl.pregnancy = { status: "none", candidateIds: [] };
        delete bl.gestation;
        break;
      }
```

- [ ] **Step 6: Run green.** `npx vitest run tests/effects/funnel.birth.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.birth.test.ts
git commit -m "feat: birth effect — heir landing, carrier lifecycle migration, gestation clear"
```

---

## Task 11: funnel — `child_favor` effect

**Files:**
- Modify: `src/engine/content/schemas.ts`, `src/engine/effects/funnel.ts`
- Test: `tests/effects/funnel.childfavor.test.ts` (new)

- [ ] **Step 1: Write the failing test** — `tests/effects/funnel.childfavor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function withHeir(favor = 50): GameState {
  const s = createNewGameState(db);
  s.resources.bloodline.heirs.push({
    id: "heir_000001",
    sex: "daughter",
    fatherId: null,
    bearer: "sovereign",
    birthAt: { year: 1, month: 5, period: "early", dayIndex: 12 },
    favor,
    legitimate: true,
  });
  return s;
}

describe("funnel: child_favor", () => {
  it("adjusts and clamps 0–100", () => {
    const r = applyEffects(db, withHeir(50), [{ type: "child_favor", heirId: "heir_000001", delta: 10 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(60);
  });

  it("caps the per-batch delta at ±10", () => {
    const r = applyEffects(db, withHeir(50), [
      { type: "child_favor", heirId: "heir_000001", delta: 10 },
      { type: "child_favor", heirId: "heir_000001", delta: 10 },
    ]);
    if (!r.ok) return;
    expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(60); // 10 cumulative cap
  });

  it("rejects an unknown heir id", () => {
    expect(validateEffects(db, withHeir(), [{ type: "child_favor", heirId: "heir_999999", delta: 5 }])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/effects/funnel.childfavor.test.ts` → FAIL.

- [ ] **Step 3: Add schema.** In `schemas.ts` union add:

```ts
  z.strictObject({ type: z.literal("child_favor"), heirId: nonEmpty, delta }),
```

- [ ] **Step 4: Add validation** in `funnel.ts`:

```ts
      case "child_favor": {
        if (!state.resources.bloodline.heirs.some((h) => h.id === e.heirId)) {
          bad(index, "BAD_EFFECT_TARGET", `unknown heir "${e.heirId}"`, { heir: e.heirId });
        }
        break;
      }
```

- [ ] **Step 5: Add apply** in `funnel.ts` (reuse `cappedDelta` + `clampPct`):

```ts
      case "child_favor": {
        const heir = next.resources.bloodline.heirs.find((h) => h.id === effect.heirId)!;
        const applied = cappedDelta(`heir:${effect.heirId}`, effect.delta);
        heir.favor = clampPct(heir.favor + applied);
        break;
      }
```

- [ ] **Step 6: Run green + full funnel suite.** `npx vitest run tests/effects/` → all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/engine/content/schemas.ts src/engine/effects/funnel.ts tests/effects/funnel.childfavor.test.ts
git commit -m "feat: child_favor effect — adjust 子嗣宠爱 (±10 cap, clamp 0–100)"
```

---

## Task 12: store/bedchamber — companionship mode + 激情 gating + single-track

**Files:**
- Modify: `src/store/bedchamber.ts`
- Test: `tests/store/bedchamber.test.ts` (extend; create if absent)

Rules (spec §3.6, §4): conception only when `passion` AND no active gestation (`pregnancy.status === "none" && gestation === undefined`). A consort that is `carrying` or in recovery (`recoverUntilMonth` not yet reached) may not use `passion`. A `deceased` consort cannot be summoned at all. Add a helper exported for the UI gate.

- [ ] **Step 1: Write the failing test** — `tests/store/bedchamber.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { createNewGameState } from "../../src/engine/state/newGame";
import { buildBedchamber, passionAllowed, canSummon } from "../../src/store/bedchamber";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("bedchamber single-track conception", () => {
  it("passion conceives only when no active gestation", () => {
    const s = createNewGameState(db);
    s.resources.bloodline.pregnancy = { status: "carrying", candidateIds: [] };
    s.resources.bloodline.gestation = { carrier: "sovereign", conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } };
    const plan = buildBedchamber(db, s, "shen_chenghui", "passion");
    expect(plan!.conceived).toBe(false);
    expect(plan!.effects.some((e) => e.type === "pregnancy")).toBe(false);
  });
});

describe("passionAllowed / canSummon", () => {
  it("carrying consort cannot use passion but can be summoned", () => {
    const s = createNewGameState(db);
    s.standing.shen_chenghui!.lifecycle = "carrying";
    expect(passionAllowed(s, "shen_chenghui")).toBe(false);
    expect(canSummon(s, "shen_chenghui")).toBe(true);
  });

  it("recovering consort cannot use passion", () => {
    const s = createNewGameState(db);
    s.standing.shen_chenghui!.recoverUntilMonth = 999;
    expect(passionAllowed(s, "shen_chenghui")).toBe(false);
  });

  it("deceased consort cannot be summoned", () => {
    const s = createNewGameState(db);
    s.standing.shen_chenghui!.lifecycle = "deceased";
    expect(canSummon(s, "shen_chenghui")).toBe(false);
  });

  it("normal consort allows passion", () => {
    const s = createNewGameState(db);
    expect(passionAllowed(s, "shen_chenghui")).toBe(true);
    expect(canSummon(s, "shen_chenghui")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/store/bedchamber.test.ts` → FAIL (`passionAllowed`/`canSummon` not exported).

- [ ] **Step 3: Update `src/store/bedchamber.ts`.** Add imports + helpers + change the conception guard + companionship fallback. Replace the file's body as follows (preserving existing structure):

Add to imports at top:

```ts
import { monthOrdinal } from "../engine/calendar/time";
```

Add the `companionship` fallback line to `FALLBACK_SCRIPT`:

```ts
const FALLBACK_SCRIPT: Record<BedchamberMode, string[]> = {
  passion: ["{name}敛衽称是，上前服侍帝王。承欢一夕，陛下只觉神清气爽。"],
  pleasure: ["{name}近前奉茶解乏，一夕清谈相伴，陛下神清气爽。"],
  companionship: ["{name}近前相伴，理妆奉茶、轻声叙话，小心顾着腹中胎息。"],
};
```

Add the two exported guards (after `bedchamberConfig`):

```ts
/** 当前是否有在孕胎息（单线孕育 — 受孕被封）。 */
export function hasActiveGestation(state: GameState): boolean {
  const bl = state.resources.bloodline;
  return bl.pregnancy.status !== "none" || bl.gestation !== undefined;
}

/** 激情可选：非承嗣君怀胎中、且不在产后休养中。 */
export function passionAllowed(state: GameState, charId: string): boolean {
  const st = state.standing[charId];
  if (!st) return false;
  if (st.lifecycle === "carrying") return false;
  if (st.recoverUntilMonth !== undefined && monthOrdinal(state.calendar) < st.recoverUntilMonth) return false;
  return true;
}

/** 可召侍寝：非已故。 */
export function canSummon(state: GameState, charId: string): boolean {
  return state.standing[charId]?.lifecycle !== "deceased";
}
```

Change the conception guard in `buildBedchamber` (replace lines 53–57 region):

```ts
  const conceived =
    mode === "passion" &&
    !hasActiveGestation(state) &&
    passionAllowed(state, charId) &&
    conceives(state.rngSeed, state.calendar.dayIndex, charId, cfg.conceptionChance);
  if (conceived) effects.push({ type: "pregnancy", op: "begin" });
```

- [ ] **Step 4: Run green.** `npx vitest run tests/store/bedchamber.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/bedchamber.ts tests/store/bedchamber.test.ts
git commit -m "feat: bedchamber companionship mode + 激情 gating + single-track conception"
```

---

## Task 13: store/gestation — assemble designate/transfer/abort/birth plans

**Files:**
- Create: `src/store/gestation.ts`
- Test: `tests/store/gestation.test.ts` (new)

This module is the UI-facing assembler (like `store/bedchamber.ts`/`store/rankOps.ts`): it resolves config, computes the birth verdict via pure `resolveBirth`, and returns `{ effects, lines }` for `App.tsx` to apply + replay through `ReactionScreen`. `recoverUntilMonth` is computed here (survival known only after verdict).

- [ ] **Step 1: Write the failing test** — `tests/store/gestation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime, monthOrdinal } from "../../src/engine/calendar/time";
import { gestationConfig, buildBirth, plannedBirth } from "../../src/store/gestation";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function sovereignCarrying(month: number): GameState {
  const s = createNewGameState(db);
  const conceivedAt = makeGameTime(1, month, "early");
  s.resources.bloodline.pregnancy = { status: "carrying", conceivedAt, candidateIds: [] };
  s.resources.bloodline.gestation = { carrier: "sovereign", conceivedAt };
  return s;
}

describe("gestationConfig", () => {
  it("reads world.gestation", () => {
    expect(gestationConfig(db).termMonths).toBe(10);
  });
});

describe("plannedBirth", () => {
  it("sovereign births at 孕十月", () => {
    const s = sovereignCarrying(1);
    expect(plannedBirth(db, s).birthMonthOrdinal).toBe(monthOrdinal(makeGameTime(1, 10, "early")));
  });
});

describe("buildBirth", () => {
  it("self-pregnancy → safe birth effect with favor 100 + lines", () => {
    const s = sovereignCarrying(1);
    s.calendar = { ...makeGameTime(1, 10, "early"), ap: 6, apMax: 6 };
    const plan = buildBirth(db, s);
    expect(plan).not.toBeNull();
    const birth = plan!.effects.find((e) => e.type === "birth");
    expect(birth).toBeDefined();
    expect(plan!.lines.length).toBeGreaterThan(0);
    // applying the effect lands an heir
    const r = applyEffects(db, s, plan!.effects);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.resources.bloodline.heirs[0]!.favor).toBe(100);
  });
});
```

- [ ] **Step 2: Run it red.** `npx vitest run tests/store/gestation.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/store/gestation.ts`:**

```ts
/**
 * 孕育流程装配层（供 App 编排）：解析配置 → 纯函数裁决 → 组装 effects + 反应台词。
 * effects 走正常漏斗；lines 经 ReactionScreen 对话缝隙重放。
 */
import { monthOrdinal } from "../engine/calendar/time";
import { resolveBirth } from "../engine/characters/birth";
import { DEFAULT_TIERS } from "../engine/characters/favorTier";
import {
  DEFAULT_GESTATION,
  birthSlot,
  plannedBirthMonth,
  recoverUntilMonth,
  type GestationConfig,
} from "../engine/characters/gestation";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import { toGameTime } from "../engine/calendar/time";
import type { GameState } from "../engine/state/types";
import { bedchamberConfig } from "./bedchamber";

export function gestationConfig(db: ContentDB): GestationConfig {
  return db.world.gestation ?? DEFAULT_GESTATION;
}

function displayName(db: ContentDB, state: GameState, charId: string): string {
  const ch = db.characters[charId];
  if (!ch) return charId;
  const st = state.standing[charId];
  return resolveDisplayName(ch, st, st ? db.ranks[st.rank] : undefined);
}

export interface BirthTiming {
  birthMonthOrdinal: number;
  birthSlot: number;
}

/** 确定的生产月 + 当月行动点 slot。无 gestation 返回 null。 */
export function plannedBirth(db: ContentDB, state: GameState): BirthTiming | null {
  const gest = state.resources.bloodline.gestation;
  if (!gest) return null;
  const cfg = gestationConfig(db);
  const bm = plannedBirthMonth(state.rngSeed, gest.conceivedAt, gest.carrier, cfg);
  return { birthMonthOrdinal: bm, birthSlot: birthSlot(state.rngSeed, bm, state.calendar.apMax) };
}

/** 是否已到生产时机（到月 + slot；过月即补触发）。 */
export function birthDue(db: ContentDB, state: GameState): boolean {
  const timing = plannedBirth(db, state);
  if (!timing) return false;
  const cur = monthOrdinal(state.calendar);
  if (cur > timing.birthMonthOrdinal) return true;
  if (cur < timing.birthMonthOrdinal) return false;
  const slot = state.calendar.apMax - state.calendar.ap;
  return slot >= timing.birthSlot;
}

export interface GestationPlan {
  effects: EventEffect[];
  lines: string[];
  /** 生产承载侍君（非自孕安产时供产后晋升用）；自孕为 "sovereign"。 */
  bearer: "sovereign" | string;
  bearerOutcome: "safe" | "child_dies" | "bearer_dies" | "both";
}

/** 生产裁决 → birth effect + 播报台词。无 gestation 返回 null。 */
export function buildBirth(db: ContentDB, state: GameState): GestationPlan | null {
  const gest = state.resources.bloodline.gestation;
  if (!gest) return null;
  const cfg = gestationConfig(db);
  const now = toGameTime(state.calendar);
  const bearerIsFenghou = gest.carrier === "feng_hou";

  const verdict = resolveBirth({
    rngSeed: state.rngSeed,
    now,
    carrier: gest.carrier,
    fatherId: gest.fatherId ?? null,
    transferredAtMonth: gest.transferredAtMonth,
    bearerIsFenghou,
    carrierRecord: gest.carrier === "sovereign" ? undefined : state.bedchamber[gest.carrier],
    thresholds: bedchamberConfig(db).tiers ?? DEFAULT_TIERS,
    cfg,
  });

  const safe = verdict.bearerOutcome === "safe";
  const recover =
    gest.carrier !== "sovereign" && (safe || verdict.bearerOutcome === "child_dies")
      ? recoverUntilMonth(monthOrdinal(now), safe, cfg)
      : undefined;

  const childNoun = verdict.sex === "daughter" ? "皇子" : "皇郎";
  const lines = buildBirthLines(db, state, gest.carrier, verdict.bearerOutcome, childNoun);

  return {
    effects: [
      {
        type: "birth",
        sex: verdict.sex,
        fatherId: verdict.fatherId,
        bearer: verdict.bearer,
        legitimate: verdict.legitimate,
        favor: verdict.favor,
        bearerOutcome: verdict.bearerOutcome,
        ...(recover !== undefined ? { recoverUntilMonth: recover } : {}),
      },
    ],
    lines,
    bearer: gest.carrier,
    bearerOutcome: verdict.bearerOutcome,
  };
}

function buildBirthLines(
  db: ContentDB,
  state: GameState,
  carrier: string,
  outcome: GestationPlan["bearerOutcome"],
  childNoun: string,
): string[] {
  if (carrier === "sovereign") {
    return [`陛下临盆，诞下一位${childNoun}，母子均安，举宫称庆。`];
  }
  const name = displayName(db, state, carrier);
  switch (outcome) {
    case "safe":
      return [`${name}临盆，顺利诞下一位${childNoun}，母子均安。`];
    case "child_dies":
      return [`${name}难产，胎死腹中，太医勉力保住了${name}性命。噩耗传来，宫中一片缄默。`];
    case "bearer_dies":
      return [`${name}难产，拼死诞下一位${childNoun}，自己却血崩而亡。宫人垂泪相送。`];
    case "both":
      return [`${name}难产，一尸两命。太医跪地请罪，宫中举哀。`];
  }
}
```

> Note: `bedchamberConfig(db).tiers` is non-optional (`BedchamberThresholds`) in `store/bedchamber.ts`; the `?? DEFAULT_TIERS` is a defensive no-op kept for clarity. If TypeScript flags it as unnecessary, drop the `?? DEFAULT_TIERS` and the unused import.

- [ ] **Step 4: Run green.** `npx vitest run tests/store/gestation.test.ts` → PASS.

- [ ] **Step 5: Typecheck the whole project now** (engine + store complete):

```bash
npm run typecheck
```

Expected: errors ONLY in `src/ui/**` (App.tsx still uses old `PregnancyModal`/`confirmPregnancy`/`"expecting"`). UI is fixed in Tasks 14–19.

- [ ] **Step 6: Commit**

```bash
git add src/store/gestation.ts tests/store/gestation.test.ts
git commit -m "feat: store/gestation — birth timing + verdict assembly with reaction lines"
```

---

## Task 14: UI — 敬事房 modal (孕二月候选承嗣) + App wiring

**Files:**
- Rename/replace: `src/ui/components/PregnancyModal.tsx` → `src/ui/components/JingshifangModal.tsx`
- Modify: `src/ui/App.tsx`
- Manual verify (Playwright smoke optional per spec §10)

The 孕二月 interception (status `pending`, `孕月数 ≥ 2`) replaces the old `PregnancyModal`. It lists the 受孕当月激情侍寝侍君 as possible fathers (display only), asks 是否即刻选定候选承嗣. Two outcomes:
- **选定候选承嗣** → opens a multi-select of ALL living consorts → commit batch `[{pregnancy carry}, {heir_designate charIds}]` → 谢恩 reaction.
- **暂不 / 自孕** → commit `[{pregnancy carry}]` only.

- [ ] **Step 1: Create `src/ui/components/JingshifangModal.tsx`** (replaces PregnancyModal; supports two phases in one component):

```tsx
/** 孕二月敬事房上书：列「可能生父」，可即刻选定候选承嗣（全体在世侍君多选）。 */
import { useState } from "react";
import { resolveDisplayName } from "../../engine/characters/standing";
import { canSummon } from "../../store/bedchamber";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function JingshifangModal({
  db,
  state,
  fatherCandidates,
  onSelfPregnancy,
  onDesignate,
}: {
  db: ContentDB;
  state: GameState;
  fatherCandidates: string[];
  onSelfPregnancy: () => void;
  onDesignate: (charIds: string[]) => void;
}) {
  const [phase, setPhase] = useState<"ask" | "pick">("ask");
  const [picked, setPicked] = useState<string[]>([]);

  const name = (id: string) => {
    const c = db.characters[id]!;
    const st = state.standing[id];
    return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
  };
  const fatherText = fatherCandidates.map(name).join(" 或 ");

  const living = Object.values(db.characters)
    .filter((c) => c.kind === "consort" && canSummon(state, c.id))
    .map((c) => c.id);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="modal-backdrop">
      <div className="pregnancy-modal" onClick={(e) => e.stopPropagation()}>
        {phase === "ask" ? (
          <>
            <h2>敬事房主管上书</h2>
            <p className="pregnancy-modal__hint">
              陛下喜脉初成。皇嗣之父可能为{fatherText || "近月承欢侍君"}。是否即刻选定候选承嗣者？
            </p>
            <button type="button" onClick={() => setPhase("pick")}>
              即刻选定候选承嗣
            </button>
            <button type="button" onClick={onSelfPregnancy}>
              暂不（自孕）
            </button>
          </>
        ) : (
          <>
            <h2>选定候选承嗣</h2>
            <p className="pregnancy-modal__hint">于在世侍君中圈定候选承嗣（可多选）：</p>
            <ul className="pregnancy-modal__list">
              {living.map((id) => (
                <li key={id}>
                  <label>
                    <input type="checkbox" checked={picked.includes(id)} onChange={() => toggle(id)} />
                    {name(id)}
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" disabled={picked.length < 1} onClick={() => onDesignate(picked)}>
              钦定候选承嗣（{picked.length}）
            </button>
            <button type="button" onClick={() => setPhase("ask")}>
              返回
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Delete the old component.** `git rm src/ui/components/PregnancyModal.tsx`.

- [ ] **Step 3: Rewire `App.tsx` 孕二月 interception.** Replace the import (line 17) and the `pregnancyDue`/`fatherCandidates`/`confirmPregnancy`/`<PregnancyModal>` block.

Replace line 17:

```tsx
import { JingshifangModal } from "./components/JingshifangModal";
```

Replace lines 161–182 (the `liveState`/`preg`/`pregnancyDue`/`fatherCandidates`/`confirmPregnancy` block) with:

```tsx
  const liveState = store.getState();
  const preg = liveState.resources.bloodline.pregnancy;
  // 孕二月敬事房上书：pending 且已过受孕月。
  const jingshifangDue =
    preg.status === "pending" &&
    preg.conceivedAt !== undefined &&
    monthOrdinal(liveState.calendar) > monthOrdinal(preg.conceivedAt);
  const fatherCandidates = jingshifangDue
    ? Object.values(db.characters)
        .filter(
          (c) =>
            c.kind === "consort" &&
            (liveState.bedchamber[c.id]?.encounters ?? []).some(
              (e) => e.mode === "passion" && monthOrdinal(e.at) === monthOrdinal(preg.conceivedAt!),
            ),
        )
        .map((c) => c.id)
    : [];

  const carrySelfPregnancy = () => {
    const r = store.applyEffects(db, [{ type: "pregnancy", op: "carry" }]);
    if (r.ok) doAutosave();
  };
  const designateCandidates = (charIds: string[]) => {
    const r = store.applyEffects(db, [
      { type: "pregnancy", op: "carry" },
      { type: "heir_designate", charIds },
    ]);
    if (r.ok) {
      doAutosave();
      setReaction({
        speakerId: charIds[0]!,
        lines: ["臣等谢陛下隆恩，必当尽心护持皇嗣。"],
      });
    }
  };
```

Replace the `<PregnancyModal>` JSX block (lines 348–355) with:

```tsx
      {jingshifangDue && (
        <JingshifangModal
          db={db}
          state={liveState}
          fatherCandidates={fatherCandidates}
          onSelfPregnancy={carrySelfPregnancy}
          onDesignate={designateCandidates}
        />
      )}
```

- [ ] **Step 4: Typecheck.** `npm run typecheck` → expect remaining errors only about `"expecting"` in `LocationScreen.tsx` (fixed Task 19) and any not-yet-added 御书房 buttons. Confirm App.tsx itself has no errors related to this task.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/JingshifangModal.tsx src/ui/App.tsx
git rm src/ui/components/PregnancyModal.tsx
git commit -m "feat: 敬事房 modal (孕二月候选承嗣) replaces PregnancyModal"
```

---

## Task 15: UI — SuccessorModal (宗正寺传嗣) + 孕三月 prompt + 御书房召见宗正寺

**Files:**
- Create: `src/ui/components/SuccessorModal.tsx`
- Modify: `src/ui/App.tsx`

The 宗正寺 transfer opens for self-pregnancy at 孕三月 (auto-prompt) and via a 御书房「召见宗正寺」button at 孕四–九月. Both pick a living consort; if 凤后 has no heir yet, surface「优先凤后承嗣以生嫡子」. Commits `pregnancy_transfer{carrierId, atMonth}` + 谢恩.

- [ ] **Step 1: Create `src/ui/components/SuccessorModal.tsx`:**

```tsx
/** 宗正寺·传嗣：在世侍君中择承嗣君（高亮候选）。凤后无嗣时提示优先凤后承嗣。 */
import { useState } from "react";
import { resolveDisplayName } from "../../engine/characters/standing";
import { canSummon } from "../../store/bedchamber";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function SuccessorModal({
  db,
  state,
  onTransfer,
  onKeep,
}: {
  db: ContentDB;
  state: GameState;
  onTransfer: (carrierId: string) => void;
  onKeep: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const candidateIds = state.resources.bloodline.pregnancy.candidateIds;
  const fenghouChildless = !state.resources.bloodline.heirs.some((h) => h.bearer === "feng_hou");

  const living = Object.values(db.characters)
    .filter((c) => c.kind === "consort" && canSummon(state, c.id))
    .map((c) => c.id);
  const name = (id: string) => {
    const c = db.characters[id]!;
    const st = state.standing[id];
    return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
  };

  return (
    <div className="modal-backdrop">
      <div className="pregnancy-modal" onClick={(e) => e.stopPropagation()}>
        <h2>宗正寺上书</h2>
        <p className="pregnancy-modal__hint">
          宗正寺奏请陛下尽早择侍君承嗣，以固宗祧。
          {fenghouChildless ? "凤后尚无所出，可优先择凤后承嗣以生嫡子。" : ""}
        </p>
        <ul className="pregnancy-modal__list">
          {living.map((id) => (
            <li key={id}>
              <label>
                <input type="radio" name="successor" checked={picked === id} onChange={() => setPicked(id)} />
                {name(id)}
                {candidateIds.includes(id) ? "（候选承嗣）" : ""}
                {id === "feng_hou" && fenghouChildless ? "（嫡子）" : ""}
              </label>
            </li>
          ))}
        </ul>
        <button type="button" disabled={picked === null} onClick={() => picked && onTransfer(picked)}>
          传嗣
        </button>
        <button type="button" onClick={onKeep}>
          仍由帝王自孕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `App.tsx`.** Add `SuccessorModal` import; add state `const [successorOpen, setSuccessorOpen] = useState(false);` near the other `useState` declarations; add derived flags + handler after the `designateCandidates` block:

```tsx
  const gest = liveState.resources.bloodline.gestation;
  const selfCarrying = preg.status === "carrying" && gest?.carrier === "sovereign";
  const gestMonth =
    gest !== undefined ? monthOrdinal(liveState.calendar) - monthOrdinal(gest.conceivedAt) + 1 : 0;
  // 孕三月自动弹宗正寺；孕四–九月由御书房「召见宗正寺」手动开。
  const successorAutoDue = selfCarrying && gestMonth === 3;
  const canSummonZongzheng = selfCarrying && gestMonth >= 4 && gestMonth <= 9;

  const transferTo = (carrierId: string) => {
    setSuccessorOpen(false);
    const r = store.applyEffects(db, [{ type: "pregnancy_transfer", carrierId, atMonth: gestMonth }]);
    if (r.ok) {
      doAutosave();
      setReaction({ speakerId: carrierId, lines: ["臣领旨。臣定以血躯护持皇嗣，不负圣恩。"] });
    }
  };
```

Add the modal JSX (after the JingshifangModal block):

```tsx
      {(successorAutoDue || successorOpen) && selfCarrying && (
        <SuccessorModal
          db={db}
          state={liveState}
          onTransfer={transferTo}
          onKeep={() => setSuccessorOpen(false)}
        />
      )}
```

> The auto-prompt at 孕三月 renders whenever `successorAutoDue` holds;「仍由帝王自孕」(`onKeep`) just closes it for this render — it reopens next month only if still at month 3, which cannot recur (month advances), so 自孕 correctly carries past month 3 to the 御书房 path.

- [ ] **Step 3: Add the 御书房「召见宗正寺」button.** This lives on `LocationScreen` for `yushufang`. Pass a callback prop. In `App.tsx`'s `<LocationScreen>` usage add:

```tsx
          onSummonZongzheng={canSummonZongzheng ? () => setSuccessorOpen(true) : undefined}
```

(The `LocationScreen` prop + button render are added in Task 19 alongside the other 御书房 buttons; for now App passes the prop. If `LocationScreen` doesn't yet accept it, TypeScript will flag — that's resolved in Task 19. To keep this task's typecheck clean, add the optional prop to `LocationScreen`'s props type now as a stub that renders a button — see Task 19 Step 2 which formalizes all three buttons. Implement the stub button in Task 19.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/SuccessorModal.tsx src/ui/App.tsx
git commit -m "feat: 宗正寺 SuccessorModal — 孕三月 auto-prompt + 御书房召见 (孕四–九月)"
```

---

## Task 16: UI — PhysicianModal (太医流胎) + 御书房召见太医

**Files:**
- Create: `src/ui/components/PhysicianModal.tsx`
- Modify: `src/ui/App.tsx`

御书房「召见太医」(0 AP). If sovereign self-carrying → red 流胎 with double-confirm. If consort-carried → 流胎 unavailable (承养不可弃). If not pregnant → 院正 idle line.

- [ ] **Step 1: Create `src/ui/components/PhysicianModal.tsx`:**

```tsx
/** 御书房·召见太医（0 行动点）。自孕中可流胎（红色二次确认）；已传嗣不可弃。 */
import { useState } from "react";

export function PhysicianModal({
  selfCarrying,
  consortCarrying,
  onAbort,
  onClose,
}: {
  selfCarrying: boolean;
  consortCarrying: boolean;
  onAbort: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="physician-modal" onClick={(e) => e.stopPropagation()}>
        <h2>太医院正请安</h2>
        {selfCarrying ? (
          confirming ? (
            <>
              <p className="physician-modal__warn">皇嗣是国家大事，可有不妥？此举不可挽回。</p>
              <button type="button" className="physician-modal__danger" onClick={onAbort}>
                执意流胎
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                取消
              </button>
            </>
          ) : (
            <>
              <p>陛下凤体有孕，院正候旨。</p>
              <button type="button" className="physician-modal__danger" onClick={() => setConfirming(true)}>
                流胎
              </button>
              <button type="button" onClick={onClose}>
                罢了
              </button>
            </>
          )
        ) : consortCarrying ? (
          <>
            <p>皇嗣已承于承嗣君，承养不可弃，唯静候临盆。</p>
            <button type="button" onClick={onClose}>
              知道了
            </button>
          </>
        ) : (
          <>
            <p>陛下凤体康健，院正无事可奏。陛下有何吩咐？</p>
            <button type="button" onClick={onClose}>
              退下
            </button>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `App.tsx`.** Add import; add `const [physicianOpen, setPhysicianOpen] = useState(false);`; add derived `const consortCarrying = gest !== undefined && gest.carrier !== "sovereign";` and handler:

```tsx
  const abortPregnancy = () => {
    setPhysicianOpen(false);
    const r = store.applyEffects(db, [{ type: "pregnancy_abort" }]);
    if (r.ok) {
      doAutosave();
      setReaction({ speakerId: "sili_nvguan", lines: ["太医奉旨调理，陛下凤体已无大碍。此事到此为止。"] });
    }
  };
```

> `sili_nvguan` is used as a neutral 司礼/院正 voice for the reaction seam (a real character with standing). If a dedicated 太医 character does not exist, this is acceptable — confirm the id exists in `db.characters` (it does: seeded in `newGame`). The reaction text is generic.

Add modal JSX:

```tsx
      {physicianOpen && (
        <PhysicianModal
          selfCarrying={selfCarrying}
          consortCarrying={consortCarrying}
          onAbort={abortPregnancy}
          onClose={() => setPhysicianOpen(false)}
        />
      )}
```

Add the `LocationScreen` prop:

```tsx
          onSummonPhysician={() => setPhysicianOpen(true)}
```

(Button rendered in Task 19.)

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/PhysicianModal.tsx src/ui/App.tsx
git commit -m "feat: 太医 PhysicianModal — 自孕流胎 (red double-confirm); 承养不可弃"
```

---

## Task 17: UI — BirthScreen + 生产 interception + 产后晋升/凶讯

**Files:**
- Create: `src/ui/screens/BirthScreen.tsx`
- Modify: `src/ui/App.tsx`

生产: when `birthDue(db, state)` and a gestation exists, intercept (highest priority, before 敬事房/宗正寺 which require pending/self-carrying anyway). `BirthScreen` plays the verdict lines via the dialogue seam (reuse `ReactionScreen` rendering by speaking as the bearer or 司礼 for self-pregnancy), then on done commits the `birth` effect. After commit: if non-凤后 consort safe → 凤后 道贺 + 晋升 prompt; 凤后/自孕 safe → 道贺 only.

Because `BirthScreen` needs to compute the plan once and commit on done, App builds the plan eagerly and passes it down.

- [ ] **Step 1: Create `src/ui/screens/BirthScreen.tsx`** (thin wrapper over the dialogue seam, same shape as `ReactionScreen` but speaks the birth lines; speaker = bearer consort, or `sili_nvguan` for self-pregnancy):

```tsx
/** 生产播报：经对话缝隙逐行播报生产结局，结束回调由 App 提交 birth 效果。 */
import { ReactionScreen } from "./ReactionScreen";
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";

export function BirthScreen({
  db,
  store,
  registry,
  speakerId,
  lines,
  onDone,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  speakerId: string;
  lines: string[];
  onDone: () => void;
}) {
  return (
    <ReactionScreen db={db} store={store} registry={registry} speakerId={speakerId} lines={lines} onDone={onDone} />
  );
}
```

- [ ] **Step 2: Wire `App.tsx`.** Add imports for `BirthScreen`, `buildBirth`, `birthDue` from `../store/gestation`. Add state `const [birthRun, setBirthRun] = useState<{ speakerId: string; plan: ReturnType<typeof buildBirth> } | null>(null);` — actually simpler: compute inline. Add:

```tsx
  const birthIsDue = birthDue(db, liveState) && gest !== undefined;

  const runBirth = () => {
    const plan = buildBirth(db, store.getState());
    if (!plan) return;
    const speaker = plan.bearer === "sovereign" ? "sili_nvguan" : plan.bearer;
    setReaction({ speakerId: speaker, lines: plan.lines });
    // commit happens after the player dismisses the reaction (see onReactionDone).
    pendingBirth.current = plan;
  };
```

This is getting tangled with the existing single `reaction` seam. Use a dedicated birth state instead. Replace the above with a clean dedicated flow:

Add state near other hooks:

```tsx
  const [birthPlan, setBirthPlan] = useState<ReturnType<typeof buildBirth>>(null);
```

Add an effect-free derived trigger: render `BirthScreen` whenever `birthIsDue && !birthPlan`. On trigger, build the plan. Since building must be a side-effect-free render decision, compute it in render:

```tsx
  const birthIsDue = gest !== undefined && birthDue(db, liveState);
  const activeBirthPlan = birthPlan ?? (birthIsDue ? buildBirth(db, liveState) : null);

  const commitBirth = () => {
    const plan = activeBirthPlan;
    setBirthPlan(null);
    if (!plan) return;
    const applied = store.applyEffects(db, plan.effects);
    if (!applied.ok) return;
    doAutosave();
    // 产后晋升/道贺
    if (plan.bearerOutcome === "safe" && plan.bearer !== "sovereign" && plan.bearer !== "feng_hou") {
      setReaction({
        speakerId: "feng_hou",
        lines: ["恭喜陛下喜得麟儿。立功侍君劳苦功高，可愿晋升以彰圣眷？"],
      });
      setPostBirthPromoteId(plan.bearer);
    } else if (plan.bearerOutcome === "safe") {
      setReaction({ speakerId: "feng_hou", lines: ["恭喜陛下喜得麟儿，宗祧有继，举国同庆。"] });
    }
  };
```

Add state `const [postBirthPromoteId, setPostBirthPromoteId] = useState<string | null>(null);`. Reuse the existing first-night promote UI pattern: after the 凤后 道贺 reaction is dismissed, if `postBirthPromoteId` set, open `RankAdminModal`. Hook into the existing `reaction` `onDone`:

Modify the `<ReactionScreen ... onDone>` (lines 292–301) to:

```tsx
      {reaction && (
        <ReactionScreen
          db={db}
          store={store}
          registry={registry}
          speakerId={reaction.speakerId}
          lines={reaction.lines}
          onDone={() => {
            setReaction(null);
            if (postBirthPromoteId) {
              const id = postBirthPromoteId;
              setPostBirthPromoteId(null);
              setManageCharId(id);
            }
          }}
        />
      )}
```

Add the `BirthScreen` render (place BEFORE the `jingshifangDue`/`successor` modals so birth wins):

```tsx
      {activeBirthPlan && (
        <BirthScreen
          db={db}
          store={store}
          registry={registry}
          speakerId={activeBirthPlan.bearer === "sovereign" ? "sili_nvguan" : activeBirthPlan.bearer}
          lines={activeBirthPlan.lines}
          onDone={commitBirth}
        />
      )}
```

> Ordering rationale: 生产 only fires when a `gestation` exists; 敬事房 needs `pending` (no gestation) and 宗正寺 needs self-carrying — so birth never collides with them. The explicit ordering is belt-and-suspenders.

- [ ] **Step 3: Typecheck.** `npm run typecheck` — resolve any type issues (e.g. `buildBirth` return type is `GestationPlan | null`; `activeBirthPlan` guards with truthiness). Expect only the Task 19 `LocationScreen` items remaining.

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/BirthScreen.tsx src/ui/App.tsx
git commit -m "feat: BirthScreen + 生产 interception + 凤后道贺/产后晋升"
```

---

## Task 18: UI — HeirListModal (子嗣两表 + 宠爱 ± 调整) + 御书房子嗣按钮

**Files:**
- Create: `src/ui/components/HeirListModal.tsx`
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Create `src/ui/components/HeirListModal.tsx`:**

```tsx
/** 御书房·子嗣列表：皇子/皇郎两表，显示承嗣者/年龄/生日/宠爱度 + ± 调整 + 嫡标记。 */
import { formatGameTime } from "../../engine/calendar/time";
import { listHeirsBySex, heirAge } from "../../engine/characters/heirs";
import { resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, Heir } from "../../engine/state/types";

export function HeirListModal({
  db,
  state,
  onAdjust,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  onAdjust: (heirId: string, delta: number) => void;
  onClose: () => void;
}) {
  const heirs = state.resources.bloodline.heirs;

  const bearerLabel = (h: Heir): string => {
    if (h.fatherId === null) return "自孕";
    const c = db.characters[h.fatherId];
    if (!c) return h.fatherId;
    const st = state.standing[h.fatherId];
    const name = resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
    return st?.lifecycle === "deceased" ? `${name}（已故）` : name;
  };

  const renderTable = (sex: "daughter" | "son", title: string) => {
    const rows = listHeirsBySex(heirs, sex);
    return (
      <section className="heir-list__table">
        <h3>{title}</h3>
        {rows.length === 0 ? (
          <p className="heir-list__empty">暂无。</p>
        ) : (
          <ul>
            {rows.map(({ heir, name }) => (
              <li key={heir.id} className="heir-list__row">
                <span className="heir-list__name">
                  {name}
                  {heir.legitimate ? "（嫡）" : ""}
                </span>
                <span>承嗣：{bearerLabel(heir)}</span>
                <span>{heirAge(heir, state.calendar)}岁 · {formatGameTime(heir.birthAt)}</span>
                <span className="heir-list__favor">
                  宠爱 {heir.favor}
                  <button type="button" onClick={() => onAdjust(heir.id, 5)}>＋</button>
                  <button type="button" onClick={() => onAdjust(heir.id, -5)}>－</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="heir-list" onClick={(e) => e.stopPropagation()}>
        <h2>皇嗣</h2>
        {renderTable("daughter", "皇子")}
        {renderTable("son", "皇郎")}
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `App.tsx`.** Add import; add `const [heirListOpen, setHeirListOpen] = useState(false);`; add handler:

```tsx
  const adjustHeirFavor = (heirId: string, delta: number) => {
    const r = store.applyEffects(db, [{ type: "child_favor", heirId, delta }]);
    if (r.ok) doAutosave();
  };
```

Add modal JSX:

```tsx
      {heirListOpen && (
        <HeirListModal db={db} state={liveState} onAdjust={adjustHeirFavor} onClose={() => setHeirListOpen(false)} />
      )}
```

Add the `LocationScreen` prop:

```tsx
          onOpenHeirs={() => setHeirListOpen(true)}
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/HeirListModal.tsx src/ui/App.tsx
git commit -m "feat: HeirListModal — 皇子/皇郎 两表 + 宠爱 ± 调整 + 嫡标记"
```

---

## Task 19: UI — lifecycle labels, companionship in BedchamberModal, deceased exclusion, HUD carrier badge, 御书房 three buttons

**Files:**
- Modify: `src/ui/components/BedchamberModal.tsx`
- Modify: `src/ui/components/BedchamberPicker.tsx`
- Modify: `src/ui/screens/LocationScreen.tsx`
- Modify: `src/ui/components/CharacterCard.tsx`
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: BedchamberModal — gate 激情, add 陪伴.** The modal must know whether passion is allowed. Change its props + body:

```tsx
/** 侍寝前选模式。承嗣君怀胎/产后休养时激情不可选，仅享受/陪伴。 */
import type { BedchamberMode } from "../../engine/state/types";

export function BedchamberModal({
  name,
  passionAllowed,
  onChoose,
  onClose,
}: {
  name: string;
  passionAllowed: boolean;
  onChoose: (mode: BedchamberMode) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bedchamber-modal" onClick={(e) => e.stopPropagation()}>
        <h2>召{name}侍寝</h2>
        <p className="bedchamber-modal__hint">择侍寝之法：</p>
        <div className="bedchamber-modal__choices">
          {passionAllowed && (
            <button type="button" onClick={() => onChoose("passion")}>
              激情<small>　恩泽承嗣，或有孕育之机</small>
            </button>
          )}
          <button type="button" onClick={() => onChoose("pleasure")}>
            享受<small>　怡情解乏，不涉子嗣</small>
          </button>
          <button type="button" onClick={() => onChoose("companionship")}>
            陪伴<small>　静好相守，安养胎息</small>
          </button>
        </div>
        <button type="button" className="bedchamber-modal__close" onClick={onClose}>
          罢了
        </button>
      </div>
    </div>
  );
}
```

In `App.tsx` pass the flag (modify the `<BedchamberModal>` usage, lines ~310–316):

```tsx
      {bedchamberPickId && db.characters[bedchamberPickId] && (
        <BedchamberModal
          name={db.characters[bedchamberPickId]!.profile.name}
          passionAllowed={passionAllowed(store.getState(), bedchamberPickId)}
          onChoose={chooseBedchamberMode}
          onClose={() => setBedchamberPickId(null)}
        />
      )}
```

Add `import { passionAllowed, canSummon } from "../store/bedchamber";` to App.tsx (note: `buildBedchamber` import line already exists — add to it or a new import).

- [ ] **Step 2: LocationScreen — 御书房 three buttons + lifecycle labels + deceased exclusion + HUD badge.** 

Add the new optional props to the `LocationScreen` props type:

```tsx
  onSummonZongzheng?: () => void;
  onSummonPhysician?: () => void;
  onOpenHeirs?: () => void;
```

Fix the HUD pregnancy badge (replace lines 49–51) to read carrier from gestation:

```tsx
        {state.resources.bloodline.gestation?.carrier === "sovereign" && (
          <span className="hud__pregnancy">怀胎</span>
        )}
```

Add the three 御书房 buttons inside the `yushufang` roster `<h2>` button group (after the 翻牌子 button, still within the `location.id === "yushufang"` block — place them in the roster header area):

```tsx
          {location.id === "yushufang" && (
            <div className="yushufang-actions">
              {onSummonPhysician && (
                <button type="button" onClick={onSummonPhysician}>召见太医</button>
              )}
              {onSummonZongzheng && (
                <button type="button" onClick={onSummonZongzheng}>召见宗正寺</button>
              )}
              {onOpenHeirs && (
                <button type="button" onClick={onOpenHeirs}>子嗣</button>
              )}
            </div>
          )}
```

(Place this block right after the `<h2>后宫名册 … 翻牌子</h2>` element, inside the existing `<section className="location-screen__roster">`.)

Add a lifecycle label to each roster row (modify the roster-row render, replace the `roster-row__rank` span area):

```tsx
              const lc = st.lifecycle;
              const lcLabel =
                lc === "carrying" ? "·承嗣君·怀胎" :
                lc === "delivered" ? "·育嗣君" :
                lc === "candidate" ? "·候选承嗣" :
                lc === "deceased" ? "·已故" : "";
              return (
                <div key={c.id} className="roster-row">
                  <span>{resolveDisplayName(c, st, db.ranks[st.rank])}</span>
                  <span className="roster-row__rank">{db.ranks[st.rank]?.name}{st.title ? `·封号「${st.title}」` : ""}{lcLabel}</span>
                  {onManage && <button type="button" onClick={() => onManage(c.id)}>管理</button>}
                </div>
              );
```

Exclude 侍寝 entry for deceased + gate the 侍寝 button on the present-character card. Change the `onBedchamber` prop passed to `CharacterCard` (lines 139–143):

```tsx
              onBedchamber={
                onBedchamber && character.kind === "consort" && canBedchamber && canSummon(state, character.id)
                  ? () => onBedchamber(character.id)
                  : undefined
              }
```

Add `import { canSummon } from "../../store/bedchamber";` to `LocationScreen.tsx`.

- [ ] **Step 3: BedchamberPicker — exclude deceased + lifecycle tag.** Filter out deceased and annotate. Replace the `consorts` filter and the row render:

```tsx
  const consorts = Object.values(db.characters)
    .filter((c) => c.kind === "consort" && state.standing[c.id]?.lifecycle !== "deceased")
    .sort((a, b) => {
      const ra = state.standing[a.id], rb = state.standing[b.id];
      if (!ra || !rb) return 0;
      return (
        effectiveOrder(db.ranks[rb.rank]!, rb.title !== undefined) -
        effectiveOrder(db.ranks[ra.rank]!, ra.title !== undefined)
      );
    });
```

In the row, append a lifecycle hint after the rank span:

```tsx
                  {resolveDisplayName(c, st, db.ranks[st.rank])}
                  <span className="bedchamber-picker__rank">
                    {db.ranks[st.rank]?.name}
                    {st.lifecycle === "carrying" ? "·承嗣君" : st.lifecycle === "delivered" ? "·育嗣君" : ""}
                  </span>
```

- [ ] **Step 4: CharacterCard — carrying badge (optional display).** Open `src/ui/components/CharacterCard.tsx`, and where standing/rank is shown, add (if a standing label area exists) a small badge when `state.standing[character.id]?.lifecycle === "carrying"` reading `承嗣君·怀胎`. If the card has no obvious slot, add a `<span className="character-card__lifecycle">` near the name. Keep it minimal and consistent with existing card markup. (Read the file first; match its structure.)

- [ ] **Step 5: Full typecheck + lint.**

```bash
npm run typecheck && npm run lint
```

Expected: GREEN. Fix any remaining references to removed `PregnancyModal`, `"expecting"`, or old `confirmPregnancy`.

- [ ] **Step 6: Commit**

```bash
git add src/ui/components/BedchamberModal.tsx src/ui/components/BedchamberPicker.tsx src/ui/components/CharacterCard.tsx src/ui/screens/LocationScreen.tsx src/ui/App.tsx
git commit -m "feat: lifecycle labels, 陪伴 mode, deceased exclusion, 御书房 三按钮, 怀胎 HUD by carrier"
```

---

## Task 20: Save round-trip test + full DoD + final review

**Files:**
- Test: `tests/save/heirRoundTrip.test.ts` (new)

- [ ] **Step 1: Write the save round-trip test** — `tests/save/heirRoundTrip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("heir lifecycle save round-trip", () => {
  it("persists gestation, heirs, candidateIds, lifecycle, recoverUntilMonth", () => {
    let s = createNewGameState(db);
    for (const effects of [
      [{ type: "pregnancy", op: "begin" }] as const,
      [{ type: "pregnancy", op: "carry" }] as const,
      [{ type: "heir_designate", charIds: ["shen_chenghui"] }] as const,
      [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }] as const,
      [{
        type: "birth", sex: "daughter", fatherId: "shen_chenghui", bearer: "shen_chenghui",
        legitimate: false, favor: 25, bearerOutcome: "safe", recoverUntilMonth: 20,
      }] as const,
    ]) {
      const r = applyEffects(db, s, effects as never);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.value;
    }
    expect(s.resources.bloodline.heirs).toHaveLength(1);
    expect(s.standing.shen_chenghui!.lifecycle).toBe("delivered");
    // The full state must still satisfy the persistence schema.
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it.** `npx vitest run tests/save/heirRoundTrip.test.ts` → PASS. Fix `stateSchema.ts` if any field fails `safeParse`.

- [ ] **Step 3: Run the full DoD gate.**

```bash
npm run typecheck && npm run lint && npm test && npm run validate-content && npm run validate-manifest && npm run build
```

Expected: all GREEN. Fix any failures before proceeding.

- [ ] **Step 4: Browser smoke (manual, optional per spec §10).** `npm run dev`, start a new game, 翻牌子 → 激情 a consort repeatedly to conceive, advance a month (travel) → 敬事房 modal appears → designate a candidate → next month 宗正寺 → transfer → advance to birth month → BirthScreen → 凤后 道贺/晋升 → open 子嗣 list → verify naming/favor/嫡. Verify 召见太医 流胎 path on a self-pregnancy. Confirm no double-fire / no AP skips.

- [ ] **Step 5: Commit the test.**

```bash
git add tests/save/heirRoundTrip.test.ts
git commit -m "test: heir lifecycle save round-trip"
```

- [ ] **Step 6: Final whole-implementation review.** Dispatch a final code-review subagent over the full diff (`git diff main...HEAD`) checking: funnel atomicity/guards for all 5 new effects, determinism (no `Math.random`, no `rngSeed` mutation), engine purity (no UI/store imports under `src/engine/**`), spec coverage (§3 state machine, §4 陪伴 gating, §5 naming/嫡/favor, §6 产后晋升/凶讯, §7 effects, §8 config). Address findings, then use **superpowers:finishing-a-development-branch**.

---

## Self-Review (against spec)

**Spec coverage:**
- §1 孕月数锚点 → Task 3 `gestationMonth` (+1).
- §2 state model (PregnancyState.candidateIds, GestationState, Heir, ConsortLifecycle, recoverUntilMonth) → Task 1.
- §3.1 孕二月敬事房 → Task 14. §3.2 孕三月宗正寺 → Task 15. §3.3 孕四–九月召见宗正寺 → Task 15. §3.4 召见太医/流胎 → Task 16. §3.5 生产/提前生产 → Tasks 3 (`plannedBirthMonth`/`earlyBirthHit`/`birthSlot`), 13 (`birthDue`/`buildBirth`), 17. §3.6 单线孕育 → Task 12 (`hasActiveGestation`). §3.7 产后休养 → Tasks 3 (`recoverUntilMonth`), 10 (birth applies it), 12 (`passionAllowed`).
- §4 陪伴 mode + 激情 gating → Tasks 2 (schema/script), 12 (`passionAllowed`), 19 (modal).
- §5.1 lifecycle 标记落点 → Task 1 (`standing.lifecycle`), 19 (labels). §5.2 命名/嫡/宠爱 → Tasks 4 (favor/嫡), 5 (naming). §5.3 子嗣列表 → Task 18.
- §6 产后晋升/死亡 → Tasks 10 (lifecycle migration), 17 (凤后 道贺/晋升, 凶讯 via birth lines).
- §7 五个新 effects + pregnancy op → Tasks 6–11.
- §8 world.json.gestation + 确定性随机 → Tasks 2, 3, 4.
- §10 tests → each engine/funnel/store task is TDD; save round-trip Task 20.
- §11 DoD → Task 20 Step 3.

**Type consistency:** `GestationState`, `Heir`, `ConsortLifecycle`, `PregnancyState.candidateIds`, `BedchamberMode += companionship` defined in Task 1; `HeirSex` reconciled in Task 5 Step 4; `GestationConfig`/`DEFAULT_GESTATION` in Task 3 reused by Tasks 4/13; effect names (`heir_designate`, `pregnancy_transfer`, `pregnancy_abort`, `birth`, `child_favor`) consistent across schema/funnel/tests/store/UI; `passionAllowed`/`canSummon`/`hasActiveGestation` exported from `store/bedchamber.ts` (Task 12) consumed by Tasks 14/15/19.

**Placeholder scan:** No TBD/TODO. One intentional typo to fix is flagged inline (Task 4 Step 1 test string). Task 15 Step 3 / Task 16 Step 2 pass `LocationScreen` props whose buttons are formalized in Task 19 — noted explicitly so the implementer adds the optional props early to keep interim typechecks clean.

# 位分升降 + 封号 System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player promote/demote a consort's 位分 and grant/strip a 封号, with an in-character reaction (谢恩/请罪/惶恐) and 称呼 that recomposes to 封号+位分 or 姓氏+位分.

**Architecture:** Three new `EventEffect` variants (`set_rank`/`set_title`/`remove_title`) flow through the existing effect funnel — the single state-change path. Display 称呼 becomes a pure helper composing surname/title + current rank name. Player actions live on the consort's card (in her palace) and a 御书房 roster, both opening one modal; reactions replay through the existing DialogueProvider seam.

**Tech Stack:** TypeScript (strict), React, Zod, Vitest, Playwright. Engine code is framework-free (lint forbids React imports under `src/engine/**`).

Reference spec: `docs/superpowers/specs/2026-06-15-rank-title-system-design.md`.

**Conventions used throughout:**
- Run tests: `npm test` (all) or `npx vitest run <path>` (one file).
- Gates: `npm run typecheck`, `npm run lint`, `npm run validate-content`.
- Commit message format: `feat: …` (attribution disabled globally).
- Branch is already `feat/map-boards-and-content-foundation`; commit there.

---

### Task 1: Add `title` to standing and `surname` to profile

**Files:**
- Modify: `src/engine/state/types.ts:54-59` (CharacterStanding)
- Modify: `src/engine/content/schemas.ts` (characterStandingSchema ~36-39, profile ~157-166)
- Test: `tests/content/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/content/schemas.test.ts`:

```typescript
import { characterStandingSchema, characterSchema } from "../../src/engine/content/schemas";

describe("rank/title fields", () => {
  it("standing accepts an optional 封号 title", () => {
    expect(characterStandingSchema.safeParse({ rank: "chenghui", favor: 30, title: "婉" }).success).toBe(true);
    expect(characterStandingSchema.safeParse({ rank: "chenghui", favor: 30 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/content/schemas.test.ts`
Expected: FAIL — `title` is an unknown key on the strict object.

- [ ] **Step 3: Add `title` to the CharacterStanding type**

In `src/engine/state/types.ts`, replace the CharacterStanding interface:

```typescript
export interface CharacterStanding {
  /** Rank id from world.json's 位分 table (PR 3). */
  rank: string;
  /** 0–100 — 恩宠 (consort) / 圣眷 (official). */
  favor: number;
  /** 封号 (optional). When set, 称呼 becomes 封号+位分 (rank/title system). */
  title?: string;
}
```

- [ ] **Step 4: Add `title` to characterStandingSchema and `surname` to profile**

In `src/engine/content/schemas.ts`, update `characterStandingSchema`:

```typescript
export const characterStandingSchema = z.strictObject({
  rank: idSchema,
  favor: percent,
  title: nonEmpty.optional(),
}) satisfies z.ZodType<CharacterStanding>;
```

And in `characterSchema`'s `profile` strictObject, add `surname` right after `name`:

```typescript
      name: nonEmpty,
      surname: nonEmpty.optional(),
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run tests/content/schemas.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/engine/state/types.ts src/engine/content/schemas.ts tests/content/schemas.test.ts
git commit -m "feat: add optional 封号 title to standing and surname to profile"
```

---

### Task 2: Add the three rank/title effect variants to the schema

**Files:**
- Modify: `src/engine/content/schemas.ts` (eventEffectSchema union ~111-148)
- Test: `tests/content/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/content/schemas.test.ts`:

```typescript
import { eventEffectSchema } from "../../src/engine/content/schemas";

describe("rank/title effects", () => {
  it("accepts set_rank / set_title / remove_title", () => {
    expect(eventEffectSchema.safeParse({ type: "set_rank", char: "shen_chenghui", rank: "jun" }).success).toBe(true);
    expect(eventEffectSchema.safeParse({ type: "set_title", char: "shen_chenghui", title: "婉" }).success).toBe(true);
    expect(eventEffectSchema.safeParse({ type: "remove_title", char: "shen_chenghui" }).success).toBe(true);
  });
  it("rejects a 封号 longer than 4 漢字", () => {
    expect(eventEffectSchema.safeParse({ type: "set_title", char: "shen_chenghui", title: "一二三四五" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/content/schemas.test.ts`
Expected: FAIL — these effect shapes don't match the union.

- [ ] **Step 3: Add the three variants**

In `src/engine/content/schemas.ts`, inside the `eventEffectSchema` union (add before the final `memory` variant):

```typescript
  z.strictObject({ type: z.literal("set_rank"), char: idSchema, rank: idSchema }),
  z.strictObject({ type: z.literal("set_title"), char: idSchema, title: z.string().min(1).max(4) }),
  z.strictObject({ type: z.literal("remove_title"), char: idSchema }),
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/content/schemas.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/content/schemas.ts tests/content/schemas.test.ts
git commit -m "feat: add set_rank/set_title/remove_title effect schemas"
```

---

### Task 3: Implement the three effects in the funnel (with guards)

**Files:**
- Modify: `src/engine/effects/funnel.ts` (validateEffects switch ~48-68; apply switch ~104-156)
- Test: `tests/effects/funnel.test.ts` (existing — confirm with `ls tests/effects/`)

- [ ] **Step 1: Write the failing tests**

Add to `tests/effects/funnel.test.ts` (it already imports `applyEffects` and a real-content fixture; mirror existing setup in that file for `db`/`state`):

```typescript
describe("rank/title effects", () => {
  it("set_rank changes a consort's rank", () => {
    const r = applyEffects(db, state, [{ type: "set_rank", char: "shen_chenghui", rank: "jun" }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.standing.shen_chenghui.rank).toBe("jun");
  });
  it("set_title then remove_title sets and clears the 封号", () => {
    const a = applyEffects(db, state, [{ type: "set_title", char: "shen_chenghui", title: "婉" }]);
    expect(a.ok && a.value.standing.shen_chenghui.title).toBe("婉");
    if (!a.ok) return;
    const b = applyEffects(db, a.value, [{ type: "remove_title", char: "shen_chenghui" }]);
    expect(b.ok && b.value.standing.shen_chenghui.title).toBeUndefined();
  });
  it("rejects set_rank to 凤后 (the cap)", () => {
    expect(applyEffects(db, state, [{ type: "set_rank", char: "shen_chenghui", rank: "fenghou" }]).ok).toBe(false);
  });
  it("rejects set_rank on an official", () => {
    expect(applyEffects(db, state, [{ type: "set_rank", char: "sili_nvguan", rank: "jun" }]).ok).toBe(false);
  });
  it("rejects a 封号 containing a forbidden term", () => {
    expect(applyEffects(db, state, [{ type: "set_title", char: "shen_chenghui", title: "女帝" }]).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/effects/funnel.test.ts`
Expected: FAIL — variants not validated/applied yet.

- [ ] **Step 3: Add validation cases**

In `src/engine/effects/funnel.ts` `validateEffects`, add to the `switch (e.type)`:

```typescript
      case "set_rank": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.standing[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `set_rank needs a consort with standing: "${e.char}"`, { char: e.char });
        } else {
          const r = db.ranks[e.rank];
          if (!r || r.domain !== "harem" || e.rank === "fenghou") {
            bad(index, "BAD_EFFECT", `set_rank to invalid rank "${e.rank}"`, { rank: e.rank });
          }
        }
        break;
      }
      case "set_title": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.standing[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `set_title needs a consort with standing: "${e.char}"`, { char: e.char });
        } else if (db.lexicon.forbiddenTerms.some((t) => e.title.includes(t))) {
          bad(index, "BAD_EFFECT", `title "${e.title}" contains a forbidden term`, { title: e.title });
        }
        break;
      }
      case "remove_title": {
        const ch = db.characters[e.char];
        if (!ch || ch.kind !== "consort" || !state.standing[e.char]) {
          bad(index, "BAD_EFFECT_TARGET", `remove_title needs a consort with standing: "${e.char}"`, { char: e.char });
        }
        break;
      }
```

- [ ] **Step 4: Add apply cases**

In `applyEffects`'s `for (const effect of effects)` switch, add:

```typescript
      case "set_rank": {
        next.standing[effect.char]!.rank = effect.rank;
        break;
      }
      case "set_title": {
        next.standing[effect.char]!.title = effect.title;
        break;
      }
      case "remove_title": {
        delete next.standing[effect.char]!.title;
        break;
      }
```

- [ ] **Step 5: Run tests + typecheck + lint**

Run: `npx vitest run tests/effects/funnel.test.ts && npm run typecheck && npm run lint`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/engine/effects/funnel.ts tests/effects/funnel.test.ts
git commit -m "feat: apply set_rank/set_title/remove_title in the effect funnel"
```

---

### Task 4: `resolveDisplayName` + `effectiveOrder` helpers

**Files:**
- Create: `src/engine/characters/standing.ts`
- Test: `tests/characters/standing.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/characters/standing.test.ts`. The 称呼 cases use inline fixtures so
this task is self-contained (independent of the shipped content's surnames):

```typescript
import { describe, expect, it } from "vitest";
import { resolveDisplayName, effectiveOrder } from "../../src/engine/characters/standing";
import type { CharacterContent, CharacterRank } from "../../src/engine/content/schemas";

const chenghui = { id: "chenghui", name: "承徽", grade: "正三品", order: 134, domain: "harem", favorTerm: "恩宠", selfRefs: { toPlayer: ["侍", "侍身"], formal: ["本宫"], informal: ["我"] } } as CharacterRank;

const consort = (over: Partial<CharacterContent["profile"]>) =>
  ({ kind: "consort", profile: { name: "沈承徽", surname: "沈", ...over } } as unknown as CharacterContent);

describe("resolveDisplayName", () => {
  it("composes surname + 位分 when untitled", () => {
    expect(resolveDisplayName(consort({}), { rank: "chenghui", favor: 30 }, chenghui)).toBe("沈承徽");
  });
  it("composes 封号 + 位分 when titled", () => {
    expect(resolveDisplayName(consort({}), { rank: "chenghui", favor: 30, title: "婉" }, chenghui)).toBe("婉承徽");
  });
  it("falls back to profile.name when there is no surname (凤后)", () => {
    const fenghou = { kind: "consort", profile: { name: "凤后" } } as unknown as CharacterContent;
    expect(resolveDisplayName(fenghou, { rank: "fenghou", favor: 25 }, { ...chenghui, name: "凤后" })).toBe("凤后");
  });
});

describe("effectiveOrder", () => {
  it("nudges a titled rank above its untitled order", () => {
    expect(effectiveOrder(chenghui, true)).toBe(135);
    expect(effectiveOrder(chenghui, false)).toBe(134);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/characters/standing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the helper**

Create `src/engine/characters/standing.ts`:

```typescript
/**
 * Display 称呼 + precedence for consorts (rank/title system). 称呼 recomposes
 * from the CURRENT rank, so a promotion/封号 changes it everywhere automatically.
 */
import type { CharacterContent, CharacterRank } from "../content/schemas";
import type { CharacterStanding } from "../state/types";

/** A 封号 nudges a consort just above untitled same-rank peers (< adjacent-rank gap). */
export const TITLE_BOOST = 1;

export function resolveDisplayName(
  character: CharacterContent,
  standing: CharacterStanding | undefined,
  rank: CharacterRank | undefined,
): string {
  if (character.kind === "consort" && character.profile.surname && rank) {
    return (standing?.title ?? character.profile.surname) + rank.name;
  }
  return character.profile.name;
}

export function effectiveOrder(rank: CharacterRank, hasTitle: boolean): number {
  return rank.order + (hasTitle ? TITLE_BOOST : 0);
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/characters/standing.test.ts`
Expected: PASS — the test uses inline fixtures, so it is fully self-contained.

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/standing.ts tests/characters/standing.test.ts
git commit -m "feat: resolveDisplayName + effectiveOrder helpers"
```

---

### Task 5: Use `resolveDisplayName` for the dialogue speaker label

**Files:**
- Modify: `src/engine/dialogue/orchestrator.ts:121-129`
- Test: `tests/dialogue/provider.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/dialogue/provider.test.ts` (uses the existing `db`, `mockProvider`, `requestFor`, `speaking` helpers):

```typescript
it("speakerName recomposes from surname + 位分", async () => {
  const result = await produceDialogueLine(db, speaking("……侍身知罪。"), requestFor("shen_chenghui"));
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.value.speakerName).toBe("沈承徽");
});
```

- [ ] **Step 2: Run it to verify it builds the seam**

Run: `npx vitest run tests/dialogue/provider.test.ts`
Expected: This asserts the helper is wired into `speakerName`. Because `profile.name`
is already `沈承徽`, it passes both before and after the Step-3 change — its job is to
lock the wiring so a future `profile.name`/surname divergence can't silently break it.
(The compose/override logic itself is fully covered by Task 4.)

- [ ] **Step 3: Switch speakerName to the helper**

In `src/engine/dialogue/orchestrator.ts`, add the import:

```typescript
import { resolveDisplayName } from "../characters/standing";
```

Replace `speakerName: character.profile.name,` (in the returned DialogueLine) with:

```typescript
    speakerName: resolveDisplayName(
      character,
      request.speakerContext.standing,
      db.ranks[request.speakerContext.standing.rank],
    ),
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run tests/dialogue/provider.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/orchestrator.ts tests/dialogue/provider.test.ts
git commit -m "feat: dialogue speaker label uses composed 称呼"
```

---

### Task 6: Add the full §9.2 rank ladder to world.json + lexicon

**Files:**
- Modify: `content/world.json` (`ranks` array)
- Modify: `content/lexicon.json` (`rankAddressRules` array)
- Verify: `npm run validate-content`

The loader enforces `lexicon.rankAddressRules[].selfRefs` deep-equals `world.json ranks[].selfRefs` per id, and every rank id has a lexicon entry. Keep them in lockstep.

- [ ] **Step 1: Replace `world.json` `ranks` with the full ladder**

Set `content/world.json` `ranks` to (keeping `sili_zhang` at the end unchanged):

```json
  "ranks": [
    { "id": "fenghou", "name": "凤后", "grade": "正宫", "selfRefs": { "toPlayer": ["臣后"], "formal": ["本宫"] }, "order": 1000, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "huangguijun", "name": "皇贵君", "grade": "超品", "selfRefs": { "toPlayer": ["臣"], "formal": ["本宫"] }, "order": 180, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "guijun", "name": "贵君", "grade": "正一品", "selfRefs": { "toPlayer": ["臣", "臣侍"], "formal": ["本宫"] }, "order": 170, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "jun", "name": "君", "grade": "从一品", "selfRefs": { "toPlayer": ["臣侍"], "formal": ["本宫"] }, "order": 160, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "guifu", "name": "贵驸", "grade": "正二品", "selfRefs": { "toPlayer": ["臣侍"], "formal": ["本宫"] }, "order": 150, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "fu", "name": "驸", "grade": "从二品", "selfRefs": { "toPlayer": ["臣侍"], "formal": ["本宫"] }, "order": 140, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "chenghui", "name": "承徽", "grade": "正三品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "order": 134, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "chengyi", "name": "承仪", "grade": "正三品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "order": 132, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "chengde", "name": "承德", "grade": "正三品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "order": 130, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "zhaohui", "name": "昭徽", "grade": "从三品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "order": 124, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "zhaoyi", "name": "昭仪", "grade": "从三品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "order": 122, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "zhaorong", "name": "昭容", "grade": "从三品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "order": 120, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "shichen", "name": "侍宸", "grade": "正四品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "order": 110, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "guiren", "name": "贵人", "grade": "从四品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本侍", "我"] }, "order": 100, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "meiren", "name": "美人", "grade": "正五品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本侍", "我"] }, "order": 90, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "cairen", "name": "才人", "grade": "从五品", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本侍", "我"] }, "order": 80, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "changzai", "name": "常在", "grade": "六品", "selfRefs": { "toPlayer": ["小侍"], "formal": ["我"] }, "order": 70, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "daying", "name": "答应", "grade": "七品", "selfRefs": { "toPlayer": ["小侍"], "formal": ["我"] }, "order": 60, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "gengyi", "name": "更衣", "grade": "八品", "selfRefs": { "toPlayer": ["小侍"], "formal": ["我"] }, "order": 50, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "guannanzi", "name": "官男子", "grade": "九品", "selfRefs": { "toPlayer": ["小侍"], "formal": ["我"] }, "order": 40, "domain": "harem", "favorTerm": "恩宠" },
    { "id": "sili_zhang", "name": "司礼", "grade": "正五品", "selfRefs": { "toPlayer": ["臣"], "formal": ["下官"] }, "order": 50, "domain": "official", "favorTerm": "圣眷" }
  ],
```

- [ ] **Step 2: Replace `lexicon.json` `rankAddressRules` to match**

Set `content/lexicon.json` `rankAddressRules` so every rank above has an entry whose `selfRefs` is byte-identical to the world.json row and `addressedAs` is the rank `name` (for `sili_zhang` keep `addressedAs: "司礼"`). Example rows (continue for all 20 ids + sili_zhang):

```json
    { "rank": "fenghou", "selfRefs": { "toPlayer": ["臣后"], "formal": ["本宫"] }, "addressedAs": "凤后" },
    { "rank": "huangguijun", "selfRefs": { "toPlayer": ["臣"], "formal": ["本宫"] }, "addressedAs": "皇贵君" },
    { "rank": "guijun", "selfRefs": { "toPlayer": ["臣", "臣侍"], "formal": ["本宫"] }, "addressedAs": "贵君" },
    { "rank": "jun", "selfRefs": { "toPlayer": ["臣侍"], "formal": ["本宫"] }, "addressedAs": "君" },
    { "rank": "guifu", "selfRefs": { "toPlayer": ["臣侍"], "formal": ["本宫"] }, "addressedAs": "贵驸" },
    { "rank": "fu", "selfRefs": { "toPlayer": ["臣侍"], "formal": ["本宫"] }, "addressedAs": "驸" },
    { "rank": "chenghui", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "addressedAs": "承徽" },
    { "rank": "chengyi", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "addressedAs": "承仪" },
    { "rank": "chengde", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "addressedAs": "承德" },
    { "rank": "zhaohui", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "addressedAs": "昭徽" },
    { "rank": "zhaoyi", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "addressedAs": "昭仪" },
    { "rank": "zhaorong", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "addressedAs": "昭容" },
    { "rank": "shichen", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本宫"], "informal": ["我"] }, "addressedAs": "侍宸" },
    { "rank": "guiren", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本侍", "我"] }, "addressedAs": "贵人" },
    { "rank": "meiren", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本侍", "我"] }, "addressedAs": "美人" },
    { "rank": "cairen", "selfRefs": { "toPlayer": ["侍", "侍身"], "formal": ["本侍", "我"] }, "addressedAs": "才人" },
    { "rank": "changzai", "selfRefs": { "toPlayer": ["小侍"], "formal": ["我"] }, "addressedAs": "常在" },
    { "rank": "daying", "selfRefs": { "toPlayer": ["小侍"], "formal": ["我"] }, "addressedAs": "答应" },
    { "rank": "gengyi", "selfRefs": { "toPlayer": ["小侍"], "formal": ["我"] }, "addressedAs": "更衣" },
    { "rank": "guannanzi", "selfRefs": { "toPlayer": ["小侍"], "formal": ["我"] }, "addressedAs": "官男子" },
    { "rank": "sili_zhang", "selfRefs": { "toPlayer": ["臣"], "formal": ["下官"] }, "addressedAs": "司礼" }
```

- [ ] **Step 3: Validate content + run the full suite**

Run: `npm run validate-content && npm test`
Expected: `content OK … 21 ranks`; all tests PASS. The gate tests (`tests/dialogue/gates.test.ts`) still pass because 本宫 stays shared and `臣侍` is still foreign to 凤后.

- [ ] **Step 4: Commit**

```bash
git add content/world.json content/lexicon.json
git commit -m "feat: full §9.2 consort rank ladder in world.json + lexicon"
```

---

### Task 7: Give the three consorts a 姓 (surname)

**Files:**
- Modify: `content/characters/shen_chenghui.json`, `chu_jun.json`, `wenya_shijun.json`
- Verify: re-run Task 4 + Task 5 tests

- [ ] **Step 1: Add `surname` to each consort's profile**

In each file, add `"surname"` inside `profile` right after `"name"`:
- `shen_chenghui.json`: `"surname": "沈"`
- `chu_jun.json`: `"surname": "初"`
- `wenya_shijun.json`: `"surname": "温"`

(凤后 `feng_hou.json` gets NO surname — it stays the 正宫 special case.)

- [ ] **Step 2: Validate + run the surname-dependent tests**

Run: `npm run validate-content && npx vitest run tests/characters/standing.test.ts tests/dialogue/provider.test.ts`
Expected: PASS — `沈承徽`, `婉承徽` compositions now resolve.

- [ ] **Step 3: Commit**

```bash
git add content/characters/shen_chenghui.json content/characters/chu_jun.json content/characters/wenya_shijun.json
git commit -m "feat: surnames for composed 称呼 (沈/初/温)"
```

---

### Task 8: Add `rankChangeReactions` content + schema

**Files:**
- Modify: `src/engine/content/schemas.ts` (worldSchema ~366-394)
- Modify: `content/world.json` (new top-level `rankChangeReactions`)
- Test: `tests/content/schemas.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/content/schemas.test.ts`:

```typescript
import { worldSchema } from "../../src/engine/content/schemas";
import worldJson from "../../content/world.json";

it("world.json carries rankChangeReactions for all four kinds", () => {
  const parsed = worldSchema.safeParse(worldJson);
  expect(parsed.success).toBe(true);
  if (parsed.success) {
    expect(Object.keys(parsed.data.rankChangeReactions ?? {}).sort()).toEqual(
      ["demote", "grant_title", "promote", "strip_title"],
    );
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/content/schemas.test.ts`
Expected: FAIL — `rankChangeReactions` absent / unknown key.

- [ ] **Step 3: Add the schema field**

In `src/engine/content/schemas.ts`, add this above `worldSchema` and reference it inside:

```typescript
const rankReactionSchema = z.strictObject({
  lines: z.array(nonEmpty).min(1).max(3),
  memory: nonEmpty,
});

export const rankChangeReactionsSchema = z.strictObject({
  promote: rankReactionSchema,
  demote: rankReactionSchema,
  grant_title: rankReactionSchema,
  strip_title: rankReactionSchema,
});
```

Then add to the `worldSchema` strictObject (after `mapPortals`):

```typescript
  /** Templated consort reactions to 位分/封号 ops (rank/title system). */
  rankChangeReactions: rankChangeReactionsSchema.optional(),
```

- [ ] **Step 4: Add the content**

Add to `content/world.json` (top level, after `mapPortals`):

```json
  "rankChangeReactions": {
    "promote":     { "lines": ["谢陛下隆恩！{self}定当尽心侍奉，不负圣眷。"], "memory": "陛下晋我为{rank}，圣眷正隆。" },
    "demote":      { "lines": ["……{self}知罪。谢陛下教诲。"], "memory": "陛下贬我为{rank}，颜面无存。" },
    "grant_title": { "lines": ["蒙陛下赐号，{self}惶恐领赏——谢陛下隆恩！"], "memory": "陛下赐我封号「{title}」，恩宠加身。" },
    "strip_title": { "lines": ["陛下息怒……{self}知罪，惶恐请罪，恳请陛下开恩。"], "memory": "陛下褫夺我封号，我惶惶不可终日。" }
  }
```

- [ ] **Step 5: Run tests + validate**

Run: `npx vitest run tests/content/schemas.test.ts && npm run validate-content`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/content/schemas.ts content/world.json tests/content/schemas.test.ts
git commit -m "feat: rankChangeReactions content + schema"
```

---

### Task 9: Reaction renderer (templates → lines + memory)

**Files:**
- Create: `src/engine/characters/rankReaction.ts`
- Test: `tests/characters/rankReaction.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/characters/rankReaction.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { renderRankReaction } from "../../src/engine/characters/rankReaction";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("renderRankReaction", () => {
  it("promote substitutes the NEW rank's selfRef and name", () => {
    const r = renderRankReaction(db, "promote", db.ranks.jun, undefined);
    expect(r.lines[0]).toContain("臣侍"); // 君's toPlayer[0]
    expect(r.memory).toContain("君");
  });
  it("grant_title substitutes the 封号", () => {
    const r = renderRankReaction(db, "grant_title", db.ranks.chenghui, "婉");
    expect(r.memory).toContain("婉");
  });
  it("falls back to a generic line when content lacks reactions", () => {
    const bare = { ...db, world: { ...db.world, rankChangeReactions: undefined } };
    expect(renderRankReaction(bare as typeof db, "demote", db.ranks.chenghui, undefined).lines.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/characters/rankReaction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the renderer**

Create `src/engine/characters/rankReaction.ts`:

```typescript
/**
 * Render a consort's reaction to a 位分/封号 op from the content templates
 * (world.json.rankChangeReactions). Substitutes {self} (the post-op rank's
 * primary selfRef), {rank} (post-op rank name), {title} (granted 封号).
 */
import type { ContentDB } from "../content/loader";
import type { CharacterRank } from "../content/schemas";

export type RankOpKind = "promote" | "demote" | "grant_title" | "strip_title";

const FALLBACK: Record<RankOpKind, { lines: string[]; memory: string }> = {
  promote: { lines: ["谢陛下隆恩。"], memory: "陛下晋我为{rank}。" },
  demote: { lines: ["……{self}知罪。"], memory: "陛下贬我为{rank}。" },
  grant_title: { lines: ["谢陛下赐号。"], memory: "陛下赐我封号「{title}」。" },
  strip_title: { lines: ["{self}惶恐请罪。"], memory: "陛下褫夺我封号。" },
};

export function renderRankReaction(
  db: ContentDB,
  kind: RankOpKind,
  newRank: CharacterRank,
  title: string | undefined,
): { lines: string[]; memory: string } {
  const tmpl = db.world.rankChangeReactions?.[kind] ?? FALLBACK[kind];
  const self = newRank.selfRefs.toPlayer[0]!;
  const subst = (s: string) =>
    s.replaceAll("{self}", self).replaceAll("{rank}", newRank.name).replaceAll("{title}", title ?? "");
  return { lines: tmpl.lines.map(subst), memory: subst(tmpl.memory) };
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/characters/rankReaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/characters/rankReaction.ts tests/characters/rankReaction.test.ts
git commit -m "feat: rank-op reaction renderer"
```

---

### Task 10: `applyRankOp` orchestration helper (store-level)

**Files:**
- Create: `src/store/rankOps.ts`
- Test: `tests/store/rankOps.test.ts`

This composes the effect batch (rank/title change + auto-memory) and the reaction lines, so the UI just calls one function. It does NOT touch React.

- [ ] **Step 1: Write the failing test**

Create `tests/store/rankOps.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildRankOp } from "../../src/store/rankOps";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";

const db = loadRealContent();

describe("buildRankOp", () => {
  const state = createNewGameState(db); // shen_chenghui starts at 承徽
  it("promote to 君 emits set_rank + memory and 谢恩 lines", () => {
    const op = buildRankOp(db, state, "shen_chenghui", { kind: "set_rank", rank: "jun" });
    expect(op).not.toBeNull();
    if (!op) return;
    expect(op.kind).toBe("promote");
    expect(op.effects[0]).toEqual({ type: "set_rank", char: "shen_chenghui", rank: "jun" });
    expect(op.effects.some((e) => e.type === "memory")).toBe(true);
    expect(op.lines[0]).toContain("臣侍");
  });
  it("selecting the SAME rank is a no-op (null)", () => {
    expect(buildRankOp(db, state, "shen_chenghui", { kind: "set_rank", rank: "chenghui" })).toBeNull();
  });
  it("strip_title classifies as strip_title and emits remove_title", () => {
    const titled = structuredClone(state);
    titled.standing.shen_chenghui.title = "婉";
    const op = buildRankOp(db, titled, "shen_chenghui", { kind: "remove_title" });
    expect(op?.kind).toBe("strip_title");
    expect(op?.effects[0]).toEqual({ type: "remove_title", char: "shen_chenghui" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/store/rankOps.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `buildRankOp`**

Create `src/store/rankOps.ts`:

```typescript
/**
 * Compose a 位分/封号 op into (effects batch + reaction lines) for the UI.
 * Returns null when nothing changes (e.g. selecting the current rank). The
 * effects go through the normal funnel; lines replay through the dialogue seam.
 */
import { effectiveOrder } from "../engine/characters/standing";
import { renderRankReaction, type RankOpKind } from "../engine/characters/rankReaction";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export type RankOpRequest =
  | { kind: "set_rank"; rank: string }
  | { kind: "set_title"; title: string }
  | { kind: "remove_title" };

export interface RankOp {
  kind: RankOpKind;
  effects: EventEffect[];
  lines: string[];
  charId: string;
}

export function buildRankOp(
  db: ContentDB,
  state: GameState,
  charId: string,
  req: RankOpRequest,
): RankOp | null {
  const standing = state.standing[charId];
  if (!standing) return null;
  const curRank = db.ranks[standing.rank];
  if (!curRank) return null;

  let kind: RankOpKind;
  let postRank = curRank;
  let postTitle = standing.title;
  const effects: EventEffect[] = [];

  if (req.kind === "set_rank") {
    const target = db.ranks[req.rank];
    if (!target || req.rank === standing.rank) return null; // unknown or no-op
    kind = effectiveOrder(target, standing.title !== undefined) > effectiveOrder(curRank, standing.title !== undefined)
      ? "promote"
      : "demote";
    postRank = target;
    effects.push({ type: "set_rank", char: charId, rank: req.rank });
  } else if (req.kind === "set_title") {
    if (!req.title || req.title === standing.title) return null;
    kind = "grant_title";
    postTitle = req.title;
    effects.push({ type: "set_title", char: charId, title: req.title });
  } else {
    if (standing.title === undefined) return null; // nothing to strip
    kind = "strip_title";
    postTitle = undefined;
    effects.push({ type: "remove_title", char: charId });
  }

  const reaction = renderRankReaction(db, kind, postRank, postTitle);
  effects.push({
    type: "memory",
    char: charId,
    entry: {
      kind: "event",
      summary: reaction.memory,
      salience: kind === "strip_title" || kind === "demote" ? 70 : 55,
      tags: ["player", kind],
      participants: ["player", charId],
    },
  });
  return { kind, effects, lines: reaction.lines, charId };
}
```

- [ ] **Step 4: Run tests + typecheck + lint**

Run: `npx vitest run tests/store/rankOps.test.ts && npm run typecheck && npm run lint`
Expected: PASS. (Lint allows this file: it's under `src/store`, not `src/engine`.)

- [ ] **Step 5: Commit**

```bash
git add src/store/rankOps.ts tests/store/rankOps.test.ts
git commit -m "feat: buildRankOp composes effects + reaction for the UI"
```

---

### Task 11: CharacterCard — composed 称呼, 封号 line, 管理 button

**Files:**
- Modify: `src/ui/components/CharacterCard.tsx`
- Modify: `src/ui/styles.css` (small additions)

- [ ] **Step 1: Update CharacterCard**

In `src/ui/components/CharacterCard.tsx`:
- Add import: `import { resolveDisplayName } from "../../engine/characters/standing";`
- Add an optional prop `onManage?: () => void` to the component's props type.
- Compute the name: replace the `<strong>` name with the composed name, and show the 封号 + the 管理 button. The header/rank block becomes:

```tsx
  const displayName = resolveDisplayName(character, standing, rank);
  const canManage = isConsort && character.id !== "feng_hou" && onManage;
  // ...
      <header className="char-card__header">
        <strong className="char-card__name">{displayName}</strong>
        <span className="char-card__kind">{isConsort ? "侍君" : "官员"}</span>
      </header>
      {rank && (
        <p className="char-card__rank">
          {isConsort ? "位分" : "官职"}：{rank.name}
          {standing?.title ? <span className="char-card__title">　封号：{standing.title}</span> : null}
        </p>
      )}
      <p className="char-card__role">{character.profile.role}</p>
      {canManage && (
        <button type="button" className="char-card__manage" onClick={onManage}>
          管理位分 / 封号
        </button>
      )}
```

(Keep the existing `attributes` block below.)

- [ ] **Step 2: Add styles**

Append to `src/ui/styles.css`:

```css
.char-card__title { color: #d9b87c; }
.char-card__manage {
  margin-top: 0.6rem;
  font-size: 0.78rem;
  padding: 0.25rem 0.6rem;
  background: #2a2017;
  color: #d9b87c;
  border: 1px solid #4a3b28;
  border-radius: 3px;
  cursor: pointer;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Callers not yet passing `onManage` are fine — it's optional.)

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/CharacterCard.tsx src/ui/styles.css
git commit -m "feat: card shows composed 称呼 + 封号 + 管理 button"
```

---

### Task 12: `RankAdminModal` component

**Files:**
- Create: `src/ui/components/RankAdminModal.tsx`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Create the modal**

Create `src/ui/components/RankAdminModal.tsx`:

```tsx
/**
 * 位分/封号 management modal (rank/title system). Three independent ops, each
 * with its own confirm; each produces a reaction via onApply.
 */
import { useState } from "react";
import { effectiveOrder } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent } from "../../engine/content/schemas";
import type { CharacterStanding } from "../../engine/state/types";
import type { RankOpRequest } from "../../store/rankOps";

export function RankAdminModal({
  db,
  character,
  standing,
  onApply,
  onClose,
}: {
  db: ContentDB;
  character: CharacterContent;
  standing: CharacterStanding;
  onApply: (req: RankOpRequest) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(standing.rank);
  const [title, setTitle] = useState("");
  const ladder = Object.values(db.ranks)
    .filter((r) => r.domain === "harem" && r.id !== "fenghou")
    .sort((a, b) => effectiveOrder(b, false) - effectiveOrder(a, false));
  const titleValid = /^[一-龥]{1,4}$/.test(title);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{character.profile.name}　管理位分 / 封号</h2>
        <p className="rank-modal__current">
          当前：{db.ranks[standing.rank]?.name}
          {standing.title ? `　封号「${standing.title}」` : "　无封号"}
        </p>

        <section className="rank-modal__section">
          <label>调整位分：</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {ladder.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}（{r.grade}）
              </option>
            ))}
          </select>
          <button type="button" disabled={target === standing.rank} onClick={() => onApply({ kind: "set_rank", rank: target })}>
            确认调整
          </button>
        </section>

        <section className="rank-modal__section">
          <label>封号：</label>
          <input value={title} maxLength={4} placeholder="1–4 字" onChange={(e) => setTitle(e.target.value)} />
          <button type="button" disabled={!titleValid} onClick={() => onApply({ kind: "set_title", title })}>
            {standing.title ? "改封" : "加封"}
          </button>
          <button type="button" disabled={standing.title === undefined} onClick={() => onApply({ kind: "remove_title" })}>
            褫夺封号
          </button>
        </section>

        <button type="button" className="rank-modal__close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add styles**

Append to `src/ui/styles.css`:

```css
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.rank-modal {
  background: #1b1510; border: 1px solid #4a3b28; border-radius: 6px;
  padding: 1.2rem 1.5rem; min-width: 22rem; color: #e8dcc8;
}
.rank-modal__current { color: #b8aa90; margin: 0.3rem 0 0.9rem; }
.rank-modal__section { display: flex; gap: 0.5rem; align-items: center; margin: 0.6rem 0; flex-wrap: wrap; }
.rank-modal__close { margin-top: 0.8rem; }
.rank-modal button { cursor: pointer; }
.rank-modal button:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/RankAdminModal.tsx src/ui/styles.css
git commit -m "feat: RankAdminModal (位分 ladder + 封号 input + 褫夺)"
```

---

### Task 13: `ReactionScreen` component

**Files:**
- Create: `src/ui/screens/ReactionScreen.tsx`

Replays the op's reaction lines through the dialogue seam, so the consort's NEW 称呼 + self-ref render.

- [ ] **Step 1: Create the screen**

Create `src/ui/screens/ReactionScreen.tsx`:

```tsx
/** Plays a 位分/封号 reaction (1–N lines) through the dialogue seam. */
import { useEffect, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { assembleDialogueRequest, produceDialogueLine } from "../../engine/dialogue/orchestrator";
import { mockProvider } from "../../engine/dialogue/providers/mockProvider";
import type { DialogueLine } from "../../engine/dialogue/types";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function ReactionScreen({
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
  const state = useGameState(store);
  const [index, setIndex] = useState(0);
  const [line, setLine] = useState<DialogueLine | null>(null);

  useEffect(() => {
    let alive = true;
    const text = lines[index];
    if (text === undefined) return;
    const req = assembleDialogueRequest(db, state, speakerId, state.playerLocation, { text });
    if (!req.ok) {
      onDone();
      return;
    }
    void produceDialogueLine(db, mockProvider, req.value).then((r) => {
      if (alive && r.ok) setLine(r.value);
      else if (alive) onDone();
    });
    return () => {
      alive = false;
    };
  }, [index]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!line) return null;
  const character = db.characters[speakerId]!;
  const portrait = registry.portrait(character.portraitSet, line.expression);
  const next = () => (index + 1 < lines.length ? setIndex(index + 1) : onDone());

  return (
    <main className="dialogue-screen" style={{ backgroundImage: `url("${registry.resolveVariant(
      db.locations[state.playerLocation]?.backgroundKey ?? "",
      timeOfDay(state.calendar),
      "background",
    ).url}")` }}>
      <img className="dialogue-screen__portrait" src={portrait.url} alt={line.speakerName} />
      <section className="dialogue-screen__box" onClick={next}>
        <strong className="dialogue-screen__speaker">{line.speakerName}</strong>
        <p className="dialogue-screen__text">{line.text}</p>
        <button type="button" className="hud__button" onClick={next}>（继续）</button>
      </section>
    </main>
  );
}
```

NOTE: confirm the className names match `DialogueScreen.tsx` (`dialogue-screen__portrait`, `__box`, `__speaker`, `__text`). If they differ, copy the exact classes from `DialogueScreen.tsx` so styling is reused.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/screens/ReactionScreen.tsx
git commit -m "feat: ReactionScreen replays rank-op reactions"
```

---

### Task 14: 御书房 roster in LocationScreen

**Files:**
- Modify: `src/ui/screens/LocationScreen.tsx`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Add an optional roster + manage hooks**

In `src/ui/screens/LocationScreen.tsx`:
- Add import: `import { resolveDisplayName, effectiveOrder } from "../../engine/characters/standing";`
- Add props `onManage: (charId: string) => void` to the component props.
- Pass `onManage={() => onManage(character.id)}` to each `<CharacterCard>`.
- When `location.id === "yushufang"`, render a roster section before `__present`:

```tsx
      {location.id === "yushufang" && (
        <section className="location-screen__roster">
          <h2>后宫名册</h2>
          {Object.values(db.characters)
            .filter((c) => c.kind === "consort" && c.id !== "feng_hou")
            .sort((a, b) => {
              const ra = state.standing[a.id], rb = state.standing[b.id];
              return effectiveOrder(db.ranks[rb!.rank]!, rb!.title !== undefined) -
                     effectiveOrder(db.ranks[ra!.rank]!, ra!.title !== undefined);
            })
            .map((c) => {
              const st = state.standing[c.id]!;
              return (
                <div key={c.id} className="roster-row">
                  <span>{resolveDisplayName(c, st, db.ranks[st.rank])}</span>
                  <span className="roster-row__rank">{db.ranks[st.rank]?.name}{st.title ? `·封号「${st.title}」` : ""}</span>
                  <button type="button" onClick={() => onManage(c.id)}>管理</button>
                </div>
              );
            })}
        </section>
      )}
```

- [ ] **Step 2: Add styles**

Append to `src/ui/styles.css`:

```css
.location-screen__roster { padding: 0.8rem 1rem; }
.roster-row { display: flex; gap: 0.8rem; align-items: center; padding: 0.3rem 0; border-bottom: 1px solid #2a2017; }
.roster-row__rank { color: #b8aa90; font-size: 0.85rem; margin-left: auto; }
.roster-row button { cursor: pointer; }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: FAIL — `App.tsx` doesn't pass `onManage` yet. That's wired in Task 15; proceed.

- [ ] **Step 4: Commit**

```bash
git add src/ui/screens/LocationScreen.tsx src/ui/styles.css
git commit -m "feat: 御书房 后宫名册 roster with 管理 entry points"
```

---

### Task 15: Wire the modal + reaction into App

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Add state + handlers**

In `src/ui/App.tsx`:
- Imports:

```typescript
import { RankAdminModal } from "./components/RankAdminModal";
import { ReactionScreen } from "./screens/ReactionScreen";
import { buildRankOp, type RankOpRequest } from "../store/rankOps";
```

- Add state:

```typescript
  const [manageCharId, setManageCharId] = useState<string | null>(null);
  const [reaction, setReaction] = useState<{ speakerId: string; lines: string[] } | null>(null);
```

- Add the apply handler:

```typescript
  const applyRankOp = (charId: string, req: RankOpRequest) => {
    const op = buildRankOp(db, store.getState(), charId, req);
    setManageCharId(null);
    if (!op) return; // no change
    const result = store.applyEffects(db, op.effects);
    if (result.ok) {
      doAutosave();
      setReaction({ speakerId: charId, lines: op.lines });
    }
  };
```

- Pass `onManage={(id) => setManageCharId(id)}` to `<LocationScreen>`.

- Render the modal + reaction (near the DebugPanel):

```tsx
      {manageCharId && store.getState().standing[manageCharId] && (
        <RankAdminModal
          db={db}
          character={db.characters[manageCharId]!}
          standing={store.getState().standing[manageCharId]!}
          onApply={(req) => applyRankOp(manageCharId, req)}
          onClose={() => setManageCharId(null)}
        />
      )}
      {reaction && (
        <ReactionScreen
          db={db}
          store={store}
          registry={registry}
          speakerId={reaction.speakerId}
          lines={reaction.lines}
          onDone={() => setReaction(null)}
        />
      )}
```

- [ ] **Step 2: Typecheck + lint + full test suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS across the board.

- [ ] **Step 3: Manual smoke (dev server)**

Run: `npm run dev`, then in the browser: 御书房 → 后宫名册 → 管理 沈承徽 → 调整位分 to 君 → 确认 → reaction 谢恩 shows, speaker reads **沈君** → close → roster shows 君. Add 封号 婉 → speaker/roster read **婉君**.

- [ ] **Step 4: Commit**

```bash
git add src/ui/App.tsx
git commit -m "feat: wire RankAdminModal + ReactionScreen into App"
```

---

### Task 16: e2e coverage

**Files:**
- Modify: `tests/e2e/smoke.spec.ts` (add a second test) OR create `tests/e2e/rank.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/rank.spec.ts`:

```typescript
import { expect, test } from "@playwright/test";

test("promote a consort from 御书房 and see the new 称呼", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新游戏" }).click();
  await page.getByRole("button", { name: /御书房/ }).click();
  // 后宫名册 → 管理 沈承徽
  const row = page.locator(".roster-row", { hasText: "沈承徽" });
  await row.getByRole("button", { name: "管理" }).click();
  // pick 君, confirm
  await page.locator(".rank-modal select").selectOption({ label: /君（从一品）/ });
  await page.getByRole("button", { name: "确认调整" }).click();
  // reaction shows the new 称呼 沈君
  await expect(page.getByText("沈君")).toBeVisible();
  await page.getByRole("button", { name: "（继续）" }).click();
  // roster now lists 沈君
  await expect(page.locator(".roster-row", { hasText: "沈君" })).toBeVisible();
});
```

- [ ] **Step 2: Run e2e**

Run: `npm run test:e2e`
Expected: both the existing smoke and this new test PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/rank.spec.ts
git commit -m "test: e2e for 位分 promotion + composed 称呼"
```

---

### Task 17: Docs

**Files:**
- Modify: `docs/world/50-harem-ranks.md` (shipped-ranks paragraph)
- Modify: `docs/engineering/10-current-implementation.md` (Recent additions)
- Modify: `README.md` (现在 section, character list)

- [ ] **Step 1: Update the docs**

- `50-harem-ranks.md`: change the "Currently shipped" paragraph to state the full §9.2 ladder is now in `world.json` + `lexicon.json`, and that the player can 升降位分 + 封号 (除皇后外).
- `10-current-implementation.md` "Recent additions": add a bullet — three new effects (`set_rank`/`set_title`/`remove_title`), composed 称呼 (`resolveDisplayName`), 封号 precedence (`effectiveOrder`), and the 管理 surfaces (card + 御书房 roster) with reactions.
- `README.md` 现在 section: note the 位分升降 + 封号 system and that 称呼 = 封号/姓 + 位分.

- [ ] **Step 2: Validate everything one last time**

Run: `npm run typecheck && npm run lint && npm test && npm run validate-content && npm run validate-manifest && npm run test:e2e`
Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add docs/world/50-harem-ranks.md docs/engineering/10-current-implementation.md README.md
git commit -m "docs: 位分升降 + 封号 system"
```

---

## Self-review notes (for the implementer)

- **Order reassignment (Task 6):** existing `fenghou`/`jun`/`chenghui` `order` values change. Verify no content uses `rankAtLeast` against an absolute number that assumed the old values (currently none ship). `npm run validate-content` + the full suite catch regressions.
- **Gate stability:** 本宫 is now shared across many ranks' `formal`; the gate's foreign-ref test for 凤后 relies on `臣侍` (still foreign), not 本宫 — already aligned from the prior dialogue pass.
- **`title` is optional everywhere** (type, schema, save) → older saves load unchanged.
- **ReactionScreen class names (Task 13):** verify against `DialogueScreen.tsx` before relying on shared CSS.
- **No new AP path:** rank ops call `store.applyEffects` directly (0 AP), never `resolveEvent`/travel.

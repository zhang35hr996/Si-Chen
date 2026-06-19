# Pregnancy & Heir System

**Status: pregnancy pipeline implemented; heir lifecycle implemented (2026-06-17).** The *worldbuilding* is in
[`../world/30-bloodline-pregnancy.md`](../world/30-bloodline-pregnancy.md). This
doc is the gameplay-layer design.

## What exists today

### Bloodline resources
- `legitimacy` (0–100) and `menstrualStatus` (`normal` | `irregular` | `absent`).
- Effects: `resource`/`bloodline`/`legitimacy` and `set_bloodline_status`.

### Pregnancy lifecycle (`bloodline.gestations[]`)
Each gestation carries: `id`, `bearerId`, `fatherId`, `startAt`, `dueAt`, `rngSeed`, `stage` (`early`/`mid`/`late`/`born`), `aborted`.

Triggered by 侍寝 (`firstNight` flag). Monthly checkpoint advances stage; `born` triggers `BirthScreen` and pushes a new `Heir` into `bloodline.heirs`.

### Heir data model (`bloodline.heirs[]`)
```ts
interface Heir {
  id: string;           // heir_000001, heir_000002 …
  sex: "daughter" | "son";
  fatherId: string | null;
  bearer: "sovereign" | string;
  birthAt: GameTime;
  favor: number;        // 0–100
  legitimate: boolean;
  petName: string;      // 小名 (2字), set at birth
  givenName?: string;   // 正名 (2字), set at 百日宴 (≥3 months old)
  education: { scholarship: number; martial: number; virtue: number }; // each 0–100, init 5
  adoptiveFatherId?: string;
}
```

### Heir lifecycle stages (derived, not stored)
| Stage | Age | Portrait |
|---|---|---|
| `infant` | 0–2 岁 | `child_baby` |
| `toddler` | 3–4 岁 | `child_baby` |
| `schooling` | ≥5 岁 | `child_school` |

Key derived functions in `src/engine/characters/heirs.ts`:
- `heirAgeMonths(heir, now)` — monthOrdinal difference
- `heirStage(heir, now)` — infant / toddler / schooling
- `centennialDue(heir, now)` — true when ≥3 months old and `givenName` not yet set
- `isEnrolled(heir, now)` — true when `heirStage === "schooling"`

### Heir effects (all bypass ±10 cappedDelta, clamp 0–100 directly)
| Effect | Fields | What it does |
|---|---|---|
| `heir_name` | `heirId`, `field: "pet"\|"given"`, `name` | sets `petName` or `givenName` |
| `heir_summon` | `heirId` | `favor += 20` (clamped) |
| `heir_educate` | `heirId`, `subject`, `attrDelta` (0–20), `favorDelta` (0–20) | `education[subject] += attrDelta`; `favor += favorDelta` |
| `heir_adopt` | `heirId`, `fatherId` | sets `adoptiveFatherId`; validates target is not deceased/冷宫 |

### Naming flow
- **小名** — modal appears immediately after birth; player inputs or rolls random from `PET_NAME_POOL` (seeded, deterministic). Commits `heir_name {field:"pet"}`.
- **百日宴** — auto-detected each render via `centennialDue`; dismissible per-month (「稍后再说」). Commits `heir_name {field:"given"}` + 司礼官 congratulation beat.

### Locations added for heir interaction
- **文昭殿** (`shangshufang`) — 问先生 (tutor report, 1 AP) and 问功课 (lesson with `heir_educate`, 1 AP). Only `isEnrolled` heirs appear.
- **奉先殿** (`fengxiandian`) — 择养父: pick heir → pick adoptive father from eligible pool → `heir_adopt` + scripted reaction (1 or 2 beats depending on whether bio-father is still in palace).

Both connect to 紫宸殿 (`yushufang`), cost 1 AP travel.

### 紫宸殿 heir interaction
`HeirListModal` (子嗣 button) lists all live heirs with format `大皇子（嫡）：长安（环环）`. Each row has a 召见 button (1 AP) → `heir_summon` + stage-appropriate scripted dialogue.

## 太后 (Empress Dowager) — implemented 2026-06-19

太后 is the sovereign's surviving elder (the gender-inverted 皇帝生父 figure): a `kind: "elder"`
character (`taihou`) with **no 位分 / attributes / standing**, living at **慈宁宫** (a 主图 travel
node rendered by its own `CiningGongScreen`). All logic is seeded-deterministic in
`src/store/taihou.ts`; the only new persisted state is `GameState.taihou.ill` (save **v4**).

### 对话
Fixed scripted scene `ev_taihou_converse` / `sc_taihou_converse` (1 AP, +legitimacy + a 太后 memory).
The event carries `checkpoint: "game_start"` purely as a *manual-trigger marker* — it never auto-fires
(the player is never at 慈宁宫 at game start); the 「与太后叙话」 button starts it directly. Do **not**
retag it `location_enter` (that would force the dialogue to pop on every arrival).

### 生病 (illness) — per-旬 roll
`buildTaihouIllnessTick` runs on each 旬 rollover:
- Not ill → falls ill with probability `taihouIllnessChance(year) = min(5 + max(0, year−1), 25)`%
  (元年 5%, +1%/yr, cap 25%), emitting a 司礼官 prompt beat.
- Ill → self-heals at 50%/旬 (silent).

Wired into **every** rollover path (`spendAp`, `restAlone`, `onTravelled`, and the scene-commit
`DialogueScreen.onDone`), de-duplicated per 旬 by the `tickedPeriods` ref. The ill state shows as a
「凤体违和」 badge on 太后's card.

### 侍疾 (tending) — entering 慈宁宫 while ill
`buildShizhiEncounter`: on entry to 慈宁宫 while 太后 is ill, a 50%/旬 roll (seed pinned per 旬, so
re-entering the same 旬 is idempotent) selects a 侍君 or 凤后 to tend her → **+5 恩宠** to the attendant
and **heals** 太后 (the heal is also what prevents double-application within a 旬).

### 敲打 (admonishment) — per action point
`buildTaihouRebuke`: each consumed AP has a 5% chance (skipped while 太后 ill) to summon a
**favor-weighted** 侍君 (凤后 excluded) for admonishment → **−5 恩宠** + 后宫 和睦 **+2**. Rolled inside
`spendAp` alongside the empress decree, using a `rebuke:`-prefixed `rolledSlots` key so the two are
independent. (Weighted pick uses `gestationRollRaw` so totals >99 stay reachable.)

### 养父 (adoptive father)
`eligibleAdoptiveFathers` includes the elder, and `heir_adopt` accepts an elder father (no standing
checks). Choosing 太后 yields a single pleased line — **no 谢恩, and no 生父泪报 even if the bio-father
is still in palace**.

> Roll-guard refs (`rolledSlots` / `tickedPeriods`) are cleared on new-game and load
> (`resetRollGuards`), so a prior session's keys never suppress the current game's rolls.

## Designed lifecycle (future — do not author against)

1. **承养 transfer mechanics** — dynamic candidate eligibility by resilience/favor/family; health drain on 承养人.
2. **Heir grown-up events** — marriage, succession competition, coming-of-age.
3. **Sub-旬 scheduling** — growth-stage transitions triggering scripted events automatically.

## Save format

Current save format is **v4** (laddered `MIGRATIONS[]` in `saveSystem.ts`):
- `2→3` (2026-06-17): backfills `petName: ""` and `education: {scholarship:5, martial:5, virtue:5}` on heirs missing those fields.
- `3→4` (2026-06-19): backfills `taihou: { ill: false }` on saves predating the 太后 system.

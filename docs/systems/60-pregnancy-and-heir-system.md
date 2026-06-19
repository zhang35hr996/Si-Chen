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
- **上书房** (`shangshufang`) — 问先生 (tutor report, 1 AP) and 问功课 (lesson with `heir_educate`, 1 AP). Only `isEnrolled` heirs appear.
- **奉先殿** (`fengxiandian`) — 择养父: pick heir → pick adoptive father from eligible pool → `heir_adopt` + scripted reaction (1 or 2 beats depending on whether bio-father is still in palace).

Both connect to 御书房 (`yushufang`), cost 1 AP travel.

### 御书房 heir interaction
`HeirListModal` (子嗣 button) lists all live heirs with format `大皇子（嫡）：长安（环环）`. Each row has a 召见 button (1 AP) → `heir_summon` + stage-appropriate scripted dialogue.

## Designed lifecycle (future — do not author against)

1. **承养 transfer mechanics** — dynamic candidate eligibility by resilience/favor/family; health drain on 承养人.
2. **Heir grown-up events** — marriage, succession competition, coming-of-age.
3. **Sub-旬 scheduling** — growth-stage transitions triggering scripted events automatically.

## Save format

Heirs are stored in `stateSchema` at save format **v3** (bumped from v2 on 2026-06-17). Migration `2→3` backfills `petName: ""` and `education: {scholarship:5, martial:5, virtue:5}` on heirs missing those fields.

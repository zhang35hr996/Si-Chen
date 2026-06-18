# Calendar & Action Points

Source: `src/engine/calendar/time.ts`. **Status: implemented.**

## Time structure

- 1 year = 12 months; 1 month = 3 action-days: **上旬 / 中旬 / 下旬** (`period` =
  `early` / `mid` / `late`).
- Each action-day has **`apMax` = 6** action points.
- Spending the last AP **rolls the day** (上旬→中旬→下旬→次月上旬; 十二月下旬→次年一月上旬)
  and refills AP. There is no AP rollover hoarding.

## 时辰 / time-of-day (背景变体)

The action slot you're about to act in (`slot = apMax − ap`) maps to a 时辰 and a
time-of-day bucket that selects which background variant renders:

| Slot | 时辰 | 时段 | time-of-day |
|---|---|---|---|
| 0 | 卯时 | 早上 | day |
| 1 | 辰时 | 上午 | day |
| 2 | 申时 | 下午 | day |
| 3 | 酉时 | 黄昏 | twilight |
| 4 | 戌时 | 晚上 | night |
| 5 | 子时 | 深夜 | night |

The HUD shows e.g. `元年一月上旬 · 卯时（早上）` — never a raw AP number. Backgrounds
resolve `bg.<x>.<twilight|night>` variants, falling back to the base art.

## AP spending & events

- Travel costs the destination's `travelCost.ap`.
- A scene/event reserves its `apCost` at entry, spends at commit.
- An action is only offered if affordable; the reducer is the final backstop.

## Free-view vs travel locations

- **travel** node — costs AP, becomes `playerLocation`, full-screen location.
- **free** node — opened from the map without AP or relocation (冷宫 look-only,
  朝堂 look + 上朝). A free node may expose **one** AP-costing action via `actionEventId`.

## Implementation status

Implemented: full calendar, AP, 时辰 buckets, roll-over, travel/free distinction.
Not modeled: per-旬 thematic gating (上旬 朝政 / 中旬 后宫 / 下旬 宗嗣 is lore guidance,
not enforced), seasons, multi-AP action tiers (events declare an explicit `apCost`).

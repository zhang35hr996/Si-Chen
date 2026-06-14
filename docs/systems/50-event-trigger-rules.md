# Event Trigger Rules

Sources: `src/engine/events/engine.ts`, `conditions.ts`; schema `gameEventSchema`.
**Status: implemented.**

## Event fields

- `checkpoint`: when the engine considers it — `game_start`, `location_enter`,
  `time_advance`, `scene_end`.
- `condition`: a closed DSL (see below). Must be satisfied to fire.
- `priority`: integer; higher wins at a checkpoint.
- `once`: fires at most once ever.
- `cooldown` (optional): `{ actionDays: N }` — minimum action-days between fires.
- `apCost`: reserved at entry, spent at commit. Must be affordable to fire.
- `public` + `headline` (optional): surfaces a court-news headline.

## Condition DSL (closed set)

`all`, `any`, `not`, `flagSet`, `eventFired`, `relationshipAtLeast`,
`favorAtLeast`, `rankAtLeast`, `hasMemoryTag`, `periodIs`, `monthAtLeast`,
`atLocation`. **No resource/bloodline predicates by design** (scaffold guard).

## Selection policy (important)

At a single checkpoint the engine selects **one** event: the highest-priority,
affordable, condition-satisfied, not-on-cooldown, not-already-used candidate.

- Lower-priority eligible events do **not** auto-fire in the same beat.
- Sequence events with **priority + cooldown + flags + `scene_end` chains**, not
  by assuming a backlog drains.
- `scene_end` chains are capped (currently 3 per player action) to prevent runaway
  chains; beyond the cap the next event is deferred with a logged warning.

## Checkpoint precedence

After a day rollover, `time_advance` is checked before `location_enter`. `game_start`
runs once at new-game. `scene_end` runs after a scene commits (and may chain).

## Authoring tips

- Gate first-visit content with `atLocation` + `not eventFired` (or `once: true`).
- Use `hasMemoryTag` for per-character follow-ups (e.g. a character who remembers
  neglect reacts later).
- Keep `apCost` honest — an unaffordable high-priority event blocks nothing; it's
  simply skipped that beat.

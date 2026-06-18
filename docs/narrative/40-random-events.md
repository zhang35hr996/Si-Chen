# Random & Ambient Events

The engine has no RNG event roller; "random-feeling" variety comes from many
**conditioned** events competing at checkpoints by priority. Determinism is a
feature (same content + state + seed ⇒ same outcome).

## How to get variety

- Author several low-priority `location_enter` / `time_advance` events with
  different conditions (period, month, location, favor, memory tags). The
  highest-priority eligible one fires; the rest wait their turn.
- Use `cooldown` so an ambient beat doesn't repeat back-to-back.
- Use `flagSet`/`eventFired`/`hasMemoryTag` to retire or rotate beats over time.

## Cadence guidance (lore, not enforced)

- 上旬 — 朝政/外务 flavored ambients.
- 中旬 — 后宫/人际.
- 下旬 — 宗嗣/内务 (经血祭祀, checks).

Encode that cadence with `periodIs` conditions if you want it.

## Caution

There is no event backlog drain: only one event fires per checkpoint. Don't author
"a burst of three things happen at once" — chain them via `scene_end` (capped) or
spread them across action beats.

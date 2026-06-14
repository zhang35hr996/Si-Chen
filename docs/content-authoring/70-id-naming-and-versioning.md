# ID Naming & Versioning

## ID format

lowercase `snake_case`, ascii, must start with a letter: `^[a-z][a-z0-9_]*$`.

| Good | Bad |
|---|---|
| `feng_hou` | `FengHou` |
| `shen_chenghui` | `event1` |
| `yushufang` | `new_scene_test` |
| `ev_lenggong_first_visit` | `冷宫初遇` |
| `sc_lenggong_first_visit` | `sc-lenggong` |

IDs must be **semantic** — name the thing, not its creation order.

## Prefixes

- **Character / location / rank ids** — no prefix; semantic name (`shen_chenghui`,
  `lenggong`, `chenghui`).
- **Event ids** — `ev_…`
- **Scene ids** — `sc_…`
- **Arc-scoped content** — `arc_<arc>__ev_…` / `arc_<arc>__sc_…` (double underscore
  separates the arc namespace), e.g. `arc_lenggong__ev_first_visit`.

## Stability

- After content version **`0.2.0`**, **do not rename ids.** Renaming a shipped id
  can quarantine or invalidate saves (no automatic aliasing — see
  [`../engineering/40-save-system.md`](../engineering/40-save-system.md)).
- Before `0.2.0` (now), save breakage on rename is acceptable.

## Tags (memory)

Lowercase ascii, `^[a-z0-9_]+$`, ≤5 per entry. Reuse a small, intentional
vocabulary (`neglect`, `favor`, `rivalry`, `rescued`, `kindness`…) so
`hasMemoryTag` conditions stay legible.

## Versioning

`world.json` `contentVersion` tracks the content contract. Bump it when you make a
breaking content change; keep it in sync with what
[`../engineering/10-current-implementation.md`](../engineering/10-current-implementation.md)
describes.

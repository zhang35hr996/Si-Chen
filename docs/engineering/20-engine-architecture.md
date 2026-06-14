# Engine Architecture

A concise map of the runtime. For the authoritative capability list see
[`10-current-implementation.md`](10-current-implementation.md); for full original
intent see [`../archive/DESIGN.md`](../archive/DESIGN.md).

## Module map (`src/engine/`)

| Module | Responsibility |
|---|---|
| `content/` | Load & Zod-validate all `content/**.json`; collect cross-reference errors; freeze the `ContentDB`. (`loader.ts`, `schemas.ts`, `viteSource.ts`) |
| `state/` | The single authoritative `GameState`; pure reducer (`applyCommand`/`applyBatch`); `newGame.ts` seeds from content. |
| `calendar/` | Time model: year/month/旬, action points, 时辰 / time-of-day buckets. |
| `events/` | Condition DSL evaluation (`conditions.ts`) + checkpoint event selection (`engine.ts`). |
| `scenes/` | Scene runner: walks `line`/`choice`/`branch`/`effect` nodes; effects funnel through the reducer. |
| `map/` | Travel legality (`travel.ts`) — fast-travel menu, AP cost, free-view guard. |
| `memory/` | Append-only per-character memory store. |
| `dialogue/` | Provider seam for AI lines (stub today). |
| `assets/` | `AssetRegistry` — never-throws asset resolution with built-in fallbacks; `manifest.ts`. |
| `save/` | Checksum + content-hash + missing-ref quarantine; autosave. |
| `infra/` | `Result`, structured `GameError`, ring-buffer logger. |

## Key invariants

- **Content is data, never mutated.** `ContentDB` is frozen after load.
- **One effect funnel.** Every state change is a `GameCommand` applied by the
  reducer — scenes, travel, and events all go through it. AP is reserved at scene
  entry and spent at commit.
- **Errors are collected, not first-failed.** One validator run lists every problem.
- **Determinism.** Given the same content, state, and seed, outcomes are identical.

## Content → screen flow

1. `viteSource.ts` (browser) / `tools/validate-content.ts` (disk) read `content/**`.
2. `loadContent()` validates + cross-checks → frozen `ContentDB`.
3. `App.tsx` runs checkpoints (`game_start`, `location_enter`, `time_advance`,
   `scene_end`) via `pickNextEvent`, opening scenes in `DialogueScreen`.
4. The map (`MapScreen`) reads `world.mapBoards`/`mapPortals` to render board
   backdrops + portals; travel dispatches a `MOVE_TO_LOCATION` + `SPEND_AP` batch.

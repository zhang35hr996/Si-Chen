# Testing & CI

## Commands

| Command | What it checks |
|---|---|
| `npm test` | Vitest unit/integration suite (`tests/**`). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run validate-content` | Loads `content/**`, reports every schema/cross-ref error. |
| `npm run validate-manifest` | Manifest paths exist on disk; every referenced asset key present with the right kind; reports orphans & placeholder %. |
| `npm run test:e2e` | Playwright smoke (`tests/e2e/`). |

**Green bar before commit** = `typecheck` + `test` + `validate-content` +
`validate-manifest` all pass.

## Test layout (`tests/`)

Mirrors `src/engine/` (`content/`, `state/`, `events/`, `calendar/`, `map/`,
`memory/`, `scenes/`, `assets/`, `store/`) plus `e2e/`. Engine tests load the
**real** shipped content via `tests/helpers/contentFixture.ts`, so a content
change that breaks an invariant fails a test.

## Adding content safely

1. Author the JSON.
2. `npm run validate-content` (and `validate-manifest` if you touched art).
3. `npm test` — the real-content fixtures will catch dangling refs / bad graphs.

## Conventions

- New engine behavior gets a test **first** (TDD). New predicates/effects get a
  truth-table row in the relevant `tests/**` file and a loader cross-ref test.
- The manifest test asserts an exact entry count — update it when you add assets.

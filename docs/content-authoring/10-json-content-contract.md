# JSON Content Contract

The rules every `content/**.json` file must obey. Violations fail
`npm run validate-content` (which collects **all** errors per run).

## Hard rules

1. **Strict JSON.** No comments, no trailing commas. (Templates included.)
2. **No unknown keys.** Schemas are strict — an extra/misspelled key is an error.
3. **Stable, semantic IDs.** lowercase `snake_case` (`^[a-z][a-z0-9_]*$`). See
   [`70-id-naming-and-versioning.md`](70-id-naming-and-versioning.md).
4. **Cross-references must resolve.** Every referenced `char` / `location` /
   `scene` / `rank` / `event` id must exist.
5. **Author to the current implementation, not future design docs.** If a field
   isn't in [`../engineering/10-current-implementation.md`](../engineering/10-current-implementation.md),
   it doesn't exist yet.

## Where files go

| Type | Directory | One file per |
|---|---|---|
| character | `content/characters/` | character |
| location | `content/locations/` | location |
| event | `content/events/` | event |
| scene | `content/scenes/` | scene |
| world | `content/world.json` | (singleton) |
| lexicon | `content/lexicon.json` | (singleton) |

`content/_templates/` is **ignored** by both content loaders (browser glob and the
disk validator) — templates never load as game content, so they can't break
validation. Anything else outside the known directories is also ignored.

## Bounds the validators enforce (high-value ones)

- Effect deltas: integer in **±10** per effect.
- Percentages (favor, trust, affinity, salience, resources): integer **0–100**.
- `memory.summary` ≤ 240 chars; `tags` ≤ 5, lowercase; `participants` ≥ 1.
- Scene `line.text` ≤ 600; `choice.text` ≤ 120; 1–4 choices per choice node.
- Scene graph must be reachable from `startNodeId` and have a terminal node.
- Map `connections` must be **symmetric** (A→B requires B→A).

## Workflow

```
edit JSON  →  npm run validate-content  →  (touched art? npm run validate-manifest)  →  npm test
```

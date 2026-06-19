# Relationship & Memory

Sources: `src/engine/state/types.ts`, `src/engine/memory/`,
`src/engine/events/conditions.ts`.

## Relationship & favor (implemented)

- `relationships[char]`: `trust`, `affinity` (0–100), and a string `flags[]`.
- `standing[char]`: `rank` + `favor` (0–100).
- Changed only via scene `effect` nodes (`relationship`, `favor` effects), each
  bounded ±10 per effect.
- Read in conditions via `relationshipAtLeast`, `favorAtLeast`, `rankAtLeast`.

## Memory (implemented — append-only)

- `memories[char]` = `{ entries[], nextSeq }`. Each entry has: `id`, `kind`,
  `summary` (≤240, third-person, that character's POV), `salience` (0–100),
  `createdAt`, `tags[]` (≤5, lowercase), `participants[]` (incl. `"player"`),
  optional `locationId`, `source` (`authored` | `scene_outcome`), `protected`.
- **Seeded** from each character's `initialMemories` (protected by default).
- **Written** by scene `memory` effects (always **unprotected** — authored seeds
  may be protected, scene outcomes never are).
- **Queried** via the `hasMemoryTag` condition:
  `{ "hasMemoryTag": { "char": "<id>", "tag": "<tag>" } }` — true when that
  character has ≥1 entry carrying the tag.

## What memory does NOT do yet

- No retrieval, salience scoring, recency ranking, or consolidation.
- No LLM-driven memory selection.
- The only query is presence-of-tag.

## Unlocks: flags vs memory tags

Both are valid; choose by intent:

- **Flag** — a global story switch ("the rite has been scheduled"). Use
  `flag` effect + `flagSet` condition.
- **Memory tag** — a *per-character* fact ("陆怀瑾 remembers being neglected").
  Use a `memory` effect with a `tag` + `hasMemoryTag` condition. Prefer this when
  the unlock is about one character's experience, so it reads naturally and scales
  to many characters.

## Implementation status

Implemented: relationship/favor/rank state + effects + conditions; append-only
memory with tags + `hasMemoryTag`. Future: retrieval/scoring/consolidation,
richer memory queries (count/recency).

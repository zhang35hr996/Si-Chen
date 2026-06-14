# Current Implementation Contract

**This is the authoritative statement of what the engine supports today.** Other
docs may describe designed-ahead or future systems; when they conflict with this
file, this file wins. The ultimate source is the Zod schemas in
[`src/engine/content/schemas.ts`](../../src/engine/content/schemas.ts) — content
is **strict** (unknown keys fail validation), so a field absent here cannot be used.

Last updated: content version `0.1.0`.

## Capability table

| Area | Implemented | Designed later | Not supported |
|---|---|---|---|
| **Scene nodes** | `line`, `choice`, `branch`, `effect` | `generate` (LLM node) | arbitrary scripts |
| **Conditions** | `all`, `any`, `not`, `flagSet`, `eventFired`, `relationshipAtLeast`, `favorAtLeast`, `rankAtLeast`, `hasMemoryTag`, `periodIs`, `monthAtLeast`, `atLocation` | richer memory queries (count/recency) | `secretRevealed`, resource/bloodline predicates (scaffold guard) |
| **Effects** | `relationship`, `favor`, `resource` (court/harem/bloodline), `set_bloodline_status`, `flag`, `memory` (unprotected) | lineage effects | direct calendar/location mutation from scenes |
| **Characters** | `consort`, `official` | wider roles | nested schedules, secrets gameplay (`secrets` must be empty) |
| **Map** | data-driven `mapBoards` + `mapPortals`; `travel` nodes (cost AP, relocate) and `free` nodes (view only, optional one AP action) | per-area sub-graphs, time-gated portals | adjacency-restricted travel (it's fast-travel) |
| **Calendar** | year / month / 上中下旬 period; `apMax` (6) action points; 时辰 time-of-day buckets driving background variants | seasonal events | sub-旬 scheduling |
| **Memory** | append-only entries with tags; seeded from `initialMemories`; written by scene `memory` effects; queried via `hasMemoryTag` | retrieval / salience scoring / consolidation | LLM-driven memory retrieval |
| **AI dialogue** | provider seam + stub remote provider | real provider, eval harness | unrestricted state mutation by the model |
| **Save** | checksum, content-hash warning, missing-ref quarantine, autosave on scene-commit & travel | save migrations | automatic ID aliasing |
| **Resources** | court (authority/publicSupport/factionPressure), harem (harmony/jealousy), bloodline (legitimacy/menstrualStatus) — written by effects | faction simulation | resource-based event conditions (deliberately none) |

## Hard rules content must obey

- **Strict JSON.** No comments, no trailing commas, no unknown keys.
- **Stable IDs.** lowercase `snake_case`; see
  [`../content-authoring/70-id-naming-and-versioning.md`](../content-authoring/70-id-naming-and-versioning.md).
- **Cross-references must resolve.** Every `char`/`location`/`scene`/`rank`/`event`
  id referenced must exist, or the loader errors (it collects *all* errors per run).
- **Content matches *this* file, not future design docs.** If a system is marked
  "Designed later" / "Not supported", do not author content that assumes it.

## The scaffold guard (why some predicates are missing)

The condition DSL has **no** resource or bloodline predicates by design. Event
logic therefore *structurally cannot* branch on scaffold-only numbers — a
condition referencing one fails schema validation rather than silently reading a
placeholder. Keep it that way until those systems are real.

## Recent additions

- **`hasMemoryTag` condition** — `{ "hasMemoryTag": { "char": "<id>", "tag": "<tag>" } }`.
  True when that character holds ≥1 memory entry carrying the tag. See
  [`../systems/40-relationship-memory.md`](../systems/40-relationship-memory.md).
- **Data-driven map boards** — `world.json` declares `mapBoards` (主图/子图 backdrops)
  and `mapPortals` (出宫 / 后宫 / 郊外 buttons). A location's `zone` names its board.

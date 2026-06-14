# Si-Chen Documentation Index

This is the **master routing index**. Read only the files a task needs — no task
should require reading the whole corpus.

The docs are split into five domains:

| Domain | Folder | What lives here |
|---|---|---|
| **World** | [`world/`](world/00-index.md) | Lore, setting, ranks, kinship, taboo. *No engine fields.* |
| **Systems** | [`systems/`](systems/00-index.md) | Gameplay mechanics: time, attributes, memory, events. Each marks its implementation status. |
| **Narrative** | [`narrative/`](narrative/00-index.md) | Story planning: arcs, random events, dialogue style. |
| **Content authoring** | [`content-authoring/`](content-authoring/00-index.md) | How to write valid JSON content. Templates + contract. |
| **Engineering** | [`engineering/`](engineering/00-index.md) | Code architecture, the current-implementation contract, CI. |

The single source of truth for **what the engine supports today** is
[`engineering/10-current-implementation.md`](engineering/10-current-implementation.md).
When lore and code disagree, the code (and that contract) win.

Old broad drafts now live in [`archive/`](archive/) and are **not** authoritative.

---

## Route by task

### Writing a new character
- [`world/50-harem-ranks.md`](world/50-harem-ranks.md)
- [`world/70-taboo-and-lexicon.md`](world/70-taboo-and-lexicon.md)
- [`systems/20-character-attributes.md`](systems/20-character-attributes.md)
- [`systems/30-personality-archetypes.md`](systems/30-personality-archetypes.md)
- [`content-authoring/20-character-template.md`](content-authoring/20-character-template.md)

### Writing a new event / scene
- [`systems/50-event-trigger-rules.md`](systems/50-event-trigger-rules.md)
- [`content-authoring/40-event-template.md`](content-authoring/40-event-template.md)
- [`content-authoring/50-scene-template.md`](content-authoring/50-scene-template.md)
- [`narrative/50-dialogue-style-guide.md`](narrative/50-dialogue-style-guide.md)
- [`world/70-taboo-and-lexicon.md`](world/70-taboo-and-lexicon.md)

### Writing a new location / map area
- [`systems/10-calendar-and-action-points.md`](systems/10-calendar-and-action-points.md) (free-view vs travel)
- [`content-authoring/30-location-template.md`](content-authoring/30-location-template.md)
- [`engineering/10-current-implementation.md`](engineering/10-current-implementation.md) (map boards & portals)

### Writing pregnancy / heir content
- [`world/30-bloodline-pregnancy.md`](world/30-bloodline-pregnancy.md)
- [`systems/60-pregnancy-and-heir-system.md`](systems/60-pregnancy-and-heir-system.md) (mostly future design)
- [`world/40-imperial-family.md`](world/40-imperial-family.md)

### Changing engine code
- [`engineering/10-current-implementation.md`](engineering/10-current-implementation.md)
- [`engineering/20-engine-architecture.md`](engineering/20-engine-architecture.md)
- `src/engine/content/schemas.ts` (the runtime contract in code)

### Before starting a content pack
- [`content-authoring/00-index.md`](content-authoring/00-index.md) — readiness checklist.

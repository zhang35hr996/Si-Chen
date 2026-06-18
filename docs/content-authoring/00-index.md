# Content Authoring

Everything needed to write valid game content **without reading `schemas.ts`**.
Each content type has a minimal valid template under
[`content/_templates/`](../../content/_templates/) and a doc here.

| File | Purpose |
|---|---|
| [`10-json-content-contract.md`](10-json-content-contract.md) | The non-negotiable rules for all content JSON. |
| [`20-character-template.md`](20-character-template.md) | Character fields, ranks, memory, portraits. |
| [`30-location-template.md`](30-location-template.md) | Locations, zones/boards, travel vs free-view. |
| [`40-event-template.md`](40-event-template.md) | Events: triggers, conditions, priority, cooldown. |
| [`50-scene-template.md`](50-scene-template.md) | Scene node types with examples. |
| [`60-validation-errors.md`](60-validation-errors.md) | Common validator errors and fixes. |
| [`70-id-naming-and-versioning.md`](70-id-naming-and-versioning.md) | ID format, prefixes, stability. |

Authoritative field list: [`../engineering/10-current-implementation.md`](../engineering/10-current-implementation.md).

---

## Content Expansion Readiness Checklist

Before adding a new content pack, confirm:

- [x] `docs/README.md` routes the task to specific docs.
- [x] Relevant world docs exist (`docs/world/*`).
- [x] Relevant system docs exist (`docs/systems/*`).
- [x] Current-implementation contract is up to date.
- [x] JSON templates exist (`content/_templates/*`).
- [x] Content scaffold tool exists (`npm run new:*`).
- [x] Event trigger policy is documented (`systems/50-event-trigger-rules.md`).
- [x] ID naming/versioning policy is documented (`content-authoring/70-…`).
- [ ] `npm run validate-content` passes.
- [ ] `npm run validate-manifest` passes.
- [ ] `npm test` passes.

(Run the last three each time you add content.)

## First Content Pack: Cold Palace Intro

The proving pack uses only currently-implemented systems:

- **Location** — `lenggong` (冷宫, already shipped as a free-view node).
- **Character** — one cold-palace consort.
- **Events** — first visit; a follow-up gated on favor/memory; a `scene_end`
  consequence.
- **Scenes** — intro, a choice, a consequence.

**Constraints:** scripted only; no real AI provider; no `generate` nodes; no active
secret system; no pregnancy-system implementation; no faction simulation. The pack
must validate cleanly and require no engine refactor. See the shipped pack in
`content/characters/wenya_shijun.json` and `content/events/arc_lenggong__*` once added.

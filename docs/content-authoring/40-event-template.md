# Event Template

Minimal valid file: [`content/_templates/event.json`](../../content/_templates/event.json).
Scaffold one with `npm run new:event <id>`. Full rules:
[`../systems/50-event-trigger-rules.md`](../systems/50-event-trigger-rules.md).

## Minimal valid event

```json
{
  "id": "ev_example",
  "title": "示例事件",
  "sceneId": "sc_example",
  "checkpoint": "location_enter",
  "condition": { "all": [{ "atLocation": "yushufang" }, { "not": { "eventFired": "ev_example" } }] },
  "priority": 1,
  "once": true,
  "apCost": 1
}
```

## Checkpoints

`game_start` · `location_enter` · `time_advance` · `scene_end`. The engine fires
**one** event per checkpoint — the highest-priority eligible one.

## Condition examples

```json
{ "favorAtLeast": { "char": "shen_chenghui", "value": 50 } }
{ "relationshipAtLeast": { "char": "shen_chenghui", "field": "affinity", "value": 40 } }
{ "rankAtLeast": { "char": "feng_hou", "rank": "chenghui" } }
{ "hasMemoryTag": { "char": "shen_chenghui", "tag": "neglect" } }
{ "periodIs": "late" }
{ "monthAtLeast": 3 }
{ "all": [ { "atLocation": "lenggong" }, { "not": { "eventFired": "ev_lenggong_first" } } ] }
```

No resource/bloodline predicates exist (scaffold guard).

## Location-enter (first visit) example

```json
{
  "id": "ev_lenggong_first",
  "title": "冷宫初遇",
  "sceneId": "sc_lenggong_first",
  "checkpoint": "location_enter",
  "condition": { "all": [{ "atLocation": "lenggong" }, { "not": { "eventFired": "ev_lenggong_first" } }] },
  "priority": 10,
  "once": true,
  "apCost": 0
}
```

## Scene-end chained event example

Fire a follow-up right after another scene commits:

```json
{
  "id": "ev_lenggong_after",
  "title": "冷宫余波",
  "sceneId": "sc_lenggong_after",
  "checkpoint": "scene_end",
  "condition": { "all": [{ "eventFired": "ev_lenggong_first" }, { "hasMemoryTag": { "char": "wenya_shijun", "tag": "rescued" } }] },
  "priority": 5,
  "once": true,
  "apCost": 0
}
```

`scene_end` chains are capped (3 per action) — don't rely on long auto-chains.

## Priority / cooldown / once

- `priority`: higher wins ties at a checkpoint.
- `once: true`: never repeats.
- `cooldown: { "actionDays": 3 }`: minimum action-days between fires (for
  repeatable ambient events).
- `apCost`: reserved at entry, spent at commit; unaffordable ⇒ skipped this beat.
- `public: true` + `headline` (≤60): emits a court-news headline.

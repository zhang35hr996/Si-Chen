# Scene Template

Minimal valid file: [`content/_templates/scene.json`](../../content/_templates/scene.json).
Scaffold one with `npm run new:scene <id>`.

## Node types (the only four)

| Type | Shape | Routing |
|---|---|---|
| `line` | `{ type, id, speaker, text, expression?, next? }` | `next` (none ⇒ terminal) |
| `choice` | `{ type, id, choices[1..4] }` | each choice has `next` (+ optional `condition`, `tone`, `isExit`) |
| `branch` | `{ type, id, condition, ifTrue, ifFalse }` | to one of two node ids |
| `effect` | `{ type, id, effects[1..], next? }` | `next` (none ⇒ terminal) |

A scene needs `id`, `locationId`, `participants[]`, `startNodeId`, `nodes[]`. Every
node id unique; all routes resolve; all nodes reachable from `startNodeId`; at
least one reachable terminal. `speaker` must be a `participant`.

## Linear scene

```json
{
  "id": "sc_linear",
  "locationId": "yushufang",
  "participants": ["example_character"],
  "startNodeId": "n1",
  "nodes": [
    { "type": "line", "id": "n1", "speaker": "example_character", "text": "陛下。", "next": "n2" },
    { "type": "line", "id": "n2", "speaker": "example_character", "text": "臣侍告退。" }
  ]
}
```

## Choice scene

```json
{
  "type": "choice",
  "id": "n_choice",
  "choices": [
    { "id": "c_warm", "text": "温言抚慰", "tone": "friendly", "next": "n_warm" },
    { "id": "c_cool", "text": "淡淡略过", "tone": "guarded", "next": "n_cool" }
  ]
}
```

`tone`: `friendly` | `neutral` | `guarded` | `hostile` | `flirty`. A choice may
carry a `condition` (hidden when false) and `isExit: true`.

## Branch scene (conditional routing)

```json
{ "type": "branch", "id": "n_gate", "condition": { "favorAtLeast": { "char": "example_character", "value": 50 } }, "ifTrue": "n_close", "ifFalse": "n_distant" }
```

## Effect node (the only way to change state)

```json
{
  "type": "effect",
  "id": "n_reward",
  "effects": [
    { "type": "favor", "char": "example_character", "delta": 3 },
    { "type": "relationship", "char": "example_character", "field": "affinity", "delta": 2 },
    { "type": "flag", "key": "met_example", "value": true },
    {
      "type": "memory",
      "char": "example_character",
      "entry": { "kind": "event", "summary": "陛下温言相待，本位记下了。", "salience": 30, "tags": ["player", "kindness"], "participants": ["player", "example_character"] }
    }
  ]
}
```

Effect types: `relationship`, `favor`, `resource` (court/harem/bloodline),
`set_bloodline_status`, `flag`, `memory`. Deltas are ±10. Scene `memory` entries
are always unprotected.

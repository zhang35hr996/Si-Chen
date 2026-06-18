# Dialogue Provider

**Status: seam only.** Scenes today are fully scripted JSON. The
`DialogueProvider` interface exists so AI-generated lines can slot in later
without rewriting scenes.

## Today

- Scenes are authored `line` nodes with fixed `text`.
- A stub remote provider exists behind the interface for wiring/tests.
- There is **no** `generate` scene node yet (see the contract).

## When a real provider lands (future)

- It must be confined to producing **dialogue text**, never mutating `GameState`.
- All state changes stay in `effect` nodes routed through the reducer.
- An eval harness will gate prompt/output quality before any provider ships.

Do not author content that assumes AI generation. Until `generate` is in the
contract, every line is scripted.

# Save System

Source: `src/engine/save/`.

## What it does today

- **Autosave** on two hooks only: scene **commit** and **travel**. Never mid-scene.
  Slots: `auto` and `auto.prev` (one level of undo).
- **Integrity**: each save carries a checksum and a content hash. A mismatch
  between the save's content hash and the loaded `ContentDB` raises a
  warning ("content changed since this save").
- **Missing-ref quarantine**: if a save references content ids that no longer
  exist (e.g. a deleted character), the load is recovered with warnings rather
  than crashing.
- **Recovery**: `loadWithRecovery` returns the best-effort state plus a list of
  warnings the UI surfaces.

## Not yet

- **Save migrations** (versioned transforms) — designed later.
- **Automatic ID aliasing** — not supported. Renaming a shipped id can break or
  quarantine saves; see [`../content-authoring/70-id-naming-and-versioning.md`](../content-authoring/70-id-naming-and-versioning.md).

## Implication for content authors

Before content version `0.2.0`, save breakage is acceptable. After that, treat
ids as immutable.

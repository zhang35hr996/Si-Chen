# Validation Errors

`npm run validate-content` collects **every** error per run. Codes you'll meet:

| Code | Meaning | Fix |
|---|---|---|
| `SCHEMA` | A field is wrong/missing or an unknown key is present | Match the template; remove stray keys; check types & bounds |
| `DUPLICATE_ID` | Two files (or ranks) share an id | Rename one; ids are global per kind |
| `MISSING_REF` | A referenced id doesn't exist | Create the target or fix the typo (char/location/scene/rank/event/mapBoard) |
| `BAD_RANK` | consort holds an official rank (or vice versa) | Match `kind` to the rank's domain |
| `ASYMMETRIC_MAP` | A→B without B→A, or a self-connection | Add the return edge; remove self-links |
| `BAD_MAP_GRAPH` | A portal links a board to itself | Point the portal at a different board |
| `BAD_SCENE_GRAPH` | Bad `startNodeId`, dangling/unreachable node, no terminal, non-participant speaker | Fix routing; ensure a `line`/`effect` with no `next`; add speaker to `participants` |
| `LEXICON` | `lexicon.json` disagrees with `world.json` ranks, or a term is both approved & forbidden | Keep rank `selfRefs` identical in both; every rank needs a `rankAddressRules` entry |

## Manifest errors (`npm run validate-manifest`)

| Code | Meaning | Fix |
|---|---|---|
| `MISSING_ASSET_KEY` | Content references an asset key not in the manifest | Add the manifest entry |
| `ASSET_FILE_MISSING` | A manifest entry points at a missing file | Add the file or fix the path |
| `ASSET_KIND_MISMATCH` | Key exists but wrong kind | Use the right `kind` (portrait/background/ui/map) |
| `ASSET_NAMING` (warning) | `backgroundKey` ≠ `bg.<id>` convention | Fine for shared backdrops; rename otherwise |
| `ORPHAN_FILE` (warning) | A file on disk no manifest entry claims | Add an entry or delete the file |

> The manifest test asserts an exact `entryCount`. When you add assets, update
> that assertion in `tests/assets/manifestCheck.test.ts`.

## Tips

- Read the **whole** error list — fixing the first often clears several.
- Each message includes the offending `file` and the bad id/field.

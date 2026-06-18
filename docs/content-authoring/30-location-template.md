# Location Template

Minimal valid file: [`content/_templates/location.json`](../../content/_templates/location.json).
Scaffold one with `npm run new:location <id>`.

## Two kinds of location

### Travel node (costs AP, becomes your location)

```json
{
  "id": "example_location",
  "name": "示例殿",
  "description": "一两句场景描写。",
  "backgroundKey": "bg.example_location",
  "ambience": ["环境细节一", "环境细节二"],
  "position": { "x": 0.5, "y": 0.5 },
  "zone": "palace",
  "entry": "travel",
  "connections": ["yushufang"],
  "travelCost": { "ap": 1 }
}
```

- `connections` must be **symmetric** — if this lists `yushufang`, `yushufang`
  must list this id back, or the loader errors.
- `travelCost.ap` ≥ 1.

### Free-view node (no AP, look-only, optional one action)

```json
{
  "id": "example_view",
  "name": "示例阁",
  "description": "……",
  "backgroundKey": "bg.example_view",
  "ambience": ["……"],
  "position": { "x": 0.8, "y": 0.7 },
  "zone": "palace",
  "entry": "free",
  "actionEventId": "ev_example_action"
}
```

- A free node has **no** `connections`/`travelCost`. It's opened from the map.
- `actionEventId` (optional) surfaces one AP-costing action (e.g. 上朝).

## Zones & map boards

`zone` is the **board** the node sits on. With `world.json` `mapBoards` declared,
`zone` must name a board: `palace`, `hougong`, `jingcheng`, `jingjiao`. Adding a
node to 京城/郊外 is just `"zone": "jingcheng"` / `"jingjiao"`.

New boards/portals are added in `world.json` (`mapBoards` + `mapPortals`), not in a
location file — see [`../engineering/10-current-implementation.md`](../engineering/10-current-implementation.md).

## Backgrounds

`backgroundKey` → manifest `background` key. Convention is `bg.<id>`; deviating is
a *warning*, not an error (shared backdrops like `bg.hougong_zhudian` do this).
Time-of-day variants resolve `bg.<x>.twilight` / `bg.<x>.night` automatically.

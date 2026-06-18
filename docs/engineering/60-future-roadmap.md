# Future Roadmap

Designed-ahead systems, roughly in build order. Nothing here is in the contract
until it moves to [`10-current-implementation.md`](10-current-implementation.md).

1. **Memory retrieval & salience scoring** — beyond `hasMemoryTag`: rank entries
   by salience/recency for dialogue context.
2. **Pregnancy & heir system** — see [`../systems/60-pregnancy-and-heir-system.md`](../systems/60-pregnancy-and-heir-system.md).
   Bloodline state already exists; the lifecycle (转胎/承养/胎息) does not.
3. **Factions & pressure simulation** — court `factionPressure` exists as a
   number; no simulation drives it yet.
4. **Secrets gameplay** — schema slot exists (`secrets` must be empty today).
5. **Real DialogueProvider + `generate` node + eval harness.**
6. **Save migrations.**
7. **Richer map** — area sub-graphs, time-gated portals.

When promoting an item: update the contract table, add tests, update the
relevant system doc's "Implementation status" section, and remove the caveat.

# Factions & Pressure

**Status: future.** Only a single number exists today.

## What exists

- Court resources: `authority`, `publicSupport`, `factionPressure` (each 0–100),
  adjustable by `resource`/`court` effects.
- `factionPressure` is a dial scenes can push; **nothing simulates it** — there is
  no faction model, no NPC bloc behavior, no pressure feedback loop.

## Designed later

- Named factions (女官集团, 宗室, 祭司, regional powers) with goals and reactions.
- Pressure that rises/falls from player choices and propagates to events.
- Faction-aware event conditions.

## How to handle faction content now

Treat 派系 as **narrative flavor + scripted events** that nudge the three court
numbers via effects. Do not assume faction conditions exist (there are none —
the condition DSL has no resource predicates by design).

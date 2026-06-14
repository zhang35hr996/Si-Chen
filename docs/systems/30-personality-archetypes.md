# Personality Archetypes

**Status: mostly future / authoring guidance.** There is no numeric personality
system. Today, personality is conveyed through free-text fields
(`profile.personalityTraits`, `profile.speechStyle`, `voice.register`/`quirks`)
and through how you script a character's scenes. This doc is a design vocabulary
to keep characters consistent, **not** a set of engine fields.

## Surface temperament

Gentle · Cold · Proud · Sensitive · Formal · Seductive · Volatile · Timid ·
Patient · Ambitious.

## Inner motivation

Seeks affection · seeks rank · seeks heirs · seeks safety · serves family interest
· seeks revenge · seeks freedom · seeks power.

## Intended gameplay effect (design only)

| Archetype | Dialogue style | Event tendency | Intended effect |
|---|---|---|---|
| Cold | restrained | slow-burn | slower favor gain, stable loyalty |
| Proud | reactive | jealousy events | high favor volatility |
| Patient | indirect | hidden arcs | stronger memory continuity |
| Timid | deferential | rescue/request | stress-sensitive |

## How to apply today

- Pick one surface temperament + one inner motivation per character.
- Express them in `personalityTraits`, `speechStyle`, `voice`, and `coreFacts`.
- Drive "event tendency" with scripted events + conditions (`favorAtLeast`,
  `hasMemoryTag`, flags) — not with a personality stat.

When a real archetype system is built it will be promoted to the contract and this
doc's status updated.

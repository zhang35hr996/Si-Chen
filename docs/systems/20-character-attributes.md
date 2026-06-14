# Character Attributes

What a character actually carries today, plus designed-later stats. The schema is
in `src/engine/content/schemas.ts` (`characterSchema`).

## Core identity (implemented)

- `id`, `kind` (`consort` | `official`)
- `profile`: `name`, `age`, `role`, `appearance`, `personalityTraits[]`,
  `coreFacts[]`, `goals[]`, `speechStyle`
- `defaultLocation`, `portraitSet`, `expressions[]` (must include `"neutral"`)
- `voice`: `register` (`formal`/`casual`/`rough`/`poetic`), `quirks[]`, `tabooTopics[]`
- `initialStanding`: `{ rank, favor }` — rank's domain must match `kind`
  (consort⇄harem, official⇄official)
- `stances[]` (optional): authored attitude toward another character

## Social stats (implemented as runtime state)

- **favor** — `standing[char].favor` (0–100). Display term: 恩宠 (consort) / 圣眷 (official).
- **relationship** — `relationships[char]`: `trust`, `affinity` (0–100), `flags[]`.
- **rank** — `standing[char].rank`; ordered by the rank table's `order`.

## Personal stats (designed later — NOT in schema)

beauty, talent, temperament-as-number, health, fertility relevance, blood-nursing
resilience, loyalty/ambition/jealousy/familyPower. These are **not** fields today;
personality is expressed through free-text `profile.personalityTraits` + `voice`,
and standing is favor/relationship only.

## Implementation status

| Field group | Status |
|---|---|
| identity, profile, voice, portrait | Implemented |
| favor / relationship(trust, affinity, flags) / rank | Implemented (runtime state) |
| numeric personality, health, fertility, family power | Not supported (designed later) |

Author only the implemented fields — strict validation rejects unknown keys.

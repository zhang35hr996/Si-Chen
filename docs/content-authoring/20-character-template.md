# Character Template

Minimal valid file: [`content/_templates/character.json`](../../content/_templates/character.json).
Scaffold one with `npm run new:character <id>`.

## Minimal valid character

```json
{
  "id": "example_character",
  "kind": "consort",
  "profile": {
    "name": "示例侍君",
    "age": 22,
    "role": "初入宫的承徽",
    "appearance": "外貌一两句。",
    "personalityTraits": ["克制"],
    "reactionTraits": ["discreet", "status_conscious"],
    "coreFacts": ["入宫一年"],
    "goals": ["承宠"],
    "speechStyle": "克制而有礼。"
  },
  "defaultLocation": "yushufang",
  "portraitSet": "example_character",
  "expressions": ["neutral"],
  "voice": { "register": "formal", "quirks": [], "tabooTopics": [] },
  "initialRelationship": { "trust": 30, "affinity": 30, "flags": [] },
  "initialStanding": { "rank": "chenghui", "favor": 20 },
  "initialMemories": [],
  "secrets": []
}
```

## Field notes

- **`kind`** — `consort` or `official`. Must match the rank's domain: a `consort`
  holds a harem rank, an `official` holds an official rank (loader enforces).
- **`initialStanding.rank`** — an existing `world.json` rank id (`fenghou`, `jun`,
  `chenghui`, `sili_zhang`). Adding a new rank means editing **both** `world.json`
  `ranks[]` and `lexicon.json` `rankAddressRules`. See
  [`../world/50-harem-ranks.md`](../world/50-harem-ranks.md).
- **`expressions`** — must include `"neutral"`. Each expression needs a portrait
  asset `portrait.<portraitSet>.<expression>` in the manifest.
- **`voice.register`** — `formal` | `casual` | `rough` | `poetic`.
- **`attributes`** (optional, 侍君明面属性) — `{ "appearance", "talent", "family",
  "health", "nurture" }`, each an integer 0–100 (容貌/才情/家世/健康/承养; background
  §四.4.1). When present the character card renders them. Officials normally omit it.
- **`secrets`** — must be `[]` (secrets gameplay isn't implemented).
- **`profile.reactionTraits`** — canonical engine traits the ReactionPlanner derives
  disposition from. The narrative `personalityTraits` are NOT parsed; author these
  machine IDs separately. Allowed: `status_conscious`, `compassionate`, `cold`,
  `discreet`, `blunt`, `impulsive`, `calculating`, `proud`. `[]` for non-reaction roles.
- **`stances`** (optional) — `[{ "charId": "<other>", "stance": "<RelationStance>",
  "attitude": "…" }]`. `stance` is the engine-used relation category
  (`devoted` | `friendly` | `neutral` | `competitive` | `contemptuous` | `hostile`);
  `attitude` is the free-text narrative description (for authors and the LLM, never parsed).

## Initial memories (optional)

Seeds the character's memory store. Use a tag your events can later read with
`hasMemoryTag`:

```json
"initialMemories": [
  {
    "kind": "opinion",
    "summary": "陛下近来鲜少召见，本位心有微凉。",
    "salience": 40,
    "tags": ["player", "neglect"],
    "participants": ["player", "example_character"]
  }
]
```

Authored memories are `protected` by default. See
[`../systems/40-relationship-memory.md`](../systems/40-relationship-memory.md).

## Portraits

`portraitSet` + each `expression` → manifest key `portrait.<set>.<expr>`. A missing
expression falls back to `neutral`, then a built-in silhouette — but
`validate-manifest` flags the missing key. Add art before shipping.

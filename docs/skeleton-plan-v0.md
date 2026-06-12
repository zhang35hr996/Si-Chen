# Si-Chen — First Playable Skeleton: Implementation Plan v0

**Status:** Planning — no code exists yet; repo contains only `docs/`
**Parent documents:** `docs/DESIGN.md` (Draft v2.1, the architecture authority) · `docs/background-v0.1.md` (world bible)
**Goal:** the smallest bootable build that proves the architecture: data-driven content → validated state machine → scripted events → dialogue UI → per-character memory → save/load → debug panel. **No real AI model.**

> Where this plan and DESIGN.md describe the same thing, DESIGN.md's section is referenced instead of restated. Where this plan deviates (naming, scope cuts, additions), the deviation is called out explicitly with a `Δ` marker.

---

## 1. Executive Summary

**What it is:** a vertical skeleton of the 礼法女尊 court-management game. One screen flow (title → new game → palace map → location → scripted event dialogue → back to map), three placeholder characters, three locations, three scripted events, the full calendar/AP loop, global resource scaffolds for 江山/后宫/血脉, per-character relationship + memory, versioned save/load, and a debug panel. Every architectural seam from DESIGN.md is present and load-bearing: content is JSON validated by Zod, all state changes flow through typed commands, dialogue is rendered through the `DialogueProvider` interface (mock implementation only), and effects are proposals the engine validates before applying.

**What it is not:** it is not fun yet, and it is not trying to be. No AI generation, no pregnancy/承养 mechanics, no faction simulation, no art. The three events exist to exercise systems (relationship change + memory write; harem etiquette; 血脉 legitimacy scaffold), not to tell a story. If the skeleton is done right, "adding game" afterwards means adding content files and one provider implementation — not new architecture.

**Why this order:** the most expensive late-stage failures in this genre are (a) AI output mutating state uncontrollably, (b) save corruption as schemas churn, and (c) content that silently breaks. The skeleton front-loads the defenses against all three before any model is connected.

---

## 2. Exact MVP Skeleton Scope

### Must have (skeleton is not done without these)

1. App boots to a title screen; New Game initializes state from `content/world.json`.
2. Calendar displays `元年一月上旬`, AP displays `行动点：5/5`; AP spend rolls 旬 → 月 → 年 correctly.
3. Palace map shows 3 locations (御书房 / 后宫主殿 / 御花园); click-to-travel costs 1 AP.
4. 3 characters (凤后 / 沈承徽 / 司礼女官) load from content files with Zod validation and cross-reference checks.
5. 3 scripted events trigger via declarative conditions at checkpoints; each is playable start-to-finish.
6. Dialogue screen renders speaker, line, 2–4 choices; choices apply validated effects atomically.
7. Global resources (江山/后宫/血脉 scaffolds) change via effects and display in the debug panel.
8. Per-character memory entries written by committed `memory` effects; subjective (same event → different entries per character).
9. Versioned save/load (manual slot + autosave), corruption quarantine, JSON export/import.
10. Debug panel: state tree, characters, relationships, standing, resources, per-character memory, event flags, force-trigger.
11. Invalid content fails loudly at boot with file + path + reason. Never a silent crash.

### Explicitly NOT included yet

- Real LLM calls of any kind (no API keys, no network). `DialogueProvider` exists; only `MockProvider` implements it.
- `generate` scene nodes (dynamic conversations). Scripted `line/choice/branch/effect` nodes only.
- Memory **retrieval/scoring/consolidation** (DESIGN §4.4–4.8). Skeleton memory is append + inspect only.
- Pregnancy/承养 mechanics, 经血祭祀 simulation, succession, factions, schedules, gossip.
- Settings screen, audio, transitions, real art, localization.

### Scaffold only (fields exist, no logic reads them beyond display)

- `BloodlineState.menstrualStatus`, `bloodlineLegitimacy` — set by event effects, shown in debug panel, nothing else.
- `CourtState` / `HaremState` resource scalars — same.
- `CharacterStanding` (rank + favor) — loaded, displayed, addressable in conditions; no promotion ceremony logic.
- `WorldLexicon` — loaded and validated (rank/selfRefs cross-checks); enforced only as content-validation, since no AI output exists yet to scan at runtime.
- `AssetManifest` + placeholder generator — keys resolve to generated placeholder cards.
- `LineageState`-shaped fields inside `BloodlineState` — reserved per DESIGN §3.8.

**Scaffold guard (P0):** scaffold-only fields must never appear in event trigger conditions, scene branch conditions, or provider prompts. They may only be (a) initialized in state, (b) mutated by `EventEffect`, (c) displayed in the debug panel, (d) persisted in saves. This is structural in the skeleton — the condition DSL deliberately has **no resource/bloodline predicates** — and `tools/validate-content` additionally rejects any condition or branch that references them (tested in PR 3). Adding a `resourceAtLeast` predicate later is therefore a conscious act of promoting a field out of scaffold status, never a drive-by in a content file.

---

## 3. Folder / Module Structure

Repo is currently docs-only, so this instantiates DESIGN §2.4 with skeleton-scoped deltas:

```
si-chen/
├── content/
│   ├── characters/        # feng_hou.json, shen_chenghui.json, sili_nvguan.json
│   ├── locations/         # yushufang.json, hougong_zhudian.json, yuhuayuan.json
│   ├── scenes/            # one scene file per scripted event (1:1 in skeleton)
│   ├── events/            # ev_shen_neglect.json, ev_fenghou_rules.json, ev_menses_rite.json
│   ├── fallback_dialogue/ # present but minimal (MockProvider rarely fails)
│   ├── lexicon.json       # WorldLexicon (DESIGN §3.9)
│   └── world.json         # map graph, calendar config, rank table, starting state & resources
├── assets/                # placeholder portraits/backgrounds + manifest.json
├── src/
│   ├── engine/            # framework-free TS — no React imports (lint-enforced)
│   │   ├── state/         # GameState, commands, reducer, atomic batch apply
│   │   ├── calendar/      # Δ split from state/: 旬/月/年 rollover, AP math, action-day index
│   │   ├── content/       # Zod schemas + ContentLoader + cross-ref validation
│   │   ├── characters/    # CharacterRuntime: profile + relationship + standing + memory handle
│   │   ├── memory/        # v0: append, list, persist (no retrieval scoring yet)
│   │   ├── dialogue/      # DialogueOrchestrator (thin in skeleton) + providers/mockProvider.ts
│   │   ├── scenes/        # SceneRunner + SceneSession transaction: line/choice/branch/effect nodes
│   │   ├── events/        # EventEngine: condition DSL evaluators, checkpoints, once/priority
│   │   ├── map/           # location graph, travel legality, presence
│   │   ├── effects/       # Δ EventEffect union, validator, applier (the single funnel)
│   │   ├── assets/        # AssetRegistry + fallback chain
│   │   ├── save/          # versioned SaveData, slots, autosave, quarantine, export/import
│   │   └── infra/         # result.ts, errors.ts, logger.ts (ring buffer), rng.ts
│   ├── ui/
│   │   ├── screens/       # Title, Map, Location, Dialogue, SaveLoad
│   │   ├── components/
│   │   └── debug/         # DebugPanel (hotkey `)
│   ├── store/             # engine↔React bridge (thin subscriber)
│   └── main.tsx
├── tools/                 # validate-content.ts, validate-manifest.ts, gen-placeholders.ts
├── tests/                 # vitest (engine headless) + fixtures/
└── docs/
```

`Δ` deltas from DESIGN §2.4: `engine/calendar/` is split out of `state/` because the 旬/月/年 + AP rollover is the skeleton's most test-heavy pure logic; `engine/effects/` is named explicitly because the effect funnel is this skeleton's centerpiece (DESIGN folds it into state/scenes). Module responsibilities, dependency rule (arrows point down, engine imports nothing above it), and must-not-do lists are exactly DESIGN §2.2–2.3.

---

## 4. Core Data Schemas

All schemas are Zod definitions; TS types inferred (`z.infer`). Shown as interfaces for readability. IDs are lowercase snake, namespaced by collection. Minimal now, future-compatible by design (optional fields + save migrations later).

```ts
// ── Time ────────────────────────────────────────────────────────────
interface GameTime {                 // pure timestamp — what gets stored on records
  year: number;                      // 1 = 元年
  month: number;                     // 1–12
  period: "early" | "mid" | "late";  // 上旬 / 中旬 / 下旬
  dayIndex: number;                  // derived action-day index ((year-1)*12 + (month-1))*3 + periodOrdinal;
}                                    //   stored for cooldown math & sorting

interface CalendarState extends GameTime {   // the live clock — GameTime + AP bookkeeping
  ap: number;                        // 5 → 0; rollover at 0
  apMax: number;                     // 5 (world.json config, not hardcoded)
}
// Timestamps (createdAt / firedAt / lastRiteAt) are GameTime, never CalendarState:
// the moment a memory happened must not carry "how many AP the player had left".

// ── Global resource pillars (Δ new in skeleton; scaffold values 0–100) ──
interface CourtState {               // 江山  (Δ name reassigned — see §15.1)
  authority: number;                 // 圣威
  publicSupport: number;             // 民心
  factionPressure: number;           // 派系压力
}
interface HaremState {               // 后宫
  harmony: number;                   // 和睦
  jealousy: number;                  // 妒意
}
interface BloodlineState {           // 血脉 — absorbs DESIGN §3.8 LineageState scaffold
  legitimacy: number;                // 宗嗣合法性
  menstrualStatus: "normal" | "irregular" | "absent";   // 经血状态
  lastRiteAt?: GameTime;             // scaffold
  pregnancy?: unknown;               // reserved, never set in skeleton (DESIGN §3.8 shape)
  heirs: unknown[];                  // reserved, always [] in skeleton
}

// ── Characters ──────────────────────────────────────────────────────
interface Character {                // static content (DESIGN §3.1, trimmed)
  id: string;                        // "shen_chenghui"
  profile: { name: string; age: number; role: string; appearance: string;
             personalityTraits: string[]; coreFacts: string[]; goals: string[];
             speechStyle: string };
  kind: "consort" | "official";      // Δ new: 司礼女官 is not a consort; gates rank semantics
  defaultLocation: string;
  portraitSet: string;
  expressions: string[];             // must include "neutral"; all in manifest
  voice: { register: "formal"|"casual"|"rough"|"poetic"; quirks: string[]; tabooTopics: string[] };
  initialRelationship: RelationshipState;
  initialStanding: CharacterStanding;    // rank domain MUST match kind (loader-enforced):
                                         //   consort → harem-domain rank, favor reads 恩宠
                                         //   official → official-domain rank, favor reads 圣眷
                                         // an official NEVER holds a harem rank or an empty/null consort
                                         // standing; if officials later grow distinct fields (office,
                                         // mandate), Character splits into a kind-discriminated union —
                                         // planned evolution, deliberately not built in v0
  initialMemories: MemoryEntryDraft[];
  secrets: [];                       // schema present, empty in skeleton
  stances?: { charId: string; attitude: string }[];
}

interface CharacterRank {            // one row of world.json's 位分 table (bible §9.2)
  id: string;                        // "chenghui"
  name: string;                      // "承徽"
  grade: string;                     // "正三品"
  selfRefs: {                        // structured — never a joined "臣后·本宫" display string
    toPlayer: string[];              // ["臣后"] — facing the Empress
    formal: string[];                // ["本宫"] — court/ceremonial register
    informal?: string[];             // ["我"]  — private, high-trust contexts (no v0 logic reads this)
  };                                 // cross-checked against lexicon.rankAddressRules
  order: number;                     // sort/compare key — rankAtLeast uses this
  domain: "harem" | "official";      // Δ consort ranks vs official ranks share one table
  favorTerm: string;                 // display label for standing.favor: 恩宠 (consort) / 圣眷 (official)
}

interface CharacterStanding {        // per-character formal standing (DESIGN v2.1's per-char
  rank: string;                      //   "CourtState", renamed — see §15.1)
  favor: number;                     // 0–100 恩宠
}

interface RelationshipState {        // stance toward the player (女帝) — consorts AND officials
  trust: number;                     // 0–100
  affinity: number;                  // 0–100 — Δ generalized from "affection": reads as 爱慕 for
  flags: string[];                   //   consorts, 亲附/敬慕 for officials; one axis, kind-appropriate label
}

// ── Memory v0 ───────────────────────────────────────────────────────
interface MemoryEntry {
  id: string;                        // "mem_shen_chenghui_000001" (monotonic per char)
  kind: "event" | "fact_learned" | "opinion" | "promise" | "conversation_summary";
  summary: string;                   // ≤240 chars, third person, THIS character's POV
  salience: number;                  // 0–100 (stored now, used by retrieval later)
  createdAt: GameTime;
  tags: string[];                    // ≤5, lowercased
  participants: string[];            // char ids incl. "player"
  locationId?: string;
  source: "authored" | "scene_outcome";   // ai_proposed/consolidation come later
  protected: boolean;
}

// ── World ───────────────────────────────────────────────────────────
interface Location {
  id: string; name: string; description: string;
  backgroundKey: string; ambience: string[];
  position: { x: number; y: number };          // 0–1 on map image
  connections: string[]; travelCost: { ap: number };
}

// ── Events & scenes (Δ "SceneEvent" = GameEvent + its 1:1 Scene; kept as two
//    files per DESIGN §3.4–3.5 so dynamic scenes slot in later without churn) ──
interface GameEvent {
  id: string; title: string;                    // Δ title added for debug panel
  sceneId: string;
  checkpoint: "game_start" | "location_enter" | "time_advance" | "scene_end";
  condition: TriggerCondition;                  // closed DSL, DESIGN §3.5 predicates
  priority: number; once: boolean;
  cooldown?: { actionDays: number };
  apCost: number;                               // reserved at entry, SPENT only at scene commit (§6)
  public?: boolean; headline?: string;          // 宫闱邸闻 scaffold (DESIGN v2.1)
}

interface Scene {
  id: string; locationId: string; participants: string[];
  startNodeId: string;                          // explicit entry — no "first element" convention
  nodes: SceneNode[];                           // line | choice | branch | effect (no generate yet)
}                                               // NO outcome block: every consequence — memory included —
                                                //   is an EventEffect inside an effect node (§6 single funnel)

interface SceneSession {                        // in-flight scene transaction (§6) — never serialized
  sceneId: string; eventId?: string;
  startedAt: GameTime;
  reservedApCost: number;                       // affordability checked at entry, spent at commit
  pendingEffects: EventEffect[];                // accumulated from effect nodes; GameState untouched
  cursorNodeId: string;
  steps: number;                                // runtime loop guard — maxNodeSteps 100
}
type SceneNode =
  | { type: "line";   id: string; speaker: string; text: string; expression?: string; next?: string }
  | { type: "choice"; id: string; choices: DialogueChoice[] }
  | { type: "branch"; id: string; condition: TriggerCondition; ifTrue: string; ifFalse: string }
  | { type: "effect"; id: string; effects: EventEffect[]; next?: string };

interface DialogueLine {                        // what UI renders (== DESIGN's DialogueTurn)
  speakerId: string; speakerName: string; text: string;
  expression: string;
  choices: DialogueChoice[];
  meta: { generated: boolean; degraded: boolean };  // always {false,false} from MockProvider
}
interface DialogueChoice {
  id: string; text: string;
  tone?: "friendly" | "neutral" | "guarded" | "hostile" | "flirty";
  next?: string; condition?: TriggerCondition; isExit?: boolean;
}

// ── Effects (the single funnel — §6). Fully discriminated: an illegal pillar/field
//    pair is a compile-time error AND a Zod parse error, never a runtime surprise. ──
type EventEffect =
  | { type: "relationship"; char: string; field: "trust" | "affinity"; delta: number }
  | { type: "favor";        char: string; delta: number }
  | { type: "resource"; pillar: "court";     field: "authority" | "publicSupport" | "factionPressure"; delta: number }
  | { type: "resource"; pillar: "harem";     field: "harmony" | "jealousy";                            delta: number }
  | { type: "resource"; pillar: "bloodline"; field: "legitimacy";                                      delta: number }
  | { type: "set_bloodline_status"; field: "menstrualStatus"; value: "normal" | "irregular" | "absent" }
  | { type: "flag";         key: string; value: boolean | number | string }
  | { type: "memory";       char: string; entry: MemoryEntryDraft };   // the ONLY memory write path

// ── Persistence ─────────────────────────────────────────────────────
interface GameState {
  calendar: CalendarState;
  playerLocation: string;
  resources: { court: CourtState; harem: HaremState; bloodline: BloodlineState };
  flags: Record<string, boolean | number | string>;
  relationships: Record<string, RelationshipState>;
  standing: Record<string, CharacterStanding>;
  memories: Record<string, { entries: MemoryEntry[]; nextSeq: number }>;
  eventLog: { eventId: string; firedAt: GameTime }[];
  sceneHistory: string[];
  rngSeed: number;
}
interface SaveData {
  formatVersion: number;             // starts at 1
  engineVersion: string;
  contentVersion: string;            // from world.json — bumped manually on meaning-changing content edits
  contentHash: string;               // hash over all loaded content files at save time
  createdAt: string; slot: string;
  checksum: string;                  // sha-256 of canonical-JSON state
  state: GameState;
}

// ── Assets ──────────────────────────────────────────────────────────
interface AssetManifestEntry {
  path: string; kind: "portrait" | "background" | "ui" | "map";
  placeholder: boolean;
}
```

Validation rules (loader-enforced): every cross-reference resolves (charId/locationId/sceneId/rank/asset key); rank `domain` matches the character's `kind` (consort ⇄ harem, official ⇄ official); no condition/branch references scaffold-only fields (§2 guard); connections symmetric; `startNodeId` exists; all `next`/branch targets exist; no unreachable nodes (unless marked `devOnly`); at least one terminal path per scene; `selfRefs` in the rank table match `lexicon.rankAddressRules`; deltas declared in content are within ±10; `apCost ≥ 0`; calendar config sane (apMax ≥ 1).

**Content file format:** all shipped `content/**` files are **strict JSON** — no comments, no trailing commas. The `jsonc` blocks in this document are documentation formatting only; never write comments into actual content files.

---

## 5. Core Gameplay Flow

```
Title screen
  → New Game
      → ContentLoader.loadAll()  — fail loud on any content error
      → GameState initialized from world.json   (元年一月上旬, AP 5/5, resources at start values)
      → EventEngine.evaluate("game_start")      — may queue an intro event (none in skeleton: 0 fire)
  → Palace map (calendar + AP + resources summary visible)
      → click location → MOVE_TO_LOCATION → SPEND_AP(travelCost)
          → if AP hits 0: rollover 上旬→中旬→下旬→次月一日, fire "time_advance" checkpoint
          → fire "location_enter" checkpoint
              → eligible event? → affordability check (ap ≥ event.apCost, else 「行动点不足」, no entry)
                  → SceneSession opened: AP reserved, NOT spent
  → Dialogue screen
      → SceneRunner walks nodes through MockProvider → DialogueLine (speaker, text, choices)
      → player picks choice → next node (branch/effect/line); effect nodes ACCUMULATE into
        session.pendingEffects — GameState is untouched while the scene runs
  → Scene reaches terminal node → COMMIT (one atomic batch — §6):
      1. validate ALL pendingEffects              4. mark eventFired + set flags
      2. SPEND_AP(reservedApCost)                 5. fire "scene_end" checkpoint
      3. apply effects in declared order           6. autosave
         (relationship/favor/resource/memory)
      (any validation failure → whole batch rejected, loud log, state unchanged)
  → Mid-scene quit → session DISCARDED: no AP spent, no effects, `once` NOT consumed
  → back to Location/Map screen
  → Save menu anytime outside a scene; Load restores exact state (deep-equal)
```

---

## 6. Event / Effect System Design

**The rule, structurally enforced:** content files (and later, AI output) only ever produce `EventEffect` **proposals**. The `effects/` module owns one function — `validateAndApply(batch: EventEffect[], state): Result<GameState, EffectError[]>` — and it is the only code path that produces a mutated state (via reducer commands). Dialogue text never touches state. There is no second path — **memory included**: there is no scene `outcome` block; branch-specific memories are just `memory` effects in that branch's effect node. (DESIGN §5.6's funnel, implemented before any AI exists so the AI inherits it rather than negotiating it.)

**Scene transaction (`SceneSession`) — complete lifecycle, locked (P0):**

| Moment | Semantics |
|---|---|
| **Entry** | Affordability check `ap ≥ event.apCost`; fail → 「行动点不足」, nothing happens, **no auto-rollover** (hidden time advance could trip cooldowns/month-end logic). Pass → in-memory session opens; AP **reserved, not spent**; event **not** marked fired |
| **During** | Effect nodes append to `pendingEffects`; GameState untouched; autosave **cannot** fire (its only hooks are scene commit and travel) |
| **Terminal node** | One atomic commit: validate batch → `SPEND_AP(reserved)` → apply effects → mark `eventFired` (`once` is consumed **here and only here**) → `scene_end` checkpoint → autosave |
| **Explicit quit** | Session discarded: no AP spent, no effects, no `eventFired`; re-entry allowed and replays identically |
| **Reload / crash / closed tab** | `SceneSession` is **never serialized**; the newest autosave predates scene entry → outcome identical to explicit quit. There is no resume-in-scene in the skeleton |
| **Commit-time validation failure** | Whole batch rejected, loud log; state unchanged — outcome identical to quit, AP included |

The "deduct-at-start + durable session + resume" variant is deliberately rejected: it buys crash-resume at the cost of serialized sessions, an `in_progress` event state, and abandon policies — none of which the skeleton needs. Known consequence: free quit = risk-free preview; accepted (re-entry replays identically), revisit with an `abandoned` marker only if a real cost ever needs protecting.

Validation per effect type: char/flag targets exist (the discriminated union already constrains pillar/field pairs at compile time and Zod-parse time); delta within ±10 per scene per axis; resources clamped 0–100 after apply; `set_bloodline_status` value in enum; memory drafts pass MemoryEntry schema (length, salience clamp, tag cap, `source` forced to `"scene_outcome"`, `protected` allowed from authored initial memories only). Reject-one-reject-all: a batch is atomic.

**Examples (content JSON):**

```jsonc
// relationship effect — 敷衍 choice in ev_shen_neglect
{ "type": "relationship", "char": "shen_chenghui", "field": "affinity", "delta": -4 }

// global resource effect — 准奏祭仪 in ev_menses_rite
{ "type": "resource", "pillar": "bloodline", "field": "legitimacy", "delta": 5 }
{ "type": "resource", "pillar": "court",     "field": "authority",  "delta": 3 }

// memory write effect — per-witness, subjective wording
{ "type": "memory", "char": "shen_chenghui",
  "entry": { "kind": "event", "summary": "陛下在御花园温言安抚了我，还记得我入宫那日穿的衣裳。",
             "salience": 65, "tags": ["player", "yuhuayuan", "favor"], "participants": ["player","shen_chenghui"] } }

// event flag effect
{ "type": "flag", "key": "rite_scheduled", "value": true }

// action point cost — NOT an effect: a declarative GameEvent field. Affordability is
// checked at scene entry, the cost is reserved on the SceneSession, and it is SPENT
// only at commit. Content can never double-charge, refund, or dodge AP.
"apCost": 2
```

**Full sample event** (`content/events/ev_shen_neglect.json` + its scene, abridged):

```jsonc
{ "id": "ev_shen_neglect", "title": "沈承徽被冷落",
  "sceneId": "sc_shen_neglect", "checkpoint": "location_enter",
  "condition": { "all": [ { "atLocation": "yuhuayuan" },
                          { "not": { "eventFired": "ev_shen_neglect" } } ] },
  "priority": 50, "once": true, "apCost": 1 }
```
Scene: `startNodeId` → line (沈承徽 alone among 落花, voice per his rank: selfRefs.toPlayer 「本位」) → choice 安抚/敷衍/离开 → branch → per-choice effect node carrying both the relationship/resource deltas **and** that branch's `memory` effect with its own POV wording — one funnel, divergent memories for free. The other two events follow the same shape: `ev_fenghou_rules` (后宫主殿, tests etiquette framing + `harem.harmony`, 凤后 trust), `ev_menses_rite` (御书房, 司礼女官, tests bloodline scaffold + `apCost: 2` heavy action + `flag rite_scheduled`).

Trigger evaluation, once/cooldown/priority/deterministic tiebreak, chain-depth cap 3: exactly DESIGN §6.2.

---

## 7. Character Memory v0

Scope — memory can be **written, stored, and inspected; it cannot yet drive AI or gameplay logic**:

- **Included:** append-only subjective entries via `EventEffect.memory`; per-character isolation; visible in the debug panel; fully persisted through save/load (entries survive roundtrip byte-identically).
- **Excluded:** retrieval for prompt construction; summarization/consolidation; dynamic salience scoring; memory-driven event recommendation; transcripts. (These arrive with real dialogue generation, DESIGN §4.3–4.8; the interfaces are shaped so they bolt on without migration.)

- Each character owns an independent store: `memories[charId] = { entries, nextSeq }` inside GameState (saves for free).
- **No global truth:** there is no shared event record characters read (the 宫闱邸闻 public digest is a *later* prompt-layer concern; skeleton events are all private). An event writes explicitly per-witness: `memory` effects in its effect nodes name each character and their POV wording. 凤后 is *not* told about what happened in 御花园 unless an effect says so.
- Producers in v0: `authored` (a character's `initialMemories`) and committed `memory` effects (`source: "scene_outcome"`). There is exactly **one** write path — `EventEffect.memory` → effect funnel → `APPEND_MEMORY`. (An earlier draft also had `outcome.memoryUpdates` on Scene; removed — it was a second, funnel-bypassing write path that would have split debug/save tracing.)
- Structured entries per the §4 schema; monotonic ids per character; protected entries (authored backstory) flagged now so the future consolidator already knows to keep its hands off.
- Debug panel: per-character table (id, kind, salience, age, tags, source, protected) + full text + "which scene wrote this" trace via the command log.
- Save/load roundtrips memory byte-identically (covered by the §11 roundtrip test).

---

## 8. DialogueProvider Interface

Designed for the AI future (DESIGN §5), implemented only as a mock today. The interface is the contract; the skeleton proves the game runs entirely behind it.

```ts
interface DialogueRequest {
  speakerId: string;
  targetId: string;                  // usually "player"
  locationId: string;
  time: GameTime;                    // not CalendarState — a speaker doesn't know the player's AP
  speakerContext: {                  // assembled by the orchestrator, NOT by the provider
    profile: Character["profile"];
    voice: Character["voice"];
    relationship: RelationshipState;
    standing: CharacterStanding & { selfRefs: CharacterRank["selfRefs"] };   // etiquette: 臣后/本宫/本位/…
    relevantMemories: MemoryEntry[]; // v0: empty array (no retrieval yet) — field exists
    stances: { charId: string; attitude: string }[];
  };
  etiquette: {                       // from WorldLexicon
    allowedTerms: string[];
    forbiddenTerms: string[];
    addressRules: { rank: string; selfRefs: CharacterRank["selfRefs"]; addressedAs: string }[];
  };
  sceneDirective?: string;           // authored steering (unused by mock)
  transcript: { speaker: string; text: string }[];
}

interface RawDialogueResponse { /* provider-shaped JSON; orchestrator validates */ }

interface DialogueProvider {
  readonly id: string;               // "mock" | future: "openai-compat" | "anthropic"
  generate(req: DialogueRequest): Promise<Result<RawDialogueResponse, AIError>>;
}
```

**MockProvider (v0):** ignores most of the request and returns the authored lines from the current scene node, wrapped in the same `RawDialogueResponse` shape a model would return — so the orchestrator's validate-then-render path runs **identically** for mock and future LLM output (`meta.generated:false`). When a real provider lands (DESIGN §5.7 adapters + routing), zero UI or engine code changes.

**Gate boundary (P1):** provider gates validate **text only** — forbidden-lexicon scan, `selfRefs` correctness, speaker-identity check, unauthorized rank/title terms, leaked template tokens. All **numeric/state** validation — delta clamps, illegal field rejection, resource/rank/status typing — belongs to `engine/effects/` and is tested there (PR 6). Keeping the dialogue seam text-only prevents provider output and state mutation from coupling: a future model's prose problems and its proposed-effect problems get caught by different, independently testable layers. Gate functions are built and unit-tested in PR 11 even though mock output trivially passes them.

---

## 9. Save / Load Design

Direct subset of DESIGN §7.1:

- **Format:** `SaveData` JSON in `localStorage` (`sichen.save.<slot>`); canonical-JSON sha-256 checksum; slots `auto`, `auto.prev`, `slot1..slot3` (3 is enough for a skeleton), plus file export/import (download/upload of the same JSON) for debugging and backups.
- **Version:** `formatVersion: 1`. Migration scaffold ships now: `migrations: Record<number, (old: unknown) => unknown>` — empty map, but the load path already runs the chain, so version 2 is a one-entry addition with a fixture test, not a refactor. Unknown future version → refuse load with a clear message, never destroy.
- **Content compatibility:** every save stores `contentVersion` + `contentHash`. On load — hash matches: load normally; hash differs: **visible warning** (「存档与当前内容版本不一致，可能出现异常」) and load proceeds only if the content-id cross-check passes; `contentVersion` declared incompatible: refuse + offer export. Never load silently against changed content.
- **Corruption handling:** parse/checksum/schema failure → quarantine blob to `sichen.corrupt.<timestamp>` (never delete), try `auto.prev`, then offer older slot / export / new game. Partial salvage (per-character memory subtree reset) is deferred — skeleton treats any schema failure as full-save corruption.
- **Autosave:** after every scene commit and every travel; rotate `auto` → `auto.prev`.
- **Rules:** no saving mid-scene; load validates that referenced content ids still exist (unknown id → quarantine that save with warning).
- **Debug:** export/import buttons in the debug panel; save size logged (watch the 5 MB localStorage ceiling from day one).

---

## 10. Error Handling

Infrastructure: typed `GameError { category, code, severity, context, cause }`, ring-buffer logger (~500 entries), console sink in dev, one-click "bug report bundle" export in the debug panel. Rule: every player-visible degradation has exactly one log entry.

| # | Failure | Detection | User-facing fallback | Dev log | Continues? |
|---|---|---|---|---|---|
| 1 | Invalid character schema | Zod at load | Boot error screen: file, Zod path, message | `ContentError:SCHEMA` | No (dev: fail fast at boot) |
| 2 | Invalid/unknown rank on a character | Rank-table cross-ref at load | Boot error screen | `ContentError:BAD_RANK` | No (boot-time) |
| 3 | Missing location (referenced id absent) | Cross-ref pass at load | Boot error screen listing every missing ref (all errors collected, not first-only) | `ContentError:MISSING_REF` | No (boot-time) |
| 4 | Event references nonexistent character | Cross-ref pass at load | Boot error screen | `ContentError:MISSING_REF` | No (boot-time) |
| 5 | Invalid event condition (unknown predicate/malformed) | Zod discriminated union at load; runtime evaluator throws typed error as backstop | Boot error; runtime backstop: event skipped | `ContentError:BAD_CONDITION` / `StateError:CONDITION_EVAL` | Boot: no. Runtime backstop: yes |
| 6 | Invalid effect target (char/flag doesn't exist) | Effect validator at commit | Whole batch rejected; scene ends with no state change at all (AP refunded with the session) | `StateError:BAD_EFFECT_TARGET` + batch dump | Yes |
| 7 | Missing dialogue (broken scene graph: bad `startNodeId`, dangling `next`, unreachable nodes, no terminal path) | Graph validation at load; runtime backstops: cursor miss, or `steps > maxNodeSteps(100)` loop guard | Boot error; runtime backstop: scene force-ends, session discarded (no AP/effects), return to map | `ContentError:BAD_SCENE_GRAPH` / `StateError:SCENE_CURSOR` / `StateError:SCENE_LOOP` | Boot: no. Runtime: yes |
| 8 | Save parse/checksum failure | On load | Quarantine → `auto.prev` → older slot → new game; never silent loss | `SaveError:CORRUPT` + quarantine key | Yes |
| 9 | Missing asset (portrait/background) | AssetRegistry resolve miss | Fallback chain: expression → neutral → baked-in silhouette/gradient; `isFallback` badge in debug | `AssetError:ASSET_MISSING` once per key | Yes |
| 10 | Impossible calendar state (month 13, AP −1, period out of enum) | Invariant check inside calendar reducer + Zod on save load | Reducer rejects the command (state unchanged); on load: treated as save corruption (#8) | `StateError:CALENDAR_INVARIANT` | Yes |
| 11 | Storage unavailable/quota | try/catch + startup probe | Banner "存档不可用——请导出存档"; play continues unsaved | `SaveError:STORAGE` | Yes |
| 12 | Save from changed content (hash/version mismatch) | `contentHash`/`contentVersion` check on load (§9) | Visible warning; loads only if content-id cross-check passes; declared-incompatible version → refuse + offer export | `SaveError:CONTENT_MISMATCH` | Yes |

Boot-time philosophy: in dev builds, content errors are **fatal and loud** (a content bug you can't miss is a content bug you fix). The production-build degradation paths (exclude broken character, disable referencing scenes) are DESIGN §7.2 behavior, deferred past the skeleton.

---

## 11. Testing Plan

Engine is framework-free → ~90% headless Vitest, no DOM.

**Unit**
- **Schemas:** every Zod schema accepts its documented example and rejects targeted mutations (missing field, bad enum, out-of-range salience, rank not in table, kind⇄domain mismatch, condition referencing a scaffold-only field, asymmetric connections). The three shipped events/characters are themselves fixtures — `tools/validate-content` runs in CI.
- **Calendar:** table-driven transitions — AP 5→0 rolls 上旬→中旬, 下旬→next month, 十二月下旬→次年一月上旬; AP never negative; `dayIndex` derivation correct and monotonic; `GameTime` extraction from `CalendarState` drops AP fields; invariant violations rejected.
- **Condition DSL:** truth table per predicate (`flagSet`, `atLocation`, `relationshipAtLeast`, `favorAtLeast`, `rankAtLeast`, `monthAtLeast`, `periodIs`, `eventFired`) + nesting `all/any/not`.
- **Effects:** each effect type — valid applies with clamp; invalid char/flag target rejects; illegal pillar/field combinations fail at Zod parse (discriminated union); batch atomicity (one bad effect → state deep-equal unchanged); ±10/scene cap.
- **Memory:** append validation, monotonic ids, per-character isolation (writing to A never touches B), protected flag honored, draft rejection paths.
- **Save:** migration chain runs (identity for v1), checksum mismatch → corruption path, unknown future version refused; contentHash mismatch → warning path (never silent); declared-incompatible contentVersion → refused.

**Integration (headless engine)**
- **Boot:** full ContentLoader over real `content/` + manifest cross-check — the one test that catches most content PR mistakes.
- **Scene execution:** scripted choice-paths through all three events → assert visited nodes, final state, memory entries written per witness (subjectivity assertion: 沈承徽 has the entry, 凤后 does not).
- **Scene transaction:** quit mid-scene at every node type → GameState deep-equal unchanged (AP included), `once` not consumed, re-entry replays; completing the same scene commits effects + AP spend + eventFired exactly once. Unaffordable event (`ap < apCost`) never opens a session.
- **Event engine:** fixtures → checkpoint evaluation picks correct single event; once/priority/cooldown; chain-depth cap with 4 chained events.
- **Save/load roundtrip:** scripted command sequence → save → load → deep-equal; continue identically (rng seed).
- **Invalid data:** corpus of broken content files → loader reports *all* errors with paths, exits nonzero.
- **Provider seam:** run a full event through MockProvider and assert the orchestrator validate-then-render path produced `DialogueLine`s with `meta.generated:false` — proving the seam works before any real provider exists.

**UI (thin)**
- Debug panel sanity: renders state tree / characters / relationships / memory / event flags from a fixture state without crashing; force-trigger fires an event. One Playwright smoke test (boot → new game → travel → play one event → save → reload → state matches) lands in the final PR.

---

## 12. PR-Sized Roadmap

**Uniform Definition of Done — every PR must satisfy:** `npm install` succeeds from a clean checkout; `npm run dev` starts without runtime errors; `npm run typecheck`, `npm test`, `npm run lint` (configured once in PR 1 — the engine-boundary rule only, don't grow the toolchain), and `npm run build` all pass; no TODO blocks the current PR's acceptance criteria; `main` remains playable up to the latest implemented slice.

Each PR leaves `main` green and the app bootable. Sequence refines the suggested one: schemas/content come **before** characters/locations (they're just content once the loader exists); the debug panel grows **incrementally** (a raw JSON state dump ships in PR 2 — waiting until PR 10 for any visibility would slow every PR in between); effects come before dialogue UI so the UI never grows a side-channel; and the **DialogueProvider seam ships together with the first dialogue UI (PR 8)** — a temporary "render scene nodes directly" path must never exist, because it would get removed later at exactly the moment the provider contract matters most.

| PR | Goal | Touches | Acceptance criteria | Risks |
|---|---|---|---|---|
| **1. Bootable shell** | Vite+React+TS strict+Vitest+ESLint (incl. no-React-in-engine rule); Title screen; infra primitives (Result, GameError, ring-buffer logger) | scaffolding, `engine/infra`, `ui/screens/Title` | `npm run dev` shows title; CI runs lint+tests; logger unit-tested | Over-scaffolding — keep it thin |
| **2. GameState + Calendar** | GameState shape, reducer, command batch atomicity, calendar/AP rollover, store bridge; **raw state JSON dump panel** | `engine/state`, `engine/calendar`, `src/store` | Calendar tests pass (元年一月上旬 init, all rollovers); atomicity test; dump panel shows live state | Calendar edge cases — table-driven tests |
| **3. Schemas + ContentLoader** | All Zod schemas (§4), loader with collect-all-errors cross-ref validation (incl. kind⇄domain match, scaffold-field guard), `tools/validate-content`, lexicon + rank table loading. **Precondition: DESIGN.md sync items (§15.1) patched first** | `engine/content`, `content/`, `tools/`, `docs/DESIGN.md` | Loader returns typed ContentDB from real placeholder content; every schema has accept+reject tests; CLI exits nonzero on bad fixture, incl. a condition referencing a scaffold-only field | Schema churn later — saves are versioned, content is cheap to edit |
| **4. Characters + Locations + Map** | 3 character files, 3 location files, world.json; map screen, travel via MOVE_TO_LOCATION + SPEND_AP; presence (defaultLocation) | `engine/characters`, `engine/map`, `ui/screens/Map·Location`, `content/` | Travel between 3 locations; AP drains; 旬 rolls over on 0; correct character shown per location | None significant |
| **5. Assets + placeholders** | manifest.json, AssetRegistry fallback chain, gen-placeholders + validate-manifest tools | `engine/assets`, `assets/`, `tools/` | Placeholder cards render; deleting a file → silhouette + one log line, no crash | Vite asset path quirks |
| **6. Effect funnel** | EventEffect union, validator, atomic applier, resource pillars in state | `engine/effects`, `engine/state` | All effect unit tests pass incl. atomicity + clamps; resources visible in dump panel | This is the architectural keystone — review hard |
| **7. Event engine + AP affordability** | Condition DSL evaluators, checkpoints wired into travel/scene-end, once/priority/cooldown, chain cap, affordability rule (block entry + 「行动点不足」), force-trigger | `engine/events` | All 3 events trigger at the right place/condition exactly once; unaffordable heavy event blocks with message; DSL truth tables pass | Checkpoint wiring — integration tests |
| **8. SceneRunner + Provider + Dialogue UI** | SceneSession transaction (reserve → accumulate → commit / discard), line/choice/branch/effect nodes, loop guard, **DialogueProvider interface + MockProvider**, DialogueScreen consuming only `DialogueLine` | `engine/scenes`, `engine/dialogue`, `ui/screens/Dialogue` | All 3 events playable start→finish **through the provider path** — UI provably never reads scene nodes; quit drill: mid-scene exit leaves state deep-equal incl. AP, `once` unconsumed | Biggest PR — split session/provider into 8a/8b if review is heavy |
| **9. Memory v0** | per-char stores, APPEND_MEMORY, `memory` effects as the **only** write path; memory tab in debug panel | `engine/memory`, `ui/debug` | Subjectivity test passes (different entries per char from one event); entries show source + writing scene; grep-level check: no write path outside the funnel | None significant |
| **10. Save/load** | SaveData with `contentVersion`/`contentHash`, checksum, slots+autosave rotation, quarantine, mismatch warning, export/import | `engine/save`, `ui/screens/SaveLoad` | Roundtrip deep-equal test; devtools-corrupted save triggers recovery ladder; content-hash-mismatch save shows visible warning; mid-scene save blocked; save size logged | localStorage quota — measure now |
| **11. Dialogue text gates** | forbidden-lexicon scan, `selfRefs`/speaker-identity validation, unauthorized-term + template-leak checks as pure **text-gate** functions (numeric clamps live in `engine/effects`, PR 6 — see §8 gate boundary); synthetic bad-output corpus; future provider adapter skeleton (types only, zero network code) | `engine/dialogue`, `tests` | Every corpus case rejected/flagged exactly as specced; MockProvider output passes all gates; adapter skeleton compiles, nothing imports it at runtime | Resist building real adapters — interface only |
| **12. Slice polish + acceptance** | full debug panel (relationships/standing/flags/force-trigger/bug-bundle), failure drills, Playwright smoke, §13 checklist walked | `ui/debug`, `tests/e2e` | Every §13 criterion checked off and demonstrated; all §10 drills behave per table | Timebox polish ruthlessly |

---

## 13. First Vertical Slice Acceptance Criteria

The skeleton is **done** when every line below is demonstrably true (PR 12 walks this list):

1. `npm run dev` boots to title; New Game reaches the palace map with no console errors.
2. Calendar displays **元年一月上旬**; AP displays **行动点：5/5**.
3. Spending 5 AP advances to 元年一月中旬; 下旬→二月上旬; 十二月下旬→二年一月上旬 (verified via debug time-skip).
4. Three locations visible and reachable; travel costs 1 AP; 凤后 in 后宫主殿, 沈承徽 in 御花园, 司礼女官 in 御书房.
5. All three characters load from `content/` with profiles, structured selfRefs (凤后: toPlayer「臣后」/ formal「本宫」; 沈承徽:「本位」), an official-domain rank for 司礼女官, relationships, standing, initial memories.
6. All three scripted events trigger at their locations exactly once and play start-to-finish through the DialogueProvider path; `apCost` is spent at commit only — the quit drill (enter event → exit mid-scene) leaves AP, state, and `once` untouched.
7. Choices change state: 敷衍 in 御花园 lowers 沈承徽 affinity and raises 妒意; 准奏祭仪 raises 宗嗣合法性 and 圣威 and sets `rite_scheduled`.
8. The same event writes different memory entries to different characters; absent characters get nothing.
9. Save → reload page → load: state deep-equal, memory intact, fired events stay fired. Corrupting the save blob in devtools triggers quarantine + `auto.prev` recovery, with user-visible messaging; loading a save whose `contentHash` mismatches current content shows a visible warning, never loads silently.
10. Debug panel (`` ` ``) shows: state tree, calendar, resources, per-character relationship + standing, per-character memory browser with sources, event flags/log, force-trigger; bug-bundle export works.
11. Breaking any content file (bad rank, kind⇄domain mismatch, dangling sceneId, broken node graph, scaffold field in a condition) produces a boot error screen naming the file, path, and reason — and `tools/validate-content` exits nonzero in CI. No silent failure anywhere.
12. Deleting an asset file shows the placeholder/silhouette fallback with exactly one log entry.

---

## 14. What NOT to Build Yet (deferred, by design)

- **Real AI integration** — adapters, routing, prompts, repair retries (DESIGN §5.4, §5.7), eval harness (§5.8).
- **Dynamic/`generate` scenes**, transcripts, conversation summaries.
- **Memory retrieval/scoring/consolidation/superseding** (DESIGN §4.4–4.8) and any vector/embedding search.
- **Full pregnancy system**, **full 承养 system** (三月转胎, blood-nurture rules, 承养人 health), **succession**, 绝经/传位.
- **Faction simulation** / 朝政 mechanics beyond the three resource scalars.
- Larger map, larger cast, schedules, NPC↔NPC dynamics, gossip propagation, procedural events.
- Final art pipeline, animation beyond portrait swaps, audio.
- Monetization, cloud save, accounts, localization, settings screen.
- Production AI-key proxy/backend (no keys exist in the skeleton at all).

---

## 15. Risks and Open Decisions

1. **DESIGN.md sync list — BLOCKING: must be patched before PR 3.** PR 3 implements these names as Zod schemas; once the loader lands, every rename multiplies across schemas, content files, and tests. PR 1–2 (shell, state dump) may proceed in parallel, but no schema code before DESIGN.md reflects:
   - `CourtState` reassigned to the 江山 pillar; per-character struct renamed `CharacterStanding` (DESIGN §3.2/§3.6).
   - `GameTime` (pure timestamp) split out of `CalendarState` (AP bookkeeping); all record timestamps use `GameTime` (DESIGN §3 conventions).
   - Scene `outcome`/`SceneOutcomeSpec` memory side-door removed: all consequences, memory included, are `EventEffect`s through the single funnel (DESIGN §3.4, §4.2, §4.6 wording).
   - `affection` → `affinity` on RelationshipState (officials share the axis).
   - `selfRef` string → structured `selfRefs {toPlayer, formal, informal?}` (DESIGN §3.9 lexicon rules, §5.4 prompt fields).
   - `apCost` semantics: reserved at entry, spent at commit (SceneSession transaction).
2. **Resource model fidelity.** Three flat 0–100 scalars per pillar is deliberately crude; the risk is content meaning accreting onto them before the real 江山/血脉 systems are designed. Mitigation: skeleton events may *only* nudge them ±≤5 and nothing reads them for logic. Re-open when the first real system lands.
3. **司礼女官 breaks the "everyone is a consort" assumption early — on purpose.** `kind: "official"` + rank `domain` + the generalized `affinity` axis + `favorTerm` (恩宠 vs 圣眷 display label) are the minimal accommodation, with the loader-enforced rule that **rank domain must match kind** — an official never holds a harem rank or a null-stuffed consort standing. Risk remains that officials eventually need their own fields (office, mandate, 忠诚/政见 axes); the planned evolution is a kind-discriminated `Character` union, deliberately not built in v0 — axes and unions are migration-cheap (DESIGN §11.6).
4. **Event↔Scene 1:1 file split** may feel like ceremony with three events. Kept anyway: collapsing them and re-splitting when dynamic scenes arrive would churn every content file; the split costs three small extra files today.
5. **UI text language.** Skeleton hardcodes Simplified Chinese UI strings (匹配 game text). If localization ever matters, that's a wrapper retrofit; explicitly not designed for now.
6. **localStorage 5 MB ceiling** — far away with 3 characters, but the save-size log (PR 10) starts the habit; IndexedDB remains the escape hatch.
7. **Scope discipline is the real risk.** The three events will tempt "just one more system" (favor ceremonies, 下旬 checks, public news digest). The line: anything not in §2 must-have goes to a post-skeleton issue list, not into a PR.
8. **Resolved: AP follows the SceneSession transaction.** Affordability blocks entry (「行动点不足」, no auto-rollover); cost is reserved at entry and spent only at commit; quit discards everything. This supersedes the earlier "deduct at scene start" wording. Remaining accepted nuance: free quit = risk-free event preview; fine for the skeleton, add an `abandoned` marker later only if a real cost ever needs protecting.

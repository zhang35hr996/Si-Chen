# Si-Chen — Foundational Design Document

**Status:** Draft v1 — pre-implementation
**Audience:** Engineers implementing the MVP vertical slice
**Scope:** Architecture, data model, memory, dialogue, scenes, assets, save/load, errors, testing, roadmap

---

## 1. Executive Summary & Product Vision

### 1.1 What the game is

A **character-driven narrative game** (visual-novel / social-sim hybrid) in which the player moves between a handful of locations in a small world, talks to a small cast of characters, and watches relationships and the world state evolve. Dialogue is **AI-generated but engine-governed**: each character speaks from their own profile, mood, relationship state, and **private subjective memory**, while all consequences (memory writes, relationship changes, event triggers) pass through validated, typed update channels.

- **Genre:** narrative adventure / relationship sim with emergent dialogue.
- **Target experience:** "These characters remember me, and they each remember things *differently*." The player feels continuity — a promise made on day 2 is referenced on day 9; a character who saw you lie trusts you less than one who only heard about it.
- **Core loop:** open map → pick a location → see who's there and what's happening → talk (scripted scene or generated conversation) → choose responses → relationships/memories/world state update → new scenes unlock → time advances.
- **What makes it compelling:** persistent per-character subjective memory + relationship state driving generated dialogue, inside a hand-authored scaffold of scenes and events that gives the story shape. Neither pure VN (static) nor pure chatbot (shapeless).

### 1.2 Intentionally out of scope for MVP

- Combat, action mechanics, minigames, inventory, economy.
- Quests as a formal system (events + flags cover the slice).
- Character-to-character autonomous simulation (NPCs talking to each other off-screen).
- Voice, music systems, animation beyond portrait swaps and simple transitions.
- Multiple save profiles/cloud sync; localization; accessibility beyond sane defaults.
- Production art (placeholders only, but pipeline is production-shaped).

### 1.3 MVP feature triage

**Must have (the vertical slice is not done without these):**
1. 3 characters with profiles, portraits (placeholder, ≥3 expressions each), independent memory.
2. 3 locations with backgrounds, a map screen, click-to-travel navigation.
3. Time model (day + time-slot) advancing on actions.
4. Dialogue screen: portrait, name, text, 2–4 player choices.
5. Scripted scenes (authored JSON) and generated conversations (LLM) through the same runtime.
6. Structured AI output → validated memory/relationship/event updates.
7. Relationship state per character (trust/affection + flags) influencing dialogue.
8. Save/load (manual slots + autosave), versioned, corruption-tolerant.
9. Debug overlay: state inspector, per-character memory browser, prompt viewer, force-event.
10. Full fallback ladder: missing asset → placeholder; AI failure → canned dialogue; bad save → recovery.

**Should have soon after MVP:**
- Character schedules (location by time-slot), mood decay/drift, conversation topic memory ("we already talked about this today"), scene cooldown UI hints, settings screen, asset preloading, a second "pack" of content to prove data-driven extension.

**Later expansion:**
- Quests, inventory, factions, NPC↔NPC generated side conversations, procedural events, schedules with exceptions, affection/rivalry webs, Steam/desktop packaging (Tauri), real art pipeline integration, audio.

---

## 2. Recommended Architecture

### 2.1 Stack decision

There is no existing code (empty repo), so the stack is chosen fresh:

| Layer | Choice | Why |
|---|---|---|
| Language | **TypeScript (strict)** | Typed data model is the backbone of this design; same language across engine, content tooling, tests. |
| Build/dev | **Vite** | Instant reload for content iteration; trivial static deploy. |
| UI | **React** | The game is UI: panels, text, choices, map. No physics/render loop needed. DOM + CSS transitions are enough; no Pixi/Phaser unless later needed. |
| Engine core | **Plain TS, framework-free** (`src/engine/**` never imports React) | Testable headless; UI is a replaceable skin. |
| State | Immutable `GameState` + command/reducer pattern, exposed to React via a thin store (zustand or a 50-line emitter) | Determinism, easy save/load, easy debug snapshotting. |
| Validation | **Zod** | Runtime schema validation for content files, saves, and AI output; types inferred from schemas (single source of truth). |
| Tests | **Vitest** | Native to the Vite ecosystem. |
| Content | JSON files in `content/`, validated at load | Data-driven extension without code changes. |
| Persistence | `localStorage` for slots + JSON export/import (IndexedDB only if saves outgrow ~5 MB) | Local-first; zero infra. |
| AI dialogue | **Provider interface** with two impls: `LLMProvider` (Claude API via Anthropic SDK) and `ScriptedProvider` (canned/mock) | Game runs fully offline on ScriptedProvider; LLM is a plug-in, not a dependency. |
| AI key handling | Dev: user-supplied key in local settings, called client-side. Production path: a **single-endpoint proxy** (`POST /dialogue`) — designed now, deployed later | Don't ship keys in a client; but don't build a backend before the slice needs one. |

**Why web-based / local-first:** a narrative game is text + images + UI state; the browser is the cheapest excellent renderer for that. Local-first means no accounts, no server state, no sync bugs; saves are user-owned JSON. The only network dependency is the optional LLM call, which is isolated behind one interface with an offline fallback. Desktop packaging later is a Tauri wrapper, not a rewrite.

### 2.2 Module map

Dependency rule: **arrows point downward only.** UI depends on engine; engine depends on nothing above it. Content and assets are data, not code.

```
┌────────────────────────── UI (React) ──────────────────────────┐
│ MapScreen · LocationScreen · DialogueScreen · SaveMenu · Debug │
└──────────────────────────────┬─────────────────────────────────┘
                               │ (reads snapshots, dispatches commands)
┌──────────────────────────────▼─────────────────────────────────┐
│                        Engine Core (plain TS)                   │
│                                                                 │
│  GameStateManager ── SceneRunner ── EventEngine                 │
│        │                  │              │                      │
│  CharacterSystem ── MemorySystem   MapSystem                    │
│        │                  │                                     │
│        └── DialogueOrchestrator ──► DialogueProvider (interface)│
│                                       ├─ LLMProvider            │
│                                       └─ ScriptedProvider       │
│                                                                 │
│  SaveSystem · ContentLoader · AssetRegistry · Logger/Errors     │
└─────────────────────────────────────────────────────────────────┘
            │                                   │
       content/*.json                      assets/* + manifest
```

### 2.3 Module responsibilities

For each module: responsibility, owned data, public interface, must-not-do, dependencies.

#### GameStateManager (`engine/state/`)
- **Responsibility:** owns the single authoritative `GameState`; applies **commands** (typed mutations) and emits change notifications. All state changes in the entire game flow through `dispatch`.
- **Owns:** `GameState` (time, player position, flags, relationship states, event log, scene history pointer). Does **not** own character memory contents (delegates to MemorySystem) but holds the serialized memory stores inside `GameState` for save purposes.
- **Interface:** `getState(): Readonly<GameState>`, `dispatch(cmd: GameCommand): CommandResult`, `subscribe(fn)`. Commands: `ADVANCE_TIME`, `MOVE_TO_LOCATION`, `SET_FLAG`, `APPLY_RELATIONSHIP_DELTA`, `APPEND_MEMORY`, `RECORD_EVENT_FIRED`, `APPLY_SCENE_OUTCOME`, …
- **Must not:** call the AI, touch the DOM, read files, know what a "scene" means narratively.
- **Depends on:** Logger only.

#### ContentLoader (`engine/content/`)
- **Responsibility:** load + Zod-validate all static content (characters, locations, scenes, events, asset manifest) at boot; produce a typed, frozen `ContentDB` with cross-reference checking (every `locationId`, `characterId`, `sceneId`, asset key referenced anywhere must exist).
- **Owns:** the immutable `ContentDB`.
- **Interface:** `loadAll(): Promise<Result<ContentDB, ContentError[]>>`, `getCharacter(id)`, `getScene(id)`, `getLocation(id)`, `getEvent(id)` (throwing typed `ContentError` on miss).
- **Must not:** hold mutable runtime state; silently skip invalid files (collect and report all errors).
- **Depends on:** Logger.

#### CharacterSystem (`engine/characters/`)
- **Responsibility:** runtime view of a character = static profile (from ContentDB) + dynamic state (mood, relationship, memory handle). Computes derived values ("disposition toward player") used by dialogue and event conditions.
- **Owns:** `CharacterRuntime` objects (thin; dynamic parts live in GameState).
- **Interface:** `get(id): CharacterRuntime`, `getPresentAt(locationId, time): CharacterRuntime[]`, `getRelationship(id): RelationshipState`, `getMood(id): MoodState`.
- **Must not:** mutate state directly (issues commands), build prompts, pick dialogue.
- **Depends on:** GameStateManager (read), ContentDB, MemorySystem.

#### MemorySystem (`engine/memory/`)
- **Responsibility:** per-character memory stores: append, retrieve (scored), summarize, consolidate, protect. Full design in §4.
- **Owns:** memory store structures (serialized inside GameState).
- **Interface:** `append(charId, entry: MemoryEntryDraft): Result<MemoryEntry, MemoryError>`, `retrieve(charId, query: MemoryQuery): MemoryEntry[]`, `consolidate(charId): ConsolidationReport`, `snapshot(charId): CharacterMemory`.
- **Must not:** call the LLM itself (summarization requests go through DialogueOrchestrator's provider); accept unvalidated entries; delete `protected` entries.
- **Depends on:** GameStateManager (via commands), Logger.

#### DialogueOrchestrator (`engine/dialogue/`)
- **Responsibility:** the dialogue pipeline (§5): assemble context, retrieve memory, build prompt, call provider, validate/repair output, translate validated output into commands and a UI-agnostic `DialogueTurn`.
- **Owns:** in-flight conversation transcript for the current scene.
- **Interface:** `startConversation(charId, ctx): Promise<DialogueTurn>`, `continueConversation(choiceId | freeText): Promise<DialogueTurn>`, `endConversation(): SceneOutcome`.
- **Must not:** mutate GameState directly (returns/dispatches typed commands); contain UI code; trust raw model output.
- **Depends on:** CharacterSystem, MemorySystem, DialogueProvider, GameStateManager, Logger.

#### DialogueProvider (interface, `engine/dialogue/providers/`)
- **Responsibility:** `generate(request: DialogueRequest): Promise<Result<RawDialogueResponse, AIError>>`. `LLMProvider` calls the model with structured-output instructions, handles timeouts/retries at the transport level. `ScriptedProvider` serves authored fallback lines and is the offline/test default.
- **Must not:** know about GameState; parse beyond raw JSON extraction (semantic validation is the Orchestrator's job, so all providers are validated identically).

#### SceneRunner (`engine/scenes/`)
- **Responsibility:** executes a `Scene` (scripted or dynamic): steps through nodes (line / choice / branch / generate / effect), requests generated turns from DialogueOrchestrator for `generate` nodes, emits `SceneOutcome` at the end.
- **Owns:** current scene execution cursor.
- **Interface:** `canStart(sceneId): boolean`, `start(sceneId): SceneFrame`, `advance(input): SceneFrame | SceneOutcome`.
- **Must not:** decide *which* scene should run (EventEngine's job); apply outcomes itself (dispatches commands).
- **Depends on:** ContentDB, DialogueOrchestrator, GameStateManager.

#### EventEngine (`engine/events/`)
- **Responsibility:** evaluates declarative trigger conditions against GameState at defined checkpoints (location entry, time advance, scene end); picks the highest-priority eligible event; enforces once/cooldown/exclusion rules; detects trigger cycles.
- **Owns:** nothing persistent (fired-event bookkeeping lives in GameState.eventLog).
- **Interface:** `evaluate(checkpoint: TriggerCheckpoint): GameEvent | null`, `forceTrigger(eventId)` (debug).
- **Must not:** run scenes itself (returns the event; caller starts the scene); contain hardcoded story logic.
- **Depends on:** ContentDB, GameStateManager (read), CharacterSystem (for condition predicates).

#### MapSystem (`engine/map/`)
- **Responsibility:** location graph, travel legality, who/what is present at a location for the current time.
- **Interface:** `getNodes(): MapNode[]`, `canTravel(from, to): boolean`, `getLocationView(id): LocationView` (background key, present characters, available scene hooks).
- **Must not:** advance time or trigger events directly (returns data; the travel *command* does the rest).

#### AssetRegistry (`engine/assets/`)
- **Responsibility:** resolve logical asset keys (`portrait.mara.smile`) to URLs via the manifest; preload per-location bundles; provide fallback chain on miss (§6.3).
- **Owns:** parsed `AssetManifest`, load-status cache.
- **Interface:** `resolve(key: AssetKey): ResolvedAsset` (never throws — always returns something drawable, flags `isFallback`), `preload(keys): Promise<void>`.
- **Must not:** be bypassed (UI components never hardcode asset paths).

#### SaveSystem (`engine/save/`)
- **Responsibility:** serialize `GameState` (+ memory stores) into versioned `SaveData`; slots, autosave, migrations, integrity checking, export/import. §7 of this doc / §11 of the brief.
- **Must not:** save mid-scene (only at safe checkpoints); apply a save that fails validation without going through recovery.

#### Logger & Errors (`engine/infra/`)
- **Responsibility:** typed error hierarchy (`ContentError`, `AssetError`, `AIError`, `SaveError`, `StateError`, each with `code`, `severity`, `context`), ring-buffer log (last ~500 entries, included in debug export), console sink in dev.
- **Must not:** swallow errors silently; log raw API keys or full prompts at `info` level (prompts log at `debug`).

#### UI Layer (`src/ui/`)
- **Responsibility:** render snapshots, dispatch commands/intents. Screens: Title, Map, Location, Dialogue, SaveLoad, Settings, DebugOverlay.
- **Must not:** contain game rules; call DialogueProvider directly; mutate state; compute memory retrieval. The dialogue screen renders a `DialogueTurn` object — it has no idea whether it was scripted or generated.

#### Debug Tools (`src/ui/debug/`)
- Dev-only overlay (hotkey `` ` ``): GameState tree inspector; per-character memory browser (sort/filter by salience, tag, protection); relationship editor; event log + force-trigger; **prompt viewer** showing the exact last prompt sent and raw response received; time/flag manipulation; save export/import as JSON file.

### 2.4 Folder structure

```
si-chen/
├── content/                      # data, no code — adding here adds game
│   ├── characters/               #   one file per character
│   │   └── mara.json
│   ├── locations/
│   │   └── inn.json
│   ├── scenes/
│   │   └── intro_mara.json
│   ├── events/
│   │   └── ev_mara_intro.json
│   ├── fallback_dialogue/        #   canned lines per character for AI failure
│   │   └── mara.json
│   └── world.json                #   map graph, time-slot config, starting state
├── assets/
│   ├── portraits/<charId>/<expression>.png
│   ├── backgrounds/<locationId>.png
│   ├── ui/
│   └── manifest.json
├── src/
│   ├── engine/                   # framework-free TS (no React imports — enforced by lint rule)
│   │   ├── state/                # GameState, commands, reducer
│   │   ├── content/              # loaders + zod schemas (schemas are the type source)
│   │   ├── characters/
│   │   ├── memory/
│   │   ├── dialogue/
│   │   │   └── providers/        # llmProvider.ts, scriptedProvider.ts
│   │   ├── scenes/
│   │   ├── events/
│   │   ├── map/
│   │   ├── assets/
│   │   ├── save/
│   │   └── infra/                # errors.ts, logger.ts, result.ts, rng.ts
│   ├── ui/
│   │   ├── screens/
│   │   ├── components/
│   │   └── debug/
│   ├── store/                    # engine↔React bridge
│   └── main.tsx
├── tools/                        # node scripts: validate-content, validate-manifest, new-character scaffold
├── tests/                        # vitest: unit + integration (engine runs headless)
└── docs/
```

---

## 3. Data Model

Schemas are **Zod definitions**; TS types are inferred (`z.infer`), so runtime validation and compile-time types cannot drift. Shown here as TS interfaces for readability. Conventions: IDs are lowercase snake strings, namespaced by collection (`mara`, not `char_001`); cross-references validated at load; all game-time stamps use `GameTime {day:number, slot:"morning"|"afternoon"|"evening"|"night"}`.

### 3.1 Character & CharacterProfile (static content)

```ts
interface Character {
  id: string;                    // "mara"
  profile: CharacterProfile;
  defaultLocation: string;       // locationId
  schedule?: ScheduleRule[];     // post-MVP; absent = always at defaultLocation
  portraitSet: string;           // asset namespace, usually == id
  expressions: string[];         // ["neutral","smile","frown","worried"] — must exist in manifest
  voice: VoiceSpec;              // prompt-facing style constraints
  initialRelationship: RelationshipState;
  initialMemories: MemoryEntryDraft[];   // seeded subjective backstory
  secrets: Secret[];
}

interface CharacterProfile {
  name: string;
  age: number;
  role: string;                  // "innkeeper"
  appearance: string;            // 1–2 sentences, for prompt + art reference
  personalityTraits: string[];   // 3–6 adjectives, stable
  coreFacts: string[];           // immutable truths ("grew up in the capital")
  goals: string[];               // current wants — drive dialogue agendas
  speechStyle: string;           // "warm, teasing, short sentences, never curses"
}

interface VoiceSpec {
  register: "formal" | "casual" | "rough" | "poetic";
  quirks: string[];              // ["calls the player 'stranger' until trust ≥ 30"]
  tabooTopics: string[];         // things the character deflects from
}

interface Secret {
  id: string;                    // "mara_debt"
  content: string;               // what's true
  revealCondition?: TriggerCondition;  // when it MAY surface in dialogue
}
```

**Purpose:** everything stable about a character. **Validation:** ≥1 expression named `neutral`; every expression present in asset manifest; `initialMemories` validate as MemoryEntryDrafts; secrets never serialized into saves in plaintext beyond their id + revealed flag (content stays in ContentDB).

```json
{
  "id": "mara",
  "profile": {
    "name": "Mara",
    "age": 38,
    "role": "innkeeper",
    "appearance": "Broad-shouldered woman with graying braids and flour-dusted sleeves.",
    "personalityTraits": ["warm", "shrewd", "protective", "secretly anxious"],
    "coreFacts": ["owns the Driftwood Inn", "widowed six years ago"],
    "goals": ["keep the inn solvent", "find out who the newcomer (player) really is"],
    "speechStyle": "Warm and teasing; short sentences; switches to clipped formality when suspicious."
  },
  "defaultLocation": "inn",
  "portraitSet": "mara",
  "expressions": ["neutral", "smile", "frown", "worried"],
  "voice": { "register": "casual", "quirks": ["calls player 'stranger' until trust >= 30"], "tabooTopics": ["her late husband's debts"] },
  "initialRelationship": { "trust": 10, "affection": 5, "flags": [] },
  "initialMemories": [
    { "kind": "event", "summary": "A stranger (the player) arrived in town yesterday on the evening ferry.", "salience": 60, "tags": ["player", "arrival"], "protected": true }
  ],
  "secrets": [
    { "id": "mara_debt", "content": "Mara owes the harbormaster a large sum and could lose the inn.", "revealCondition": { "all": [{ "relationshipAtLeast": { "char": "mara", "field": "trust", "value": 60 } }] } }
  ]
}
```

### 3.2 CharacterMemory, MemoryEntry, RelationshipState, MoodState (runtime)

```ts
interface CharacterMemory {
  characterId: string;
  entries: MemoryEntry[];          // long-term, structured
  recentTranscript: TranscriptLine[]; // short-term: last conversation w/ player, verbatim, capped
  conversationSummaries: MemoryEntry[]; // kind:"conversation_summary", one per past conversation
  revealedSecrets: string[];       // secret ids the player now knows
}

interface MemoryEntry {
  id: string;                      // "mem_mara_000017" (monotonic per char)
  kind: "event" | "fact_learned" | "opinion" | "promise" | "conversation_summary";
  summary: string;                 // ≤ 240 chars, third person, from THIS character's POV
  detail?: string;                 // optional longer text, never sent to prompts wholesale
  salience: number;                // 0–100, how much this matters to the character
  createdAt: GameTime;
  lastReferencedAt?: GameTime;     // touched on retrieval — feeds recency scoring
  tags: string[];                  // ["player","promise","inn"] — retrieval keys
  participants: string[];          // character ids incl. "player"
  locationId?: string;
  source: "authored" | "scene_outcome" | "ai_proposed" | "consolidation";
  protected: boolean;              // never auto-deleted/merged
  supersededBy?: string;           // contradiction handling, §4.7
}

interface RelationshipState {
  trust: number;                   // 0–100
  affection: number;               // 0–100
  flags: string[];                 // ["knows_player_name","owes_player_favor"]
  // future axes (rivalry, fear, respect) added as optional fields + migration
}

interface MoodState {
  current: "neutral" | "happy" | "tense" | "sad" | "angry" | "anxious";
  intensity: number;               // 0–100, decays toward neutral each time slot
  cause?: string;                  // memoryEntry id or event id — debuggability
}
```

**Validation:** salience clamped 0–100; summary length enforced; `kind` whitelist; `source:"ai_proposed"` entries additionally pass the AI-update validator (§5.6). Trust/affection deltas clamped to ±10 per scene.

### 3.3 Location & MapNode

```ts
interface Location {
  id: string;                      // "inn"
  name: string;                    // "The Driftwood Inn"
  description: string;             // shown on entry + fed to prompts as setting
  backgroundKey: AssetKey;         // "bg.inn"
  ambience: string[];              // ["smell of bread","fire crackling"] — prompt color
  hooks: SceneHook[];              // interactable non-character things (post-slice ok)
}

interface MapNode {
  locationId: string;
  position: { x: number; y: number };   // 0–1 normalized coords on map image
  connections: string[];           // travel edges; MVP: fully connected is fine
  travelCost: { slots: number };   // time slots consumed (MVP: 1 for all)
  unlockedBy?: TriggerCondition;   // hidden until condition met
}
```

```json
{ "locationId": "docks", "position": { "x": 0.72, "y": 0.61 }, "connections": ["inn", "archive"], "travelCost": { "slots": 1 } }
```

**Validation:** connections symmetric (loader auto-mirrors and warns); every `backgroundKey` exists in manifest; node positions within [0,1].

### 3.4 Scene, DialogueTurn, DialogueChoice

```ts
interface Scene {
  id: string;                          // "intro_mara"
  kind: "scripted" | "dynamic" | "hybrid";
  locationId: string;
  participants: string[];              // character ids
  nodes: SceneNode[];                  // execution graph; entry = nodes[0]
  outcome?: SceneOutcomeSpec;          // declarative effects applied at scene end
}

type SceneNode =
  | { type: "line"; id: string; speaker: string; text: string; expression?: string; next?: string }
  | { type: "choice"; id: string; choices: DialogueChoice[] }
  | { type: "branch"; id: string; condition: TriggerCondition; ifTrue: string; ifFalse: string }
  | { type: "generate"; id: string; characterId: string; directive: string;   // authored steering, e.g. "Mara probes who the player is; she is friendly but fishing"
      maxTurns: number; exitOn: "choice_exit" | "turn_limit"; next?: string }
  | { type: "effect"; id: string; commands: SceneEffect[]; next?: string };   // SET_FLAG, RELATIONSHIP_DELTA, APPEND_MEMORY — engine-validated

interface DialogueChoice {
  id: string;
  text: string;                        // what the player says/does
  tone?: "friendly" | "neutral" | "guarded" | "hostile" | "flirty";  // feeds prompt + relationship heuristics
  next?: string;                       // scripted: next node id
  condition?: TriggerCondition;        // hidden if unmet
  isExit?: boolean;
}

interface DialogueTurn {                // what UI renders — provider-agnostic
  speakerId: string;
  speakerName: string;
  text: string;
  emotion: string;                     // semantic ("amused")
  expression: string;                  // concrete portrait key suffix ("smile")
  choices: DialogueChoice[];
  meta: { generated: boolean; degraded: boolean };  // degraded = fallback content
}
```

**Validation:** node graph reachable, no dangling `next`, exactly one terminal path or explicit `exitOn`; `generate` nodes only reference participants; scripted `expression` values exist for that character.

### 3.5 GameEvent & TriggerCondition

```ts
interface GameEvent {
  id: string;                          // "ev_mara_debt_reveal"
  sceneId: string;                     // what runs when it fires
  checkpoint: "location_enter" | "time_advance" | "scene_end" | "game_start";
  condition: TriggerCondition;
  priority: number;                    // higher wins; ties broken by id (deterministic)
  once: boolean;
  cooldown?: { slots: number };        // for repeatable events
  exclusiveGroup?: string;             // at most one event per group per checkpoint
}

type TriggerCondition =
  | { all: TriggerCondition[] } | { any: TriggerCondition[] } | { not: TriggerCondition }
  | { flagSet: string } | { dayAtLeast: number } | { timeSlotIs: string }
  | { atLocation: string }
  | { relationshipAtLeast: { char: string; field: "trust" | "affection"; value: number } }
  | { hasMemoryTag: { char: string; tag: string } }
  | { eventFired: string } | { secretRevealed: { char: string; secretId: string } };
```

This closed predicate set is the **condition DSL** — adding a predicate = one Zod variant + one evaluator function. No eval(), no scripting language in MVP.

```json
{
  "id": "ev_mara_debt_reveal",
  "sceneId": "mara_debt_confession",
  "checkpoint": "location_enter",
  "condition": { "all": [ { "atLocation": "inn" }, { "relationshipAtLeast": { "char": "mara", "field": "trust", "value": 60 } }, { "not": { "eventFired": "ev_mara_debt_reveal" } } ] },
  "priority": 50,
  "once": true
}
```

### 3.6 GameState & SaveData

```ts
interface GameState {
  time: GameTime;
  playerLocation: string;
  flags: Record<string, boolean | number | string>;
  relationships: Record<string, RelationshipState>;   // by characterId
  moods: Record<string, MoodState>;
  memories: Record<string, CharacterMemory>;
  eventLog: EventLogEntry[];           // {eventId, firedAt} — drives once/cooldown
  sceneHistory: string[];              // completed scene ids
  pendingScene?: string;               // resume safety: scene queued but not started
  rngSeed: number;
}

interface SaveData {
  formatVersion: number;               // integer, bump on breaking change
  engineVersion: string;               // app build, informational
  createdAt: string;                   // ISO wall-clock
  slot: string;                        // "auto" | "slot1".."slot5" | "debug-export"
  checksum: string;                    // sha-256 of canonical-JSON state
  state: GameState;
}
```

**Validation on load:** formatVersion known → run migration chain → Zod-validate → checksum verify → cross-check referenced content ids still exist (unknown char/scene ids quarantined with warning, not fatal — see §7).

### 3.7 AssetManifest

```ts
interface AssetManifest {
  version: number;
  entries: Record<AssetKey, AssetEntry>;   // key e.g. "portrait.mara.smile"
}
interface AssetEntry {
  path: string;                        // "portraits/mara/smile.png"
  kind: "portrait" | "background" | "ui" | "map";
  placeholder: boolean;                // true until real art lands — drives a debug report
  size?: { w: number; h: number };
}
```

```json
{
  "version": 1,
  "entries": {
    "portrait.mara.neutral": { "path": "portraits/mara/neutral.png", "kind": "portrait", "placeholder": true },
    "bg.inn": { "path": "backgrounds/inn.png", "kind": "background", "placeholder": true }
  }
}
```

---

## 4. Character Memory System

This is the heart of the design. Principles: **structured over freeform**, **subjective per character**, **explicit writes only**, **bounded size**, **protected canon**.

### 4.1 Memory layers

| Layer | Contents | Lifetime | Sent to prompts as |
|---|---|---|---|
| **Profile** (static) | coreFacts, traits, goals, speechStyle | forever, content-defined | always, in full (it's small) |
| **Long-term entries** | typed `MemoryEntry`s: events, learned facts, opinions, promises | until consolidated (unless protected) | top-K retrieved (§4.4) |
| **Conversation summaries** | one compressed entry per finished conversation | long-term, consolidation-eligible | retrieved like other entries; last 2 always eligible |
| **Short-term transcript** | verbatim lines of the *current/last* conversation | cleared/compressed at scene end | last conversation tail, always (continuity) |
| **Relationship + mood** | numeric axes, flags, mood | runtime | always, rendered as natural language |
| **Secrets** | content-defined hidden knowledge + revealed flags | forever | only `revealCondition`-eligible secrets, with handling instructions |

**Subjectivity:** there is no global "what happened" store that characters read from. When a scene ends, the SceneOutcome generates **per-witness** memory drafts — each present character gets their own entry, worded from their POV, with their own salience. Mara (lied to directly) stores *"The stranger lied to me about where they came from"* at salience 75; Joren (overheard) stores *"The stranger told Mara some story about the capital; sounded off"* at salience 40. Characters absent from a scene get nothing unless an explicit gossip effect writes a secondhand entry (post-MVP system; supported now by just authoring an `effect` node).

### 4.2 How memory is created

Only four producers, all explicit:

1. **Authored**: `initialMemories` in character files; `effect` nodes in scripted scenes (`APPEND_MEMORY` with full entry specified by the writer).
2. **Scene outcome**: SceneRunner's end-of-scene step writes the conversation summary + per-witness event entries declared in `SceneOutcomeSpec`.
3. **AI-proposed**: the model's `memory_updates` field — these are *drafts* that must pass the AI-update validator (§5.6): schema-valid, summary length ok, salience clamp, tag whitelist-ish (free tags allowed but lowercased/trimmed/capped at 5), `protected` forced to `false` (AI can never write protected memories), kind ∈ whitelist. Rejected drafts are logged, never applied.
4. **Consolidation**: the system itself writing merged summaries (§4.8).

Every applied entry flows through the `APPEND_MEMORY` command → it appears in the command log → it is inspectable in the debug memory browser with its `source`. **Nothing else can write memory.** This is the "explicit, reviewable, safe" requirement made concrete.

### 4.3 Short-term vs long-term

During a conversation, the orchestrator keeps a verbatim `recentTranscript` (capped at 40 lines). At scene end: transcript → one `conversation_summary` entry (~2–4 sentences; generated by the provider with a dedicated summarize request, or by a dumb truncation fallback if AI unavailable) + the transcript tail (last 6 lines) is retained until the *next* conversation with that character starts, so "as I was saying" continuity works across an immediate re-talk.

### 4.4 Retrieval for dialogue

`MemoryQuery` built by the orchestrator: `{ participants:["player", charId], locationId, topicTags (from current scene directive + last player choice), limit: 8 }`.

Scoring (plain weighted sum — tune constants later, no embeddings in MVP):

```
score = 0.45 * salience/100
      + 0.25 * recency          // exp decay on (now - lastReferencedAt ?? createdAt), half-life ≈ 6 days
      + 0.20 * tagOverlap       // |query.tags ∩ entry.tags| / |query.tags|
      + 0.10 * participantMatch
+ guarantees: all `promise` entries involving the player are always included;
              the 2 most recent conversation_summaries are always included;
              hard cap: 8 entries (~ ≤ 1200 chars of memory text in the prompt)
```

Retrieved entries get `lastReferencedAt = now` (recently-discussed things stay warm). **Embedding-based retrieval is deliberately deferred:** with <100 entries per character and good tags, weighted scoring is sufficient, deterministic, and debuggable. The `MemoryQuery → entries` interface won't change if embeddings are added later.

### 4.5 Retrieval failure

If retrieval throws (corrupt entry, etc.): log `MemoryError`, fall back to profile + relationship + last conversation summary only. Dialogue proceeds, marked `degraded`. The game never blocks on memory.

### 4.6 Updates after a scene

Fixed, ordered, atomic sequence at scene end (`APPLY_SCENE_OUTCOME` command batch):
1. Validate all proposed updates (AI + declarative outcome spec).
2. Apply relationship deltas (clamped ±10/scene per axis).
3. Apply mood change.
4. Append per-witness memory entries.
5. Write conversation summary; trim transcript.
6. Record event-fired bookkeeping; set flags.
7. Run EventEngine `scene_end` checkpoint.
8. Autosave.

If any step fails validation, the *whole batch* is rejected and a minimal safe outcome applies (conversation summary only + log). State is never half-updated.

### 4.7 Contradictions

Memories are never edited in place. A new entry that contradicts an old one (same topic, incompatible content — detected only when an *authored* effect or AI update explicitly names a `supersedes` target; no automatic NLP contradiction detection in MVP) sets `supersededBy` on the old entry. Superseded entries are excluded from retrieval by default but kept (debuggable history; enables "you told me differently before!" authored beats, which query superseded entries deliberately). Two characters remembering the same event incompatibly is **not** a contradiction — that's the subjectivity feature.

### 4.8 Bloat prevention & consolidation

Budget: **60 active entries per character** (configurable). When exceeded, consolidation runs at the next safe checkpoint (end of day):
- Candidates: unprotected, salience < 40, not referenced in 5+ days, not `promise`.
- Cluster candidates by shared dominant tag; merge each cluster into one `consolidation` entry ("Over several days, the stranger helped around the inn a few times"), salience = max of merged + 5.
- Originals get `supersededBy = <consolidated id>` (retained but inactive; a hard purge of superseded entries older than 30 game-days keeps saves bounded).
- `protected` entries and promises are untouchable, ever. Authored initial memories default to protected.

### 4.9 Debugging memory

Debug overlay memory browser per character: table of entries (id, kind, salience, age, tags, source, protected, superseded), full-text view, **retrieval simulator** (type a topic → see exactly which 8 entries would be sent and their scores), diff view of the last scene's memory writes, and a "why does she think that?" trace (entry → source command → scene id). Memory state is exportable as JSON with any debug save.

---

## 5. Dialogue Generation System

### 5.1 Pipeline

```
player intent (choice/talk)
  → DialogueOrchestrator.assembleContext
      profile + voice + mood + relationship(level + flags, rendered as prose)
      + scene directive (authored steering)            ← keeps story on rails
      + retrieved memories (§4.4)
      + eligible secrets w/ handling rules
      + transcript so far (this conversation)
      + world context (location, time, present others)
  → build prompt (template §5.4)
  → DialogueProvider.generate (timeout 12s)
  → extract JSON → Zod-validate → semantic-validate (§5.5)
  → on failure: 1 repair retry → ScriptedProvider fallback
  → split: DialogueTurn (render now) + proposed updates (hold until scene end, §4.6)
```

Generated dialogue **never mutates state at render time.** Proposed updates accumulate on the orchestrator and are applied as one validated batch when the scene ends. (If the player quits mid-scene, accumulated updates are dropped, transcript discarded — a scene is the atomic narrative unit.)

### 5.2 Output contract (model must return exactly this JSON)

```json
{
  "speaker": "mara",
  "text": "Capital folk don't usually know one end of a mop from the other. You surprise me, stranger.",
  "emotion": "amused",
  "expression": "smile",
  "choices": [
    { "text": "I wasn't always a clerk.", "tone": "friendly" },
    { "text": "Maybe I'm full of surprises.", "tone": "flirty" },
    { "text": "(Say nothing and keep mopping.)", "tone": "guarded", "isExit": false }
  ],
  "memory_updates": [
    { "kind": "opinion", "summary": "The stranger works harder than expected for a self-described clerk.", "salience": 45, "tags": ["player", "work", "inn"] }
  ],
  "relationship_updates": { "trust": 3, "affection": 1 },
  "event_triggers": []
}
```

### 5.3 Validation & repair (three gates)

1. **Syntactic:** extract first JSON object from response; `JSON.parse`; Zod schema. Failure → one **repair retry**: re-send with the parse error appended ("Your previous output was invalid: <error>. Return only valid JSON matching the schema."). Second failure → fallback.
2. **Semantic:** `speaker` is the requested character; `expression` ∈ character's expression list (else map via `emotion→expression` table, else `neutral`); 1–4 choices, each ≤ 120 chars; `text` ≤ 600 chars and contains no other character's dialogue; relationship deltas clamped ±5 per *turn* (and ±10 per scene total); `event_triggers` ⊆ the whitelist of trigger ids offered in the prompt (anything else dropped + logged).
3. **Safety/state:** memory_updates pass §4.2 rule 3; the model cannot set flags, move characters, reveal non-eligible secrets (output mentioning an ineligible secret's content is not detectable cheaply — mitigated by never putting ineligible secrets in the prompt at all).

**Fallback ladder:** LLM ok → use it. Retry ok → use it. Else → ScriptedProvider serves a character-appropriate canned line from `content/fallback_dialogue/<char>.json` (keyed by mood + relationship tier, e.g. "mara.tense.low_trust": "Not now, stranger. The kettle's screaming.") with generic choices (continue / leave). Turn is marked `degraded:true`; UI shows it normally (player shouldn't be slapped with an error), debug overlay counts degradations. Conversation can always be exited; the game never hard-blocks on the model.

### 5.4 Prompt template (per character, per turn)

```
You are roleplaying {name}, a character in a narrative game. Stay strictly in character.

== WHO YOU ARE ==
{name}, {age}, {role}. {appearance}
Personality: {personalityTraits, joined}
Core facts: {coreFacts, bulleted}
Current goals: {goals, bulleted}
Speech style: {speechStyle} Register: {voice.register}. Quirks: {voice.quirks}.
Never discuss willingly: {voice.tabooTopics} — deflect if raised.

== YOUR CURRENT STATE ==
Mood: {mood.current} (intensity {mood.intensity}/100){mood.cause ? ", because " + causeSummary : ""}
Your relationship with the player: trust {trust}/100 ({trustTierWord}), affection {affection}/100 ({affTierWord}).
Relationship notes: {flags rendered as sentences}

== WHAT YOU REMEMBER (your subjective memories — others may remember differently) ==
{retrieved entries, newest last: "- [day {d}] {summary}"}

== SECRETS YOU HOLD ==        (section omitted if none eligible)
{for each eligible secret: "- {content} — You may hint at or reveal this ONLY if the
 conversation naturally leads there and you feel safe. Otherwise guard it."}

== SCENE ==
Location: {location.name}. {location.description} Ambience: {ambience}.
Time: day {day}, {slot}. Also present: {others or "no one else"}.
Direction for this conversation: {scene directive}

== CONVERSATION SO FAR ==
{transcript lines: "{Speaker}: {text}" — last 12 lines}
Player ({choice.tone} tone): {player's chosen line}

== OUTPUT ==
Respond with ONLY a JSON object, no prose around it:
{ "speaker": "{id}", "text": "...", "emotion": "...", "expression": one of {expressions},
  "choices": [2–4 options the PLAYER could say next, varied in tone, each ≤120 chars,
              include one that disengages if conversation could naturally end],
  "memory_updates": [0–2 NEW things {name} will remember from this exchange, only if
                     genuinely noteworthy; {"kind","summary"(≤240 chars, your POV),
                     "salience"(0–100),"tags"(≤5)}],
  "relationship_updates": {"trust": -5..5, "affection": -5..5} (0 if nothing changed),
  "event_triggers": [] or subset of {offeredTriggerIds} if its condition was clearly met }

Rules: Speak only as {name}. ≤120 words of dialogue. React to the player's tone and to
your memories. Do not invent facts about the world or other characters not given above.
Do not reveal information from sections above verbatim as exposition.
```

Player **choices are model-generated** in dynamic nodes (with the tone-variety rule above) and **author-written** in scripted nodes; hybrid scenes can pin authored choices by having the `generate` node exit into a `choice` node.

### 5.5 Staying in-character

Defense in depth: (a) profile/voice/taboo sections in every prompt; (b) directive from the authored scene bounds the topic; (c) only that character's memories are in context — it literally cannot leak others' knowledge; (d) semantic validator rejects wrong-speaker output; (e) regression "voice tests" (§8) snapshot known-good outputs for prompt-change review; (f) temperature ~0.8 for dialogue, 0.2 for summarization.

### 5.6 How dialogue affects game state — the single funnel

```
raw model JSON → Zod → semantic clamps → ProposedUpdates (typed)
   → held by orchestrator → scene end → APPLY_SCENE_OUTCOME batch → reducer
```

There is exactly one path, and the reducer only accepts typed commands. The model cannot name a command; it can only fill whitelisted proposal fields. This satisfies the "AI never directly mutates state" constraint structurally rather than by discipline.

### 5.7 API boundary (future backend)

`LLMProvider` speaks to `POST /dialogue { request: DialogueRequest }` → `{ response: RawDialogueResponse }`. In dev this "endpoint" is a local function calling the Anthropic SDK with a user-provided key (stored in localStorage settings, never in saves or content). Moving to a real proxy later changes one file. The request type contains the fully-assembled prompt — the server stays stateless and game-agnostic.

---

## 6. Map, Scene/Event, and Asset Systems

### 6.1 Map & locations

- Map screen renders `world.json`'s MapNodes on a single map image; nodes with unmet `unlockedBy` are hidden or shown locked.
- Travel: click reachable node → `MOVE_TO_LOCATION` command → time advances by `travelCost.slots` → `time_advance` then `location_enter` event checkpoints run → LocationScreen renders background + present characters (clickable portraits → start conversation) + any location hooks.
- **Presence (MVP):** character is at `defaultLocation` every slot unless a fired event/flag relocates them (`flagSet` conditions on a per-character `presenceOverrides` list in world.json). **Schedules** are the designed-but-deferred upgrade: `ScheduleRule { slot, day?, locationId, condition? }`, evaluated top-down, first match wins; the `getPresentAt()` interface already supports this so UI/events won't change.
- Location-specific events: just `GameEvent`s with `atLocation` conditions on the `location_enter` checkpoint.

### 6.2 Scenes & events

- **Scripted scenes**: pure node graphs (line/choice/branch/effect) — deterministic, testable, no AI needed. Used for: intros, reveals, anything canon-critical.
- **Dynamic conversations**: a 1-node `generate` scene with a directive — the default "talk to X" interaction. Directive comes from a small pool per character/relationship tier ("Mara makes small talk and probes...") so even free talk has authored intent.
- **Hybrid**: scripted spine with `generate` nodes for connective conversation — the workhorse format.
- **Trigger rules**: at each checkpoint EventEngine filters events by checkpoint → evaluates conditions → drops fired `once` events and cooling-down repeatables → groups by `exclusiveGroup` → picks max priority (deterministic tiebreak by id) → returns at most **one** event. Scene-end checkpoints can chain (reveal scene unlocks confession scene) but with a **chain depth cap of 3 per player action**; hitting the cap logs `StateError:EVENT_CHAIN_LIMIT` and defers remaining events to the next checkpoint — this is the circular-trigger guard, plus a content-validation pass that walks `eventFired` references looking for static cycles and warns at load.
- **Consequences** are only ever `SceneOutcomeSpec` + effect nodes: flags, relationship deltas, memory appends, mood sets, presence overrides, unlocking map nodes. New scene unlocks are *not* a mechanism of their own — they're just events whose conditions (memory tags, relationship thresholds, flags) become true.
- **Cooldowns/once** bookkeeping lives in `GameState.eventLog`, so it saves/loads for free.

### 6.3 Asset pipeline

- **Naming convention = asset key**: `portrait.<charId>.<expression>`, `bg.<locationId>`, `ui.<name>`, `map.<name>`. Keys are the only thing code/content ever references; paths live solely in `manifest.json`.
- **Adding assets without code changes:** drop file → add manifest entry → (for a new expression) add to the character's `expressions` list. `tools/validate-manifest.ts` checks: every manifest path exists on disk, every content-referenced key exists in manifest, orphan files reported, and prints a "placeholder report" (% real art).
- **Placeholder strategy:** every placeholder is a real file (solid-color card: character color + name + expression label; backgrounds: color + location name) generated by `tools/gen-placeholders.ts` from the manifest, and marked `placeholder:true`. The game *never* special-cases placeholders — they're just assets. Swapping in real art = replacing a file + flipping the flag.
- **Runtime fallback chain (AssetRegistry.resolve, never throws):**
  `portrait.mara.worried` missing → `portrait.mara.neutral` → built-in silhouette (a data-URI baked into the bundle, cannot be missing) ; `bg.docks` missing → built-in neutral gradient. Every fallback hit logs `AssetError:ASSET_MISSING` once per key and flags `isFallback` (debug overlay shows a badge).
- **Expression mapping:** model outputs semantic `emotion`; a per-character (with global default) `emotionToExpression` table maps it to an actual portrait key; unmapped → `neutral`. Adding a new expression: art + manifest + table row. No code.
- Preload per location: background + portraits×expressions of present characters on travel start.

---

## 7. Save/Load & Error Handling

### 7.1 Save design

- **Format:** `SaveData` (§3.6) as JSON in `localStorage` (`sichen.save.<slot>`), canonical-JSON checksum. Slots: `auto`, `slot1..slot5`, plus file export/import (debug + user backup) via download/upload of the same JSON.
- **What persists:** the whole `GameState` — including all generated memories, transcripts tails, event log, rng seed. ContentDB and assets are *not* in saves; saves reference content by id.
- **Autosave:** after every `APPLY_SCENE_OUTCOME` and every travel; rotating `auto` + `auto.prev` (the previous autosave is the corruption safety net). Manual save allowed anywhere except mid-scene.
- **Versioning & migration:** integer `formatVersion`; `migrations: Record<number, (old: unknown) => unknown>` chain applied in order, each step Zod-checked; migrations are pure functions with fixture-based tests (a saved fixture file per historical version). Unknown *future* version → refuse load with clear message (don't destroy it).
- **Corruption handling:** parse/checksum/schema failure → quarantine the blob to `sichen.corrupt.<timestamp>` (never delete user data), try `auto.prev`, then offer: load older slot / export corrupt blob for support / new game. **Partial salvage:** if only per-character memory subtrees fail validation, those characters reset to initial memories with an in-game notice, rest of the save loads (logged loudly).

### 7.2 Failure-mode matrix

| # | Failure | Detection | User-facing fallback | Dev log | Continues? |
|---|---|---|---|---|---|
| 1 | Missing character file (referenced id absent) | ContentLoader cross-ref pass at boot | Boot error screen listing missing ids (content bugs should be loud at dev time); in production build, character excluded + scenes referencing them disabled | `ContentError:MISSING_REF` + referencing file | Dev: no (fail fast). Prod: yes, degraded |
| 2 | Invalid character schema | Zod at load | Same as #1 | `ContentError:SCHEMA` with Zod path detail | Same as #1 |
| 3 | Missing portrait/background | AssetRegistry resolve miss | Fallback chain §6.3; player sees neutral/silhouette art | `AssetError:ASSET_MISSING` once per key | Yes |
| 4 | AI request fails (network/timeout/429) | Provider error/12s timeout | Canned fallback line, `degraded` turn; conversation remains exitable | `AIError:REQUEST_FAILED` + latency | Yes |
| 5 | Malformed AI response | JSON/Zod/semantic gates §5.3 | 1 repair retry → canned fallback | `AIError:MALFORMED` + raw response (debug ring buffer) | Yes |
| 6 | Memory retrieval failure | try/catch in MemorySystem | Dialogue runs on profile+relationship only (§4.5) | `MemoryError:RETRIEVAL` + char id | Yes |
| 7 | Save corruption | checksum/Zod on load | Quarantine → auto.prev → older slot → new game; never silent data loss | `SaveError:CORRUPT` + quarantine key | Yes |
| 8 | Transition to nonexistent scene | SceneRunner.canStart id check | Event skipped, location screen unaffected; toast in dev builds only | `StateError:BAD_SCENE_REF` + event id | Yes |
| 9 | Circular event triggers | Chain-depth cap 3 + static cycle walk at load | Extra events deferred to next checkpoint; player sees nothing | `StateError:EVENT_CHAIN_LIMIT` + chain | Yes |
| 10 | Storage failure (quota/unavailable) | try/catch on write; startup probe | Banner "saving unavailable — export your save" + always-offered file export | `SaveError:STORAGE` | Yes (play continues unsaved, loudly) |

**Logging:** every error is a typed `GameError { category, code, severity: "fatal"|"error"|"warn", context, cause }`. Dev: console + ring buffer. The ring buffer + current state + last prompt/response is one click to export in the debug overlay ("bug report bundle"). Rule: a player-visible degradation must always have exactly one corresponding log entry — no silent fallbacks.

---

## 8. Testing Strategy

The engine being framework-free makes ~90% of this headless Vitest with no DOM.

**Unit tests**
- **Schemas/content:** every Zod schema accepts its documented example and rejects mutations (missing field, bad enum, out-of-range salience). `tools/validate-content` runs in CI — *the shipped content files are themselves test fixtures*.
- **Condition DSL:** table-driven truth tests per predicate + nesting (`all`/`any`/`not`).
- **Memory:** append (validation, monotonic ids), retrieval scoring (fixture store with known scores → expected top-K order), guarantees (promises always retrieved), consolidation (budget trigger, protected untouched, supersededBy set), contradiction supersede, clamps.
- **Reducer:** every command — known state in, expected state out; rejected batch leaves state untouched (atomicity test).
- **Dialogue validation:** corpus of bad model outputs (truncated JSON, prose-wrapped JSON, wrong speaker, 9 choices, ±40 trust delta, unknown expression, ineligible event trigger) → each is repaired, clamped, or rejected exactly as specced. This corpus grows every time a real malformed output is seen in the wild.
- **Asset fallback:** missing key resolves through the documented chain; `isFallback` flagged; never throws.
- **Migrations:** fixture save per historical version → migrate → validates as current.

**Integration tests (headless engine)**
- **Save/load roundtrip:** play a scripted sequence of commands → save → load → deep-equal state; then continue identically (rng seed respected).
- **Scene execution:** run scripted scene graphs with choice scripts → assert visited nodes, outcome batch contents, event checkpoint results.
- **Dialogue pipeline with FakeProvider:** provider returns canned good/bad/timeout responses → assert full ladder including degradation marking and that proposed updates only land at scene end (quit mid-scene → nothing applied).
- **Event engine:** state fixtures → checkpoint evaluation → correct single event, priority/tie/cooldown/once/exclusion behavior; chain-limit test with 4 chained events.
- **Boot:** full ContentLoader run over real `content/` + manifest cross-check — this single test catches most content PR mistakes.

**Not in MVP test scope:** live-LLM evaluation tests (run a small "voice check" script manually before content releases), visual/UI snapshot tests (cheap to add later; UI is thin), E2E browser tests (one Playwright smoke test — boot → travel → talk via ScriptedProvider → save → reload — added in the polish phase).

---

## 9. PR-Sized Roadmap

Each phase is one reviewable PR, each leaves `main` green and the game bootable.

| PR | Goal | Touches | Acceptance criteria | Risks |
|---|---|---|---|---|
| **1. Skeleton** | Vite+React+TS strict+Vitest+lint (incl. no-React-in-engine rule); empty screens; Result/error/logger primitives | scaffolding, `engine/infra` | `npm run dev` shows title screen; CI runs tests+lint | Over-scaffolding — keep it thin |
| **2. Schemas & ContentLoader** | All Zod schemas (§3); loader with cross-ref validation; `tools/validate-content`; 3 stub characters/locations/scenes as fixtures | `engine/content`, `content/`, tests | Loader returns typed ContentDB; every schema has accept+reject tests; CLI validator exits nonzero on bad content | Schema churn later → keep migrations in mind, version content informally |
| **3. GameState & reducer** | GameState, all commands, atomic batch apply, store bridge to React | `engine/state`, `src/store` | Reducer unit tests pass incl. atomicity; debug JSON dump of state visible in UI | Command set too narrow — add commands as needed, it's cheap |
| **4. Map & navigation** | Map screen, location screen, travel command, time advance, presence (default-location rule) | `engine/map`, `ui/screens` | Can travel between 3 locations; time advances; correct characters shown | None significant |
| **5. Assets & placeholders** | Manifest, AssetRegistry + fallback chain, placeholder generator, validate-manifest tool | `engine/assets`, `assets/`, `tools/` | All placeholder art renders; deleting a file produces silhouette + one log line, no crash | Path/bundler quirks with Vite asset handling |
| **6. Scripted scenes** | SceneRunner (line/choice/branch/effect), DialogueScreen rendering DialogueTurn, outcome batch application | `engine/scenes`, `ui` | Authored intro scene playable start→finish; effects land; mid-scene quit drops outcome | Node-graph edge cases — lean on validator from PR2 |
| **7. Memory system** | MemorySystem: append/retrieve/score/protect; seeded initial memories; memory debug browser v1 | `engine/memory`, `ui/debug` | Retrieval ordering tests pass; scene effects write memories; browser shows per-char entries with sources | Scoring constants wrong — fine, they're tunable, tests pin *ordering logic* not constants |
| **8. Events** | EventEngine, condition DSL evaluators, checkpoints wired into travel/scene-end, chain cap | `engine/events` | Intro event auto-fires on first location entry; once/priority/cooldown tests pass | Checkpoint wiring subtle — integration tests here |
| **9. Save/load** | SaveSystem, slots+autosave, checksum, quarantine, export/import | `engine/save`, `ui` | Roundtrip test passes; corrupting a save in devtools triggers recovery path; mid-scene save blocked | localStorage quota — measure save size now |
| **10. Dialogue: providers & pipeline** | DialogueOrchestrator, prompt builder, validation gates, ScriptedProvider + fallback content, FakeProvider tests | `engine/dialogue`, `content/fallback_dialogue` | Full pipeline integration tests green **without any real LLM**; degraded turns render normally | Biggest PR — split orchestrator/provider if review is heavy |
| **11. Live LLM + structured output** | LLMProvider (Anthropic SDK), key settings UI, repair retry, prompt viewer in debug overlay | `providers/llmProvider`, `ui/debug`, settings | Real generated conversation with memory references; malformed-output corpus seeded from real failures; works offline via fallback when key absent | Model JSON discipline; latency UX (add typing indicator) |
| **12. Scene-end updates & consolidation** | AI-proposed memory/relationship funnel, per-witness memory writes, summarization call, consolidation job | `engine/memory`, `engine/dialogue` | Play 2 conversations → second references the first; budget overflow consolidates correctly in test | Summary quality — keep dumb-truncation fallback |
| **13. Vertical slice content & polish** | Real slice content (§10), expression mapping tables, hybrid scenes, transitions, Playwright smoke test, placeholder report | `content/`, `ui` | A new player can play the §10 slice end-to-end; all failure drills (kill network, delete asset, corrupt save) behave per §7.2 | Content tuning time-sink — timebox |

Rough sizing: PRs 1–6 are the deterministic foundation (no AI anywhere yet), 7–9 the persistence/simulation layer, 10–12 the AI layer, 13 the slice. The AI is deliberately last-but-one: everything before it is testable and shippable with scripted content alone.

---

## 10. Concrete Vertical Slice Example

Placeholder lore — demonstrates architecture, not canon. Setting: a small harbor town the player has just arrived in.

**Characters:** `mara` — innkeeper (full example in §3.1; secret: debt to the harbormaster). `joren` — dockworker: blunt, loyal, suspicious of strangers (`initialRelationship: {trust: 5, affection: 0}`; initial memory: *"Saw the stranger step off the evening ferry with no luggage. No luggage means trouble."* salience 55, protected). `sela` — archive scribe: curious, formal, gossip-hungry (`trust: 15, affection: 10`; secret: she reads sealed correspondence; initial memory: *"A stranger arrived; Mara took them in at the Driftwood."* salience 30 — secondhand, lower salience than the witnesses').

**Locations:** `inn` (Driftwood Inn — Mara's default), `docks` (Joren's default), `archive` (Sela's default). Map: three nodes, fully connected, travelCost 1 slot each.

**Scene** `intro_mara` (hybrid), triggered by event `ev_intro` (`checkpoint: game_start`, priority 100, once):
```
line(mara, "worried→smile"): "Off the evening ferry, no luggage... You'll be wanting a room, stranger."
choice: ["I can pay." (neutral) | "I can work for my keep." (friendly) | "Who's asking?" (guarded)]
branch on choice → effect: SET_FLAG intro_tone=<tone>; RELATIONSHIP_DELTA mara trust +2 (friendly) / -2 (guarded)
generate(mara, directive: "Mara settles the room arrangement and probes who the player is.
  She is welcoming but fishing for information. Do not reveal her debt.", maxTurns: 4)
outcome: per-witness memories + conversation summary + autosave
```

**Generated flow (illustrative):** player picked "I can work for my keep" → next morning, player travels to `inn`, taps Mara → dynamic scene, directive from her `friendly_low_trust` pool. Context assembled: profile + mood `neutral` + trust 12 + retrieved memories include the protected arrival memory and yesterday's conversation summary *"The stranger offered to work for their keep; said little about their past."* Model returns the §5.2 example JSON (Mara teases about capital clerks, proposes the `opinion` memory at salience 45, trust +3 / affection +1). Validator: expression `smile` ✓ in her list, deltas within ±5 ✓, no event triggers ✓ → turn renders with `portrait.mara.smile`; updates held.

**Memory before/after (mara):**
```
before: [mem_mara_000001 event   "A stranger arrived on the evening ferry." sal 60 🔒]
        [mem_mara_000002 c.summ  "The stranger offered to work for keep; vague about past." sal 50]
after:  ...both, plus
        [mem_mara_000003 opinion "The stranger works harder than expected for a self-described
                                  clerk." sal 45 tags:[player,work,inn] source:ai_proposed]
        [mem_mara_000004 c.summ  "Friendly morning chat while the stranger mopped; they hinted
                                  they weren't always a clerk." sal 45 source:scene_outcome]
```
Joren, absent, gets nothing — ask him about the player and he still only has the ferry memory: subjectivity demonstrated.

**Relationship update:** `mara: {trust: 12→15, affection: 6→7}` via one `APPLY_SCENE_OUTCOME` batch, visible in the debug relationship panel with the scene id as cause.

**Asset manifest entries:**
```json
"portrait.mara.neutral":  { "path": "portraits/mara/neutral.png",  "kind": "portrait", "placeholder": true },
"portrait.mara.smile":    { "path": "portraits/mara/smile.png",    "kind": "portrait", "placeholder": true },
"portrait.joren.neutral": { "path": "portraits/joren/neutral.png", "kind": "portrait", "placeholder": true },
"bg.inn":                 { "path": "backgrounds/inn.png",          "kind": "background", "placeholder": true },
"bg.docks":               { "path": "backgrounds/docks.png",        "kind": "background", "placeholder": true },
"map.town":               { "path": "map/town.png",                 "kind": "map",        "placeholder": true }
```

---

## 11. Key Risks & Decisions Needing Confirmation

1. **LLM cost/latency per conversation turn.** Each turn ≈ 1.5–2.5k prompt tokens. Decide later: model tier (Haiku-class is likely sufficient for in-character chat; use a stronger model for summarization/consolidation?), caching strategy, and a per-day soft budget. *Decision deferred to PR 11.*
2. **Client-side API key is dev-only.** Before any public release a proxy endpoint is mandatory (key security + rate limiting). The boundary is designed (§5.7); the deployment isn't. *Confirm hosting choice when release is in sight.*
3. **Retrieval without embeddings** is a bet that tags+salience+recency suffice at slice scale. Re-evaluate when characters exceed ~100 active entries or dialogue visibly "forgets" relevant things despite entries existing. The interface allows swapping the scorer.
4. **Model-generated player choices** risk railroading or tonal mush. Mitigations are in the prompt (tone variety, exit option); if quality disappoints, fall back to choice templates with generated fill-ins. *Evaluate during PR 11–13 playtesting.*
5. **Free-text player input** is excluded from MVP (choices only). It's the most-requested likely extension and the memory/dialogue design supports it, but it expands the validation/safety surface. *Explicit go/no-go after the slice.*
6. **Relationship model breadth** (2 axes + flags) is intentionally minimal. Adding axes is a schema field + save migration — cheap — so resist adding them until a design need is proven.
7. **localStorage ceiling** (~5 MB) vs growing memory stores. Consolidation + transcript caps should keep saves <300 KB; PR 9 must measure and assert this in a test. IndexedDB is the escape hatch.
8. **Content authoring ergonomics**: raw JSON will grate as content grows. Planned answer is a schema-aware editor or YAML+build step — *not* in MVP; revisit after PR 13 when authoring pain is real and informed.

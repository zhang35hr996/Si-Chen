# Si-Chen — Foundational Design Document

**Status:** Draft v2.2 — implementation in progress, aligned to the world bible `docs/background-v0.1.md` and reconciled with `docs/skeleton-plan-v0.md`
**Audience:** Engineers implementing the MVP vertical slice
**Scope:** Architecture, data model, memory, dialogue, scenes, assets, save/load, errors, testing, roadmap

**v2 changes (setting alignment only — architecture unchanged):** product vision recast to the 礼法女尊 imperial-harem setting; calendar/AP time model replaces day+time-slot (§1.1.1, §3, §6.1); court status (位分 rank / 恩宠 favor) added to the data model (§3.2); 血脉 lineage state designed but slice-inert (§3.8); lexicon & address rules fed into prompts and validation (§5.3–§5.5); vertical slice recast to the palace cast (§10); two new risks (§11). The module map, memory system, dialogue pipeline, validation gates, save/load, error handling, and testing strategy carry over from v1 intact.

**v2.1 changes (model strategy & palace-news context):** multi-vendor model routing with task profiles (§2.1, §5.7); model evaluation metrics & bake-off harness (§5.8); `WorldLexicon` promoted to a full schema (§3.9); public-record layer so NPCs react to palace-wide events (§3.5, §4.1, §5.4); authored NPC↔NPC stances (§3.1). Runtime validation stays deterministic engine code — there is deliberately no LLM-as-validator in the play loop (§5.7).

**v2.2 changes (skeleton-plan reconciliation, blocking-before-PR-3 sync):** per-character `CourtState` renamed `CharacterStanding` (the name `CourtState` now means the 江山 resource pillar); pure `GameTime` timestamp split from `CalendarState` (AP bookkeeping); `Scene.outcome`/`SceneOutcomeSpec` removed — all consequences including memory are EventEffects through the single funnel, committed by the SceneSession transaction (`apCost` reserved at entry, spent at commit); `affection` → `affinity`; `selfRef` string → structured `selfRefs {toPlayer, formal, informal?}`.

---

## 1. Executive Summary & Product Vision

### 1.1 What the game is

A **character-driven court/harem narrative game** (visual-novel / social-sim hybrid) set in the ritualized matriarchal empire defined in `docs/background-v0.1.md`. The player is the **女帝** (reigning Empress), moving between a handful of palace locations, talking to a small cast of consorts (侍君) and court figures, and watching relationships, court standing, and the world state evolve. Dialogue is **AI-generated but engine-governed**: each character speaks from their own profile, mood, relationship state, court status, and **private subjective memory**, while all consequences (memory writes, relationship changes, rank/favor changes, event triggers) pass through validated, typed update channels.

- **Genre:** narrative court/harem sim with emergent dialogue. Game text is Simplified Chinese; code, schemas, and ids are English.
- **Target experience:** "These consorts remember me, and they each remember things *differently*." The player feels continuity — a promise made one 旬 is referenced months later; the consort you lied to face-to-face trusts you less than the one who only heard palace gossip about it.
- **Core loop:** open palace map → pick a location → see who's there and what's happening → talk (scripted scene or generated conversation) → choose responses → relationships/memories/court status/world state update → new scenes unlock → action points drain and the calendar advances (§1.1.1).
- **What makes it compelling:** persistent per-character subjective memory + relationship/court state driving generated dialogue, inside a hand-authored scaffold of scenes and events that gives the story shape. Neither pure VN (static) nor pure chatbot (shapeless).

#### 1.1.1 Time model (from the world bible §11)

> 1 year = 12 months; 1 month = 3 action-days (上旬 / 中旬 / 下旬); 1 action-day = **5 action points (AP)**.

Travel and light actions cost 1 AP; medium actions (侍寝, banquets, deep talks) cost 2; heavy actions (大朝会, 大祭, 转胎仪式) cost 3+. When AP reaches 0 the action-day rolls over and a `time_advance` checkpoint fires. The bible's per-旬 themes (上旬 朝政 / 中旬 后宫 / 下旬 宗嗣) are **not a mechanism** — they are just event pools gated by `periodIs` conditions (§3.5).

### 1.2 Intentionally out of scope for MVP

- Combat, action mechanics, minigames, inventory, economy.
- 江山 (state/court governance) as a simulated system — in the slice it exists only as flags, events, and dialogue color.
- 血脉 mechanics (经血祭祀, 怀胎, 自孕/承养, 胎息稳定度) as dedicated subsystems — the state schema is reserved now (§3.8) but the slice represents them with events + flags so the architecture is proven first.
- Quests as a formal system (events + flags cover the slice).
- Character-to-character autonomous simulation (NPCs talking to each other off-screen).
- Voice, music systems, animation beyond portrait swaps and simple transitions.
- Multiple save profiles/cloud sync; localization; accessibility beyond sane defaults.
- Production art (placeholders only, but pipeline is production-shaped).

### 1.3 MVP feature triage

**Must have (the vertical slice is not done without these):**
1. 3 consorts (侍君) with profiles, portraits (placeholder, ≥3 expressions each), independent memory.
2. 3 palace locations with backgrounds, a palace map screen, click-to-travel navigation.
3. Calendar/AP time model (year → month → 旬 action-day → 5 AP) advancing on actions.
4. Dialogue screen: portrait, name, text, 2–4 player choices.
5. Scripted scenes (authored JSON) and generated conversations (LLM) through the same runtime.
6. Structured AI output → validated memory/relationship/event updates.
7. Relationship state (trust/affinity + flags) and court status (位分 rank + 恩宠 favor) per character, influencing dialogue.
8. Save/load (manual slots + autosave), versioned, corruption-tolerant.
9. Debug overlay: state inspector, per-character memory browser, prompt viewer, force-event.
10. Full fallback ladder: missing asset → placeholder; AI failure → canned dialogue; bad save → recovery.

**Should have soon after MVP:**
- Character schedules (location by 旬/AP), mood decay/drift, 下旬 宗嗣 checkpoint events as authored scenes (经血祭祀, 胎息检查), rank promotion/demotion ceremony scenes, conversation topic memory ("we already talked about this today"), scene cooldown UI hints, settings screen, asset preloading, a second "pack" of content to prove data-driven extension.

**Later expansion:**
- Full 血脉 subsystem (§3.8: menses rites, pregnancy, 承养 lifecycle with its legal rules), 江山 systems (朝政, factions), quests, inventory, gossip propagation (NPC↔NPC secondhand memory), NPC↔NPC generated side conversations, procedural events, schedules with exceptions, affinity/rivalry webs, Steam/desktop packaging (Tauri), real art pipeline integration, audio.

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
| AI dialogue | **Provider interface** with pluggable vendor adapters: `LLMProvider` (one **OpenAI-compatible adapter** covers Qwen/Kimi/DeepSeek/OpenAI — same wire format, different `baseURL`+model id; an **Anthropic adapter** covers Claude) and `ScriptedProvider` (canned/mock). Models are picked per **task profile** via `ModelRouting` config (§5.7) | Game runs fully offline on ScriptedProvider; vendors are config, not architecture. Which model writes the best 古风 Chinese is an empirical bake-off (§5.8), not a stack decision. |
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
- **Interface:** `getState(): Readonly<GameState>`, `dispatch(cmd: GameCommand): CommandResult`, `subscribe(fn)`. Commands: `SPEND_AP` (rolls the 旬/month/year when AP hits 0), `MOVE_TO_LOCATION`, `SET_FLAG`, `APPLY_RELATIONSHIP_DELTA`, `APPLY_FAVOR_DELTA`, `SET_RANK`, `APPEND_MEMORY`, `RECORD_EVENT_FIRED`, `APPLY_SCENE_OUTCOME`, …
- **Must not:** call the AI, touch the DOM, read files, know what a "scene" means narratively.
- **Depends on:** Logger only.

#### ContentLoader (`engine/content/`)
- **Responsibility:** load + Zod-validate all static content (characters, locations, scenes, events, lexicon, rank table, asset manifest) at boot; produce a typed, frozen `ContentDB` with cross-reference checking (every `locationId`, `characterId`, `sceneId`, asset key referenced anywhere must exist).
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
- **Responsibility:** resolve logical asset keys (`portrait.shen_yan.smile`) to URLs via the manifest; preload per-location bundles; provide fallback chain on miss (§6.3).
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
│   │   └── shen_yan.json
│   ├── locations/
│   │   └── fengyi_palace.json
│   ├── scenes/
│   │   └── intro_shen_yan.json
│   ├── events/
│   │   └── ev_shen_yan_intro.json
│   ├── fallback_dialogue/        #   canned lines per character for AI failure
│   │   └── shen_yan.json
│   ├── lexicon.json              #   world terms (胎息/承养/…), address & self-reference rules, banned terms (§5.4)
│   └── world.json                #   map graph, calendar config, rank table (位分), starting state
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

Schemas are **Zod definitions**; TS types are inferred (`z.infer`), so runtime validation and compile-time types cannot drift. Shown here as TS interfaces for readability. Conventions: IDs are lowercase snake strings, namespaced by collection (`shen_yan`, not `char_001`); cross-references validated at load; all record timestamps use the pure `GameTime { year: number; month: number /*1–12*/; period: "early"|"mid"|"late" /*上旬·中旬·下旬*/; dayIndex: number /*derived action-day index, stored for cooldown/sorting*/ }`; the live clock is `CalendarState extends GameTime { ap: number; apMax: number }` — AP bookkeeping never appears on timestamps (a memory's moment must not carry how many AP the player had left). "Days" in scoring formulas mean action-days (`dayIndex` deltas).

### 3.1 Character & CharacterProfile (static content)

```ts
interface Character {
  id: string;                    // "shen_yan"
  profile: CharacterProfile;
  defaultLocation: string;       // locationId — typically the consort's own palace
  schedule?: ScheduleRule[];     // post-MVP; absent = always at defaultLocation
  portraitSet: string;           // asset namespace, usually == id
  expressions: string[];         // ["neutral","smile","frown","worried"] — must exist in manifest
  voice: VoiceSpec;              // prompt-facing style constraints
  initialRelationship: RelationshipState;
  initialStanding: CharacterStanding;  // starting 位分 + 恩宠/圣眷 (§3.2); rank domain must match character kind
  initialMemories: MemoryEntryDraft[];   // seeded subjective backstory
  secrets: Secret[];
  stances?: { charId: string; attitude: string }[];  // authored one-line attitudes toward other NPCs,
                                         // prompt-fed when both are present; dynamic NPC↔NPC state is post-MVP
}

interface CharacterProfile {
  name: string;
  age: number;
  role: string;                  // "皇后（凤后，后宫之主）"
  appearance: string;            // 1–2 sentences, for prompt + art reference
  personalityTraits: string[];   // 3–6 adjectives, stable
  coreFacts: string[];           // immutable truths ("出身世族沈氏")
  goals: string[];               // current wants — drive dialogue agendas
  speechStyle: string;           // "warm, teasing, short sentences, never curses"
}

interface VoiceSpec {
  register: "formal" | "casual" | "rough" | "poetic";
  quirks: string[];              // ["自称『臣后』，仪式场合用『本宫』", "trust ≥ 60 后私下偶尔自称『我』"]
  tabooTopics: string[];         // things the character deflects from
}

interface Secret {
  id: string;                    // "shen_yan_ledger"
  content: string;               // what's true
  revealCondition?: TriggerCondition;  // when it MAY surface in dialogue
}
```

**Purpose:** everything stable about a character. **Validation:** ≥1 expression named `neutral`; every expression present in asset manifest; `initialMemories` validate as MemoryEntryDrafts; secrets never serialized into saves in plaintext beyond their id + revealed flag (content stays in ContentDB).

```json
{
  "id": "shen_yan",
  "profile": {
    "name": "沈晏",
    "age": 26,
    "role": "皇后（凤后，后宫之主）",
    "appearance": "清瘦端方，常服深青凤纹礼衣，仪态一丝不苟。",
    "personalityTraits": ["端肃", "克制", "敏锐", "外冷内热", "暗自不安"],
    "coreFacts": ["出身世族沈氏", "大婚三年，执掌凤印总理后宫", "久不承宠，地位全系于名分与母家"],
    "goals": ["维持后宫秩序与自身体面", "试探陛下对沈氏一族的真实态度"],
    "speechStyle": "措辞雅正，多用敬语，句子短而克制；动情时偶有一瞬失措，随即收敛。"
  },
  "defaultLocation": "fengyi_palace",
  "portraitSet": "shen_yan",
  "expressions": ["neutral", "smile", "frown", "worried"],
  "voice": { "register": "formal", "quirks": ["自称『臣后』，仪式场合用『本宫』", "称玩家『陛下』，绝不直呼"], "tabooTopics": ["自己久不承宠之事", "沈氏母家在朝中的动向"] },
  "initialRelationship": { "trust": 30, "affinity": 15, "flags": [] },
  "initialStanding": { "rank": "huanghou", "favor": 20 },
  "initialMemories": [
    { "kind": "event", "summary": "陛下已有三月未踏入凤仪宫，昨日大朝会后却单独召见了楚贵君。", "salience": 70, "tags": ["player", "favor", "chu_he"], "protected": true }
  ],
  "secrets": [
    { "id": "shen_yan_ledger", "content": "沈晏借『账册法』之名私录各宫用度，暗中推演前朝派系的银钱往来，已逾男子之学的边界。", "revealCondition": { "all": [{ "relationshipAtLeast": { "char": "shen_yan", "field": "trust", "value": 60 } }] } }
  ],
  "stances": [
    { "charId": "chu_he", "attitude": "视其恃宠而骄，面上仍以礼相待" },
    { "charId": "lin_wan", "attitude": "几乎不曾留意此人，只当是掖庭寻常侍者" }
  ]
}
```

### 3.2 CharacterMemory, MemoryEntry, RelationshipState, CharacterStanding, MoodState (runtime)

```ts
interface CharacterMemory {
  characterId: string;
  entries: MemoryEntry[];          // long-term, structured
  recentTranscript: TranscriptLine[]; // short-term: last conversation w/ player, verbatim, capped
  conversationSummaries: MemoryEntry[]; // kind:"conversation_summary", one per past conversation
  revealedSecrets: string[];       // secret ids the player now knows
}

interface MemoryEntry {
  id: string;                      // "mem_shen_yan_000017" (monotonic per char)
  kind: "event" | "fact_learned" | "opinion" | "promise" | "conversation_summary";
  summary: string;                 // ≤ 240 chars, third person, from THIS character's POV
  detail?: string;                 // optional longer text, never sent to prompts wholesale
  salience: number;                // 0–100, how much this matters to the character
  createdAt: GameTime;
  lastReferencedAt?: GameTime;     // touched on retrieval — feeds recency scoring
  tags: string[];                  // ["player","promise","fengyi_palace"] — retrieval keys
  participants: string[];          // character ids incl. "player"
  locationId?: string;
  source: "authored" | "scene_outcome" | "ai_proposed" | "consolidation";
  protected: boolean;              // never auto-deleted/merged
  supersededBy?: string;           // contradiction handling, §4.7
}

interface RelationshipState {     // the character's stance toward the player (女帝)
  trust: number;                   // 0–100 信任/忠诚
  affinity: number;               // 0–100 — 爱慕 for consorts, 亲附/敬慕 for officials (one axis, kind-appropriate label)
  flags: string[];                 // ["has_served_night","resents_chu_he"]
  // future axes (妒 jealousy, 惧 fear, 敬 respect) added as optional fields + migration
}

interface CharacterStanding {      // the character's formal standing — granted by the player, never by AI
                                   // (named CourtState in v2.1; renamed — CourtState now means the 江山 resource pillar)
  rank: string;                    // rank id from world.json's 位分 table ("huanghou","guijun","chenghui","gengyi",…)
  favor: number;                   // 0–100 — 恩宠 (consort ranks) / 圣眷 (official ranks); drives rank
                                   //   eligibility, 侍寝 priority, event conditions; rank domain must match kind
}

interface MoodState {
  current: "neutral" | "happy" | "tense" | "sad" | "angry" | "anxious";
  intensity: number;               // 0–100, decays toward neutral each action-day
  cause?: string;                  // memoryEntry id or event id — debuggability
}
```

**Validation:** salience clamped 0–100; summary length enforced; `kind` whitelist; `source:"ai_proposed"` entries additionally pass the AI-update validator (§5.6). Trust/affinity/favor deltas clamped to ±10 per scene. `rank` must exist in the rank table; rank changes happen only via explicit `SET_RANK` commands from authored effects or scene outcomes — the AI cannot propose them.

### 3.3 Location & MapNode

```ts
interface Location {
  id: string;                      // "fengyi_palace"
  name: string;                    // "凤仪宫"
  description: string;             // shown on entry + fed to prompts as setting
  backgroundKey: AssetKey;         // "bg.fengyi_palace"
  ambience: string[];              // ["殿内焚着安息香","廊下宫人垂手侍立"] — prompt color
  hooks: SceneHook[];              // interactable non-character things (post-slice ok)
}

interface MapNode {
  locationId: string;
  position: { x: number; y: number };   // 0–1 normalized coords on map image
  connections: string[];           // travel edges; MVP: fully connected is fine
  travelCost: { ap: number };      // action points consumed (MVP: 1 for all)
  unlockedBy?: TriggerCondition;   // hidden until condition met
}
```

```json
{ "locationId": "lantai", "position": { "x": 0.72, "y": 0.61 }, "connections": ["fengyi_palace", "yuhua_garden"], "travelCost": { "ap": 1 } }
```

**Validation:** connections symmetric (loader auto-mirrors and warns); every `backgroundKey` exists in manifest; node positions within [0,1].

### 3.4 Scene, DialogueTurn, DialogueChoice

```ts
interface Scene {
  id: string;                          // "intro_shen_yan"
  kind: "scripted" | "dynamic" | "hybrid";
  locationId: string;
  participants: string[];              // character ids
  nodes: SceneNode[];                  // execution graph; entry = nodes[0]
  startNodeId: string;                 // explicit entry node — no "first element" convention
                                       // NO outcome block (removed in v2.2): every consequence, memory
                                       // included, is an EventEffect inside an effect node — one funnel
}

type SceneNode =
  | { type: "line"; id: string; speaker: string; text: string; expression?: string; next?: string }
  | { type: "choice"; id: string; choices: DialogueChoice[] }
  | { type: "branch"; id: string; condition: TriggerCondition; ifTrue: string; ifFalse: string }
  | { type: "generate"; id: string; characterId: string; directive: string;   // authored steering, e.g. "沈晏克制地试探陛下三月不至凤仪宫的缘由；守礼、敏锐、不肯露怯"
      maxTurns: number; exitOn: "choice_exit" | "turn_limit";
      profile?: "dialogue" | "dialogue_keystone";                              // model routing override (§5.7); default "dialogue"
      next?: string }
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
  id: string;                          // "ev_shen_yan_ledger_reveal"
  sceneId: string;                     // what runs when it fires
  checkpoint: "location_enter" | "time_advance" | "scene_end" | "game_start";
  condition: TriggerCondition;
  priority: number;                    // higher wins; ties broken by id (deterministic)
  once: boolean;
  cooldown?: { actionDays: number };   // for repeatable events
  apCost: number;                      // reserved at scene entry (affordability gate: 行动点不足 blocks,
                                       //   no auto-rollover), SPENT only at scene commit; quit/reload
                                       //   discards the SceneSession — no AP loss, `once` unconsumed
  exclusiveGroup?: string;             // at most one event per group per checkpoint
  public?: boolean;                    // 宫中大事: goes into every prompt's palace-news digest (§4.1)
  headline?: string;                   // one-line digest text, required if public ("楚贵君晋皇贵君，赐居昭阳殿")
}

type TriggerCondition =
  | { all: TriggerCondition[] } | { any: TriggerCondition[] } | { not: TriggerCondition }
  | { flagSet: string } | { monthAtLeast: number } | { periodIs: "early" | "mid" | "late" }
  | { atLocation: string }
  | { relationshipAtLeast: { char: string; field: "trust" | "affinity"; value: number } }
  | { favorAtLeast: { char: string; value: number } } | { rankAtLeast: { char: string; rank: string } }
  | { hasMemoryTag: { char: string; tag: string } }
  | { eventFired: string } | { secretRevealed: { char: string; secretId: string } };
```

This closed predicate set is the **condition DSL** — adding a predicate = one Zod variant + one evaluator function. No eval(), no scripting language in MVP.

```json
{
  "id": "ev_shen_yan_ledger_reveal",
  "sceneId": "shen_yan_ledger_confession",
  "checkpoint": "location_enter",
  "condition": { "all": [ { "atLocation": "fengyi_palace" }, { "relationshipAtLeast": { "char": "shen_yan", "field": "trust", "value": 60 } }, { "not": { "eventFired": "ev_shen_yan_ledger_reveal" } } ] },
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
  standing: Record<string, CharacterStanding>;         // by characterId — 位分 + 恩宠/圣眷
  resources: { court: CourtState; harem: HaremState; bloodline: BloodlineState };
                                       // 江山/后宫/血脉 pillars (scalars in skeleton-plan §4; scaffold-only
                                       //   until their systems land — never read by logic or conditions)
  moods: Record<string, MoodState>;
  memories: Record<string, CharacterMemory>;
  lineage: LineageState;                               // 血脉 (§3.8) — slice: inert defaults
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
  entries: Record<AssetKey, AssetEntry>;   // key e.g. "portrait.shen_yan.smile"
}
interface AssetEntry {
  path: string;                        // "portraits/shen_yan/smile.png"
  kind: "portrait" | "background" | "ui" | "map";
  placeholder: boolean;                // true until real art lands — drives a debug report
  size?: { w: number; h: number };
}
```

```json
{
  "version": 1,
  "entries": {
    "portrait.shen_yan.neutral": { "path": "portraits/shen_yan/neutral.png", "kind": "portrait", "placeholder": true },
    "bg.fengyi_palace": { "path": "backgrounds/fengyi_palace.png", "kind": "background", "placeholder": true }
  }
}
```

### 3.8 LineageState (designed now, slice-inert)

The 血脉 pillar (经血祭祀 / 怀胎 / 自孕·承养, world bible §3 & §5) is core to the setting but **not an MVP mechanism** — the slice plays it through events and flags. The state shape is reserved now so saves won't need a disruptive migration later:

```ts
interface LineageState {
  menses: { status: "normal" | "irregular" | "absent"; lastRiteAt?: GameTime };  // 经血状态 — a political signal, not just biology
  pregnancy?: {
    mode: "self" | "chengyang";        // 自孕 | 承养 (bible §3.1)
    conceivedAt: GameTime;
    chengyangCharId?: string;          // 承养人 — immutable once set (bible §3.3: no substitution, ever)
    stability: number;                 // 0–100 胎息稳定度
  };
  heirs: { id: string; bornAt: GameTime; chengyangCharId?: string }[];
}
```

When the subsystem lands (post-slice), its rules — 三月转胎 timing, blood-nurture irreplaceability, 承养人 health drain — are enforced the same way everything else is: as validation inside dedicated commands (`BEGIN_PREGNANCY`, `ASSIGN_CHENGYANG`, …) evaluated at 下旬 `time_advance` checkpoints. No new architecture required.

### 3.9 WorldLexicon (`content/lexicon.json`)

The setting's biggest LLM failure mode isn't plot — it's vocabulary: 皇郎 drifting to 皇子, 承养人 to “血父”, a 侍宸 self-referencing 本宫, men written as 现代恋爱脑, or invented ranks (圣血妃, 御胎君). The lexicon is the single source of truth feeding both prompt injection (§5.4) and the gate-2 string validators (§5.3):

```ts
interface WorldLexicon {
  approvedTerms: string[];           // 胎息, 承养, 承养人, 承嗣君, 育嗣君, 养君, 自孕, 经血祭祀, 皇郎, 贵主, …
  forbiddenTerms: string[];          // 父皇, 血父, 王爷, 娘娘(用于男子), modern vocabulary, …
  rankAddressRules: { rank: string;                                            // bible §9.3 自称表
    selfRefs: { toPlayer: string[]; formal: string[]; informal?: string[] };   // structured — never a joined display string
    addressedAs: string }[];
  kinshipTerms: { concept: string; term: string }[];                           // bible §8 称谓体系
  styleRules: string[];              // "不得创造新的官职、位分、宗嗣术语；制度未定时用普通描述，不要造词"
}
```

**Validation:** `approvedTerms ∩ forbiddenTerms = ∅`; every rank in `rankAddressRules` exists in world.json's rank table; loader cross-checks that no character's `voice.quirks` contradicts their rank's `selfRefs`. The prompt always carries the rules verbatim: *你只能使用 approvedTerms 中的制度词；不得造词；如需表达未定制度，用普通描述。*

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
| **Public record (宫闱邸闻)** | palace-wide happenings everyone knows: 册封, 晋降, 大祭, 降罪 — `public:true` events in the eventLog | forever (digest capped) | last ~5 public-event headlines, always |

**Subjectivity:** there is no global "what happened" store that characters read from. When a scene ends, the SceneOutcome generates **per-witness** memory drafts — each present character gets their own entry, worded from their POV, with their own salience. 沈晏 (lied to face-to-face about why the Empress skipped a rite) stores *“陛下当面诓我，说下旬未行祭祀是太医的意思”* at salience 75; 楚荷 (heard it secondhand) stores *“听闻陛下同皇后解释了祭祀的事，说辞含糊”* at salience 40. Characters absent from a scene get nothing unless an explicit gossip effect writes a secondhand entry (post-MVP system; supported now by just authoring an `effect` node — and since palace gossip is thematically load-bearing in this setting, the gossip system ranks high on the post-MVP list).

**Palace-wide events (宫中大事):** big public happenings — 册封, 晋降, 大祭, 降罪 — must not depend on who was in the room. Events flagged `public: true` (§3.5) contribute their `headline` to a "recent palace news" digest rendered into **every** character's prompt (§5.4): shared public knowledge, the NPC equivalent of reading the 邸报. Each character's *reaction* to the news stays subjective — a private memory/opinion entry, authored per-witness or written by the AI's own `memory_updates` when the topic comes up in conversation. No new storage: the digest is a read over `GameState.eventLog`. This is what lets 林晚 comment on 楚荷's promotion she never witnessed, while still *feeling* about it differently than 沈晏 does.

### 4.2 How memory is created

Only four producers, all explicit:

1. **Authored**: `initialMemories` in character files; `effect` nodes in scripted scenes (`APPEND_MEMORY` with full entry specified by the writer).
2. **Scene effects**: per-witness entries are `memory` effects inside the scene's effect nodes, accumulated on the SceneSession and committed atomically at scene end; the conversation summary is written in the same commit. (v2.1's `SceneOutcomeSpec` side-door is removed — memory has no write path outside the effect funnel.)
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
      + 0.25 * recency          // exp decay on (now - lastReferencedAt ?? createdAt), half-life ≈ 6 action-days (= 2 game months)
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

Fixed, ordered, atomic sequence at scene commit (`APPLY_SCENE_OUTCOME` command batch — the SceneSession transaction's terminal step; mid-scene, nothing touches state):
1. Validate all accumulated effects (AI-proposed + authored effect nodes).
2. Spend the reserved AP (`event.apCost`).
3. Apply relationship/favor deltas (clamped ±10/scene per axis).
4. Apply mood change.
5. Append per-witness memory entries (`memory` effects).
6. Write conversation summary; trim transcript.
7. Record event-fired bookkeeping (`once` consumed here only); set flags.
8. Run EventEngine `scene_end` checkpoint.
9. Autosave.

If any step fails validation, the *whole batch* is rejected (AP included) and a minimal safe outcome applies (conversation summary only + log). State is never half-updated. Quit/reload before the terminal node discards the session: no AP cost, no effects, `once` unconsumed.

### 4.7 Contradictions

Memories are never edited in place. A new entry that contradicts an old one (same topic, incompatible content — detected only when an *authored* effect or AI update explicitly names a `supersedes` target; no automatic NLP contradiction detection in MVP) sets `supersededBy` on the old entry. Superseded entries are excluded from retrieval by default but kept (debuggable history; enables "you told me differently before!" authored beats, which query superseded entries deliberately). Two characters remembering the same event incompatibly is **not** a contradiction — that's the subjectivity feature.

### 4.8 Bloat prevention & consolidation

Budget: **60 active entries per character** (configurable). When exceeded, consolidation runs at the next safe checkpoint (end of action-day):
- Candidates: unprotected, salience < 40, not referenced in 5+ action-days, not `promise`.
- Cluster candidates by shared dominant tag; merge each cluster into one `consolidation` entry (“数旬之间，林晚常在御花园伺候笔墨，安静妥帖”), salience = max of merged + 5.
- Originals get `supersededBy = <consolidated id>` (retained but inactive; a hard purge of superseded entries older than 30 action-days keeps saves bounded).
- `protected` entries and promises are untouchable, ever. Authored initial memories default to protected.

### 4.9 Debugging memory

Debug overlay memory browser per character: table of entries (id, kind, salience, age, tags, source, protected, superseded), full-text view, **retrieval simulator** (type a topic → see exactly which 8 entries would be sent and their scores), diff view of the last scene's memory writes, and a "why does she think that?" trace (entry → source command → scene id). Memory state is exportable as JSON with any debug save.

---

## 5. Dialogue Generation System

### 5.1 Pipeline

```
player intent (choice/talk)
  → DialogueOrchestrator.assembleContext
      profile + voice + mood + relationship + court status (rank/favor), rendered as prose
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
  "speaker": "chu_he",
  "text": "陛下竟舍得来兰台？本宫还当，这一旬的工夫都要赏给凤仪宫了。……坐呀，茶是新沏的，气性也是。",
  "emotion": "amused",
  "expression": "smile",
  "choices": [
    { "text": "朕去中宫议事，与你何干。", "tone": "guarded" },
    { "text": "吃味了？朕这不是来了。", "tone": "flirty" },
    { "text": "（不接话，自顾端起茶盏。）", "tone": "neutral", "isExit": false }
  ],
  "memory_updates": [
    { "kind": "opinion", "summary": "陛下嘴上不提凤仪宫，神色却不像要疏远中宫的样子。", "salience": 45, "tags": ["player", "shen_yan", "favor"] }
  ],
  "relationship_updates": { "trust": 2, "affinity": 3 },
  "event_triggers": []
}
```

### 5.3 Validation & repair (three gates)

1. **Syntactic:** extract first JSON object from response; `JSON.parse`; Zod schema. Failure → one **repair retry**: re-send with the parse error appended ("Your previous output was invalid: <error>. Return only valid JSON matching the schema."). Second failure → fallback.
2. **Semantic:** `speaker` is the requested character; `expression` ∈ character's expression list (else map via `emotion→expression` table, else `neutral`); 1–4 choices, each ≤ 120 chars; `text` ≤ 600 chars and contains no other character's dialogue; `text` contains no banned-lexicon terms (father-line/modern vocabulary listed in `lexicon.json` — cheap string scan) and uses the correct self-reference for the speaker's rank (臣后/本宫/本位/臣侍/小侍 — regex check; violation → repair retry, not fallback); relationship deltas clamped ±5 per *turn* (and ±10 per scene total); `event_triggers` ⊆ the whitelist of trigger ids offered in the prompt (anything else dropped + logged).
3. **Safety/state:** memory_updates pass §4.2 rule 3; the model cannot set flags, move characters, reveal non-eligible secrets (output mentioning an ineligible secret's content is not detectable cheaply — mitigated by never putting ineligible secrets in the prompt at all).

**Fallback ladder:** LLM ok → use it. Retry ok → use it. Else → ScriptedProvider serves a character-appropriate canned line from `content/fallback_dialogue/<char>.json` (keyed by mood + relationship tier, e.g. "shen_yan.tense.low_trust": "陛下恕罪，臣后今日精神短了些……改日再奉茶罢。") with generic choices (continue / leave). Turn is marked `degraded:true`; UI shows it normally (player shouldn't be slapped with an error), debug overlay counts degradations. Conversation can always be exited; the game never hard-blocks on the model.

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

== COURT & SPEECH RULES ==
The player is the reigning Empress (女帝); address her as 陛下 unless your quirks say otherwise.
Your rank: {rankName}. Self-reference: {selfRefs for your rank, by register — 臣后/本宫/本位/臣侍/小侍}.
World terms, use them correctly: {lexicon terms — 胎息, 承养, 承养人, 承嗣君, 育嗣君, 养君, 自孕, 经血祭祀, …}
Forbidden vocabulary: {lexicon.banned — father-line terms (父亲/父皇/夫人 for men), modern speech}.
This is a 礼法女尊 court: women hold throne, army, rites; men keep the inner palace.
All dialogue is Simplified Chinese.

== YOUR CURRENT STATE ==
Mood: {mood.current} (intensity {mood.intensity}/100){mood.cause ? ", because " + causeSummary : ""}
Your relationship with the Empress: trust {trust}/100 ({trustTierWord}), affinity {affinity}/100 ({affTierWord}).
Your standing: rank {rankName}, favor {favor}/100 ({favorTierWord}).
Relationship notes: {flags rendered as sentences}

== WHAT YOU REMEMBER (your subjective memories — others may remember differently) ==
{retrieved entries, newest last: "- [{year}年{month}月{period}] {summary}"}

== SECRETS YOU HOLD ==        (section omitted if none eligible)
{for each eligible secret: "- {content} — You may hint at or reveal this ONLY if the
 conversation naturally leads there and you feel safe. Otherwise guard it."}

== RECENT PALACE NEWS (宫闱邸闻 — public knowledge, everyone has heard) ==
{last ~5 public-event headlines, newest last; section omitted if none}

== SCENE ==
Location: {location.name}. {location.description} Ambience: {ambience}.
Time: {year}年{month}月{period 上旬/中旬/下旬}. Also present: {others or "no one else"}.
Your attitude toward those present: {stances for present charIds; omitted if none}
Direction for this conversation: {scene directive}

== CONVERSATION SO FAR ==
{transcript lines: "{Speaker}: {text}" — last 12 lines}
陛下 ({choice.tone} tone): {player's chosen line}

== OUTPUT ==
Respond with ONLY a JSON object, no prose around it:
{ "speaker": "{id}", "text": "...", "emotion": "...", "expression": one of {expressions},
  "choices": [2–4 options the PLAYER could say next, varied in tone, each ≤120 chars,
              include one that disengages if conversation could naturally end],
  "memory_updates": [0–2 NEW things {name} will remember from this exchange, only if
                     genuinely noteworthy; {"kind","summary"(≤240 chars, your POV),
                     "salience"(0–100),"tags"(≤5)}],
  "relationship_updates": {"trust": -5..5, "affinity": -5..5} (0 if nothing changed),
  "event_triggers": [] or subset of {offeredTriggerIds} if its condition was clearly met }

Rules: Speak only as {name}, in Simplified Chinese, ≤150 字 of dialogue. Obey the COURT &
SPEECH RULES (address, self-reference, lexicon). React to the player's tone and to your
memories. Do not invent facts about the world or other characters not given above.
Do not reveal information from sections above verbatim as exposition.
```

Player **choices are model-generated** in dynamic nodes (with the tone-variety rule above) and **author-written** in scripted nodes; hybrid scenes can pin authored choices by having the `generate` node exit into a `choice` node.

### 5.5 Staying in-character

Defense in depth: (a) profile/voice/taboo sections in every prompt; (b) directive from the authored scene bounds the topic; (c) only that character's memories are in context — it literally cannot leak others' knowledge; (d) semantic validator rejects wrong-speaker output; (e) regression "voice tests" (§8) snapshot known-good outputs for prompt-change review; (f) temperature ~0.8 for dialogue, 0.2 for summarization; (g) the lexicon/self-reference string checks in gate 2 (§5.3) catch register drift cheaply, with repair retry before fallback.

### 5.6 How dialogue affects game state — the single funnel

```
raw model JSON → Zod → semantic clamps → ProposedUpdates (typed)
   → held by orchestrator → scene end → APPLY_SCENE_OUTCOME batch → reducer
```

There is exactly one path, and the reducer only accepts typed commands. The model cannot name a command; it can only fill whitelisted proposal fields. This satisfies the "AI never directly mutates state" constraint structurally rather than by discipline.

### 5.7 API boundary, vendor adapters & model routing

`LLMProvider` speaks to `POST /dialogue { request: DialogueRequest }` → `{ response: RawDialogueResponse }`. In dev this "endpoint" is a local function calling a vendor SDK with a user-provided key (stored in localStorage settings, never in saves or content). Moving to a real proxy later changes one file. The request type contains the fully-assembled prompt — the server stays stateless and game-agnostic.

Two vendor adapters cover every candidate model:
- **OpenAI-compatible adapter** — Qwen (DashScope), Kimi (Moonshot), DeepSeek, OpenAI all expose OpenAI-compatible chat endpoints: one adapter, different `baseURL` + model id.
- **Anthropic adapter** — Claude.

Model choice is data, not code: a `ModelRouting` config maps **task profiles** to pinned model snapshots —

| Task profile | What it is | Default candidate class | Temp |
|---|---|---|---|
| `dialogue` | in-character NPC turns — the hot path: every talk action, cost-sensitive, Chinese-naturalness-critical | Qwen / Kimi class | ~0.8 |
| `dialogue_keystone` | authored-flagged key scenes (deep talks, confessions, 大事 aftermaths) where prose quality justifies premium cost | Claude class | ~0.8 |
| `summarize` | conversation summaries, consolidation merges — background tasks: cheap + obedient beats eloquent | DeepSeek / GPT-mini class | 0.2 |

Routing rules:
- Snapshots are **pinned** — a silent vendor upgrade must never change a character's voice mid-playthrough; new snapshots only after a §5.8 scorecard run.
- Each profile has an ordered fallback list (primary → secondary vendor → ScriptedProvider), reusing the §5.3 ladder unchanged — a vendor outage degrades exactly like a malformed response.
- A scene's `generate` node may set `profile: "dialogue_keystone"` — authored, never automatic.
- Swapping the bake-off winner in is a config edit, not a refactor.

**What is deliberately *not* a model: runtime validation.** Gates 1–3 (§5.3) — JSON schema, lexicon/self-reference scans, clamps, whitelists — are deterministic engine code: free, instant, testable, and incapable of hallucinating an approval. A second "validator LLM" in the play loop would double latency and cost to do a strictly worse job. Likewise there is no separate "state-patch generator" model: the dialogue model proposes updates inline in its own JSON (§5.2) and the engine validates and applies them (§5.6) — one model call per turn, one funnel. LLM-as-judge appears only **offline**, in the eval harness (§5.8).

### 5.8 Model evaluation — what "good" means here

For this game, raw model intelligence is the wrong axis. Bake-off metrics, in priority order:

1. **中文自然度** — reads like 古风宫廷 Chinese, not translated English or 网文模板. (Human-judged sample sheets.)
2. **称谓/自称错误率** — wrong rank self-reference, invented honorifics. (Automatic: §5.3 string validators over the eval corpus.)
3. **术语表遵守率** — uses 胎息/承养/承嗣君 correctly, never invents terms (圣血妃, 御胎君, 血父…). (Automatic: approved/forbidden scans.)
4. **JSON 合规率** — first-try parse rate, repair-retry rate. (Automatic.)
5. **人设长期一致性** — 20-turn drift test per character: is 沈晏 still 端肃 at turn 20? (Offline LLM-as-judge + human spot check.)
6. **单轮成本与延迟** — tokens × price at hot-path frequency; this alone gates which models are eligible for the `dialogue` profile.

Harness: `tools/eval-dialogue.ts` (extends the §8 voice-check) replays a fixed set of `DialogueRequest` fixtures against any routed model, runs the automatic checks, and emits a scorecard — same fixtures for every candidate, so vendor choices are evidence, not vibes. Run before pinning any snapshot. *Built in PR 11 alongside the first live adapter.*

---

## 6. Map, Scene/Event, and Asset Systems

### 6.1 Map & locations

- Map screen renders `world.json`'s MapNodes on a single map image; nodes with unmet `unlockedBy` are hidden or shown locked.
- Travel: click reachable node → `MOVE_TO_LOCATION` command → `SPEND_AP travelCost.ap` (AP hitting 0 rolls the 旬/month/year and fires the `time_advance` checkpoint) → `location_enter` event checkpoint runs → LocationScreen renders background + present characters (clickable portraits → start conversation) + any location hooks.
- **Presence (MVP):** a consort is at `defaultLocation` (their own palace) every action-day unless a fired event/flag relocates them (`flagSet` conditions on a per-character `presenceOverrides` list in world.json). **Schedules** are the designed-but-deferred upgrade: `ScheduleRule { period, month?, locationId, condition? }`, evaluated top-down, first match wins; the `getPresentAt()` interface already supports this so UI/events won't change.
- Location-specific events: just `GameEvent`s with `atLocation` conditions on the `location_enter` checkpoint.
- **旬 themes:** the bible's 上旬 朝政 / 中旬 后宫 / 下旬 宗嗣 cadence is plain content — e.g. the 下旬 宗嗣 checks (经血祭祀 reminders, 胎息/承养 inspection scenes) are `time_advance` events with `{ periodIs: "late" }` conditions. No bespoke calendar logic in the engine.

### 6.2 Scenes & events

- **Scripted scenes**: pure node graphs (line/choice/branch/effect) — deterministic, testable, no AI needed. Used for: intros, reveals, anything canon-critical.
- **Dynamic conversations**: a 1-node `generate` scene with a directive — the default "talk to X" interaction. Directive comes from a small pool per character/relationship tier ("楚荷恃宠撒娇，顺势打探陛下近日的行踪……") so even free talk has authored intent.
- **Hybrid**: scripted spine with `generate` nodes for connective conversation — the workhorse format.
- **Trigger rules**: at each checkpoint EventEngine filters events by checkpoint → evaluates conditions → drops fired `once` events and cooling-down repeatables → groups by `exclusiveGroup` → picks max priority (deterministic tiebreak by id) → returns at most **one** event. Scene-end checkpoints can chain (reveal scene unlocks confession scene) but with a **chain depth cap of 3 per player action**; hitting the cap logs `StateError:EVENT_CHAIN_LIMIT` and defers remaining events to the next checkpoint — this is the circular-trigger guard, plus a content-validation pass that walks `eventFired` references looking for static cycles and warns at load.
- **Consequences** are only ever effect nodes (EventEffects committed at scene end): flags, relationship deltas, memory appends, mood sets, presence overrides, unlocking map nodes. New scene unlocks are *not* a mechanism of their own — they're just events whose conditions (memory tags, relationship thresholds, flags) become true.
- **Cooldowns/once** bookkeeping lives in `GameState.eventLog`, so it saves/loads for free.

### 6.3 Asset pipeline

- **Naming convention = asset key**: `portrait.<charId>.<expression>`, `bg.<locationId>`, `ui.<name>`, `map.<name>`. Keys are the only thing code/content ever references; paths live solely in `manifest.json`.
- **Adding assets without code changes:** drop file → add manifest entry → (for a new expression) add to the character's `expressions` list. `tools/validate-manifest.ts` checks: every manifest path exists on disk, every content-referenced key exists in manifest, orphan files reported, and prints a "placeholder report" (% real art).
- **Placeholder strategy:** every placeholder is a real file (solid-color card: character color + name + expression label; backgrounds: color + location name) generated by `tools/gen-placeholders.ts` from the manifest, and marked `placeholder:true`. The game *never* special-cases placeholders — they're just assets. Swapping in real art = replacing a file + flipping the flag.
- **Runtime fallback chain (AssetRegistry.resolve, never throws):**
  `portrait.shen_yan.worried` missing → `portrait.shen_yan.neutral` → built-in silhouette (a data-URI baked into the bundle, cannot be missing) ; `bg.lantai` missing → built-in neutral gradient. Every fallback hit logs `AssetError:ASSET_MISSING` once per key and flags `isFallback` (debug overlay shows a badge).
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
- **Dialogue validation:** corpus of bad model outputs (truncated JSON, prose-wrapped JSON, wrong speaker, 9 choices, ±40 trust delta, unknown expression, ineligible event trigger, banned-lexicon text, wrong rank self-reference) → each is repaired, clamped, or rejected exactly as specced. This corpus grows every time a real malformed output is seen in the wild.
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
| **3. GameState & reducer** | GameState, all commands (incl. calendar/AP model: `SPEND_AP` rollover), atomic batch apply, store bridge to React | `engine/state`, `src/store` | Reducer unit tests pass incl. atomicity and 旬/month/year rollover; debug JSON dump of state visible in UI | Command set too narrow — add commands as needed, it's cheap |
| **4. Map & navigation** | Palace map screen, location screen, travel command, AP spend, presence (default-location rule) | `engine/map`, `ui/screens` | Can travel between 3 palace locations; AP drains and the 旬 rolls over; correct characters shown | None significant |
| **5. Assets & placeholders** | Manifest, AssetRegistry + fallback chain, placeholder generator, validate-manifest tool | `engine/assets`, `assets/`, `tools/` | All placeholder art renders; deleting a file produces silhouette + one log line, no crash | Path/bundler quirks with Vite asset handling |
| **6. Scripted scenes** | SceneRunner (line/choice/branch/effect), DialogueScreen rendering DialogueTurn, outcome batch application | `engine/scenes`, `ui` | Authored intro scene playable start→finish; effects land; mid-scene quit drops outcome | Node-graph edge cases — lean on validator from PR2 |
| **7. Memory system** | MemorySystem: append/retrieve/score/protect; seeded initial memories; memory debug browser v1 | `engine/memory`, `ui/debug` | Retrieval ordering tests pass; scene effects write memories; browser shows per-char entries with sources | Scoring constants wrong — fine, they're tunable, tests pin *ordering logic* not constants |
| **8. Events** | EventEngine, condition DSL evaluators, checkpoints wired into travel/scene-end, chain cap | `engine/events` | Intro event auto-fires on first location entry; once/priority/cooldown tests pass | Checkpoint wiring subtle — integration tests here |
| **9. Save/load** | SaveSystem, slots+autosave, checksum, quarantine, export/import | `engine/save`, `ui` | Roundtrip test passes; corrupting a save in devtools triggers recovery path; mid-scene save blocked | localStorage quota — measure save size now |
| **10. Dialogue: providers & pipeline** | DialogueOrchestrator, prompt builder, validation gates, ScriptedProvider + fallback content, FakeProvider tests | `engine/dialogue`, `content/fallback_dialogue` | Full pipeline integration tests green **without any real LLM**; degraded turns render normally | Biggest PR — split orchestrator/provider if review is heavy |
| **11. Live LLM + structured output** | LLMProvider with OpenAI-compatible + Anthropic adapters, `ModelRouting` config, key settings UI, repair retry, prompt viewer in debug overlay, eval harness `tools/eval-dialogue.ts` (§5.8) | `providers/`, `ui/debug`, `tools/`, settings | Real generated conversation, in-register Chinese with memory references; §5.8 scorecard produced for ≥2 candidate models; malformed-output corpus seeded from real failures; works offline via fallback when key absent | Model JSON discipline; lexicon/register drift (§11 risk 10); latency UX (add typing indicator) |
| **12. Scene-end updates & consolidation** | AI-proposed memory/relationship funnel, per-witness memory writes, summarization call, consolidation job | `engine/memory`, `engine/dialogue` | Play 2 conversations → second references the first; budget overflow consolidates correctly in test | Summary quality — keep dumb-truncation fallback |
| **13. Vertical slice content & polish** | Real slice content (§10), expression mapping tables, hybrid scenes, transitions, Playwright smoke test, placeholder report | `content/`, `ui` | A new player can play the §10 slice end-to-end; all failure drills (kill network, delete asset, corrupt save) behave per §7.2 | Content tuning time-sink — timebox |

Rough sizing: PRs 1–6 are the deterministic foundation (no AI anywhere yet), 7–9 the persistence/simulation layer, 10–12 the AI layer, 13 the slice. The AI is deliberately last-but-one: everything before it is testable and shippable with scripted content alone.

---

## 10. Concrete Vertical Slice Example

Slice content uses the world bible's canon (terms, ranks, 称谓, conflicts) but the slice characters are placeholders — they demonstrate architecture, not final cast. Setting: the inner palace, early in the reign; the player is the young 女帝.

**Characters:**
- `shen_yan` 沈晏 — 皇后 (full example in §3.1). 端肃克制, 无宠但掌后宫 (bible conflict #6). Court: `{ rank: "huanghou", favor: 20 }`. Secret: 私录各宫账册推演前朝银钱往来 — brushing the 男子不得私习外学 line (conflict #5, the mild version).
- `chu_he` 楚荷 — 贵君: bold, vivid, openly favored, needles the 皇后 at every chance (conflict #6 from the other side). `initialRelationship: { trust: 20, affinity: 40 }`; court `{ rank: "guijun", favor: 70 }`; initial memory: *“大朝会后陛下单独召见了我；凤仪宫那位的脸色，啧。”* salience 55, protected. Secret: 妆匣夹层里藏着半部手抄兵书 (conflict #5, the sharp version).
- `lin_wan` 林晚 — 更衣 (lowest rank): quiet, observant, rumored to have exceptional 血养 aptitude (conflict #3). `initialRelationship: { trust: 10, affinity: 5 }`; court `{ rank: "gengyi", favor: 5 }`; initial memory: *“听闻陛下已三月未进凤仪宫，宫人都在押中宫何时失势。”* salience 30 — secondhand, lower salience than the witnesses'.

**Locations:** `fengyi_palace` 凤仪宫 (沈晏's seat), `lantai` 兰台 (楚荷's palace), `yuhua_garden` 御花园 (林晚 is assigned duties here). Map: three nodes on the 宫城图, fully connected, travelCost 1 AP each.

**Scene** `intro_shen_yan` (hybrid), triggered by event `ev_intro` (`checkpoint: game_start`, priority 100, once):
```
line(shen_yan, "worried→neutral"): "陛下今日肯踏进凤仪宫，臣后竟一时不知，该备哪一盏茶。"
choice: ["皇后这是在怨朕。" (guarded) | "随手煮一盏便是，朕坐坐就走。" (neutral) | "备你自己常喝的那盏。" (friendly)]
branch on choice → effect: SET_FLAG intro_tone=<tone>; RELATIONSHIP_DELTA shen_yan trust +2 (friendly) / -2 (guarded)
generate(shen_yan, directive: "沈晏与陛下叙后宫近况，克制地试探陛下三月不至凤仪宫的缘由，
  并隐晦提及楚贵君近来的风头。他守礼、敏锐、不肯露怯。不得暴露他私录账册之事。", maxTurns: 4)
outcome: per-witness memories + conversation summary + autosave
```

**Generated flow (illustrative):** player chose the friendly line → next 中旬 (the 后宫 action-day), player travels to `lantai` (1 AP), taps 楚荷 → dynamic scene, directive from her `favored_mid_trust` pool ("楚荷恃宠撒娇，顺势打探陛下昨日去凤仪宫做了什么"). Context assembled: profile + mood `neutral` + trust 20 / favor 70 (rendered: rank 贵君, self-reference 本宫) + retrieved memories include her protected 召见 memory and the gossip summary *“陛下昨日去了凤仪宫，坐了近一盏茶的工夫。”* Model returns the §5.2 example JSON (楚荷 needles about 凤仪宫, proposes an `opinion` memory at salience 45, trust +2 / affinity +3). Validator: expression `smile` ✓ in her list, deltas within ±5 ✓, no banned terms ✓, self-reference 本宫 ✓ for rank `guijun`, no event triggers ✓ → turn renders with `portrait.chu_he.smile`; updates held.

**Memory before/after (chu_he):**
```
before: [mem_chu_he_000001 event  "大朝会后陛下单独召见了我；凤仪宫那位的脸色，啧。" sal 55 🔒]
        [mem_chu_he_000002 c.summ "陛下昨日去了凤仪宫，坐了近一盏茶的工夫。" sal 50]
after:  ...both, plus
        [mem_chu_he_000003 opinion "陛下嘴上不提凤仪宫，神色却不像要疏远中宫的样子。" sal 45
                                    tags:[player,shen_yan,favor] source:ai_proposed]
        [mem_chu_he_000004 c.summ  "兰台闲谈；试探凤仪宫之事，陛下避而不答，却多坐了半盏茶。" sal 45
                                    source:scene_outcome]
```
林晚, absent, gets nothing — ask her about the Empress and she still only has the palace-gossip memory: subjectivity demonstrated. (沈晏 likewise learns nothing of the 兰台 visit — what 楚荷 later gossips about is an authored `effect`, never automatic.)

**Relationship update:** `chu_he: {trust: 20→22, affinity: 40→43}` via one `APPLY_SCENE_OUTCOME` batch, visible in the debug relationship panel with the scene id as cause. Favor unchanged — 恩宠 moves only through explicit player actions (赏赐, 侍寝, 晋位 via `APPLY_FAVOR_DELTA`/`SET_RANK` effects), never by AI proposal.

**Asset manifest entries:**
```json
"portrait.shen_yan.neutral": { "path": "portraits/shen_yan/neutral.png", "kind": "portrait", "placeholder": true },
"portrait.shen_yan.smile":   { "path": "portraits/shen_yan/smile.png",   "kind": "portrait", "placeholder": true },
"portrait.chu_he.smile":     { "path": "portraits/chu_he/smile.png",     "kind": "portrait", "placeholder": true },
"bg.fengyi_palace":          { "path": "backgrounds/fengyi_palace.png",  "kind": "background", "placeholder": true },
"bg.lantai":                 { "path": "backgrounds/lantai.png",         "kind": "background", "placeholder": true },
"map.palace":                { "path": "map/palace.png",                 "kind": "map",        "placeholder": true }
```

---

## 11. Key Risks & Decisions Needing Confirmation

1. **LLM cost/latency per conversation turn.** Each turn ≈ 1.5–2.5k prompt tokens on the hot `dialogue` profile. Mitigation is the routing table (§5.7): a cheap Chinese-strong model on the hot path, premium models only for authored keystone scenes, mini-class models for summarization — plus prompt caching and a per-day soft budget. Final picks come from the §5.8 scorecard, not vendor marketing. *Decision lands in PR 11.*
2. **Client-side API key is dev-only.** Before any public release a proxy endpoint is mandatory (key security + rate limiting). The boundary is designed (§5.7); the deployment isn't. *Confirm hosting choice when release is in sight.*
3. **Retrieval without embeddings** is a bet that tags+salience+recency suffice at slice scale. Re-evaluate when characters exceed ~100 active entries or dialogue visibly "forgets" relevant things despite entries existing. The interface allows swapping the scorer.
4. **Model-generated player choices** risk railroading or tonal mush. Mitigations are in the prompt (tone variety, exit option); if quality disappoints, fall back to choice templates with generated fill-ins. *Evaluate during PR 11–13 playtesting.*
5. **Free-text player input** is excluded from MVP (choices only). It's the most-requested likely extension and the memory/dialogue design supports it, but it expands the validation/safety surface. *Explicit go/no-go after the slice.*
6. **Relationship model breadth** (2 axes + flags) is intentionally minimal. Adding axes is a schema field + save migration — cheap — so resist adding them until a design need is proven.
7. **localStorage ceiling** (~5 MB) vs growing memory stores. Consolidation + transcript caps should keep saves <300 KB; PR 9 must measure and assert this in a test. IndexedDB is the escape hatch.
8. **Content authoring ergonomics**: raw JSON will grate as content grows. Planned answer is a schema-aware editor or YAML+build step — *not* in MVP; revisit after PR 13 when authoring pain is real and informed.
9. **Content rating & model refusals.** 侍寝/承养 themes sit near content the model may refuse or sanitize. Decision needed before PR 11: target rating (recommendation: non-explicit, fade-to-black — enforced by scene directives, not by hoping). A refusal is just another `AIError` and the fallback ladder absorbs it, but a high refusal rate in intimate scenes would gut the experience — the manual voice-check script must include these scenes from day one.
10. **Chinese terminology & register drift.** The invented lexicon (胎息/承养/承嗣君…) and rank-based self-reference (臣后/本宫/本位/臣侍/小侍) are exactly the kind of detail LLMs drift on. Mitigations: lexicon + rules in every prompt (§5.4), cheap string validators with repair retry (§5.3), banned-term/self-reference cases in the test corpus (§8), per-character voice snapshots. If drift persists despite all that, add a post-generation rewrite pass — *not* in MVP.
11. **Open world-bible items** (bible §14: 转胎 timing, 绝经判定, succession rules, …) are deliberately *not* blocked on: the slice touches none of them mechanically, and §3.8 + the condition DSL absorb whichever way they're decided. Track them as content decisions, not engineering ones.

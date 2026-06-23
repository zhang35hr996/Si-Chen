# Relationship & Memory

Sources: `src/engine/state/types.ts`, `src/engine/memory/`,
`src/engine/chronicle/`, `src/engine/dialogue/`, `src/engine/events/conditions.ts`.

> This file tracks the **current** implementation. The memory system has moved
> well past the old "tag presence only" stage: it now has an objective chronicle,
> private memories with decay/activation, emotional conditions, candidate recall +
> rerank, structured-claim gating, and a reaction planner. Older docs that mention
> `salience`, `protected`, `participants`, `relationships[char]`, or "no retrieval"
> are obsolete — do not reintroduce those shapes.

## Standing & favor (implemented)

There is no separate `relationships[char]` table. Per-character runtime status lives
in `standing[char]` (`CharacterStanding`):

- `rank` (id from `world.json` 位分 table) + `favor` (0–100, 恩宠/圣眷).
- `title?`, `lifecycle?`, `residence?`, `chamber?`, `confined?`.
- `affection?` (0–100, 侍君 only — 好感/情意; falls back to authored `hidden.affection`).
- health/illness, palace-entry time, etc.

Changed only via scene `effect` nodes and domain systems (bounded per effect). Read in
conditions via `favorAtLeast`, `rankAtLeast`, `atLocation`, etc.

> Note: `standing[char].affection` is that character's affection **toward the
> sovereign**. It is NOT a speaker→subject relationship signal — the reaction planner
> derives speaker→subject relation from authored `stances`, not from this field.

## Objective chronicle (implemented — append-only)

`state.chronicle: CourtEvent[]` is the immutable record of "what actually happened"
(`src/engine/chronicle/`). Each `CourtEvent` has: `id`, `type`
(`residence_changed | heir_born | heir_died | rank_changed | punished | rewarded |
conflict | promise | secret_discovered`), `occurredAt`, `participants[]` (each with an
explicit `role`), optional `locationId`, scalar `payload`, `publicity`
(`circle | palace | realm` + persistence), `publicSalience` (0–100), `retention`
(`fast | slow | permanent`), and `tags[]`. Never rewritten; corrections would be new
events.

**Awareness:** `canKnowEvent` (`chronicle/awareness.ts`) gates who may know an event by
scope + `contemporaneous`/`institutional` persistence. `GroundTruthBeliefProjection`
(`chronicle/belief.ts`) projects currently-visible ground truth — there are **no
incorrect beliefs, rumor, or per-character awareness records yet** (see "Not yet").

## Private memory (implemented — append-only)

`state.memories[char] = { entries[], nextSeq }`. Each `MemoryEntry`:

- `id`, `ownerId`, `kind` (`episodic | trauma | grievance | gratitude | promise |
  secret | impression`), optional `sourceEventId` (links to a `CourtEvent`).
- `subjectIds[]` (who it is about; may include `"player"`), `perspective`, `summary`
  (≤240, that character's POV).
- `strength` (0–100, durability — replaces the old `salience`), `retention`
  (`fast | slow | permanent` — replaces `protected`), `emotions` (partial map),
  `triggerTags[]` (≤5), `unresolved`, `createdAt`.

**Seeded** from each character's `initialMemories`; **written** by scene `memory`
effects and `CourtEvent` → memory rules (`chronicle/rules.ts`, currently
`rank_changed`/`residence_changed`/`heir_born`/`heir_died`).

**Emotional conditions:** `state.emotionalConditions: EmotionalCondition[]`
(`acute_grief | prolonged_grief | resentment | anxiety | infatuation | humiliation`)
carry `severity`, `startedAt`, and a `recoveryProfile` (`fast | slow | normal | stuck`).
`effectiveConditionSeverity` (`chronicle/conditions.ts`) decays severity over action-days
(`stuck` holds); retrieval scales the condition bonus by this current severity rather than
granting a permanent boost.

## Retrieval pipeline (implemented)

For a dialogue turn the engine selects what the speaker is thinking about
(`src/engine/dialogue/`):

1. **Recall** (`recall.ts`) — wide net of candidate memories/events by `topicTags`,
   `subjectIds`, `presentCharacterIds`, or high strength.
2. **Decay** (`decay.ts`) — `effectiveStrength` (permanent holds; fast/slow half-life).
3. **Activation** (`retrievalScore.ts`) — `effectiveStrength × (base + topic) +
   anniversary + location + subjectPresent + unresolved + conditionActivation −
   recentMentionPenalty`. The location term requires the memory to declare the
   `"residence"` trigger tag **and** match its source event's location/from/to.
4. **Rerank** (`rerank.ts`) — `rankCandidates` keeps top-N; permanent memories never
   fall below threshold.
5. **Event activation** (`eventActivationScore`) — decayed `publicSalience × relevance +
   subjectPresent − recentReaction`; `selectPromptEventsByActivation` ranks prompt events
   (the speaker's reaction-source event is pinned first).

The orchestrator always treats the **speaker** and the **conversation target** as part of
the scene: the target is in the present-bonus set (so memories about the partner surface),
and the speaker is in `subjectIds` (self-memories stay reachable).

## Reaction, claims & cooldown (implemented)

- **ReactionPlan** (`reactionAssembler.ts` + `planReaction.ts`) — disposition from authored
  `personalityTraits` (`deriveDisposition`), speaker→subject relation from authored
  `stances` (`deriveSubjectRelation`), and the real scene audience (present + privacy).
  Only `rank_changed`/`residence_changed`/`heir_born`/`heir_died` currently yield reactions.
- **Structured claims** (`claims.ts`, `claimAssembler.ts`, `claimGate.ts`) — the LLM may only
  assert facts it is authorized to, gated against the belief projection, audience, offered
  refs, and `forbiddenClaims`. Constraint is on declared `proposedClaims`, never parsed text.
- **Mention cooldown** (`mention.ts`, `mentionWriteback.ts`) — memories the model used this
  turn cool down. Driven by accepted-claim source refs **and** `mentionedContextRefs` (the
  context the model declares it drew on), so emotional mentions without a factual claim still
  cool down. Providers are instructed to fill `mentionedContextRefs` (world rule 13).

## Scene queries: flags vs memory tags

Both remain valid; choose by intent:

- **Flag** — a global story switch. `flag` effect + `flagSet` condition.
- **Memory tag** — a *per-character* fact. A `memory` effect with a `triggerTag` +
  `hasMemoryTag` condition (`{ "hasMemoryTag": { "char": "<id>", "tag": "<tag>" } }`, true
  when that character holds ≥1 entry whose `triggerTags` include the tag).

## Not yet implemented

- **EventAwareness / rumor / incorrect beliefs** — only visible ground truth is projected;
  no `told_by`/`witnessed`/`rumor` provenance, certainty, or `claim_corrected`.
- **Interaction memory** — generative dialogue does not yet write new memories from player
  choices (promises/gratitude/grievance/relationship deltas); only mention/reaction logs are
  written back.
- **`unresolved` resolution** — `unresolved` is fixed at creation; no resolution/derivation
  when the grievance is later addressed.
- **Domain event coverage** — most `CourtEventType`s (punished/rewarded/conflict/promise/
  secret_discovered) and many gameplay systems do not yet emit chronicle events or reactions.
- **Consolidation / indexing** — memories, chronicle, and conditions are append-only with no
  theme summaries, derived indexes, or capacity control.
- **`topicTags` for free chat** — the engine threads `topicTags`, but free-chat `converse()`
  leaves them empty (no topic classifier); authored/free-chat topics are a follow-up.

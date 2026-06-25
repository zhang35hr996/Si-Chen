# Knowledge RAG System

## Overview

Si-Chen uses a two-layer context architecture for dialogue:

```
Structured runtime context        (authoritative)
  current state, character memory, known events,
  allowed claims, relationships, presence

RAG knowledge context             (advisory)
  world lore, etiquette, institutions,
  location history, public biographies, historical records
```

**Knowledge retrieval is advisory context.  
It does not override authoritative runtime state.**

**Retrieved knowledge must not grant a character access to facts above the
runtime-computed visibility ceiling.**

---

## Boundary: RAG vs Character Memory

| Concern | Layer |
|---------|-------|
| What a character knows or believes | Character memory (deterministic retrieval) |
| Who is allowed to know what | Claim gates + visibility ceiling |
| Static world lore (etiquette, institutions) | Knowledge RAG |
| Dynamic game state | Runtime state — never indexed |
| Secret / private character facts | Forbidden from knowledge index |

The character memory system has time-ordering, knowledge-permission constraints,
and relationship/presence filtering.  Do not use RAG for character-specific facts.

---

## What Belongs in the Knowledge Base

✅ **Safe to index:**
- World etiquette rules and ritual norms
- Rank system and title rules
- Palace locations (public description only)
- Official post definitions
- Historical records with clear time bounds
- Publicly known character biographies (only `coreFacts` marked public)
- Institution rules (承养, 大选, 禁足 system)

❌ **Forbidden from knowledge index:**
- Character private memories, fears, secrets, hidden motives
- Dynamic game state (favors, health, pregnancy status)
- Relationship stances that depend on current game state
- Secret facts only certain characters know
- Runtime chronicle events (use the chronicle system instead)
- Raw character JSON objects in their entirety

---

## Markdown Lore Document Format

Place lore documents in `content/knowledge/*.md`.

### Frontmatter

```yaml
---
id: etiquette.confinement         # unique document ID (dot-separated)
sourceType: etiquette             # see KnowledgeSourceType
title: 禁足期间的宫廷礼制           # document title (also used as chunk title prefix)
tags:
  - etiquette
  - punishment
entityIds: []                     # character IDs this lore is about
locationIds: []                   # location IDs this lore references
visibility: public                # public | restricted | imperial
# Optional: temporal bounds (all three fields must be present together)
validFromYear: 3
validFromMonth: 1
validFromPeriod: early
validUntilYear: 10
validUntilMonth: 12
validUntilPeriod: late
---
```

### Allowed `sourceType` values

| Value | Meaning |
|-------|---------|
| `world_rule` | General game-world rules |
| `etiquette` | Court etiquette and ritual |
| `location` | Palace/place descriptions |
| `official_system` | Official posts, government structure |
| `character_public_profile` | Publicly known character facts |
| `historical_archive` | Historical events (usually time-bounded) |

### Visibility levels

| Value | Who can read |
|-------|-------------|
| `public` | Any context (safe default) |
| `restricted` | Privileged contexts (inner court) |
| `imperial` | Sovereign context only |

The runtime query builder must always pass `visibilityCeiling` explicitly.
The default when omitted is `public` (safe, conservative).

---

## Semantic Chunking Rules

1. Content **before the first `##` heading** → `_intro` chunk (if ≥ 10 chars).
2. Each **`##` or `###` heading** + its body → one chunk.
3. Chunk ID format:
   - `##` heading → `${docId}#${anchorOrH2Text}`
   - `###` heading under a `##` → `${docId}#${anchorOrH2}/${anchorOrH3}`
   - Two `### 职责` sections under different `##` parents get **distinct** IDs via the H2 prefix.
4. Intro chunk ID: `${docId}#_intro`.
5. If a section body exceeds ~800 characters, it is **split at paragraph boundaries** (blank lines).  Never splits mid-sentence or mid-paragraph.
6. Sub-chunk IDs: `${docId}#${headingPath}:0`, `${docId}#${headingPath}:1`, … (where `headingPath` follows the H2/H3 rule above).
7. Empty sections (< 10 chars after trimming) are **discarded** — no garbage chunks.
8. All chunks inherit the document-level `tags`, `entityIds`, `locationIds`, `visibility`, `validFrom`, `validUntil`.
9. Chunk title for a `###` section includes the parent `##` for display context: `"H2 — H3"` (e.g. `"高位自称 — 对皇帝的正式自称"`).

---

## Stable Heading Anchors

Production knowledge files (`content/knowledge/*.md`) MUST use **stable heading anchors** to decouple chunk IDs from Chinese display text.

### Syntax

```markdown
## 后宫位分顺序 {#rank-order}

### 对皇帝的正式自称 {#to-emperor}
```

### Rules

- Anchor format: `{#kebab-case-id}` at the end of the heading line.
- Anchor characters: lowercase ASCII letters, digits, and hyphens. Must start with a letter.
- When an anchor is present it becomes the **ID component**; the Chinese heading text is display-only.
- When no anchor is present the heading text is used (backwards-compatible for test fixtures and legacy files).
- **Every `##` and `###` heading in `content/knowledge/*.md` MUST carry an anchor** — `knowledge:validate` rejects files that omit them.
- Anchors must be unique within a document.
- Renaming an anchor is a **breaking change** (chunk ID changes, golden eval expected IDs break, any stored references need migration).

### Generated IDs

```
## 后宫位分顺序 {#rank-order}          → titles.harem-ranks#rank-order
### 对皇帝的正式自称 {#to-emperor}     → titles.harem-ranks#rank-order/to-emperor
```

Without anchor (legacy / test fixtures):

```
## 禁足期间的请安                       → etiquette.confinement#禁足期间的请安
### 请安规则                           → etiquette.confinement#禁足期间的请安/请安规则
```

### Compatibility Policy

- Test fixtures in `tests/knowledge/fixtures/` may use headings without anchors.
- The `knowledge:validate` production validator enforces anchors only for `content/knowledge/*.md`.
- Legacy documents in other directories are not subject to the anchor requirement.

---

## Stable ID Rules

- IDs are derived from document content only — no filesystem order dependency.
- Identical document + path → identical IDs across all runs.
- IDs may contain Chinese characters, hyphens, and `/` separators (knowledge IDs are not `idSchema`).
- Do not rely on database row IDs as business IDs.
- H3 IDs embed the parent H2 anchor/text: `doc#H2key/H3key` — never write `doc#H3key` alone.

---

## `validFrom` / `validUntil` Semantics

Both bounds are **inclusive** (`<=` and `>=` on `dayIndex`).

- `validFrom` absent → no lower bound.
- `validUntil` absent → no upper bound.
- When `currentTime` is absent in a query → **no temporal filtering** (all chunks returned).  This is intentional for authoring and debug search.
- Runtime query builders **must always pass `currentTime`** to enforce temporal correctness.

---

## Building the Index

```bash
npm run knowledge:build
```

Reads `content/knowledge/*.md` and `content/locations/*.json`, ingests them, and writes the SQLite FTS5 database to `.knowledge.db`.

The database file is gitignored and must be rebuilt whenever source files change.

```bash
# Custom path
npm run knowledge:build -- --db ./dist/knowledge.db
```

---

## Searching

```bash
npm run knowledge:inspect -- "承养"
npm run knowledge:inspect -- "禁足 请安" --limit 5
npm run knowledge:inspect -- "宣政殿" --visibility public
```

Output per hit: chunk ID, title, sourceType, visibility, sourcePath, bm25Score, text preview.

---

## Chinese Search

SQLite's default `unicode61` tokenizer does not segment Chinese text (no word boundaries).  To solve this, we generate **overlapping character bigrams** from all CJK text and store them in a dedicated FTS5 column.

Example: `"禁足期间"` → bigrams `"禁足 足期 期间"`

Query `"承养"` is decomposed to its bigram `"承养"`, which appears as a distinct token and matches correctly.

### Current limitations

- **Minimum query length for CJK**: single-character queries may not match if the character never forms a bigram pair.
- **No semantic segmentation**: bigrams can spuriously match adjacent characters that are not a meaningful word.
- **Query decomposition is best-effort**: extremely long queries are decomposed into many bigrams, increasing noise.
- The bigram column is weighted lower (0.5×) than title (2.0×) and body (1.0×) in BM25 scoring.

---

## Embedding and Vector Search (PR2)

### Architecture

```
EmbeddingProvider (openai | gemini)
  ↓ embed texts
SqliteVectorIndex (same .knowledge.db)
  knowledge_embedding_cache   — (model_key, content_hash) → Float32 BLOB vector
  knowledge_chunk_embeddings  — (chunk_id, model_key)     → content_hash
  ↓ cosine search in Node
KnowledgeHybridRetriever
  ↓ keyword hits + vector hits
  Reciprocal Rank Fusion
  ↓ ranked KnowledgeHybridHit[]
```

### Embedding Cache Design

- **Cache key**: `(model_key, content_hash)` where `model_key = "${providerId}:${model}"` and `content_hash = SHA-256(embeddingText)`.
- **Embedding text** is compiled from: title, sourceType, tags (sorted), entityIds (sorted), locationIds (sorted), text.  `sourcePath`, chunk `id`, and temporal bounds are **excluded** so a chunk's vector is stable across filesystem moves and time-bound edits that don't change content.
- **Cache hit**: if a chunk's content hash is already in the cache, no provider call is made.  Two chunks with identical content hash share one cache entry.

### Syncing Embeddings

```bash
# First, build the keyword index
npm run knowledge:build

# Then embed (reads chunks from .knowledge.db, writes vectors to same file)
OPENAI_API_KEY=sk-... npm run knowledge:embed -- --provider openai --model text-embedding-3-small
GEMINI_API_KEY=...    npm run knowledge:embed -- --provider gemini  --model gemini-embedding-2

# Custom batch size and DB path
OPENAI_API_KEY=... npm run knowledge:embed -- --provider openai --model text-embedding-3-small --batch-size 50 --db ./custom.db
```

> **Note — Gemini gen2 HTTP call count**: `gemini-embedding-2` returns exactly one aggregated embedding per `embedContent()` call.  `--batch-size` controls the number of cache-miss texts passed to each `EmbeddingProvider.embed()` invocation; for `gemini-embedding-2`, the provider expands that logical batch into sequential per-text HTTP requests.  SQLite is written once, atomically, after all provider batches complete and validate.

`syncEmbeddings` contract:
1. Compile embedding text + SHA-256 per chunk.
2. Cache-check without holding a SQLite transaction.
3. Provider is called **only for cache misses** (deduplicated by hash).
4. Each batch's dimensions must match all prior batches (cross-batch consistency validated before any DB write).
5. All batch results are validated before any DB write.
6. Cache writes + chunk mappings + stale-mapping pruning happen in **one atomic transaction**.

### Hybrid Keyword + Vector Search

```bash
# Interactive hybrid search (embeds query inline)
OPENAI_API_KEY=... npm run knowledge:hybrid-inspect -- "宫廷礼仪" --provider openai --model text-embedding-3-small
OPENAI_API_KEY=... npm run knowledge:hybrid-inspect -- "禁足" --provider openai --model text-embedding-3-small --limit 5 --visibility imperial
GEMINI_API_KEY=... npm run knowledge:hybrid-inspect -- "宫廷礼仪" --provider gemini --model gemini-embedding-2
```

Output per hit: fused rank, hybrid score, keyword rank + BM25, vector rank + cosine, chunk metadata.

### Reciprocal Rank Fusion

```
hybridScore = kwWeight / (k + kwRank) + vecWeight / (k + vecRank)
```

Defaults: `k = 60`, `kwWeight = 1`, `vecWeight = 1`.  
All three are overridable in `KnowledgeHybridQuery`.

Tie-break order (deterministic):
1. hybridScore descending
2. best component rank ascending (min of kwRank, vecRank)
3. chunk ID code-point ascending

### `vectorFailureMode`

| Value | Behaviour |
|-------|-----------|
| `"fail"` | Throw on vector error (default — explicit contract) |
| `"keyword_only"` | Swallow vector errors; return keyword results only |

### Vector Codec

Vectors are stored as little-endian IEEE 754 Float32 BLOBs (4 bytes/dimension).
A 1536-dim OpenAI embedding = 6144 bytes.  Float32 precision is adequate for all current embedding models.

### API Key Security

- Keys are read from `OPENAI_API_KEY` / `GEMINI_API_KEY` environment variables **only**.
- Keys are **never** logged, printed, or included in error messages.
- Tools exit 1 with a clear error if a required key is absent.
- Never commit real keys to code, fixtures, snapshots, or test logs.

---

## Smoke Tests

```bash
# Live provider round-trip (require valid API keys; not run in CI)
OPENAI_API_KEY=... npm run smoke:knowledge:openai
GEMINI_API_KEY=... npm run smoke:knowledge:gemini
```

---

## PR3: Dialogue Runtime Wiring (implemented)

The dialogue pipeline now supports advisory knowledge context.

### Bridge module: `src/engine/dialogue/knowledge/`

| File | Responsibility |
|------|---------------|
| `types.ts` | `PromptKnowledgeChunk` (`{ id, title, text, sourceType }` — no `sourcePath`, no `visibility`); `KnowledgeRetriever` interface |
| `queryBuilder.ts` | `buildDialogueKnowledgeQuery(request, ceiling)` — deterministic query; uses `request.time` directly, includes latest target transcript line; fixed field order; 300-char cap |
| `visibility.ts` | `resolveVisibilityCeiling(speakerId, db, state)` — full access matrix (see below) |
| `promptKnowledge.ts` | `packPromptKnowledge(hits, ceiling)` — ≤4 chunks, ≤3200 chars; skips oversize (never breaks early); deduplicates chunk IDs |
| `provenance.ts` | `extractProvenance(...)` — stable first-seen union of all ref kinds (memory/event/knowledge); filters by `offeredRefKeys`; emits `unknownRefs` |

### Visibility ceiling access matrix

```text
player / sovereign → "imperial"
consort            → "restricted"
official           → "restricted"
elder              → "restricted"
generated consort  → "restricted"   (looked up from state.generatedConsorts)
unknown speaker    → "public"       (safe fallback — never elevate unknowns)
```

### `produceDialogueTurn` options

```typescript
type DialogueTurnOptions = {
  logger?: RingBufferLogger;
  retriever?: KnowledgeRetriever;
  knowledgeFailureMode?: "continue_without_knowledge" | "fail_turn";
};
```

When `retriever` is provided (generative path only):
1. `resolveVisibilityCeiling(speakerId, db, state)` → ceiling
2. `buildDialogueKnowledgeQuery(request, ceiling)` → query (currentTime = request.time)
3. `retriever.retrieve(query)` → hits + optional vectorDegradation
4. `packPromptKnowledge(hits, ceiling)` → up to 4 `PromptKnowledgeChunk` objects
5. Injected into `request.promptContext.knowledgeContext`
6. Knowledge chunk IDs added to `policy.offeredRefKeys`
7. `extractProvenance(...)` populates `line.meta.sourceRefs` and `line.meta.knowledge`

**Fatal retrieval errors:**
- `"continue_without_knowledge"` (default): turn proceeds; prompt receives `knowledgeContext: []`; `meta.knowledge.degraded = true`, `degradationKind = "fatal_degraded"`. Error text never reaches the LLM.
- `"fail_turn"`: provider is NOT called; turn returns an error; state unchanged.

### `KnowledgeRetrievalStatus` — no boolean inference

The `meta.knowledge` diagnostic is derived from an explicit `KnowledgeRetrievalStatus` union, never inferred from `knowledgeContext.length`:

| Status kind | `degraded` | `degradationKind` | Notes |
|-------------|-----------|-------------------|-------|
| `not_configured` | — | — | `knowledge` field absent |
| `ok` | `false` | absent | Successful retrieval (zero hits is fine) |
| `vector_degraded` | `true` | `"vector_degraded"` | `degradationReason` carries exact VectorDegradation reason |
| `fatal_degraded` | `true` | `"fatal_degraded"` | Exception during retriever.retrieve() |

### Claim gate invariant

`knowledge_not_claim_authority` — new violation code (step 1b). Knowledge chunks are advisory context only; any `ProposedClaim` with a `kind: "knowledge"` `sourceRef` is rejected before forbidden/allowed-claim checks.

Knowledge refs ARE permitted in `mentionedContextRefs` (tracks which advisory chunks the model drew on). `recordMentionedContext` ignores them (no memory cooldown for knowledge).

### `DialogueLine.meta` additions

```typescript
meta: {
  generated: boolean;
  degraded: boolean;
  /** All context kinds (memory/event/knowledge) the model drew on this turn. */
  sourceRefs?: ContextRef[];
  /** Knowledge retrieval diagnostic. Present when a retriever was wired. */
  knowledge?: {
    chunkIds: string[];
    degraded: boolean;
    degradationKind?: "vector_degraded" | "fatal_degraded";
    degradationReason?: VectorDegradation["reason"];
  };
}
```

### Provenance sanitization

`extractProvenance` builds a stable first-seen union of all offered refs from:
1. accepted claim `sourceRefs` (claim order, then ref order within each claim)
2. `mentionedContextRefs` (in order)

Refs NOT in `policy.offeredRefKeys` are excluded and collected as `unknownRefs`. Each unknown ref becomes a `ProvenanceFinding` (code `"unknown_context_ref"`) that is:
- Added to `outcome.diagnostics.provenanceFindings`
- Logged via logger as `UNKNOWN_CONTEXT_REF` warning
- Absent from `DialogueLine.meta.sourceRefs`

### `DialogueValidationDiagnostics` additions

```typescript
interface ProvenanceFinding {
  code: "unknown_context_ref";
  ref: ContextRef;
}

interface DialogueValidationDiagnostics {
  claimFindings: ClaimGateFinding[];
  textFindings: GateFinding[];
  acceptedClaims: ProposedClaim[];
  provenanceFindings: ProvenanceFinding[];  // NEW
}
```

### System rules (all 3 providers updated)

Rules 8, 13–15 updated:
- Rule 8: explicitly prohibits `kind: "knowledge"` in `sourceRefs`.
- Rule 13: extends `mentionedContextRefs` to include `knowledgeContext` items.
- Rule 14: advisory nature of `knowledgeContext` — character speaks from their perspective, not verbatim from lore.
- Rule 15: runtime authoritative data (`allowedClaims`, `forbiddenClaims`) takes precedence over `knowledgeContext`.

---

## Application Wiring (PR4)

### DialogueRuntimeDeps

All generative dialogue entry points share a single `DialogueRuntimeDeps` bundle:

```typescript
// src/engine/dialogue/runtimeDeps.ts
interface DialogueRuntimeDeps {
  readonly provider: DialogueProvider;
  readonly logger?: RingBufferLogger;
  readonly knowledgeRetriever?: KnowledgeRetriever;
  readonly knowledgeFailureMode?: "continue_without_knowledge" | "fail_turn";
}
```

`toDialogueTurnOptions(deps)` maps the bundle to `DialogueTurnOptions` — omitting any fields that are `undefined` so they don't override orchestrator defaults.

### Entry points wired

| Entry point | File | Uses runtime? |
|---|---|---|
| Converse first turn | `src/ui/App.tsx` | ✅ |
| Choice continuation | `src/ui/App.tsx` | ✅ |
| Scene line (future generative) | `src/engine/scenes/runner.ts` | ✅ |

`SceneRunner` constructor changed from `(db, provider, logger?)` to `(db, dialogueRuntime)`. Scripted provider invariant: the orchestrator skips retrieval when `provider.kind === "scripted"`.

### Failure mode behavior

| Mode | Provider called | State mutated | Meta |
|---|---|---|---|
| `continue_without_knowledge` | Yes | Yes | `meta.knowledge.degraded = true, degradationKind = "fatal_degraded"` |
| `fail_turn` | No | No | Turn returns `Err`, UI falls through to scripted fallback |

### DebugPanel knowledge diagnostic

`DialogueKnowledgeDiagnostic` (in `src/ui/debug/DebugPanel.tsx`) is captured into App-local state after each successful generative turn. It shows:
- `configured` — whether a retriever is wired
- `chunkIds` — which chunks were used (provenance from `meta.knowledge.chunkIds`)
- `degraded / degradationKind / degradationReason` — degradation status

This is non-persistent — never written to `GameState` or save files.

### Browser boundary

```
Browser                              Node (PR5 / server)
─────────────────────────────────    ────────────────────────────────
DialogueRuntimeDeps (interface)      KnowledgeHybridRetriever (class)
toDialogueTurnOptions (pure fn)      better-sqlite3
RemoteKnowledgeClient (fetch only)   sqlite-fts5, sqlite-vec
KnowledgeRetriever (interface)       embedding providers
src/ui/**                            .knowledge.db
```

`src/engine/dialogue/runtimeDeps.ts` and `src/engine/knowledge/remote/client.ts` import only TypeScript interfaces and Zod — verified by source-scan tests.

---

## Remote Retrieval (PR5 skeleton)

### Wire protocol

`POST /knowledge/retrieve` — JSON request/response. Schemas defined in:

```
src/engine/knowledge/remote/schemas.ts  ← shared browser+server
server/knowledge/handler.ts             ← transport-neutral handler
server/knowledge/relay.ts               ← HTTP adapter
```

### Request DTO

```typescript
{
  query: {
    text: string;              // 1–2000 chars
    limit: number;             // 1–20
    visibilityCeiling?: "public" | "restricted" | "imperial";
    currentTime?: GameTime;
    sourceTypes?: KnowledgeSourceType[];
    tagFilter?: KnowledgeMetadataFilter;
    entityFilter?: KnowledgeMetadataFilter;
    locationFilter?: KnowledgeMetadataFilter;
    vectorFailureMode?: "fail" | "keyword_only";
  }
}
```

### Response DTO

```typescript
{
  hits: Array<{
    id: string;
    sourceType: KnowledgeSourceType;
    title: string;
    text: string;
    tags: string[];
    entityIds: string[];
    locationIds: string[];
    visibility: "public" | "restricted" | "imperial";
    validFrom?: GameTime;
    validUntil?: GameTime;
    // Scores (for client-side packer)
    hybridScore: number;
    rank: number;
    keywordRank: number | null;
    keywordScore: number | null;
    vectorRank: number | null;
    cosineScore: number | null;
  }>;
  vectorDegradation?: { reason: "provider_error" | "no_embeddings" | "invalid_embedding" | "search_error" };
}
```

**Intentionally absent from response:** `sourcePath`, embedding vectors, error stack traces, API keys.

### Error sanitization

The handler catches all retriever errors, logs them via `deps.logger.error`, and returns `{ error: "retrieval_failed", code: "INTERNAL_ERROR" }` to the client. The raw error text (which may contain file paths, API keys, or stack traces) never reaches the browser.

### PR5 composition root (pending)

`server/knowledge/host.ts` — creates a `KnowledgeHybridRetriever` backed by `.knowledge.db` and wires it into `createKnowledgeRequestHandler`. Not yet implemented; this is the next integration step after `npm run knowledge:build` for the production database.

To add the retriever client to the browser runtime:

```typescript
// In src/main.tsx (after PR5 host is implemented):
import { RemoteKnowledgeClient } from "./engine/knowledge/remote/client";

const dialogueRuntime: DialogueRuntimeDeps = {
  provider: createDialogueProvider({ ... }),
  logger,
  knowledgeRetriever: new RemoteKnowledgeClient({ baseUrl: "http://localhost:3001" }),
  knowledgeFailureMode: "continue_without_knowledge",
};
```

---

## Author Checklist — Adding New Lore

- [ ] File goes in `content/knowledge/` (for production lore) or `tests/knowledge/fixtures/` (for test-only content).
- [ ] `id` is globally unique (check existing documents).
- [ ] `sourceType` matches the content category.
- [ ] `visibility` is the minimum required (default to `public`).
- [ ] If time-bounded: all three of `validFromYear/Month/Period` are set together.
- [ ] No character secrets, private memories, or dynamic state in the text.
- [ ] Run `npm run knowledge:build` and verify with `npm run knowledge:inspect`.
- [ ] Run `npm test` to verify no regressions.

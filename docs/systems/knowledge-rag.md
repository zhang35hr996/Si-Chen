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
3. Chunk ID format: `${docId}#${headingText}` (e.g. `etiquette.confinement#禁足期间的请安`).
4. Intro chunk ID: `${docId}#_intro`.
5. If a section body exceeds ~800 characters, it is **split at paragraph boundaries** (blank lines).  Never splits mid-sentence or mid-paragraph.
6. Sub-chunk IDs: `${docId}#${headingText}:0`, `${docId}#${headingText}:1`, …
7. Empty sections (< 10 chars after trimming) are **discarded** — no garbage chunks.
8. All chunks inherit the document-level `tags`, `entityIds`, `locationIds`, `visibility`, `validFrom`, `validUntil`.

---

## Stable ID Rules

- IDs are derived from document content only — no filesystem order dependency.
- Identical document + path → identical IDs across all runs.
- IDs may contain Chinese characters (the knowledge ID is not `idSchema`).
- Do not rely on database row IDs as business IDs.

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

## PR2 Extension Points

The following interfaces are clean extension points for embedding/hybrid retrieval:

```ts
// New in PR2:
interface KnowledgeVectorIndex {
  rebuild(chunks: readonly KnowledgeChunk[]): Promise<void>;
  search(query: KnowledgeVectorQuery): Promise<KnowledgeVectorHit[]>;
}

interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

// PR3 wires these into the prompt compiler and sourceRefs:
interface KnowledgeHybridRetriever {
  retrieve(query: HybridQuery, context: RuntimeContext): KnowledgeChunk[];
}
```

The chunk ingestion pipeline, normalization, and `KnowledgeChunk` type are shared across all three PRs without modification.

---

## PR3 Extension Points

PR3 will:
1. Wire `KnowledgeChunk[]` into the `promptPayload` as a `knowledgeContext` field.
2. Emit `sourceRefs` pointing to knowledge chunks used in a response.
3. Add claim-level support validation: retrieved knowledge never bypasses claim gates.
4. Add the `runtime query builder` that always passes `currentTime` and `visibilityCeiling`.

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

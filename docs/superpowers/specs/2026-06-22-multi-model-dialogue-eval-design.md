# Design: Multi-model dialogue eval (extend LLM-2 harness)

Date: 2026-06-22
Branch: `worktree-llm-multimodel-eval`
Status: design — awaiting user review

## Goal

Make it possible to run the same dialogue-generation scenarios across multiple
LLMs (Claude / GPT / Gemini) and get a per-model **scorecard** comparing
pass rates, lore-violation rate, an explainable character/style **proxy** score,
latency, token usage, and estimated cost — so model choices are quantified, not
eyeballed.

## Non-goals (explicitly out of scope for this spec)

- No second-pass **LLM judge**. First implementation is fully deterministic.
  An optional judge may be added later as a separate, opt-in layer.
- No **1000-scenario** scale-up. Reuse the existing 39 golden scenarios as-is.
  Scenario authoring is a separate later content task.
- No change to game runtime / dialogue generation behavior. New scores are
  **reporting/eval-only** and never block or degrade generation.
- No move of the eval harness out of the repo. No parallel `tools/llm-eval`
  runner. Everything is additive on the LLM-2 harness.
- No OpenAI-compatible gateway for Gemini in this phase (official SDK only;
  gateway can be a separate provider/transport later).

## Guiding principle: additive layer, zero duplication

The LLM-2 harness is the source of truth and is **not** forked or rewritten:

- `src/engine/dialogue/eval/{evalRunner,scoring,types,fixtureProvider}.ts`
- `src/engine/dialogue/gates.ts` (text/lore gates)
- `tools/eval-run.ts`, `tools/eval-score.ts`, `tools/eval-export.ts`
- `tests/eval/golden/scenarios.jsonl` (39 scenarios) + `tests/eval/fixtures/builders.ts`

New work **reads** the existing `EvalResult` (which already carries `model`,
`mode`, `usage`, `durationMs`, `textFindings`, `expectation*`) and **adds**
providers, scorers, pricing, and a report. The existing runner loop, scoring
functions, and gates are extended, never replaced or copied.

Data flow (unchanged spine; new layers in **bold**):

```
fixture (real char/memory)
  → provider (anthropic │ openai │ google)        ← NEW providers
  → DialogueToolOutput (shared Zod schema)
  → gates.ts (lore findings)
  → EvalResult (+ durationMs + usage)
  → scoreResults() [extended] + consistency proxy scorer [NEW]
  → eval-report (canonical JSON → derived Markdown/TSV)   ← NEW
```

## Component 1 — Provider expansion

### Naming (constraint #1)

- `ModelRef.provider` uses **vendor** names. Add `"google"` to the union
  (currently `"anthropic" | "openai" | "qwen" | "kimi" | "deepseek"` — add
  `"google"`). Do **not** add `"gemini"` to the type.
- CLI `eval:run --provider` accepts `anthropic | openai | google | fixture`,
  plus the alias **`gemini` → normalized to `google`** before constructing the
  `ModelRef`. The alias lives only in CLI argument parsing.

### SDKs (constraint #2)

Official SDKs, server-side, API-key auth (same posture as `@anthropic-ai/sdk`):

- `openai` (env `OPENAI_API_KEY`)
- `@google/genai` (env `GEMINI_API_KEY`)

No OpenAI-compatible gateway for Gemini in this phase.

### Provider + transport seam

Mirror the existing Anthropic seam (`remoteProvider` + injected transport in
`server/llm/anthropicSdkTransport.ts`) so providers are unit-testable without
network:

- `src/engine/dialogue/providers/openaiProvider.ts`
- `src/engine/dialogue/providers/geminiProvider.ts`

Both implement the existing `DialogueProvider` interface and return
`DialogueProviderResult`, populating `usage` and `providerMeta`. The SDK call
is wrapped behind a small injectable transport function so tests can feed
canned responses and error shapes. Provider errors map onto the existing
`ProviderError` union (`transport | protocol | config | …`).

### OpenAI structured output

Use **forced function calling**: one tool `emit_dialogue_line` whose parameters
are `dialogueToolOutputJsonSchema` (already produced by
`z.toJSONSchema(dialogueToolOutputSchema)`), with `tool_choice` set to require
that tool. Parse `tool_calls[0].function.arguments`, then validate with
`dialogueToolOutputSchema` (the shared schema stays canonical).

### Gemini structured output (constraint #7 — verified)

Verified against `@google/genai` (Context7 `/googleapis/js-genai`): forced
function calling is supported via
`config.tools = [{ functionDeclarations: [{ name, parametersJsonSchema }] }]`
plus `config.toolConfig.functionCallingConfig = { mode: ANY,
allowedFunctionNames: ['emit_dialogue_line'] }`. `parametersJsonSchema` accepts
a **raw JSON schema**, so the existing `dialogueToolOutputJsonSchema` can be
passed directly. Read `response.functionCalls[0].args`, then validate with the
shared `dialogueToolOutputSchema`.

**Provider-local adapter (no shared-schema change):** Gemini's JSON-schema
dialect may reject a few Zod-emitted keywords (e.g. `additionalProperties:false`
from `strictObject`, `default`, `$schema`). The Gemini provider owns a small
`sanitizeJsonSchemaForGemini()` step that strips/normalizes only the
unsupported keywords before the call. The shared `dialogueToolOutputSchema` is
**not** altered to accommodate Gemini.

### Smoke tests

- `tools/smoke-openai.ts`, `tools/smoke-gemini.ts` mirroring
  `tools/smoke-anthropic.ts` (single live call, intent → text, prints result).
- npm scripts: `smoke:openai`, `smoke:gemini`.

### eval-run wiring

`tools/eval-run.ts`: extend `--provider` to `anthropic | openai | google |
fixture` (+ `gemini` alias), each online provider deriving `mode=online`.
`--model` already exists and stays required for online providers.

## Component 2 — Metrics expansion

### Pricing (constraint #6)

New pure module `src/engine/dialogue/eval/pricing.ts`:

- An external, editable default price table keyed by `"<provider>:<model>"`,
  values `{ inputPerMTok, outputPerMTok, cacheReadPerMTok?, cacheCreationPerMTok? }`
  in USD per 1M tokens.
- `costForUsage(model, usage, table?)` — pure; `table` defaults to the built-in
  table but **accepts an override** so prices can be updated without touching
  scorer code. Unknown model → cost `undefined` (surfaced as `n/a`, never throws).

The price table is data, not logic: it lives in its own module and is passed
into scoring as a parameter; scoring never hardcodes prices.

### Scoring extension

Extend `ScoreReport` in `src/engine/dialogue/eval/scoring.ts` — **all existing
fields preserved** (`scenarioCount`, `runCount`, `schemaPassRate`,
`gatePassRate`, `expectationPassRate`, `cacheHitRate`, `avgInputTokens`,
`avgOutputTokens`). Add:

- `avgLatencyMs`, `p95LatencyMs` (from `durationMs`)
- `totalInputTokens`, `totalOutputTokens`
- `estCostUsd` (sum of `costForUsage`; `undefined` if any model unpriced)
- `loreViolationRate` (share of results with ≥1 `forbidden_lexicon` finding)
- `gateViolationsByType: Record<GateId, number>` (counts across all results)

`scoreResults` stays pure and gains an optional pricing-table parameter; with no
table it falls back to the built-in default. No I/O.

## Component 3 — Character / style proxy scoring (constraint #3, #4)

New pure module `src/engine/dialogue/eval/consistencyProxy.ts`.

**Naming discipline:** the exported scores are `characterProxyScore` and
`styleProxyScore`. Code, types, and docs must **not** call these "true
consistency" or imply semantic judgment. They are explainable **lexical/
structural proxies**; semantic consistency is the deferred optional judge.

**Boundary (constraint #4):** these scores are reporting/eval-only. They are
computed *after* `EvalResult` exists and **never** feed back into generation,
gates, or pass/fail. Gates alone reject/degrade output.

Inputs (all already available at scoring time via `ContentDB` + `EvalResult`):
`profile.personalityTraits`, `profile.speechStyle`, `voice.register`
(`formal|casual|rough|poetic`), `voice.quirks`, `voice.tabooTopics`, speaker
`selfRefs`, and the gate `textFindings` already on each `EvalResult`.

Each score returns `{ score: number /*0..1*/, signals: Signal[] }` where
`Signal = { name, weight, value, evidence }`, so every number is traceable.

`characterProxyScore` signals:
- self-ref correctness — reuses `self_ref` gate findings (speaker uses own
  `selfRefs`, not foreign ranks').
- player-address correctness — reuses `rank_title` gate findings (addresses
  player as 陛下; no wrong honorifics).
- checkable quirk adherence — only quirks that encode a literal lexical rule
  (e.g. `自称『侍身』`, `称玩家『陛下』`) are scored; free-form quirks
  (e.g. `失落时偶尔脱口而出『曾经』`) are reported as `not_scorable`, never
  penalized.
- taboo avoidance — text does not surface `voice.tabooTopics` keywords.
- cross-scenario stability — for one speaker across that speaker's scenarios in
  the run, low variance of self-ref usage / register markers (the "same person
  across scene 1..N" signal).

`styleProxyScore` signals:
- register-appropriate markers for `voice.register` (presence of expected
  markers; absence of register-incongruent ones).
- anachronism absence — new eval-only `src/engine/dialogue/eval/styleLexicon.ts`
  holds a curated 现代词 list (e.g. 手机/系统/项目/搞定/OK). Kept **separate**
  from game-lore `content/lexicon.json` (these are eval heuristics, not world
  rules).
- length appropriateness vs `audience.privacy`.

`loreViolationProxy` is not a new score — it is the existing
`forbidden_lexicon`/`rank_title` gate findings, summarized (see Component 2
`loreViolationRate` / `gateViolationsByType`).

## Component 4 — Multi-model scorecard (constraint #8)

New `tools/eval-report.ts` + npm script `eval:report`.

- Input: N result files (one `eval:run` per model), e.g.
  `eval:report --input claude.jsonl gpt.jsonl gemini.jsonl --output-dir out/`.
- **Canonical output is JSON** (`scorecard.json`): an array of per-model rows,
  each row = `{ model, provider, runCount, schemaPassRate, gatePassRate,
  expectationPassRate, loreViolationRate, gateViolationsByType,
  characterProxyScore, styleProxyScore, avgLatencyMs, p95LatencyMs,
  totalInputTokens, totalOutputTokens, estCostUsd }`.
- **Markdown and TSV are derived** from the JSON in the same run
  (`scorecard.md`, `scorecard.tsv`) — never authored independently, never the
  source of truth.
- Complements (does not replace) `tools/eval-export.ts` blind A/B pairing.

## Testing

All new pure modules get vitest unit tests with golden inputs — **no network in
CI**:

- `pricing`: `costForUsage` math, override table, unknown-model → `undefined`.
- `scoring` extension: latency percentiles, totals, `loreViolationRate`,
  `gateViolationsByType`; existing fields unchanged (regression).
- `consistencyProxy`: deterministic scores on canned `EvalResult` + fixture
  character data, including `not_scorable` quirks and cross-scenario stability.
- `eval-report`: JSON shape + Markdown/TSV derived correctly from JSON.
- providers: exercised via injected transports (canned success + each
  `ProviderError` shape); Gemini `sanitizeJsonSchemaForGemini` unit-tested.

Live `smoke:*` and online `eval:run` stay **manual** (require API keys).
Existing 1238-test baseline must remain green.

## New dependencies

- `openai`
- `@google/genai`

(Both server-side, API-key auth, used only by providers/smoke tools — not
bundled into the game client.)

## File inventory

New:
- `src/engine/dialogue/providers/openaiProvider.ts`
- `src/engine/dialogue/providers/geminiProvider.ts`
- `src/engine/dialogue/eval/pricing.ts`
- `src/engine/dialogue/eval/consistencyProxy.ts`
- `src/engine/dialogue/eval/styleLexicon.ts`
- `tools/smoke-openai.ts`, `tools/smoke-gemini.ts`, `tools/eval-report.ts`
- `server/llm/openaiSdkTransport.ts`, `server/llm/geminiSdkTransport.ts`
- tests alongside each new pure module.

Modified (additive only):
- `src/engine/dialogue/providerContract.ts` (`ModelRef.provider` += `"google"`)
- `src/engine/dialogue/eval/scoring.ts` (`ScoreReport` += fields, optional table arg)
- `tools/eval-run.ts` (provider switch + `gemini`→`google` alias)
- `package.json` (deps + `smoke:openai`, `smoke:gemini`, `eval:report` scripts)

## Open risks

- Gemini JSON-schema keyword support is verified at the API level but the exact
  set of rejected keywords is confirmed empirically during implementation;
  `sanitizeJsonSchemaForGemini` absorbs this and is the only place that changes.
- Anachronism / register marker lists are heuristic and will need tuning; they
  are isolated in `styleLexicon.ts` and are eval-only, so tuning never affects
  the game.

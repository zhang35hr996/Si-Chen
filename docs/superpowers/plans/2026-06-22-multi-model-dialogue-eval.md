# Multi-model Dialogue Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the same dialogue scenarios across Claude / GPT / Gemini and produce a per-model scorecard (pass rates, lore-violation rate, explainable character/style proxy scores, latency, tokens, estimated cost) on top of the existing LLM-2 eval harness.

**Architecture:** Three staged PRs, additive only. PR1 adds OpenAI + Google providers behind the existing `DialogueProvider`/transport seam and wires `eval-run`. PR2 adds pricing + metric aggregation + a canonical-JSON scorecard (metric columns only). PR3 adds deterministic `characterProxyScore`/`styleProxyScore` and wires them into the scorecard.

**Tech Stack:** TypeScript (ESM, `tsx`), Vitest, Zod, `@anthropic-ai/sdk` (existing), `openai`, `@google/genai`.

## Global Constraints

- Additive only. Do NOT fork/rewrite `evalRunner`, `scoring.ts`, `gates.ts`, or `eval-export.ts`. Existing 1238-test baseline stays green.
- `ModelRef.provider` uses vendor names: add `"google"` (NOT `"gemini"`). CLI accepts alias `gemini` → normalized to `google` in arg parsing only.
- Official SDKs only (`openai`, `@google/genai`). No OpenAI-compatible gateway for Gemini this phase.
- Shared `dialogueToolOutputSchema` is canonical and MUST NOT change to satisfy any provider. Gemini schema incompatibilities are absorbed by a provider-local `sanitizeJsonSchemaForGemini`.
- Proxy scores are named exactly `characterProxyScore` / `styleProxyScore`. Never call them "true consistency" or imply semantic judgment in code/docs.
- Proxy scores are reporting/eval-only. They MUST NOT block, gate, or degrade generation. Only `gates.ts` rejects/degrades.
- Pricing lives in an external editable table; scoring/report functions accept an override table and never hardcode prices inline.
- Report canonical output is JSON; Markdown/TSV are derived from the JSON in the same run, never the source of truth.
- Reuse the existing 39 golden scenarios. No scenario scale-up in this plan.
- Live `smoke:*` and online `eval:run` are manual (need API keys); never added to CI.
- Spec: `docs/superpowers/specs/2026-06-22-multi-model-dialogue-eval-design.md`.

## Non-goals

- No second-pass LLM judge.
- No 1000-scenario authoring.
- No change to game runtime dialogue generation behavior.
- No moving the harness out of the repo; no parallel `tools/llm-eval` runner.
- No refactor of `anthropicProvider.ts` internals (new providers may share a small helper but the Anthropic path is left working as-is).

## Failure-handling policy (applies to all tasks)

- **Missing API key:** online providers print `Error: <ENV> environment variable is required for --provider <name>` to stderr and `process.exit(1)`. Never partially run.
- **Unsupported / absent usage fields:** providers populate `usage` only when the SDK returns token counts; missing counts default to `0` for input/output and omit optional cache fields. `costForUsage` returns `undefined` (rendered `n/a`) for unknown models — never throws, never NaN.
- **Provider schema / protocol errors:** map onto the existing `ProviderError` union (`protocol` causes `no_tool_call | wrong_tool | schema_invalid | truncated | multiple_tool_calls | pause_turn`; `config` causes `auth | billing | model_not_found | request_too_large | invalid_request`). A `schema_invalid` from any provider is a non-fatal `EvalResult` (recorded, run continues), identical to the Anthropic path.

---

## PR 1 — Providers (OpenAI + Google/Gemini)

**Reference template:** `src/engine/dialogue/providers/anthropicProvider.ts` and `server/llm/anthropicSdkTransport.ts` are the canonical pattern (build request → inject transport → `Promise.race` deadline/cancel → parse tool-use → map errors). New providers mirror this shape.

### Task 1.1: Add `google` to ModelRef; add `provider`+`speakerId` to EvalResult

**Files:**
- Modify: `src/engine/dialogue/providerContract.ts` (`ModelRef`)
- Modify: `src/engine/dialogue/eval/types.ts` (`EvalResult`)
- Modify: `src/engine/dialogue/eval/evalRunner.ts` (populate new fields)
- Test: `src/engine/dialogue/eval/evalRunner.test.ts` (existing — extend) or `tests/eval/evalRunnerFields.test.ts` (new)

**Interfaces:**
- Produces: `ModelRef.provider` now includes `"google"`. `EvalResult` gains `provider: string` and `speakerId: string`.

- [ ] **Step 1: Write the failing test** — `tests/eval/evalRunnerFields.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { loadRealContent } from "../helpers/contentFixture";
import { createNewGameState } from "../../src/engine/state/newGame";
import { runEvalScenarioWithProvider } from "../../src/engine/dialogue/eval/evalRunner";
import { createMockProvider } from "../../src/engine/dialogue/providers/mockProvider";
import type { EvalScenario } from "../../src/engine/dialogue/eval/types";

describe("EvalResult provenance fields", () => {
  it("records provider and speakerId", async () => {
    const db = loadRealContent();
    const state = createNewGameState(db);
    const scenario: EvalScenario = {
      id: "t-prov", fixtureId: "base_palace",
      speakerId: "shen_zhibai", locationId: "kunninggong",
    };
    const result = await runEvalScenarioWithProvider(
      scenario, db, state, () => createMockProvider(),
      "eval-x", 0, "gpt-test", "online", "openai",
    );
    expect(result.speakerId).toBe("shen_zhibai");
    expect(result.provider).toBe("openai");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eval/evalRunnerFields.test.ts`
Expected: FAIL — `runEvalScenarioWithProvider` has no 9th param / `result.provider` undefined.

- [ ] **Step 3: Implement**

In `providerContract.ts`:
```ts
export interface ModelRef { provider: "anthropic" | "openai" | "google" | "qwen" | "kimi" | "deepseek"; model: string; }
```

In `eval/types.ts` `EvalResult`, add after `model: string;`:
```ts
  provider: string;          // vendor name ("anthropic"|"openai"|"google") or "fixture"
  speakerId: string;         // scenario.speakerId — needed by proxy scorers
```

In `evalRunner.ts`: add a trailing optional `provider` param to `runEvalScenarioWithProvider(..., model, mode, provider = "online" === mode ? "unknown" : "fixture")` and set `provider`, `speakerId: scenario.speakerId` on every constructed `EvalResult` (including the fixture path in `runEvalScenario`, where `provider = "fixture"`). Find each `EvalResult` literal and add the two fields. For `runEvalScenario` (fixture), set `provider: "fixture"`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/eval/evalRunnerFields.test.ts && npx vitest run src/engine/dialogue/eval`
Expected: PASS; existing eval tests still pass (fix any that build `EvalResult` literals by adding the two fields).

- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/providerContract.ts src/engine/dialogue/eval/types.ts src/engine/dialogue/eval/evalRunner.ts tests/eval/evalRunnerFields.test.ts
git commit -m "feat(eval): add google provider type + provider/speakerId on EvalResult"
```

### Task 1.2: Shared deadline/cancel helper

**Files:**
- Create: `src/engine/dialogue/providers/withDeadline.ts`
- Test: `src/engine/dialogue/providers/withDeadline.test.ts`

**Interfaces:**
- Produces: `runWithDeadline<T>(work: (signal: AbortSignal) => Promise<T>, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ kind: "ok"; value: T } | { kind: "timeout" } | { kind: "cancel" }>`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runWithDeadline } from "./withDeadline";

describe("runWithDeadline", () => {
  it("returns ok when work resolves first", async () => {
    const r = await runWithDeadline(async () => 42, { timeoutMs: 1000 });
    expect(r).toEqual({ kind: "ok", value: 42 });
  });
  it("returns timeout when work is slow", async () => {
    const r = await runWithDeadline(() => new Promise((res) => setTimeout(() => res(1), 50)), { timeoutMs: 5 });
    expect(r.kind).toBe("timeout");
  });
  it("returns cancel when pre-aborted", async () => {
    const ac = new AbortController(); ac.abort();
    const r = await runWithDeadline(async () => 1, { timeoutMs: 1000, signal: ac.signal });
    expect(r.kind).toBe("cancel");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/engine/dialogue/providers/withDeadline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `withDeadline.ts`

```ts
const TIMEOUT = Symbol("timeout");
const CANCEL = Symbol("cancel");
const DEFAULT_TIMEOUT_MS = 30000;

export type DeadlineOutcome<T> =
  | { kind: "ok"; value: T }
  | { kind: "timeout" }
  | { kind: "cancel" };

export async function runWithDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  opts?: { timeoutMs?: number; signal?: AbortSignal },
): Promise<DeadlineOutcome<T>> {
  if (opts?.signal?.aborted) return { kind: "cancel" };
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveCancel!: (v: typeof CANCEL) => void;
  const deadline = new Promise<typeof TIMEOUT>((res) => { timer = setTimeout(() => res(TIMEOUT), timeoutMs); });
  const cancel = new Promise<typeof CANCEL>((res) => { resolveCancel = res; });
  const onAbort = () => resolveCancel(CANCEL);
  opts?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const winner = await Promise.race([work(controller.signal), deadline, cancel]);
    if (winner === TIMEOUT) { controller.abort(); return { kind: "timeout" }; }
    if (winner === CANCEL) { controller.abort(); return { kind: "cancel" }; }
    return { kind: "ok", value: winner as T };
  } finally {
    opts?.signal?.removeEventListener("abort", onAbort);
    if (timer) clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/providers/withDeadline.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/providers/withDeadline.ts src/engine/dialogue/providers/withDeadline.test.ts
git commit -m "feat(dialogue): shared runWithDeadline helper for providers"
```

### Task 1.3: OpenAI provider (request build + parse + error map)

**Files:**
- Create: `src/engine/dialogue/providers/openaiProvider.ts`
- Test: `src/engine/dialogue/providers/openaiProvider.test.ts`

**Interfaces:**
- Consumes: `compilePromptPayload`, `WORLD_RULES_TEXT`, `renderEtiquetteBlock` (from `anthropicProvider`/`promptPayload`), `dialogueToolOutputSchema`, `dialogueToolOutputJsonSchema`, `runWithDeadline`.
- Produces:
  - `OpenAITransport.send(payload: OpenAIRequestPayload, opts?: { signal?: AbortSignal }): Promise<Result<OpenAITransportResult, OpenAITransportFailure>>`
  - `OpenAIRequestPayload` (`{ model; max_tokens; messages; tools; tool_choice }`)
  - `OpenAITransportResult` (`{ message: OpenAIToolResponse; requestId?: string }`), `OpenAIToolResponse` (`{ finish_reason; tool_calls: { function: { name; arguments: string } }[]; usage?: { prompt_tokens?; completion_tokens?; prompt_tokens_details?: { cached_tokens?: number } } }`)
  - `OpenAITransportFailure` (`{ kind: "http"|"network"|"offline"; status?; requestId?; retryAfterMs?; message? }`)
  - `createOpenAIProvider(opts: { model: string; transport: OpenAITransport }): DialogueProvider`
  - `buildOpenAIToolRequest(request, model, options?): OpenAIRequestPayload`

- [ ] **Step 1: Write the failing test** (transport injected; no network)

```ts
import { describe, it, expect } from "vitest";
import { createOpenAIProvider, type OpenAITransport } from "./openaiProvider";
import { ok } from "../../infra/result";
import { makeDialogueRequest } from "../../../../tests/helpers/dialogueRequest"; // see note below

function transportReturning(args: object): OpenAITransport {
  return { send: async () => ok({ message: {
    finish_reason: "tool_calls",
    tool_calls: [{ function: { name: "emit_dialogue_line", arguments: JSON.stringify(args) } }],
    usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 30 } },
  }, requestId: "req_1" }) };
}

describe("openaiProvider", () => {
  it("parses a forced tool call into DialogueProviderResult", async () => {
    const provider = createOpenAIProvider({ model: "gpt-x", transport: transportReturning({ text: "臣妾参见陛下。", proposedClaims: [] }) });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.text).toBe("臣妾参见陛下。");
      expect(res.value.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 30 });
      expect(res.value.providerMeta).toMatchObject({ provider: "openai", model: "gpt-x" });
    }
  });

  it("maps schema-invalid tool args to protocol/schema_invalid", async () => {
    const provider = createOpenAIProvider({ model: "gpt-x", transport: transportReturning({ text: "" }) }); // empty text violates min(1)
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "protocol", cause: "schema_invalid" });
  });
});
```

> **Test helper note:** create `tests/helpers/dialogueRequest.ts` exporting `makeDialogueRequest()` that returns a minimal valid `DialogueRequest` (reuse the literal from `tools/smoke-anthropic.ts`). Build this helper as Step 0 of this task if absent; commit it with the task.

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/engine/dialogue/providers/openaiProvider.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `openaiProvider.ts`

```ts
import { ok, err, type Result } from "../../infra/result";
import { dialogueToolOutputSchema, dialogueToolOutputJsonSchema,
         type DialogueProviderResult, type ProviderError, type ProviderResult } from "../providerContract";
import type { DialogueProvider, DialogueGenerationOptions, DialogueRequest } from "../types";
import { WORLD_RULES_TEXT, renderEtiquetteBlock } from "./anthropicProvider";
import { compilePromptPayload } from "../promptPayload";
import { runWithDeadline } from "./withDeadline";

const TOOL_NAME = "emit_dialogue_line";
const DEFAULT_MAX_TOKENS = 800;

export interface OpenAIRequestPayload {
  model: string; max_tokens: number;
  messages: { role: "system" | "user"; content: string }[];
  tools: { type: "function"; function: { name: string; description: string; parameters: unknown; strict: true } }[];
  tool_choice: { type: "function"; function: { name: string } };
}
export interface OpenAIToolResponse {
  finish_reason: string;
  tool_calls?: { function: { name: string; arguments: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}
export interface OpenAITransportResult { message: OpenAIToolResponse; requestId?: string; }
export interface OpenAITransportFailure { kind: "http" | "network" | "offline"; status?: number; requestId?: string; retryAfterMs?: number; message?: string; }
export interface OpenAITransport { send(payload: OpenAIRequestPayload, opts?: { signal?: AbortSignal }): Promise<Result<OpenAITransportResult, OpenAITransportFailure>>; }

export function buildOpenAIToolRequest(request: DialogueRequest, model: string, options?: DialogueGenerationOptions): OpenAIRequestPayload {
  const payload = compilePromptPayload(request);
  const etiquette = renderEtiquetteBlock(request.etiquette, payload.speaker.standing.selfRefs, payload.audience.targetRole);
  return {
    model, max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [
      { role: "system", content: `${WORLD_RULES_TEXT}\n\n${etiquette}` },
      { role: "user", content: JSON.stringify(payload) },
    ],
    tools: [{ type: "function", function: { name: TOOL_NAME, description: "提交角色台词及其结构化事实。", parameters: dialogueToolOutputJsonSchema, strict: true } }],
    tool_choice: { type: "function", function: { name: TOOL_NAME } },
  };
}

export function createOpenAIProvider(opts: { model: string; transport: OpenAITransport }): DialogueProvider {
  return {
    id: `openai:${opts.model}`, kind: "generative",
    capabilities: { strictTools: true, promptCaching: true, batch: false },
    async generate(request, options): Promise<ProviderResult<DialogueProviderResult>> {
      const payload = buildOpenAIToolRequest(request, opts.model, options);
      const outcome = await runWithDeadline((signal) => opts.transport.send(payload, { signal }), { timeoutMs: options?.timeoutMs, signal: options?.signal });
      if (outcome.kind === "timeout") return err<ProviderError>({ kind: "transport", retryable: true, cause: "timeout" });
      if (outcome.kind === "cancel") return err<ProviderError>({ kind: "cancelled", retryable: false });
      const r = outcome.value;
      if (!r.ok) return err(classifyOpenAIFailure(r.error));
      return parseOpenAIToolCall(r.value, request, opts.model);
    },
  };
}

function parseOpenAIToolCall(res: OpenAITransportResult, request: DialogueRequest, model: string): ProviderResult<DialogueProviderResult> {
  const m = res.message;
  const meta = res.requestId !== undefined ? { requestId: res.requestId } : undefined;
  if (m.finish_reason === "length") return err<ProviderError>({ kind: "protocol", retryable: true, cause: "truncated", meta });
  if (m.finish_reason === "content_filter") return err<ProviderError>({ kind: "refused", retryable: false, meta });
  const calls = m.tool_calls ?? [];
  if (calls.length === 0) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  if (calls.length > 1) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "multiple_tool_calls", meta });
  if (calls[0]!.function.name !== TOOL_NAME) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "wrong_tool", meta });
  let raw: unknown;
  try { raw = JSON.parse(calls[0]!.function.arguments); }
  catch { return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta }); }
  const parsed = dialogueToolOutputSchema.safeParse(raw);
  if (!parsed.success) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta });
  const u = m.usage;
  return ok<DialogueProviderResult>({
    speaker: request.speakerId, text: parsed.data.text, choices: [], proposedClaims: parsed.data.proposedClaims,
    ...(u ? { usage: { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0,
      ...(u.prompt_tokens_details?.cached_tokens !== undefined ? { cacheReadTokens: u.prompt_tokens_details.cached_tokens } : {}) } } : {}),
    providerMeta: { provider: "openai", model, ...(res.requestId ? { requestId: res.requestId } : {}) },
  });
}

function classifyOpenAIFailure(f: OpenAITransportFailure): ProviderError {
  const meta = { ...(f.requestId ? { requestId: f.requestId } : {}), ...(f.status ? { statusCode: f.status } : {}) };
  if (f.kind === "offline") return { kind: "offline", retryable: false, meta };
  if (f.kind === "network") return { kind: "transport", retryable: true, cause: "network", meta };
  switch (f.status) {
    case 408: return { kind: "transport", retryable: true, cause: "timeout", meta };
    case 401: case 403: return { kind: "config", retryable: false, cause: "auth", meta };
    case 402: return { kind: "config", retryable: false, cause: "billing", meta };
    case 404: return { kind: "config", retryable: false, cause: "model_not_found", meta };
    case 413: return { kind: "config", retryable: false, cause: "request_too_large", meta };
    case 429: return { kind: "transport", retryable: true, cause: "rate_limit", meta: { ...meta, ...(f.retryAfterMs ? { retryAfterMs: f.retryAfterMs } : {}) } };
    default:
      if (typeof f.status === "number" && f.status >= 500) return { kind: "transport", retryable: true, cause: "5xx", meta };
      if (typeof f.status === "number" && f.status >= 400) return { kind: "config", retryable: false, cause: "invalid_request", meta };
      return { kind: "transport", retryable: true, cause: "network", meta };
  }
}
```

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/providers/openaiProvider.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/providers/openaiProvider.ts src/engine/dialogue/providers/openaiProvider.test.ts tests/helpers/dialogueRequest.ts
git commit -m "feat(dialogue): OpenAI provider (forced tool-call, error mapping)"
```

### Task 1.4: Google/Gemini provider + schema sanitizer

**Files:**
- Create: `src/engine/dialogue/providers/geminiProvider.ts`
- Test: `src/engine/dialogue/providers/geminiProvider.test.ts`

**Interfaces:**
- Produces:
  - `sanitizeJsonSchemaForGemini(schema: unknown): unknown` — deep-clones and strips keys Gemini's dialect rejects: `additionalProperties`, `$schema`, `default`, `$ref`/`definitions` (inline if present is out of scope — our schema has none).
  - `GeminiTransport.send(payload: GeminiRequestPayload, opts?): Promise<Result<GeminiTransportResult, GeminiTransportFailure>>`
  - `GeminiRequestPayload` (`{ model; systemInstruction: string; contents: string; functionDeclaration: { name; description; parametersJsonSchema: unknown }; maxOutputTokens: number }`)
  - `GeminiTransportResult` (`{ functionCalls?: { name: string; args: unknown }[]; finishReason?: string; usage?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number }; requestId?: string }`)
  - `GeminiTransportFailure` (same shape as OpenAI's)
  - `createGeminiProvider(opts: { model: string; transport: GeminiTransport }): DialogueProvider`
  - `buildGeminiToolRequest(request, model, options?): GeminiRequestPayload`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { createGeminiProvider, sanitizeJsonSchemaForGemini, type GeminiTransport } from "./geminiProvider";
import { ok } from "../../infra/result";
import { makeDialogueRequest } from "../../../../tests/helpers/dialogueRequest";

describe("sanitizeJsonSchemaForGemini", () => {
  it("strips additionalProperties, $schema, default", () => {
    const out = sanitizeJsonSchemaForGemini({
      type: "object", additionalProperties: false, $schema: "x",
      properties: { proposedClaims: { type: "array", default: [], items: { type: "object", additionalProperties: false } } },
    }) as any;
    expect(out.additionalProperties).toBeUndefined();
    expect(out.$schema).toBeUndefined();
    expect(out.properties.proposedClaims.default).toBeUndefined();
    expect(out.properties.proposedClaims.items.additionalProperties).toBeUndefined();
  });
});

describe("geminiProvider", () => {
  it("parses functionCalls[0].args into DialogueProviderResult", async () => {
    const transport: GeminiTransport = { send: async () => ok({
      functionCalls: [{ name: "emit_dialogue_line", args: { text: "臣妾告退。", proposedClaims: [] } }],
      finishReason: "STOP",
      usage: { promptTokenCount: 80, candidatesTokenCount: 12, cachedContentTokenCount: 10 },
      requestId: "g_1",
    }) };
    const provider = createGeminiProvider({ model: "gemini-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.text).toBe("臣妾告退。");
      expect(res.value.usage).toEqual({ inputTokens: 80, outputTokens: 12, cacheReadTokens: 10 });
      expect(res.value.providerMeta).toMatchObject({ provider: "google", model: "gemini-x" });
    }
  });

  it("maps missing function call to protocol/no_tool_call", async () => {
    const transport: GeminiTransport = { send: async () => ok({ functionCalls: [], finishReason: "STOP" }) };
    const provider = createGeminiProvider({ model: "gemini-x", transport });
    const res = await provider.generate(makeDialogueRequest());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ kind: "protocol", cause: "no_tool_call" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/engine/dialogue/providers/geminiProvider.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `geminiProvider.ts`

```ts
import { ok, err, type Result } from "../../infra/result";
import { dialogueToolOutputSchema, dialogueToolOutputJsonSchema,
         type DialogueProviderResult, type ProviderError, type ProviderResult } from "../providerContract";
import type { DialogueProvider, DialogueGenerationOptions, DialogueRequest } from "../types";
import { WORLD_RULES_TEXT, renderEtiquetteBlock } from "./anthropicProvider";
import { compilePromptPayload } from "../promptPayload";
import { runWithDeadline } from "./withDeadline";

const TOOL_NAME = "emit_dialogue_line";
const DEFAULT_MAX_TOKENS = 800;
const STRIP_KEYS = new Set(["additionalProperties", "$schema", "default", "$id"]);

export function sanitizeJsonSchemaForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeJsonSchemaForGemini);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (STRIP_KEYS.has(k)) continue;
      out[k] = sanitizeJsonSchemaForGemini(v);
    }
    return out;
  }
  return schema;
}

export interface GeminiRequestPayload {
  model: string; systemInstruction: string; contents: string; maxOutputTokens: number;
  functionDeclaration: { name: string; description: string; parametersJsonSchema: unknown };
}
export interface GeminiTransportResult {
  functionCalls?: { name: string; args: unknown }[];
  finishReason?: string;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
  requestId?: string;
}
export interface GeminiTransportFailure { kind: "http" | "network" | "offline"; status?: number; requestId?: string; retryAfterMs?: number; message?: string; }
export interface GeminiTransport { send(payload: GeminiRequestPayload, opts?: { signal?: AbortSignal }): Promise<Result<GeminiTransportResult, GeminiTransportFailure>>; }

export function buildGeminiToolRequest(request: DialogueRequest, model: string, options?: DialogueGenerationOptions): GeminiRequestPayload {
  const payload = compilePromptPayload(request);
  const etiquette = renderEtiquetteBlock(request.etiquette, payload.speaker.standing.selfRefs, payload.audience.targetRole);
  return {
    model, maxOutputTokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    systemInstruction: `${WORLD_RULES_TEXT}\n\n${etiquette}`,
    contents: JSON.stringify(payload),
    functionDeclaration: { name: TOOL_NAME, description: "提交角色台词及其结构化事实。", parametersJsonSchema: sanitizeJsonSchemaForGemini(dialogueToolOutputJsonSchema) },
  };
}

export function createGeminiProvider(opts: { model: string; transport: GeminiTransport }): DialogueProvider {
  return {
    id: `google:${opts.model}`, kind: "generative",
    capabilities: { strictTools: true, promptCaching: false, batch: false },
    async generate(request, options): Promise<ProviderResult<DialogueProviderResult>> {
      const payload = buildGeminiToolRequest(request, opts.model, options);
      const outcome = await runWithDeadline((signal) => opts.transport.send(payload, { signal }), { timeoutMs: options?.timeoutMs, signal: options?.signal });
      if (outcome.kind === "timeout") return err<ProviderError>({ kind: "transport", retryable: true, cause: "timeout" });
      if (outcome.kind === "cancel") return err<ProviderError>({ kind: "cancelled", retryable: false });
      const r = outcome.value;
      if (!r.ok) return err(classifyGeminiFailure(r.error));
      return parseGeminiCall(r.value, request, opts.model);
    },
  };
}

function parseGeminiCall(res: GeminiTransportResult, request: DialogueRequest, model: string): ProviderResult<DialogueProviderResult> {
  const meta = res.requestId !== undefined ? { requestId: res.requestId } : undefined;
  if (res.finishReason === "MAX_TOKENS") return err<ProviderError>({ kind: "protocol", retryable: true, cause: "truncated", meta });
  if (res.finishReason === "SAFETY" || res.finishReason === "PROHIBITED_CONTENT") return err<ProviderError>({ kind: "refused", retryable: false, meta });
  const calls = res.functionCalls ?? [];
  if (calls.length === 0) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  if (calls.length > 1) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "multiple_tool_calls", meta });
  if (calls[0]!.name !== TOOL_NAME) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "wrong_tool", meta });
  const parsed = dialogueToolOutputSchema.safeParse(calls[0]!.args);
  if (!parsed.success) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta });
  const u = res.usage;
  return ok<DialogueProviderResult>({
    speaker: request.speakerId, text: parsed.data.text, choices: [], proposedClaims: parsed.data.proposedClaims,
    ...(u ? { usage: { inputTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0,
      ...(u.cachedContentTokenCount !== undefined ? { cacheReadTokens: u.cachedContentTokenCount } : {}) } } : {}),
    providerMeta: { provider: "google", model, ...(res.requestId ? { requestId: res.requestId } : {}) },
  });
}

function classifyGeminiFailure(f: GeminiTransportFailure): ProviderError {
  const meta = { ...(f.requestId ? { requestId: f.requestId } : {}), ...(f.status ? { statusCode: f.status } : {}) };
  if (f.kind === "offline") return { kind: "offline", retryable: false, meta };
  if (f.kind === "network") return { kind: "transport", retryable: true, cause: "network", meta };
  switch (f.status) {
    case 400: return { kind: "config", retryable: false, cause: "invalid_request", meta };
    case 401: case 403: return { kind: "config", retryable: false, cause: "auth", meta };
    case 404: return { kind: "config", retryable: false, cause: "model_not_found", meta };
    case 429: return { kind: "transport", retryable: true, cause: "rate_limit", meta: { ...meta, ...(f.retryAfterMs ? { retryAfterMs: f.retryAfterMs } : {}) } };
    default:
      if (typeof f.status === "number" && f.status >= 500) return { kind: "transport", retryable: true, cause: "5xx", meta };
      if (typeof f.status === "number" && f.status >= 400) return { kind: "config", retryable: false, cause: "invalid_request", meta };
      return { kind: "transport", retryable: true, cause: "network", meta };
  }
}
```

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/providers/geminiProvider.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/providers/geminiProvider.ts src/engine/dialogue/providers/geminiProvider.test.ts
git commit -m "feat(dialogue): Google/Gemini provider + JSON-schema sanitizer"
```

### Task 1.5: SDK transports + wire `remoteProvider`

**Files:**
- Create: `server/llm/openaiSdkTransport.ts`, `server/llm/geminiSdkTransport.ts`
- Modify: `src/engine/dialogue/providers/remoteProvider.ts`
- Test: `src/engine/dialogue/providers/remoteProvider.test.ts` (extend or add)

**Interfaces:**
- Consumes: `createOpenAIProvider`, `createGeminiProvider`, `OpenAITransport`, `GeminiTransport`.
- Produces: `createOpenAISdkTransport(apiKey): OpenAITransport`, `createGeminiSdkTransport(apiKey): GeminiTransport`. `createDialogueProvider` accepts `transport?: AnthropicTransport | OpenAITransport | GeminiTransport` and routes by `model.provider`.

- [ ] **Step 1: Write the failing test** — `remoteProvider` returns a generative (not `not_configured`) provider for openai/google when a transport is supplied.

```ts
import { describe, it, expect } from "vitest";
import { createDialogueProvider } from "./remoteProvider";
import { ok } from "../../infra/result";

it("wires openai when transport supplied", () => {
  const p = createDialogueProvider({ model: { provider: "openai", model: "gpt-x" }, transport: { send: async () => ok({ message: { finish_reason: "tool_calls", tool_calls: [] } }) } as any });
  expect(p.id).toContain("openai");
  expect(p.kind).toBe("generative");
});
it("wires google when transport supplied", () => {
  const p = createDialogueProvider({ model: { provider: "google", model: "gemini-x" }, transport: { send: async () => ok({ functionCalls: [] }) } as any });
  expect(p.id).toContain("google");
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/engine/dialogue/providers/remoteProvider.test.ts` → FAIL.

- [ ] **Step 3: Implement**

`openaiSdkTransport.ts` (uses `openai` SDK `chat.completions.create`, maps SDK errors to `OpenAITransportFailure` mirroring `anthropicSdkTransport`'s try/catch; read `choices[0].finish_reason`, `choices[0].message.tool_calls`, `usage`, `response._request_id`):

```ts
import OpenAI from "openai";
import { ok, err, type Result } from "../../src/engine/infra/result";
import type { OpenAITransport, OpenAIRequestPayload, OpenAITransportResult, OpenAITransportFailure } from "../../src/engine/dialogue/providers/openaiProvider";

export function createOpenAISdkTransport(apiKey: string): OpenAITransport {
  const client = new OpenAI({ apiKey });
  return {
    async send(p: OpenAIRequestPayload, opts): Promise<Result<OpenAITransportResult, OpenAITransportFailure>> {
      try {
        const resp = await client.chat.completions.create({
          model: p.model, max_tokens: p.max_tokens, messages: p.messages as any,
          tools: p.tools as any, tool_choice: p.tool_choice as any,
        }, { signal: opts?.signal });
        const choice = resp.choices[0];
        return ok({ message: {
          finish_reason: choice?.finish_reason ?? "stop",
          tool_calls: (choice?.message.tool_calls ?? []).map((t: any) => ({ function: { name: t.function.name, arguments: t.function.arguments } })),
          usage: resp.usage ? { prompt_tokens: resp.usage.prompt_tokens, completion_tokens: resp.usage.completion_tokens,
            prompt_tokens_details: (resp.usage as any).prompt_tokens_details } : undefined,
        }, requestId: (resp as any)._request_id ?? undefined });
      } catch (e: any) {
        if (e instanceof OpenAI.APIUserAbortError) return err({ kind: "network", message: "aborted" });
        if (e instanceof OpenAI.APIConnectionTimeoutError) return err({ kind: "network", message: "timeout" });
        if (e instanceof OpenAI.APIConnectionError) return err({ kind: "network", message: e.message });
        if (e instanceof OpenAI.APIError) return err({ kind: "http", status: e.status, requestId: e.request_id ?? undefined });
        return err({ kind: "network", message: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
```

`geminiSdkTransport.ts` (uses `@google/genai` `models.generateContent` with `config.tools` + `toolConfig.functionCallingConfig.mode = ANY` + `allowedFunctionNames`; read `response.functionCalls`, `response.candidates[0].finishReason`, `response.usageMetadata`):

```ts
import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import { ok, err, type Result } from "../../src/engine/infra/result";
import type { GeminiTransport, GeminiRequestPayload, GeminiTransportResult, GeminiTransportFailure } from "../../src/engine/dialogue/providers/geminiProvider";

export function createGeminiSdkTransport(apiKey: string): GeminiTransport {
  const ai = new GoogleGenAI({ apiKey });
  return {
    async send(p: GeminiRequestPayload, opts): Promise<Result<GeminiTransportResult, GeminiTransportFailure>> {
      try {
        const resp = await ai.models.generateContent({
          model: p.model,
          contents: p.contents,
          config: {
            systemInstruction: p.systemInstruction,
            maxOutputTokens: p.maxOutputTokens,
            tools: [{ functionDeclarations: [p.functionDeclaration as any] }],
            toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [p.functionDeclaration.name] } },
          },
        }, { abortSignal: opts?.signal } as any);
        return ok({
          functionCalls: (resp.functionCalls ?? []).map((c: any) => ({ name: c.name, args: c.args })),
          finishReason: resp.candidates?.[0]?.finishReason,
          usage: resp.usageMetadata ? { promptTokenCount: resp.usageMetadata.promptTokenCount,
            candidatesTokenCount: resp.usageMetadata.candidatesTokenCount, cachedContentTokenCount: resp.usageMetadata.cachedContentTokenCount } : undefined,
        });
      } catch (e: any) {
        const status = typeof e?.status === "number" ? e.status : undefined;
        if (status) return err({ kind: "http", status });
        return err({ kind: "network", message: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}
```

> **SDK field verification note:** before committing, confirm against installed SDK types the exact field names (`prompt_tokens_details`, `_request_id`, `usageMetadata.cachedContentTokenCount`, `FunctionCallingConfigMode`). Adjust the transport (NOT the provider) if a name differs — the provider interface is the stable contract.

In `remoteProvider.ts`, widen the transport type and add cases:
```ts
import { createOpenAIProvider, type OpenAITransport } from "./openaiProvider";
import { createGeminiProvider, type GeminiTransport } from "./geminiProvider";
// ...
export function createDialogueProvider(config: { model: ModelRef; transport?: AnthropicTransport | OpenAITransport | GeminiTransport }): DialogueProvider {
  const id = `remote:${config.model.provider}:${config.model.model}`;
  switch (config.model.provider) {
    case "anthropic": return config.transport ? createAnthropicProvider({ model: config.model.model, transport: config.transport as AnthropicTransport }) : notConfigured(id);
    case "openai": return config.transport ? createOpenAIProvider({ model: config.model.model, transport: config.transport as OpenAITransport }) : notConfigured(id);
    case "google": return config.transport ? createGeminiProvider({ model: config.model.model, transport: config.transport as GeminiTransport }) : notConfigured(id);
    default: return notConfigured(id);
  }
}
```

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/providers/remoteProvider.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add server/llm/openaiSdkTransport.ts server/llm/geminiSdkTransport.ts src/engine/dialogue/providers/remoteProvider.ts src/engine/dialogue/providers/remoteProvider.test.ts
git commit -m "feat(llm): OpenAI + Gemini SDK transports, wire remoteProvider"
```

### Task 1.6: Add deps; wire `eval-run` provider switch + `gemini` alias; smoke scripts

**Files:**
- Modify: `package.json` (deps + scripts), `tools/eval-run.ts`
- Create: `tools/smoke-openai.ts`, `tools/smoke-gemini.ts`

**Interfaces:**
- Consumes: `createOpenAISdkTransport`, `createGeminiSdkTransport`, `createDialogueProvider`.
- Produces: `eval:run --provider openai|google|gemini`; `smoke:openai`, `smoke:gemini` scripts.

- [ ] **Step 1: Add dependencies**

Run: `npm install openai @google/genai`
Expected: both added to `dependencies`; lockfile updated; `npm test` baseline still green.

- [ ] **Step 2: Implement eval-run changes**

In `parseArgs`, broaden the provider type and normalize alias:
```ts
let provider = flag("--provider");
if (provider === "gemini") provider = "google"; // CLI alias → vendor name
if (!["anthropic", "openai", "google", "fixture"].includes(provider ?? "")) {
  console.error(`Error: --provider must be anthropic|openai|google|gemini|fixture, got: ${provider ?? "(missing)"}`);
  process.exit(1);
}
```
Add builders mirroring `buildAnthropicProvider`:
```ts
async function buildOnlineProvider(providerName: "anthropic" | "openai" | "google", model: string) {
  const { createDialogueProvider } = await import(path.join(PROJECT_ROOT, "src/engine/dialogue/providers/remoteProvider.ts")) as typeof import("../src/engine/dialogue/providers/remoteProvider");
  if (providerName === "anthropic") {
    const apiKey = requireKey("ANTHROPIC_API_KEY", "anthropic");
    const { createSdkAnthropicTransport } = await import(path.join(PROJECT_ROOT, "server/llm/anthropicSdkTransport.ts")) as any;
    return createDialogueProvider({ model: { provider: "anthropic", model }, transport: createSdkAnthropicTransport(apiKey) });
  }
  if (providerName === "openai") {
    const apiKey = requireKey("OPENAI_API_KEY", "openai");
    const { createOpenAISdkTransport } = await import(path.join(PROJECT_ROOT, "server/llm/openaiSdkTransport.ts")) as any;
    return createDialogueProvider({ model: { provider: "openai", model }, transport: createOpenAISdkTransport(apiKey) });
  }
  const apiKey = requireKey("GEMINI_API_KEY", "google");
  const { createGeminiSdkTransport } = await import(path.join(PROJECT_ROOT, "server/llm/geminiSdkTransport.ts")) as any;
  return createDialogueProvider({ model: { provider: "google", model }, transport: createGeminiSdkTransport(apiKey) });
}
function requireKey(env: string, name: string): string {
  const v = process.env[env];
  if (!v) { console.error(`Error: ${env} environment variable is required for --provider ${name}`); process.exit(1); }
  return v;
}
```
Replace the `buildAnthropicProvider(model!)` call and the `runEvalScenarioWithProvider(..., model!, "online")` call so they pass the chosen `providerName` (8th-arg `mode="online"`, 9th-arg `provider=providerName`). The fixture branch is unchanged.

- [ ] **Step 3: Implement smoke scripts**

`tools/smoke-openai.ts` and `tools/smoke-gemini.ts` mirror `tools/smoke-anthropic.ts`, but build the transport from the SDK transport + env key (no relay needed) and use `createDialogueProvider`. Header comment: `OPENAI_API_KEY=... npm run smoke:openai` / `GEMINI_API_KEY=... npm run smoke:gemini`. Reuse the same `DialogueRequest` literal (import `makeDialogueRequest` from `tests/helpers/dialogueRequest.ts`).

In `package.json` scripts add:
```json
"smoke:openai": "tsx tools/smoke-openai.ts",
"smoke:gemini": "tsx tools/smoke-gemini.ts",
```

- [ ] **Step 4: Verify** — Run: `npm run typecheck && npx vitest run` → typecheck clean, full suite green. (Live smoke is manual, not run here.)
- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tools/eval-run.ts tools/smoke-openai.ts tools/smoke-gemini.ts
git commit -m "feat(eval): eval-run multi-provider switch + gemini alias + smoke scripts"
```

### PR1 wrap-up

- [ ] Run full suite: `npm run typecheck && npx vitest run` → green.
- [ ] Push branch, open PR titled `feat: multi-provider dialogue eval (OpenAI + Gemini)`. PR body lists files, the manual smoke commands, and "no CI network".

---

## PR 2 — Pricing, metric aggregation, canonical-JSON scorecard

### Task 2.1: Pricing module

**Files:**
- Create: `src/engine/dialogue/eval/pricing.ts`
- Test: `src/engine/dialogue/eval/pricing.test.ts`

**Interfaces:**
- Produces:
  - `type ModelPricing = { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok?: number; cacheCreationPerMTok?: number }`
  - `type PriceTable = Record<string, ModelPricing>` keyed `"<provider>:<model>"`
  - `DEFAULT_PRICE_TABLE: PriceTable`
  - `costForUsage(key: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number } | undefined, table?: PriceTable): number | undefined`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { costForUsage, DEFAULT_PRICE_TABLE } from "./pricing";

describe("costForUsage", () => {
  it("computes cost from input/output per-MTok", () => {
    const table = { "openai:gpt-x": { inputPerMTok: 1, outputPerMTok: 2 } };
    expect(costForUsage("openai:gpt-x", { inputTokens: 1_000_000, outputTokens: 500_000 }, table)).toBeCloseTo(1 + 1);
  });
  it("returns undefined for unknown model", () => {
    expect(costForUsage("x:y", { inputTokens: 10, outputTokens: 10 }, {})).toBeUndefined();
  });
  it("returns undefined when usage missing", () => {
    expect(costForUsage("openai:gpt-x", undefined, { "openai:gpt-x": { inputPerMTok: 1, outputPerMTok: 1 } })).toBeUndefined();
  });
  it("uses cacheReadPerMTok for cached tokens when present", () => {
    const table = { "anthropic:c": { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3 } };
    const c = costForUsage("anthropic:c", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000 }, table)!;
    expect(c).toBeCloseTo(3 + 0.3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/engine/dialogue/eval/pricing.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `pricing.ts`

```ts
export interface ModelPricing { inputPerMTok: number; outputPerMTok: number; cacheReadPerMTok?: number; cacheCreationPerMTok?: number; }
export type PriceTable = Record<string, ModelPricing>;

// USD per 1M tokens. Editable; update here without touching scoring/report code.
export const DEFAULT_PRICE_TABLE: PriceTable = {
  "anthropic:claude-haiku-4-5-20251001": { inputPerMTok: 1.0, outputPerMTok: 5.0, cacheReadPerMTok: 0.1 },
  // add models as needed — unknown keys yield undefined cost (rendered n/a)
};

export function costForUsage(
  key: string,
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number } | undefined,
  table: PriceTable = DEFAULT_PRICE_TABLE,
): number | undefined {
  const p = table[key];
  if (!p || !usage) return undefined;
  const M = 1_000_000;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheCreate = usage.cacheCreationTokens ?? 0;
  const plainInput = Math.max(0, usage.inputTokens - cacheRead);
  return (
    (plainInput * p.inputPerMTok +
      usage.outputTokens * p.outputPerMTok +
      cacheRead * (p.cacheReadPerMTok ?? p.inputPerMTok) +
      cacheCreate * (p.cacheCreationPerMTok ?? p.inputPerMTok)) / M
  );
}
```

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/eval/pricing.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/eval/pricing.ts src/engine/dialogue/eval/pricing.test.ts
git commit -m "feat(eval): external editable pricing table + costForUsage"
```

### Task 2.2: Extend `ScoreReport` / `scoreResults`

**Files:**
- Modify: `src/engine/dialogue/eval/scoring.ts`
- Test: `src/engine/dialogue/eval/scoring.test.ts` (extend)

**Interfaces:**
- Consumes: `costForUsage`, `PriceTable`, `GateId` (from `../gates`).
- Produces: `ScoreReport` gains `avgLatencyMs, p95LatencyMs, totalInputTokens, totalOutputTokens, estCostUsd?: number, loreViolationRate, gateViolationsByType: Record<string, number>`. `scoreResults(results, opts?: { priceTable?: PriceTable })`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { scoreResults } from "./scoring";
import type { EvalResult } from "./types";

function r(over: Partial<EvalResult>): EvalResult {
  return { scenarioId: "s", runId: "s-r0", runIndex: 0, fixtureId: "f", model: "m", provider: "openai", speakerId: "x",
    mode: "online", schemaStatus: "pass", gateStatus: "pass", claimFindings: [], textFindings: [],
    expectationStatus: "pass", expectationFindings: [], durationMs: 100, ...over } as EvalResult;
}

describe("scoreResults metrics", () => {
  it("aggregates latency, tokens, lore violations, byType", () => {
    const results = [
      r({ durationMs: 100, usage: { inputTokens: 10, outputTokens: 5 }, textFindings: [{ gate: "forbidden_lexicon", severity: "reject", matched: "皇上" }] }),
      r({ durationMs: 300, usage: { inputTokens: 20, outputTokens: 7 }, textFindings: [{ gate: "rank_title", severity: "flag", matched: "x" }] }),
    ];
    const rep = scoreResults(results, { priceTable: { "openai:m": { inputPerMTok: 1, outputPerMTok: 1 } } });
    expect(rep.avgLatencyMs).toBe(200);
    expect(rep.p95LatencyMs).toBe(300);
    expect(rep.totalInputTokens).toBe(30);
    expect(rep.totalOutputTokens).toBe(12);
    expect(rep.loreViolationRate).toBeCloseTo(0.5); // one of two has forbidden_lexicon
    expect(rep.gateViolationsByType).toMatchObject({ forbidden_lexicon: 1, rank_title: 1 });
    expect(rep.estCostUsd).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/engine/dialogue/eval/scoring.test.ts` → FAIL.

- [ ] **Step 3: Implement** — add to `ScoreReport` interface and to `scoreResults`. `p95` = value at `Math.ceil(0.95*n)-1` of ascending-sorted `durationMs`. `loreViolationRate` = share of results with any `textFindings.gate === "forbidden_lexicon"`. `gateViolationsByType` = count of all `textFindings` by `gate`. `estCostUsd` = sum of `costForUsage(`${r.provider}:${r.model}`, r.usage, table)`; if every result is unpriced (all `undefined`), report `undefined`, else sum the defined ones.

```ts
import { costForUsage, type PriceTable } from "./pricing";
// ScoreReport += avgLatencyMs, p95LatencyMs, totalInputTokens, totalOutputTokens, estCostUsd?, loreViolationRate, gateViolationsByType
export function scoreResults(results: EvalResult[], opts?: { priceTable?: PriceTable }): ScoreReport {
  // ...keep existing fields...
  const latencies = results.map((x) => x.durationMs).sort((a, b) => a - b);
  const avgLatencyMs = latencies.length ? latencies.reduce((s, x) => s + x, 0) / latencies.length : 0;
  const p95LatencyMs = latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(0.95 * latencies.length) - 1)]! : 0;
  let totalInputTokens = 0, totalOutputTokens = 0;
  for (const x of results) { totalInputTokens += x.usage?.inputTokens ?? 0; totalOutputTokens += x.usage?.outputTokens ?? 0; }
  const loreHits = results.filter((x) => x.textFindings.some((f) => f.gate === "forbidden_lexicon")).length;
  const gateViolationsByType: Record<string, number> = {};
  for (const x of results) for (const f of x.textFindings) gateViolationsByType[f.gate] = (gateViolationsByType[f.gate] ?? 0) + 1;
  const costs = results.map((x) => costForUsage(`${x.provider}:${x.model}`, x.usage, opts?.priceTable)).filter((c): c is number => c !== undefined);
  const estCostUsd = costs.length ? costs.reduce((s, c) => s + c, 0) : undefined;
  return { /* existing fields */ avgLatencyMs, p95LatencyMs, totalInputTokens, totalOutputTokens, estCostUsd, loreViolationRate: results.length ? loreHits / results.length : 0, gateViolationsByType };
}
```

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/eval/scoring.test.ts` → PASS (existing scoring tests still green).
- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/eval/scoring.ts src/engine/dialogue/eval/scoring.test.ts
git commit -m "feat(eval): aggregate latency/tokens/cost/lore + gateViolationsByType"
```

### Task 2.3: Canonical-JSON scorecard report (metric columns)

**Files:**
- Create: `tools/eval-report.ts`, `src/engine/dialogue/eval/report.ts` (pure builder)
- Test: `src/engine/dialogue/eval/report.test.ts`
- Modify: `package.json` (`eval:report` script)

**Interfaces:**
- Produces:
  - `buildScorecard(byModel: { provider: string; model: string; results: EvalResult[] }[], opts?: { priceTable?: PriceTable }): ScorecardRow[]`
  - `ScorecardRow = { provider; model; runCount; schemaPassRate; gatePassRate; expectationPassRate; loreViolationRate; gateViolationsByType; characterProxyScore: number | null; styleProxyScore: number | null; avgLatencyMs; p95LatencyMs; totalInputTokens; totalOutputTokens; estCostUsd: number | null }`
  - `scorecardToMarkdown(rows: ScorecardRow[]): string`, `scorecardToTsv(rows: ScorecardRow[]): string`
  - `characterProxyScore`/`styleProxyScore` are `null` in PR2 (populated in PR3).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildScorecard, scorecardToMarkdown, scorecardToTsv } from "./report";
import type { EvalResult } from "./types";

const base: Omit<EvalResult, "model" | "provider"> = { scenarioId: "s", runId: "s-r0", runIndex: 0, fixtureId: "f", speakerId: "x",
  mode: "online", schemaStatus: "pass", gateStatus: "pass", claimFindings: [], textFindings: [], expectationStatus: "pass",
  expectationFindings: [], durationMs: 100, usage: { inputTokens: 10, outputTokens: 5 } } as any;

describe("buildScorecard", () => {
  it("emits one row per model with proxy fields null", () => {
    const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results: [{ ...base, model: "gpt-x", provider: "openai" } as EvalResult] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "openai", model: "gpt-x", runCount: 1, characterProxyScore: null, styleProxyScore: null });
  });
  it("markdown and tsv derive from rows (same model names)", () => {
    const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results: [{ ...base, model: "gpt-x", provider: "openai" } as EvalResult] }]);
    expect(scorecardToMarkdown(rows)).toContain("gpt-x");
    expect(scorecardToTsv(rows).split("\n")[0]).toContain("model");
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/engine/dialogue/eval/report.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `report.ts`: `buildScorecard` calls `scoreResults(group.results, opts)` per group and maps into `ScorecardRow` (proxy fields `null`, `estCostUsd ?? null`). `scorecardToMarkdown` renders a GFM table from a fixed column list; `scorecardToTsv` renders the same columns tab-separated with a header row. Both consume `ScorecardRow[]` only (derived from JSON).

`tools/eval-report.ts`: parse `--input a.jsonl b.jsonl ...` and `--output-dir`. For each file, load `EvalResult[]`, derive `{ provider, model }` from the first record. Call `buildScorecard`, then write `scorecard.json` (canonical), `scorecard.md`, `scorecard.tsv` (derived from the same `rows`). Reuse the JSONL loader pattern from `tools/eval-score.ts`.

In `package.json`: `"eval:report": "tsx tools/eval-report.ts"`.

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/eval/report.test.ts && npm run typecheck` → PASS/clean.
- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/eval/report.ts src/engine/dialogue/eval/report.test.ts tools/eval-report.ts package.json
git commit -m "feat(eval): canonical-JSON multi-model scorecard + derived md/tsv"
```

### PR2 wrap-up

- [ ] `npm run typecheck && npx vitest run` → green.
- [ ] Push, open PR `feat: eval pricing + metric aggregation + multi-model scorecard`.

---

## PR 3 — Deterministic proxy scorers

### Task 3.1: Style lexicon (anachronism + register markers)

**Files:**
- Create: `src/engine/dialogue/eval/styleLexicon.ts`
- Test: `src/engine/dialogue/eval/styleLexicon.test.ts`

**Interfaces:**
- Produces:
  - `ANACHRONISM_TERMS: string[]` (eval-only modern-word list; separate from game `content/lexicon.json`)
  - `REGISTER_MARKERS: Record<"formal"|"casual"|"rough"|"poetic", { expected: string[]; incongruent: string[] }>`
  - `findAnachronisms(text: string): string[]`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { findAnachronisms, ANACHRONISM_TERMS, REGISTER_MARKERS } from "./styleLexicon";

it("flags modern terms", () => {
  expect(findAnachronisms("臣妾打开手机看了下系统")).toEqual(expect.arrayContaining(["手机", "系统"]));
});
it("clean classical line has no anachronisms", () => {
  expect(findAnachronisms("臣妾参见陛下，万福金安。")).toEqual([]);
});
it("exposes register tables for all four registers", () => {
  expect(Object.keys(REGISTER_MARKERS).sort()).toEqual(["casual", "formal", "poetic", "rough"]);
  expect(ANACHRONISM_TERMS.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/engine/dialogue/eval/styleLexicon.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `styleLexicon.ts`

```ts
// Eval-only heuristics. NOT world lore — game lexicon lives in content/lexicon.json.
export const ANACHRONISM_TERMS: string[] = [
  "手机", "电话", "电脑", "系统", "项目", "网络", "OK", "搞定", "数据", "信息化",
  "现代", "科技", "互联网", "视频", "拍照", "上线", "下线", "用户", "客户", "流量",
];
export const REGISTER_MARKERS: Record<"formal" | "casual" | "rough" | "poetic", { expected: string[]; incongruent: string[] }> = {
  formal: { expected: ["谨", "敢", "万福", "恭", "请安"], incongruent: ["哈哈", "啦", "呗", "搞"] },
  casual: { expected: ["呀", "呢", "嘛"], incongruent: ["谨此", "伏惟", "顿首"] },
  rough: { expected: ["哼", "罢了", "少来"], incongruent: ["万福金安", "谨此"] },
  poetic: { expected: ["如", "似", "恰", "宛", "曾经"], incongruent: ["搞定", "OK"] },
};
export function findAnachronisms(text: string): string[] {
  return ANACHRONISM_TERMS.filter((t) => text.includes(t));
}
```

> Term lists are heuristic; tuning them is expected and is isolated to this file. They never affect game runtime.

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/eval/styleLexicon.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/eval/styleLexicon.ts src/engine/dialogue/eval/styleLexicon.test.ts
git commit -m "feat(eval): style lexicon (anachronisms + register markers)"
```

### Task 3.2: `consistencyProxy` scorers

**Files:**
- Create: `src/engine/dialogue/eval/consistencyProxy.ts`
- Test: `src/engine/dialogue/eval/consistencyProxy.test.ts`

**Interfaces:**
- Consumes: `EvalResult`, `CharacterContent` (`profile`, `voice`, `selfRefs`), `findAnachronisms`, `REGISTER_MARKERS`.
- Produces:
  - `type Signal = { name: string; weight: number; value: number /*0..1*/; evidence: string }`
  - `type ProxyScore = { score: number; signals: Signal[] }`
  - `interface SpeakerProfile { selfRefs: string[]; addressTerm: string; quirkLexemes: string[]; tabooTopics: string[]; register: "formal"|"casual"|"rough"|"poetic" }`
  - `characterProxyScore(resultsForSpeaker: EvalResult[], profile: SpeakerProfile): ProxyScore`
  - `styleProxyScore(resultsForSpeaker: EvalResult[], profile: SpeakerProfile): ProxyScore`
  - `extractQuirkLexemes(quirks: string[]): string[]` — pulls `『…』`-quoted lexemes from quirks (only quirks with a quoted token are checkable; others are ignored, never penalized).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { characterProxyScore, styleProxyScore, extractQuirkLexemes } from "./consistencyProxy";
import type { EvalResult } from "./types";

function res(text: string, findings: { gate: string }[] = []): EvalResult {
  return { scenarioId: "s", runId: "s-r0", runIndex: 0, fixtureId: "f", model: "m", provider: "p", speakerId: "lu_huaijin",
    mode: "online", schemaStatus: "pass", gateStatus: "pass", claimFindings: [],
    textFindings: findings.map((f) => ({ gate: f.gate, severity: "reject", matched: "x" })),
    expectationStatus: "pass", expectationFindings: [], durationMs: 100, text } as EvalResult;
}
const profile = { selfRefs: ["侍身"], addressTerm: "陛下", quirkLexemes: ["侍身", "陛下"], tabooTopics: ["家中来信"], register: "poetic" as const };

it("extractQuirkLexemes pulls quoted tokens only", () => {
  expect(extractQuirkLexemes(["自称『侍身』", "称玩家『陛下』", "失落时偶尔脱口而出『曾经』"])).toEqual(["侍身", "陛下", "曾经"]);
  expect(extractQuirkLexemes(["语调轻软"])).toEqual([]);
});

it("character proxy: clean in-character line scores high; gate-flagged line scores lower", () => {
  const good = characterProxyScore([res("侍身参见陛下。")], profile).score;
  const bad = characterProxyScore([res("臣参见皇上。", [{ gate: "self_ref" }, { gate: "rank_title" }])], profile).score;
  expect(good).toBeGreaterThan(bad);
});

it("style proxy: anachronism lowers score", () => {
  const clean = styleProxyScore([res("侍身如约而来。")], profile).score;
  const modern = styleProxyScore([res("侍身打开手机。")], profile).score;
  expect(clean).toBeGreaterThan(modern);
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/engine/dialogue/eval/consistencyProxy.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `consistencyProxy.ts`. Signals are pure functions over `text`/`textFindings`. `score` = weighted average of signal `value`s (weights sum to 1). Naming MUST stay `characterProxyScore`/`styleProxyScore`.

`characterProxyScore` signals (weights): self-ref correctness 0.3 (1 if no `self_ref` finding AND ≥1 own `selfRefs` token appears across the speaker's lines; else 0); address correctness 0.2 (1 if no `rank_title` finding); quirk adherence 0.2 (fraction of `quirkLexemes` that appear in at least one line — if `quirkLexemes` empty → value 1, marked not_scorable in evidence); taboo avoidance 0.15 (1 if no `tabooTopics` substring in any line); cross-scenario stability 0.15 (1 minus normalized variance of per-line self-ref presence across `resultsForSpeaker`; single line → 1).

`styleProxyScore` signals: anachronism absence 0.5 (1 if `findAnachronisms` empty across lines, else `1 - min(1, hits/lines)`); register congruence 0.3 (expected-marker presence minus incongruent-marker presence, clamped 0..1, using `REGISTER_MARKERS[profile.register]`); length appropriateness 0.2 (1 if mean line length within 8..120 chars, else linearly penalized).

Each signal returns a `Signal` with `evidence` (e.g. matched anachronisms, missing quirk lexemes). Provide `extractQuirkLexemes` using regex `/『([^』]+)』/g`.

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/eval/consistencyProxy.test.ts` → PASS
- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/eval/consistencyProxy.ts src/engine/dialogue/eval/consistencyProxy.test.ts
git commit -m "feat(eval): deterministic characterProxyScore + styleProxyScore"
```

### Task 3.3: Wire proxy scores into the scorecard

**Files:**
- Modify: `src/engine/dialogue/eval/report.ts` (accept per-speaker profiles + populate proxy fields)
- Modify: `tools/eval-report.ts` (load `ContentDB`, build `SpeakerProfile` per `speakerId`, group results by speaker)
- Test: `src/engine/dialogue/eval/report.test.ts` (extend)

**Interfaces:**
- Consumes: `characterProxyScore`, `styleProxyScore`, `SpeakerProfile`, `loadRealContent` (CLI only).
- Produces: `buildScorecard(byModel, opts?: { priceTable?; profiles?: Record<string, SpeakerProfile> })`. When `profiles` present, each row's `characterProxyScore`/`styleProxyScore` = mean across that model's speakers (each speaker scored on its own lines); else `null`.

- [ ] **Step 1: Write the failing test** — extend `report.test.ts`:

```ts
it("populates proxy scores when profiles supplied", () => {
  const profiles = { lu_huaijin: { selfRefs: ["侍身"], addressTerm: "陛下", quirkLexemes: ["侍身"], tabooTopics: [], register: "poetic" as const } };
  const results = [{ ...base, model: "gpt-x", provider: "openai", speakerId: "lu_huaijin", text: "侍身参见陛下。" } as any];
  const rows = buildScorecard([{ provider: "openai", model: "gpt-x", results }], { profiles });
  expect(typeof rows[0]!.characterProxyScore).toBe("number");
  expect(typeof rows[0]!.styleProxyScore).toBe("number");
});
```

- [ ] **Step 2: Run test to verify it fails** — Run: `npx vitest run src/engine/dialogue/eval/report.test.ts` → FAIL.

- [ ] **Step 3: Implement** — In `buildScorecard`, when `opts.profiles` present: group `group.results` by `speakerId`; for each speaker with a known profile compute `characterProxyScore`/`styleProxyScore` over its lines; row value = mean of speaker scores (ignore speakers without a profile). Keep `null` when no profiles. In `tools/eval-report.ts`: `const db = loadRealContent();` then build `SpeakerProfile` per character: `selfRefs` = `db.ranks[char.initialStanding.rank]?.selfRefs` flattened (or `char.selfRefs`), `addressTerm = "陛下"`, `quirkLexemes = extractQuirkLexemes(char.voice.quirks)`, `tabooTopics = char.voice.tabooTopics`, `register = char.voice.register`. Pass `{ priceTable: DEFAULT_PRICE_TABLE, profiles }`.

- [ ] **Step 4: Run tests** — Run: `npx vitest run src/engine/dialogue/eval/report.test.ts && npm run typecheck` → PASS/clean.
- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/eval/report.ts tools/eval-report.ts src/engine/dialogue/eval/report.test.ts
git commit -m "feat(eval): populate characterProxyScore/styleProxyScore in scorecard"
```

### PR3 wrap-up

- [ ] `npm run typecheck && npx vitest run` → green.
- [ ] Push, open PR `feat: deterministic character/style proxy scoring in scorecard`.

---

## Test plan (summary)

| Layer | Tested by | CI |
|---|---|---|
| `runWithDeadline` | unit (ok/timeout/cancel) | ✅ |
| OpenAI/Gemini providers | unit w/ injected transport: parse, schema_invalid, no_tool_call, error mapping | ✅ |
| `sanitizeJsonSchemaForGemini` | unit (strips keys, deep) | ✅ |
| SDK transports | typecheck + manual smoke (`smoke:openai`, `smoke:gemini`) | typecheck only |
| `costForUsage` | unit (math, unknown, missing usage, cache) | ✅ |
| `scoreResults` extension | unit (latency, p95, totals, lore rate, byType, cost) + existing regression | ✅ |
| `buildScorecard` + md/tsv | unit (rows, derived formats) | ✅ |
| `styleLexicon` | unit (anachronisms, registers) | ✅ |
| `consistencyProxy` | unit (signals, ordering good>bad, quirk extraction) | ✅ |
| Online `eval:run`, end-to-end scorecard | manual w/ API keys | ❌ (manual) |

Each PR ends green on `npm run typecheck && npx vitest run` with the 1238-test baseline intact.

## Self-review notes

- Spec coverage: provider expansion (PR1 1.1–1.6), metrics (PR2 2.1–2.2), report (PR2 2.3 + PR3 3.3), proxy scorers (PR3 3.1–3.2), naming/boundary/pricing-override/canonical-JSON constraints all mapped. Gemini schema verified pre-plan; `sanitizeJsonSchemaForGemini` is the single absorption point.
- Type consistency: `EvalResult` gains `provider`+`speakerId` (1.1) consumed by `scoreResults` (2.2), `buildScorecard` (2.3), and proxy scorers (3.2/3.3). Transport interfaces (`OpenAITransport`/`GeminiTransport`) defined in 1.3/1.4 and consumed in 1.5. `SpeakerProfile`/`ProxyScore` defined in 3.2 consumed in 3.3.
- Failure handling: missing-key exit, missing-usage → undefined cost, schema/protocol → `ProviderError` mapping — all specified per task and summarized in the policy block.

# LLM-1 Anthropic Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dialogue provider stub with a real,厂商无关 contract and a working Anthropic protocol adapter (forced strict tool, fixture-tested, zero live network in CI), without touching the live planner.

**Architecture:** One atomic breaking migration of `DialogueProvider.generate`'s return contract (`DialogueProviderResult` + `ProviderError`), then an `anthropicProvider` built around an **injected transport seam** (`AnthropicTransport.send`) so request-build / response-parse / error-classification are unit-tested with recorded fixtures. `remoteProvider` becomes a facade routing by explicit `ModelRef.provider`. The adapter does ZERO fact/etiquette validation — its parsed result flows through the existing `claim gate → text gate → mention writeback` unchanged.

**Tech Stack:** TypeScript, Zod 4, Vitest. **No `@anthropic-ai/sdk` in this PR** — the real SDK transport belongs in a relay/native layer and is a separate small PR (see Global Constraints).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-06-21-llm-dialogue-provider-design.md`. Every decision below is from it.
- Determinism in tests: no real network, no `Math.random()`. Anthropic calls go through an injected `AnthropicTransport`; tests pass recorded fixtures.
- **The model never produces choices in v1.** `DialogueToolOutput` has NO `choices` field; the tool schema cannot express choices, so an out-of-bounds option is a schema error, not a silent drop. The adapter fixes `choices: []`.
- **`speaker` is derived by the adapter from `request.speakerId`** — never trusted from model output. `usage`/`providerMeta`/`requestId` are adapter-supplied from the transport envelope.
- **Tool schema derives only from `DialogueToolOutput`** (`dialogueToolOutputSchema`), never from `DialogueProviderResult`; it must exclude `speaker`/`expression`/`choices`/`usage`/`providerMeta` and set `additionalProperties: false`.
- **No behavior regression in the scripted/mock path.** Migration acceptance = "mock/scripted behavior unchanged, only the carried type changes" — NOT "whatever current tests happen to assert". Authored `expression` (and any authored choices) must survive; `expression?` rides on `DialogueProviderResult` but NOT on `DialogueToolOutput`.
- **Relay boundary:** `src/engine/dialogue/` keeps only the `AnthropicTransport` interface. NO SDK import, NO `new Anthropic()`, NO key handling in engine/renderer code. The real SDK transport (relay/native layer) and a `resolveCredential` are a **separate PR**, not LLM-1. No dead `apiKeyRef` parameter that looks safe but does nothing.
- `ProviderError` must not leak into the engine: convert at the orchestrator boundary via `mapProviderErrorToGameError`.
- Breaking migration is pre-release ([[no-save-backcompat]]); migrate ALL consumers in one commit, full suite green.
- Logs store only error classification + `requestId`; never API key or full prompt.
- Adapter performs no fact/etiquette/claim validation — delegated to existing `claimGate` + `gates`.
- This PR does NOT wire live `planReaction`/`assembleClaims`/`AuthorizedClaim`/`ContextRef`/`claim_not_allowed`/`factKey`/polarity/`choiceCandidates` — those are LLM-3. Full prompt compiler + caching is LLM-2.
- `batch` capability is `false` in LLM-1 (no batch executor here); LLM-2 flips it. `capabilities` describes what THIS adapter implements, not vendor potential.

---

### Task 1: Provider contract types + tool-output schema (additive)

Introduce the new types and the single-source tool-output schema **alongside** the existing contract (no behavior flipped yet).

**Files:**
- Create: `src/engine/dialogue/providerContract.ts`
- Test: `tests/dialogue/providerContract.test.ts`

**Interfaces:**
- Consumes: `proposedClaimSchema`, `ProposedClaim` from `./claims`; `Result` from `../infra/result`.
- Produces: `DialogueToolOutput`, `RenderedDialogueChoice`, `DialogueProviderResult`, `ProviderError`, `ProviderErrorMeta`, `ModelRef`, `ProviderCapabilities`, `ProviderResult<T>`, `dialogueToolOutputSchema`, `dialogueToolOutputJsonSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dialogue/providerContract.test.ts
import { describe, it, expect } from "vitest";
import { dialogueToolOutputSchema, dialogueToolOutputJsonSchema } from "../../src/engine/dialogue/providerContract";

describe("dialogueToolOutputSchema", () => {
  it("accepts minimal output (text only; proposedClaims defaults to [])", () => {
    const r = dialogueToolOutputSchema.safeParse({ text: "本宫累了。" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.proposedClaims).toEqual([]);
  });
  it("rejects empty text", () => {
    expect(dialogueToolOutputSchema.safeParse({ text: "" }).success).toBe(false);
  });
  it("rejects a choices field — the model cannot author player options in v1", () => {
    expect(dialogueToolOutputSchema.safeParse({ text: "嗯。", choices: [{ id: "x", text: "y" }] }).success).toBe(false);
  });
  it("tool JSON schema excludes non-model fields and forbids extras", () => {
    const props = (dialogueToolOutputJsonSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("text");
    expect(props).toHaveProperty("proposedClaims");
    for (const forbidden of ["speaker", "expression", "choices", "usage", "providerMeta"]) {
      expect(props).not.toHaveProperty(forbidden);
    }
    expect((dialogueToolOutputJsonSchema as { additionalProperties: unknown }).additionalProperties).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/providerContract.test.ts`
Expected: FAIL — `Cannot find module './providerContract'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/dialogue/providerContract.ts
import { z } from "zod";
import { proposedClaimSchema, type ProposedClaim } from "./claims";
import type { Result } from "../infra/result";

/** A player-choice option rendered to text. v1: produced by the ENGINE (authored), never the model. */
export interface RenderedDialogueChoice {
  id: string;
  text: string;
  tone?: "friendly" | "neutral" | "guarded" | "hostile" | "flirty";
}

/** EXACTLY the part the model produces via the forced tool. No choices in v1. Tool schema derives only from this. */
export interface DialogueToolOutput {
  text: string;
  proposedClaims: ProposedClaim[];
}

/** Adapter-assembled result: model output + adapter-supplied speaker/expression/usage/providerMeta. */
export interface DialogueProviderResult {
  speaker: string;
  text: string;
  expression?: string;                 // authored by scripted providers; Anthropic omits → neutral fallback
  choices: RenderedDialogueChoice[];    // engine-authored; v1 adapter sets []
  proposedClaims: ProposedClaim[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number };
  providerMeta?: { provider: string; model: string; requestId?: string };
}

export interface ProviderErrorMeta {
  message?: string; statusCode?: number; retryAfterMs?: number; requestId?: string;
}

export type TransportCause = "timeout" | "rate_limit" | "5xx" | "network";
export type ProtocolCause = "no_tool_call" | "wrong_tool" | "schema_invalid" | "truncated" | "multiple_tool_calls" | "pause_turn";
export type ConfigCause = "not_configured" | "auth" | "billing" | "model_not_found" | "request_too_large" | "invalid_request" | "incompatible_schema";

export type ProviderError =
  | { kind: "transport"; retryable: true; cause: TransportCause; meta?: ProviderErrorMeta }
  | { kind: "protocol"; retryable: boolean; cause: ProtocolCause; meta?: ProviderErrorMeta }
  | { kind: "config"; retryable: false; cause: ConfigCause; meta?: ProviderErrorMeta }
  | { kind: "cancelled"; retryable: false; meta?: ProviderErrorMeta }   // caller AbortSignal — never auto-retry
  | { kind: "offline"; retryable: false; meta?: ProviderErrorMeta }
  | { kind: "refused"; retryable: false; meta?: ProviderErrorMeta };    // content policy / stop_reason refusal

export type ProviderResult<T> = Result<T, ProviderError>;

export interface ModelRef { provider: "anthropic" | "openai" | "qwen" | "kimi" | "deepseek"; model: string; }
export interface ProviderCapabilities { strictTools: boolean; promptCaching: boolean; batch: boolean; }

/** SINGLE SOURCE for the forced-tool input schema. No speaker/expression/choices/usage/providerMeta. */
export const dialogueToolOutputSchema = z.strictObject({
  text: z.string().min(1).max(300),
  proposedClaims: z.array(proposedClaimSchema).default([]),
});

export const dialogueToolOutputJsonSchema = z.toJSONSchema(dialogueToolOutputSchema);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dialogue/providerContract.test.ts`
Expected: PASS (4 tests). Zod 4.4.3 ships `z.toJSONSchema`; `z.strictObject` yields `additionalProperties: false`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/providerContract.ts tests/dialogue/providerContract.test.ts
git commit -m "feat(dialogue): provider contract 类型 + dialogueToolOutputSchema 单源（无 choices，additive）"
```

---

### Task 2: `mapProviderErrorToGameError` boundary

**Files:**
- Create: `src/engine/dialogue/providerError.ts`
- Test: `tests/dialogue/providerError.test.ts`

**Interfaces:**
- Consumes: `ProviderError` (Task 1); `aiError`, `GameError` from `../infra/errors`.
- Produces: `mapProviderErrorToGameError(e: ProviderError): GameError`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dialogue/providerError.test.ts
import { describe, it, expect } from "vitest";
import { mapProviderErrorToGameError } from "../../src/engine/dialogue/providerError";
import type { ProviderError } from "../../src/engine/dialogue/providerContract";

const cases: { e: ProviderError; code: string }[] = [
  { e: { kind: "transport", retryable: true, cause: "timeout" }, code: "PROVIDER_TRANSPORT" },
  { e: { kind: "protocol", retryable: true, cause: "no_tool_call" }, code: "PROVIDER_PROTOCOL" },
  { e: { kind: "config", retryable: false, cause: "invalid_request" }, code: "PROVIDER_CONFIG" },
  { e: { kind: "cancelled", retryable: false }, code: "PROVIDER_CANCELLED" },
  { e: { kind: "offline", retryable: false }, code: "PROVIDER_OFFLINE" },
  { e: { kind: "refused", retryable: false }, code: "PROVIDER_REFUSED" },
];

describe("mapProviderErrorToGameError", () => {
  it("maps each kind to a stable ai code", () => {
    for (const { e, code } of cases) {
      const g = mapProviderErrorToGameError(e);
      expect(g.category).toBe("ai");
      expect(g.code).toBe(code);
    }
  });
  it("carries requestId/statusCode into context, nothing sensitive", () => {
    const g = mapProviderErrorToGameError({ kind: "transport", retryable: true, cause: "5xx", meta: { requestId: "req_1", statusCode: 503 } });
    expect(g.context).toMatchObject({ requestId: "req_1", statusCode: 503, cause: "5xx" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/providerError.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/dialogue/providerError.ts
import { aiError, type GameError } from "../infra/errors";
import type { ProviderError } from "./providerContract";

const CODE: Record<ProviderError["kind"], string> = {
  transport: "PROVIDER_TRANSPORT",
  protocol: "PROVIDER_PROTOCOL",
  config: "PROVIDER_CONFIG",
  cancelled: "PROVIDER_CANCELLED",
  offline: "PROVIDER_OFFLINE",
  refused: "PROVIDER_REFUSED",
};

export function mapProviderErrorToGameError(e: ProviderError): GameError {
  const cause = "cause" in e ? e.cause : undefined;
  return aiError(CODE[e.kind], `dialogue provider failed: ${e.kind}${cause ? `/${cause}` : ""}`, {
    severity: e.retryable ? "warn" : "error",
    context: {
      kind: e.kind,
      ...(cause !== undefined ? { cause } : {}),
      ...(e.meta?.requestId !== undefined ? { requestId: e.meta.requestId } : {}),
      ...(e.meta?.statusCode !== undefined ? { statusCode: e.meta.statusCode } : {}),
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dialogue/providerError.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/providerError.ts tests/dialogue/providerError.test.ts
git commit -m "feat(dialogue): mapProviderErrorToGameError 边界（含 cancelled）"
```

---

### Task 3: Atomic contract flip — migrate ALL consumers (no behavior regression)

Flip `DialogueProvider.generate` to the new contract and migrate every consumer in one commit. The mock/scripted path keeps its exact behavior (echoes scripted text AND authored expression).

**Files:**
- Modify: `src/engine/dialogue/types.ts`
- Modify: `src/engine/dialogue/providers/mockProvider.ts`
- Modify: `src/engine/dialogue/providers/remoteProvider.ts`
- Modify: `src/engine/dialogue/orchestrator.ts`
- Modify: `src/engine/scenes/runner.ts`
- Modify: `src/ui/screens/BedchamberScene.tsx`, `DialogueScreen.tsx`, `ReactionScreen.tsx`
- Modify tests: `tests/dialogue/provider.test.ts`, `pr5Integration.test.ts`, `remoteProvider.test.ts`, `tests/scenes/runner.test.ts`, `tests/memory/memory.test.ts`

**Interfaces:**
- Consumes: `DialogueProviderResult`, `ProviderError`, `ProviderResult`, `ProviderCapabilities`, `ModelRef` (Task 1); `mapProviderErrorToGameError` (Task 2).
- Produces: `DialogueProvider.generate(request, options?): Promise<ProviderResult<DialogueProviderResult>>`; `DialogueProvider.capabilities`; `DialogueGenerationOptions` (NO `model` — model is fixed at provider creation); `createDialogueProvider({ model: ModelRef }): DialogueProvider` (config/not_configured default; routing added in Task 6).

- [ ] **Step 1: Update the contract in `types.ts`**

```ts
// src/engine/dialogue/types.ts — replace the DialogueProvider block; add options
import type { DialogueProviderResult, ProviderResult, ProviderCapabilities } from "./providerContract";

export interface DialogueGenerationOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  maxTokens?: number;
  // NOTE: no `model` — model selection happens at provider creation (createDialogueProvider).
}

export interface DialogueProvider {
  readonly id: string;
  readonly kind: "scripted" | "generative";
  readonly capabilities: ProviderCapabilities;
  generate(request: DialogueRequest, options?: DialogueGenerationOptions): Promise<ProviderResult<DialogueProviderResult>>;
}
```

Keep `rawDialogueResponseSchema`/`DialogueLine` (orchestrator still uses `DialogueLine`).

- [ ] **Step 2: Migrate `mockProvider` (preserve authored expression)**

```ts
// src/engine/dialogue/providers/mockProvider.ts
import { err, ok } from "../../infra/result";
import type { DialogueProvider } from "../types";
import type { ProviderError, DialogueProviderResult } from "../providerContract";

const NO_SCRIPT: ProviderError = { kind: "config", retryable: false, cause: "not_configured" };

export const mockProvider: DialogueProvider = {
  id: "mock",
  kind: "scripted",
  capabilities: { strictTools: false, promptCaching: false, batch: false },
  generate(request) {
    if (!request.scripted) return Promise.resolve(err<ProviderError>(NO_SCRIPT));
    const result: DialogueProviderResult = {
      speaker: request.speakerId,
      text: request.scripted.text,
      ...(request.scripted.expression !== undefined ? { expression: request.scripted.expression } : {}),
      choices: [],
      proposedClaims: [],
      providerMeta: { provider: "mock", model: "mock" },
    };
    return Promise.resolve(ok(result));
  },
};
```

- [ ] **Step 3: Replace `remoteProvider` with the final-shape facade (config/not_configured default)**

```ts
// src/engine/dialogue/providers/remoteProvider.ts — replace file body
import { err } from "../../infra/result";
import type { DialogueProvider } from "../types";
import type { ModelRef, ProviderError } from "../providerContract";

/** Routing facade. Task 6 adds the anthropic case (needs an injected transport). */
export function createDialogueProvider(config: { model: ModelRef }): DialogueProvider {
  const e: ProviderError = { kind: "config", retryable: false, cause: "not_configured" };
  return {
    id: `remote:${config.model.provider}:${config.model.model}`,
    kind: "generative",
    capabilities: { strictTools: false, promptCaching: false, batch: false },
    generate: () => Promise.resolve(err(e)),
  };
}
```

Delete the old `ProviderAdapter`/`RemoteProviderConfig`/`createRemoteProvider` exports (and any `RawDialogueResponse` import).

- [ ] **Step 4: Migrate the orchestrator**

```ts
// orchestrator.ts — produceDialogueLine
import { mapProviderErrorToGameError } from "./providerError";
import type { DialogueProviderResult } from "./providerContract";

export async function produceDialogueLine(db, provider, request, logger?) {
  const raw = await provider.generate(request);
  if (!raw.ok) return err(mapProviderErrorToGameError(raw.error));
  return finalizeLine(db, provider, request, raw.value, logger);
}
```

In `produceDialogueLineWithPolicy`, replace the `generate` + `safeParse` prologue:

```ts
const raw = await provider.generate(request);
if (!raw.ok) return err(mapProviderErrorToGameError(raw.error));
const response: DialogueProviderResult = raw.value;
// claim gate uses response.proposedClaims; finalizeLine(db, provider, request, response, logger)
```

Change `finalizeLine`'s response param type to `DialogueProviderResult` (it reads `speaker`/`text`/`choices`/`expression?` — all present). Remove the now-unused `rawDialogueResponseSchema` import.

- [ ] **Step 5: Migrate `scenes/runner.ts` + UI screens**

Run: `grep -rn "RawDialogueResponse\|\.generate(\|createRemoteProvider\|safeParse" src/engine/scenes/runner.ts src/ui/screens/*.tsx`
For each hit: delete any `safeParse` of the provider result (it is already parsed); replace `createRemoteProvider` with `createDialogueProvider`. Screens that just `produceDialogueLine(...).then(r => r.ok && setLine(r.value))` need no change (signature of `produceDialogueLine` is unchanged).

- [ ] **Step 6: Migrate the consumer tests**

- `provider.test.ts`: inline providers return `ok<DialogueProviderResult>({ speaker, text, choices: [], proposedClaims: [] })` + `capabilities`. Move the `garbage`/malformed-response case OUT — it's an adapter-parse concern now (Task 5); replace with: a provider returning a `ProviderError` surfaces as the mapped `GameError` code.
- `pr5Integration.test.ts`: `makeProvider` returns `DialogueProviderResult` (add `speaker`) + `capabilities`.
- `remoteProvider.test.ts`: assert `createDialogueProvider({ model: { provider: "anthropic", model: "x" } })` refuses with `ProviderError { kind: "config", cause: "not_configured" }`.
- `runner.test.ts`, `memory.test.ts`: update inline providers to the new contract + `capabilities`.

```ts
const provider: DialogueProvider = {
  id: "synthetic", kind: "generative",
  capabilities: { strictTools: true, promptCaching: false, batch: false },
  generate: (req) => Promise.resolve(ok<DialogueProviderResult>({
    speaker: req.speakerId, text: "本宫累了，陛下早些歇息。", choices: [], proposedClaims: [],
  })),
};
```

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green. If a scripted test asserted authored expression, it must still pass (we preserved it). Park any case explicitly moving to Task 5 with `it.skip` + a `// → anthropicProvider.test.ts (Task 5)` note.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(dialogue): 原子迁移 provider 返回契约到 DialogueProviderResult/ProviderError（保留 scripted expression；createDialogueProvider 终形）"
```

---

### Task 4: Anthropic adapter — transport seam, request build, success parse, timeout/cancel

**Files:**
- Create: `src/engine/dialogue/providers/anthropicProvider.ts`
- Test: `tests/dialogue/anthropicProvider.test.ts`
- Create: `tests/dialogue/fixtures/anthropic.ts`

**Interfaces:**
- Consumes: `dialogueToolOutputSchema`, `dialogueToolOutputJsonSchema`, `DialogueProviderResult`, `ProviderError`, `ProviderResult` (Task 1); `DialogueProvider`, `DialogueRequest`, `DialogueGenerationOptions` (types).
- Produces: `AnthropicRequestPayload`, `AnthropicToolUseResponse`, `AnthropicTransportResult`, `TransportOptions`, `AnthropicTransport`, `buildAnthropicToolRequest(request, model, options?)`, `createAnthropicProvider({ model, transport }): DialogueProvider`.

- [ ] **Step 1: Write the fixture helper (envelope: message + separate requestId)**

```ts
// tests/dialogue/fixtures/anthropic.ts
import { createNewGameState } from "../../../src/engine/state/newGame";
import { loadRealContent } from "../../helpers/contentFixture";
import { assembleDialogueRequest } from "../../../src/engine/dialogue/orchestrator";
import type { DialogueToolOutput } from "../../../src/engine/dialogue/providerContract";
import type { AnthropicTransportResult } from "../../../src/engine/dialogue/providers/anthropicProvider";

const db = loadRealContent();
const state = createNewGameState(db);

export function makeRequest(speakerId: string) {
  const r = assembleDialogueRequest(db, state, speakerId, "zichendian");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

export function okToolUse(input: DialogueToolOutput, requestId = "req_test"): AnthropicTransportResult {
  return {
    requestId, // SDK _request_id — NOT message id
    message: {
      id: "msg_abc",                       // message id (distinct from requestId)
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "emit_dialogue_line", input }],
      usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 1000 },
    },
  };
}
```

- [ ] **Step 2: Write the failing success test**

```ts
// tests/dialogue/anthropicProvider.test.ts
import { describe, it, expect } from "vitest";
import { createAnthropicProvider, type AnthropicTransport } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okToolUse, makeRequest } from "./fixtures/anthropic";

describe("anthropicProvider — success", () => {
  it("forces a single tool, parses input, derives speaker, fills meta from envelope", async () => {
    let payloadSeen: { tool_choice?: unknown } = {};
    const transport: AnthropicTransport = {
      send: (p) => { payloadSeen = p; return Promise.resolve(okToolUse({ text: "本宫安好。", proposedClaims: [] }, "req_x")); },
    };
    const provider = createAnthropicProvider({ model: "claude-sonnet-4-6", transport });
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.speaker).toBe("shen_zhibai");
    expect(r.value.text).toBe("本宫安好。");
    expect(r.value.choices).toEqual([]);
    expect(r.value.providerMeta).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6", requestId: "req_x" });
    expect(provider.capabilities).toEqual({ strictTools: true, promptCaching: true, batch: false });
    expect(payloadSeen.tool_choice).toEqual({ type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the adapter**

```ts
// src/engine/dialogue/providers/anthropicProvider.ts
import { err, ok } from "../../infra/result";
import { dialogueToolOutputSchema, dialogueToolOutputJsonSchema,
         type DialogueProviderResult, type ProviderError, type ProviderResult } from "../providerContract";
import type { DialogueProvider, DialogueRequest, DialogueGenerationOptions } from "../types";

const TOOL_NAME = "emit_dialogue_line";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_TOKENS = 800;

export interface AnthropicToolUseResponse {
  id?: string;
  stop_reason: string;
  content: { type: string; name?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}
export interface AnthropicRequestPayload {
  model: string; max_tokens: number;
  system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
  messages: { role: "user"; content: string }[];
  tools: { name: string; description: string; strict: true; input_schema: unknown }[];
  tool_choice: { type: "tool"; name: string; disable_parallel_tool_use: true };
}
export interface TransportOptions { signal?: AbortSignal; }
export interface AnthropicTransportResult { message: AnthropicToolUseResponse; requestId?: string; }
/** Injected seam. Real SDK transport lives in a relay layer (separate PR), never in engine. */
export interface AnthropicTransport { send(payload: AnthropicRequestPayload, options?: TransportOptions): Promise<AnthropicTransportResult>; }

export function buildAnthropicToolRequest(request: DialogueRequest, model: string, options?: DialogueGenerationOptions): AnthropicRequestPayload {
  // LLM-1 minimal prompt; full compiler is LLM-2.
  const system = `你只把既定意图写成符合人物身份的中文台词。proposedClaims 只填台词中真正说出口、且来源在请求中提供的事实。`;
  const user = JSON.stringify({
    speakerId: request.speakerId, profile: request.speakerContext.profile,
    voice: request.speakerContext.voice, relevantMemories: request.speakerContext.relevantMemories,
    scripted: request.scripted,
  });
  return {
    model, max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    tools: [{ name: TOOL_NAME, description: "提交角色台词及其结构化事实。", strict: true, input_schema: dialogueToolOutputJsonSchema }],
    tool_choice: { type: "tool", name: TOOL_NAME, disable_parallel_tool_use: true },
  };
}

export function createAnthropicProvider(opts: { model: string; transport: AnthropicTransport }): DialogueProvider {
  return {
    id: `anthropic:${opts.model}`,
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: true, batch: false },
    async generate(request, options): Promise<ProviderResult<DialogueProviderResult>> {
      const payload = buildAnthropicToolRequest(request, opts.model, options);
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const timeoutController = new AbortController();
      const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
      const caller = options?.signal;
      const onCallerAbort = () => timeoutController.abort();
      caller?.addEventListener("abort", onCallerAbort);
      try {
        const res = await opts.transport.send(payload, { signal: timeoutController.signal });
        return parseToolUse(res, request, opts.model);
      } catch (cause) {
        if (caller?.aborted) return err<ProviderError>({ kind: "cancelled", retryable: false });
        if (timeoutController.signal.aborted) return err<ProviderError>({ kind: "transport", retryable: true, cause: "timeout" });
        return err(classifyTransportError(cause));
      } finally {
        clearTimeout(timer);
        caller?.removeEventListener("abort", onCallerAbort);
      }
    },
  };
}

function parseToolUse(res: AnthropicTransportResult, request: DialogueRequest, model: string): ProviderResult<DialogueProviderResult> {
  const msg = res.message;
  const meta = res.requestId !== undefined ? { requestId: res.requestId } : undefined;
  switch (msg.stop_reason) {
    case "tool_use": break;
    case "max_tokens": return err<ProviderError>({ kind: "protocol", retryable: true, cause: "truncated", meta });
    case "refusal": return err<ProviderError>({ kind: "refused", retryable: false, meta });
    case "pause_turn": return err<ProviderError>({ kind: "protocol", retryable: true, cause: "pause_turn", meta });
    case "model_context_window_exceeded": return err<ProviderError>({ kind: "config", retryable: false, cause: "request_too_large", meta });
    default: return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  }
  const blocks = msg.content.filter((b) => b.type === "tool_use");
  if (blocks.length === 0) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  if (blocks.length > 1) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "multiple_tool_calls", meta });
  if (blocks[0]!.name !== TOOL_NAME) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "wrong_tool", meta });
  const parsed = dialogueToolOutputSchema.safeParse(blocks[0]!.input);
  if (!parsed.success) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta });
  const u = msg.usage;
  const result: DialogueProviderResult = {
    speaker: request.speakerId,                 // never trust model
    text: parsed.data.text,
    choices: [],                                // v1: model never authors choices
    proposedClaims: parsed.data.proposedClaims,
    ...(u ? { usage: { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
        ...(u.cache_read_input_tokens !== undefined ? { cacheReadTokens: u.cache_read_input_tokens } : {}),
        ...(u.cache_creation_input_tokens !== undefined ? { cacheCreationTokens: u.cache_creation_input_tokens } : {}) } } : {}),
    providerMeta: { provider: "anthropic", model, ...(res.requestId ? { requestId: res.requestId } : {}) },
  };
  return ok(result);
}

function classifyTransportError(cause: unknown): ProviderError {
  const e = cause as { status?: number; headers?: Record<string, string>; request_id?: string };
  const meta = { ...(e.request_id ? { requestId: e.request_id } : {}), ...(e.status ? { statusCode: e.status } : {}) };
  switch (e.status) {
    case 400: return { kind: "config", retryable: false, cause: "invalid_request", meta };
    case 401: case 403: return { kind: "config", retryable: false, cause: "auth", meta };
    case 402: return { kind: "config", retryable: false, cause: "billing", meta };
    case 404: return { kind: "config", retryable: false, cause: "model_not_found", meta };
    case 413: return { kind: "config", retryable: false, cause: "request_too_large", meta };
    case 429: {
      const ra = e.headers?.["retry-after"]; const retryAfterMs = ra ? Number(ra) * 1000 : undefined;
      return { kind: "transport", retryable: true, cause: "rate_limit", meta: { ...meta, ...(retryAfterMs ? { retryAfterMs } : {}) } };
    }
    default:
      if (typeof e.status === "number" && e.status >= 500) return { kind: "transport", retryable: true, cause: "5xx", meta };
      return { kind: "transport", retryable: true, cause: "network", meta };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: PASS.

- [ ] **Step 6: Add timeout + cancel tests**

```ts
// append to tests/dialogue/anthropicProvider.test.ts
import { makeRequest as mkReq } from "./fixtures/anthropic";

describe("anthropicProvider — timeout vs cancel", () => {
  const hanging: AnthropicTransport = {
    send: (_p, o) => new Promise((_res, reject) =>
      o?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  };
  it("our timeout controller firing → transport/timeout (retryable)", async () => {
    const r = await createAnthropicProvider({ model: "claude-sonnet-4-6", transport: hanging }).generate(mkReq("shen_zhibai"), { timeoutMs: 5 });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "transport", cause: "timeout", retryable: true });
  });
  it("caller signal firing → cancelled (NOT retryable)", async () => {
    const ac = new AbortController();
    const p = createAnthropicProvider({ model: "claude-sonnet-4-6", transport: hanging }).generate(mkReq("shen_zhibai"), { signal: ac.signal, timeoutMs: 10000 });
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "cancelled", retryable: false });
  });
});
```

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: PASS (success + timeout + cancel).

- [ ] **Step 7: Commit**

```bash
git add src/engine/dialogue/providers/anthropicProvider.ts tests/dialogue/anthropicProvider.test.ts tests/dialogue/fixtures/anthropic.ts
git commit -m "feat(dialogue): anthropic adapter（注入式 transport、强制单工具、timeout/cancel 区分、success parse）"
```

---

### Task 5: Adapter error classification — protocol + HTTP status table

Fixture-drive every protocol and status failure.

**Files:**
- Modify: `tests/dialogue/anthropicProvider.test.ts`
- Modify: `tests/dialogue/fixtures/anthropic.ts`

(The classification code already landed in Task 4; this task proves it exhaustively. If a case fails, fix the relevant branch in `anthropicProvider.ts`.)

- [ ] **Step 1: Add failure fixtures**

```ts
// append to tests/dialogue/fixtures/anthropic.ts
export const res = (over: Partial<AnthropicTransportResult["message"]>): AnthropicTransportResult =>
  ({ requestId: "req_f", message: { id: "msg_f", stop_reason: "tool_use", content: [], ...over } });
export const wrongTool = () => res({ content: [{ type: "tool_use", name: "other", input: {} }] });
export const twoEmits = () => res({ content: [
  { type: "tool_use", name: "emit_dialogue_line", input: { text: "a", proposedClaims: [] } },
  { type: "tool_use", name: "emit_dialogue_line", input: { text: "b", proposedClaims: [] } } ] });
export const truncated = () => res({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "半", proposedClaims: [] } }] });
export const refusal = () => res({ stop_reason: "refusal", content: [] });
export const ctxExceeded = () => res({ stop_reason: "model_context_window_exceeded", content: [] });
export const endTurnNoTool = () => res({ stop_reason: "end_turn", content: [{ type: "text" }] });
export const badInput = () => res({ content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "", proposedClaims: [] } }] });
```

- [ ] **Step 2: Add the protocol + status tests**

```ts
// append to tests/dialogue/anthropicProvider.test.ts
import { wrongTool, twoEmits, truncated, refusal, ctxExceeded, endTurnNoTool, badInput } from "./fixtures/anthropic";

describe("anthropicProvider — protocol classification", () => {
  const run = (r: ReturnType<typeof wrongTool>) =>
    createAnthropicProvider({ model: "claude-sonnet-4-6", transport: { send: () => Promise.resolve(r) } }).generate(mkReq("shen_zhibai"));
  const expectErr = async (r: Promise<{ ok: boolean }>, m: object) => { const x = await r as { ok: boolean; error?: object }; expect(x.ok).toBe(false); if (!x.ok) expect(x.error).toMatchObject(m); };
  it("wrong tool", () => expectErr(run(wrongTool()), { kind: "protocol", cause: "wrong_tool" }));
  it("multiple tool calls", () => expectErr(run(twoEmits()), { kind: "protocol", cause: "multiple_tool_calls" }));
  it("max_tokens → truncated", () => expectErr(run(truncated()), { kind: "protocol", cause: "truncated" }));
  it("refusal → refused", () => expectErr(run(refusal()), { kind: "refused" }));
  it("context window exceeded → config/request_too_large", () => expectErr(run(ctxExceeded()), { kind: "config", cause: "request_too_large" }));
  it("end_turn no tool → no_tool_call", () => expectErr(run(endTurnNoTool()), { kind: "protocol", cause: "no_tool_call" }));
  it("invalid tool input → schema_invalid", () => expectErr(run(badInput()), { kind: "protocol", cause: "schema_invalid" }));
});

describe("anthropicProvider — HTTP status classification", () => {
  const reject = (cause: unknown) =>
    createAnthropicProvider({ model: "claude-sonnet-4-6", transport: { send: () => Promise.reject(cause) } }).generate(mkReq("shen_zhibai"));
  const expectErr = async (r: Promise<{ ok: boolean }>, m: object) => { const x = await r as { ok: boolean; error?: object }; expect(x.ok).toBe(false); if (!x.ok) expect(x.error).toMatchObject(m); };
  it("400 → config/invalid_request", () => expectErr(reject({ status: 400 }), { kind: "config", cause: "invalid_request", retryable: false }));
  it("401 → config/auth", () => expectErr(reject({ status: 401 }), { kind: "config", cause: "auth" }));
  it("402 → config/billing", () => expectErr(reject({ status: 402 }), { kind: "config", cause: "billing" }));
  it("404 → config/model_not_found", () => expectErr(reject({ status: 404 }), { kind: "config", cause: "model_not_found" }));
  it("413 → config/request_too_large", () => expectErr(reject({ status: 413 }), { kind: "config", cause: "request_too_large" }));
  it("429 → transport/rate_limit + retryAfterMs", () => expectErr(reject({ status: 429, headers: { "retry-after": "2" }, request_id: "req_429" }), { kind: "transport", cause: "rate_limit", meta: { retryAfterMs: 2000, requestId: "req_429" } }));
  it("503 → transport/5xx", () => expectErr(reject({ status: 503 }), { kind: "transport", cause: "5xx" }));
  it("no status → transport/network", () => expectErr(reject(new Error("boom")), { kind: "transport", cause: "network" }));
});
```

- [ ] **Step 3: Run to verify (fail → fix branch → pass)**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: all pass. Any failure points at the matching branch in `parseToolUse`/`classifyTransportError` — fix there.

- [ ] **Step 4: Commit**

```bash
git add tests/dialogue/anthropicProvider.test.ts tests/dialogue/fixtures/anthropic.ts src/engine/dialogue/providers/anthropicProvider.ts
git commit -m "test(dialogue): anthropic adapter 协议 + HTTP 状态分类全覆盖（fixture，CI 不调网络）"
```

---

### Task 6: `createDialogueProvider` routes anthropic by explicit `ModelRef.provider`

Add the anthropic routing case (additive — `transport?` param) without re-migrating the public contract introduced in Task 3.

**Files:**
- Modify: `src/engine/dialogue/providers/remoteProvider.ts`
- Modify: `tests/dialogue/remoteProvider.test.ts`

**Interfaces:**
- Consumes: `createAnthropicProvider`, `AnthropicTransport` (Task 4); `ModelRef` (Task 1).
- Produces: `createDialogueProvider({ model: ModelRef; transport?: AnthropicTransport }): DialogueProvider`.

> Real SDK transport (relay/native layer) is OUT of LLM-1. Without an injected `transport`, the anthropic case returns `config/not_configured` — exactly the safe default.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dialogue/remoteProvider.test.ts (replace)
import { describe, it, expect } from "vitest";
import { createDialogueProvider } from "../../src/engine/dialogue/providers/remoteProvider";
import { okToolUse, makeRequest } from "./fixtures/anthropic";

describe("createDialogueProvider routing", () => {
  it("anthropic + injected transport → routed to the anthropic adapter", async () => {
    const provider = createDialogueProvider({
      model: { provider: "anthropic", model: "claude-sonnet-4-6" },
      transport: { send: () => Promise.resolve(okToolUse({ text: "臣妾遵旨。", proposedClaims: [] })) },
    });
    expect(provider.capabilities.strictTools).toBe(true);
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true); if (r.ok) expect(r.value.providerMeta?.provider).toBe("anthropic");
  });
  it("anthropic WITHOUT transport → config/not_configured (no SDK in engine)", async () => {
    const r = await createDialogueProvider({ model: { provider: "anthropic", model: "x" } }).generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "config", cause: "not_configured" });
  });
  it("unimplemented provider → config/not_configured", async () => {
    const r = await createDialogueProvider({ model: { provider: "deepseek", model: "x" } }).generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "config", cause: "not_configured" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/remoteProvider.test.ts`
Expected: FAIL — routing/`transport` param not present.

- [ ] **Step 3: Implement routing**

```ts
// src/engine/dialogue/providers/remoteProvider.ts (replace)
import { err } from "../../infra/result";
import type { DialogueProvider } from "../types";
import type { ModelRef, ProviderError } from "../providerContract";
import { createAnthropicProvider, type AnthropicTransport } from "./anthropicProvider";

function notConfigured(id: string): DialogueProvider {
  const e: ProviderError = { kind: "config", retryable: false, cause: "not_configured" };
  return { id, kind: "generative", capabilities: { strictTools: false, promptCaching: false, batch: false }, generate: () => Promise.resolve(err(e)) };
}

export function createDialogueProvider(config: { model: ModelRef; transport?: AnthropicTransport }): DialogueProvider {
  const id = `remote:${config.model.provider}:${config.model.model}`;
  switch (config.model.provider) {
    case "anthropic":
      return config.transport ? createAnthropicProvider({ model: config.model.model, transport: config.transport }) : notConfigured(id);
    default:
      return notConfigured(id);
  }
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run tests/dialogue/remoteProvider.test.ts && npx tsc --noEmit`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/providers/remoteProvider.ts tests/dialogue/remoteProvider.test.ts
git commit -m "feat(dialogue): createDialogueProvider 按 ModelRef.provider 显式路由 anthropic（无 transport → not_configured）"
```

---

### Task 7: Acceptance — full `claim gate → text gate → mention writeback`

Prove the fixture-backed Anthropic adapter's parsed result drives the real PR5 pipeline — including actual claim acceptance and mention writeback, not just text gating.

**Files:**
- Test: `tests/dialogue/anthropicProvider.integration.test.ts`

**Interfaces:**
- Consumes: `createAnthropicProvider` (Task 4); `assembleDialogueRequest`, `buildDialoguePolicyContext`, `produceDialogueLineWithPolicy` (orchestrator); `okToolUse` (fixtures).

- [ ] **Step 1: Write the failing tests (4 chains)**

```ts
// tests/dialogue/anthropicProvider.integration.test.ts
import { describe, it, expect } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { assembleDialogueRequest, buildDialoguePolicyContext, produceDialogueLineWithPolicy } from "../../src/engine/dialogue/orchestrator";
import { createAnthropicProvider } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okToolUse } from "./fixtures/anthropic";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";

const db = loadRealContent();
const state = createNewGameState(db);
const SPEAKER = "shen_zhibai";

function setup(text: string, claims: ProposedClaim[]) {
  const req = assembleDialogueRequest(db, state, SPEAKER, "zichendian");
  if (!req.ok) throw new Error(req.error.message);
  const policy = buildDialoguePolicyContext(db, state, req.value);
  const provider = createAnthropicProvider({ model: "claude-sonnet-4-6", transport: { send: () => Promise.resolve(okToolUse({ text, proposedClaims: claims })) } });
  return { req: req.value, policy, provider };
}

describe("anthropic provider — full PR5 pipeline acceptance", () => {
  it("(a) valid claim with a real offered source → passes, mentionLog grows", async () => {
    const { req, policy, provider } = setup("本宫累了，陛下早些歇息。", []);
    const offered = [...policy.offeredContextIds][0]!;
    const claim: ProposedClaim = { claim: { id: "c1", predicate: "holds_rank", subjectId: SPEAKER, object: "fenghou", modality: "assert" }, sourceContextIds: [offered], modality: "assert", certainty: 90 };
    const { provider: p2, req: r2, policy: pol2 } = setup("本宫累了。", [claim]);
    const r = await produceDialogueLineWithPolicy(db, p2, r2, pol2, state);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.nextState.mentionLog.length).toBeGreaterThan(state.mentionLog.length);
    void req; void policy; void provider;
  });
  it("(b) claim contradicts belief → CLAIM_REJECTED, mentionLog unchanged", async () => {
    const base = setup("本宫累了。", []);
    const offered = [...base.policy.offeredContextIds][0]!;
    const wrong: ProposedClaim = { claim: { id: "c2", predicate: "holds_rank", subjectId: SPEAKER, object: "zhaoyi", modality: "assert" }, sourceContextIds: [offered], modality: "assert", certainty: 90 };
    const { provider, req, policy } = setup("本宫累了。", [wrong]);
    const r = await produceDialogueLineWithPolicy(db, provider, req, policy, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("CLAIM_REJECTED");
  });
  it("(c) unknown source context → reject, mentionLog unchanged", async () => {
    const bad: ProposedClaim = { claim: { id: "c3", predicate: "holds_rank", subjectId: SPEAKER, object: "fenghou", modality: "assert" }, sourceContextIds: ["not_offered_xyz"], modality: "assert", certainty: 90 };
    const { provider, req, policy } = setup("本宫累了。", [bad]);
    const r = await produceDialogueLineWithPolicy(db, provider, req, policy, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("CLAIM_REJECTED");
  });
  it("(d) claim valid but text has a forbidden term → text reject, mentionLog unchanged", async () => {
    const { policy } = setup("本宫累了。", []);
    const offered = [...policy.offeredContextIds][0]!;
    const ok: ProposedClaim = { claim: { id: "c4", predicate: "holds_rank", subjectId: SPEAKER, object: "fenghou", modality: "assert" }, sourceContextIds: [offered], modality: "assert", certainty: 90 };
    const { provider, req, policy: pol } = setup("皇上圣明。", [ok]);
    const r = await produceDialogueLineWithPolicy(db, provider, req, pol, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("GATE_REJECTED");
  });
});
```

- [ ] **Step 2: Run to verify (fail → fix wiring → pass)**

Run: `npx vitest run tests/dialogue/anthropicProvider.integration.test.ts`
Expected: all four pass. No new production code expected; a failure reveals a contract mismatch — fix in the relevant task's file. (Claim object/predicate values mirror the existing `pr5Integration.test.ts`; adjust to the real fenghou/zhaoyi rank ids if content differs.)

- [ ] **Step 3: Full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green; re-enable any `it.skip` parked in Task 3 Step 7.

- [ ] **Step 4: Commit**

```bash
git add tests/dialogue/anthropicProvider.integration.test.ts
git commit -m "test(dialogue): anthropic adapter 全链路验收（claim 接受写 mention / 三类拒绝不写 mention）"
```

---

## Self-Review

**Required fixes from review — all incorporated:**
1. Model cannot author choices → `DialogueToolOutput` drops `choices`; schema rejects it; Task 1 test asserts absence + `additionalProperties:false`. ✅
2. No scripted-behavior regression → `expression?` on `DialogueProviderResult` (not on tool output); mock preserves authored expression; constraint states "behavior unchanged, not test-coverage-defined". ✅
3. SDK transport out of engine → only `AnthropicTransport` interface in engine; no SDK import / `new Anthropic()` / `apiKeyRef`; real transport is a separate relay PR. ✅
4. `options.model` removed; model fixed at creation; `timeoutMs` actually wired in `generate`. ✅
5. cancel vs timeout split → `cancelled` (not retryable) vs `transport/timeout`; caller-signal vs timeout-controller distinguished. ✅
6. Full 4xx + stop_reason handling → status table (400/401/402/403/404/413/429/5xx) + stop_reason switch (tool_use/max_tokens/refusal/pause_turn/model_context_window_exceeded/default). ✅
7. Single-tool check = `blocks.length`-based + `disable_parallel_tool_use: true`. ✅
8. `requestId` from transport envelope (`AnthropicTransportResult.requestId`), distinct from `message.id`. ✅
9. No `as never` — no default SDK transport in this PR at all. ✅
10. Task 7 has the 4 real claim/mention chains. ✅
11. `batch: false` in adapter capabilities. ✅
12. `text.max(300)` + `max_tokens` default 800. ✅

**Out of scope (LLM-3, deferred):** `AuthorizedClaim`, `factKey` w/o modality, polarity split, `claim_not_allowed`, typed `ContextRef`, live `planReaction`/`assembleClaims`, `choiceCandidates` rendering. **LLM-2:** full prompt compiler + caching boundary + eval. **Separate relay PR:** real SDK transport + `resolveCredential`.

**Placeholder scan:** no "TBD"/"add error handling"/"similar to Task N"; every code step shows actual code.

**Type consistency:** `DialogueToolOutput`(text+proposedClaims), `DialogueProviderResult`(+speaker/expression?/choices/usage/providerMeta), `ProviderError`(transport/protocol/config/cancelled/offline/refused), `AnthropicTransport.send`, `AnthropicTransportResult`(message+requestId), `createAnthropicProvider`/`createDialogueProvider` are used identically across tasks. `produceDialogueLine` keeps `Result<DialogueLine, GameError>`.

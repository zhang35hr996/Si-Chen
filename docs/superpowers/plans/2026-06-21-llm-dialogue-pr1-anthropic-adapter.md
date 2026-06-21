# LLM-1 Anthropic Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dialogue provider stub with a real,厂商无关 contract and a working Anthropic protocol adapter (forced strict tool, fixture-tested, zero live network in CI), without touching the live planner.

**Architecture:** One atomic breaking migration of `DialogueProvider.generate`'s return contract (`DialogueProviderResult` + `ProviderError`), then an `anthropicProvider` built around an **injected transport seam** that returns a **structured `Result`** (no exception-guessing). Request-build / response-parse / error-classification / deadline are unit-tested with recorded fixtures. `remoteProvider` becomes a facade routing by explicit `ModelRef.provider`. The adapter does ZERO fact/etiquette validation — its parsed result flows through the existing `claim gate → text gate → mention writeback` unchanged.

**Tech Stack:** TypeScript, Zod 4, Vitest. **No `@anthropic-ai/sdk` in this PR** — the real SDK transport belongs in a relay/native layer and is a separate small PR (see Global Constraints).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-06-21-llm-dialogue-provider-design.md`.
- Determinism in tests: no real network, no `Math.random()`. Anthropic calls go through an injected `AnthropicTransport`; tests pass recorded fixtures.
- **The model never produces choices in v1.** `DialogueToolOutput` has NO `choices` field (an out-of-bounds option is a schema error, not a silent drop). The adapter fixes `choices: []`.
- **`request.scripted` carries `{ text, expression? }` only — there are NO authored choices anywhere in the current data path**, so the scripted/mock path legitimately emits `choices: []`; that is not a regression. Authored `expression` MUST survive. (If a `choices` source is ever added to scripted data, map it through then.)
- **`speaker` derived by the adapter from `request.speakerId`** — never trusted from model output. `usage`/`providerMeta`/`requestId` are adapter-supplied from the transport envelope.
- **Tool schema derives only from `DialogueToolOutput`**, which is itself `z.infer` of `dialogueToolOutputSchema` (one Zod source → type + JSON schema). It must exclude `speaker`/`expression`/`choices`/`usage`/`providerMeta` and set `additionalProperties: false`.
- **No behavior regression in the scripted/mock path** — defined by behavior, not by current test coverage.
- **Relay boundary:** `src/engine/dialogue/` keeps only the `AnthropicTransport` interface (returning a structured `Result`, never throwing for HTTP/network). NO SDK import, NO `new Anthropic()`, NO key handling, NO dead `apiKeyRef` in engine. Real SDK transport + `resolveCredential` is a **separate relay PR**.
- `ProviderError` must not leak into the engine: convert at the orchestrator boundary via `mapProviderErrorToGameError`.
- Breaking migration is pre-release ([[no-save-backcompat]]); migrate ALL consumers in one commit, full suite green.
- Logs store only error classification + `requestId`; never API key or full prompt.
- Adapter does no fact/etiquette/claim validation — delegated to existing `claimGate` + `gates`.
- Out of scope (LLM-3): `AuthorizedClaim`, `factKey` w/o modality, polarity, `claim_not_allowed`, `ContextRef`, live `planReaction`/`assembleClaims`, `choiceCandidates`. Out of scope (LLM-2): full prompt compiler + caching. Out of scope (relay PR): real SDK transport.
- `capabilities` describes what THIS adapter implements: LLM-1 ships `{ strictTools: true, promptCaching: false, batch: false }`. `promptCaching` stays false until LLM-2 adds a cacheable fixed prefix above Anthropic's minimum cache token threshold; `batch` until LLM-2 adds a batch executor.

---

### Task 1: Provider contract types + tool-output schema (additive, single-source)

**Files:**
- Create: `src/engine/dialogue/providerContract.ts`
- Test: `tests/dialogue/providerContract.test.ts`

**Interfaces:**
- Consumes: `proposedClaimSchema`, `ProposedClaim` from `./claims`; `Result` from `../infra/result`.
- Produces: `dialogueToolOutputSchema`, `DialogueToolOutput` (= `z.infer`), `dialogueToolOutputJsonSchema`, `RenderedDialogueChoice`, `DialogueProviderResult`, `ProviderError`, `ProviderErrorMeta`, `ModelRef`, `ProviderCapabilities`, `ProviderResult<T>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dialogue/providerContract.test.ts
import { describe, it, expect } from "vitest";
import { dialogueToolOutputSchema, dialogueToolOutputJsonSchema } from "../../src/engine/dialogue/providerContract";

describe("dialogueToolOutputSchema", () => {
  it("accepts text-only (proposedClaims defaults to [])", () => {
    const r = dialogueToolOutputSchema.safeParse({ text: "本宫累了。" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.proposedClaims).toEqual([]);
  });
  it("rejects empty text", () => {
    expect(dialogueToolOutputSchema.safeParse({ text: "" }).success).toBe(false);
  });
  it("rejects a choices field (model cannot author options in v1)", () => {
    expect(dialogueToolOutputSchema.safeParse({ text: "嗯。", choices: [{ id: "x", text: "y" }] }).success).toBe(false);
  });
  it("caps proposedClaims at 8", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      claim: { id: `c${i}`, predicate: "holds_rank", subjectId: "s", modality: "assert" },
      sourceContextIds: ["m1"], modality: "assert", certainty: 50,
    }));
    expect(dialogueToolOutputSchema.safeParse({ text: "嗯。", proposedClaims: many }).success).toBe(false);
  });
  it("tool JSON schema excludes non-model fields and forbids extras", () => {
    const props = (dialogueToolOutputJsonSchema as { properties: Record<string, unknown> }).properties;
    expect(props).toHaveProperty("text");
    expect(props).toHaveProperty("proposedClaims");
    for (const f of ["speaker", "expression", "choices", "usage", "providerMeta"]) expect(props).not.toHaveProperty(f);
    expect((dialogueToolOutputJsonSchema as { additionalProperties: unknown }).additionalProperties).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/providerContract.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/dialogue/providerContract.ts
import { z } from "zod";
import { proposedClaimSchema, type ProposedClaim } from "./claims";
import type { Result } from "../infra/result";

export interface RenderedDialogueChoice {
  id: string;
  text: string;
  tone?: "friendly" | "neutral" | "guarded" | "hostile" | "flirty";
}

/** SINGLE SOURCE: the part the model produces via the forced tool. No choices in v1. */
export const dialogueToolOutputSchema = z.strictObject({
  text: z.string().min(1).max(300),
  proposedClaims: z.array(proposedClaimSchema).max(8).default([]),
});
export type DialogueToolOutput = z.infer<typeof dialogueToolOutputSchema>;
export const dialogueToolOutputJsonSchema = z.toJSONSchema(dialogueToolOutputSchema);

export interface DialogueProviderResult {
  speaker: string;
  text: string;
  expression?: string;                 // scripted authored; Anthropic omits → neutral fallback
  choices: RenderedDialogueChoice[];    // engine-authored; v1 adapter sets []
  proposedClaims: ProposedClaim[];
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheCreationTokens?: number };
  providerMeta?: { provider: string; model: string; requestId?: string };
}

export interface ProviderErrorMeta { message?: string; statusCode?: number; retryAfterMs?: number; requestId?: string; }
export type TransportCause = "timeout" | "rate_limit" | "5xx" | "network";
export type ProtocolCause = "no_tool_call" | "wrong_tool" | "schema_invalid" | "truncated" | "multiple_tool_calls" | "pause_turn";
export type ConfigCause = "not_configured" | "auth" | "billing" | "model_not_found" | "request_too_large" | "invalid_request" | "incompatible_schema";

export type ProviderError =
  | { kind: "transport"; retryable: true; cause: TransportCause; meta?: ProviderErrorMeta }
  | { kind: "protocol"; retryable: boolean; cause: ProtocolCause; meta?: ProviderErrorMeta }
  | { kind: "config"; retryable: false; cause: ConfigCause; meta?: ProviderErrorMeta }
  | { kind: "cancelled"; retryable: false; meta?: ProviderErrorMeta }
  | { kind: "offline"; retryable: false; meta?: ProviderErrorMeta }
  | { kind: "refused"; retryable: false; meta?: ProviderErrorMeta };

export type ProviderResult<T> = Result<T, ProviderError>;
export interface ModelRef { provider: "anthropic" | "openai" | "qwen" | "kimi" | "deepseek"; model: string; }
export interface ProviderCapabilities { strictTools: boolean; promptCaching: boolean; batch: boolean; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dialogue/providerContract.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/providerContract.ts tests/dialogue/providerContract.test.ts
git commit -m "feat(dialogue): provider 契约 + dialogueToolOutputSchema 单源（type=z.infer，无 choices，claims≤8）"
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
  { e: { kind: "protocol", retryable: false, cause: "pause_turn" }, code: "PROVIDER_PROTOCOL" },
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
  transport: "PROVIDER_TRANSPORT", protocol: "PROVIDER_PROTOCOL", config: "PROVIDER_CONFIG",
  cancelled: "PROVIDER_CANCELLED", offline: "PROVIDER_OFFLINE", refused: "PROVIDER_REFUSED",
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
git commit -m "feat(dialogue): mapProviderErrorToGameError 边界（含 cancelled / pause_turn）"
```

---

### Task 3: Atomic contract flip — migrate ALL consumers (no behavior regression)

**Files:**
- Modify: `src/engine/dialogue/types.ts`, `providers/mockProvider.ts`, `providers/remoteProvider.ts`, `orchestrator.ts`
- Modify: `src/engine/scenes/runner.ts`, `src/ui/screens/{BedchamberScene,DialogueScreen,ReactionScreen}.tsx`
- Modify tests: `tests/dialogue/{provider,pr5Integration,remoteProvider}.test.ts`, `tests/scenes/runner.test.ts`, `tests/memory/memory.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `mapProviderErrorToGameError` (Task 2).
- Produces: `DialogueProvider.generate(request, options?): Promise<ProviderResult<DialogueProviderResult>>` + `.capabilities`; `DialogueGenerationOptions` (NO `model`); `createDialogueProvider({ model: ModelRef }): DialogueProvider` (config/not_configured default).

- [ ] **Step 1: Update the contract in `types.ts`**

```ts
import type { DialogueProviderResult, ProviderResult, ProviderCapabilities } from "./providerContract";

export interface DialogueGenerationOptions { timeoutMs?: number; signal?: AbortSignal; maxTokens?: number; }

export interface DialogueProvider {
  readonly id: string;
  readonly kind: "scripted" | "generative";
  readonly capabilities: ProviderCapabilities;
  generate(request: DialogueRequest, options?: DialogueGenerationOptions): Promise<ProviderResult<DialogueProviderResult>>;
}
```

Keep `rawDialogueResponseSchema`/`DialogueLine`.

- [ ] **Step 2: Migrate `mockProvider` (preserve authored expression; choices [] is correct — scripted has none)**

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
      choices: [], // request.scripted carries no choices in the current data path
      proposedClaims: [],
      providerMeta: { provider: "mock", model: "mock" },
    };
    return Promise.resolve(ok(result));
  },
};
```

- [ ] **Step 3: Replace `remoteProvider` with final-shape facade**

```ts
// src/engine/dialogue/providers/remoteProvider.ts
import { err } from "../../infra/result";
import type { DialogueProvider } from "../types";
import type { ModelRef, ProviderError } from "../providerContract";

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

Delete old `ProviderAdapter`/`RemoteProviderConfig`/`createRemoteProvider` and any `RawDialogueResponse` import.

- [ ] **Step 4: Migrate the orchestrator**

```ts
import { mapProviderErrorToGameError } from "./providerError";
import type { DialogueProviderResult } from "./providerContract";

export async function produceDialogueLine(db, provider, request, logger?) {
  const raw = await provider.generate(request);
  if (!raw.ok) return err(mapProviderErrorToGameError(raw.error));
  return finalizeLine(db, provider, request, raw.value, logger);
}
```

In `produceDialogueLineWithPolicy` replace the generate+safeParse prologue with the same `generate` + `mapProviderErrorToGameError`, set `const response: DialogueProviderResult = raw.value`, pass `response` to the claim gate (`response.proposedClaims`) and `finalizeLine`. Change `finalizeLine`'s response param to `DialogueProviderResult`. Remove the now-unused `rawDialogueResponseSchema` import.

- [ ] **Step 5: Migrate `scenes/runner.ts` + UI screens**

Run: `grep -rn "RawDialogueResponse\|\.generate(\|createRemoteProvider\|safeParse" src/engine/scenes/runner.ts src/ui/screens/*.tsx`
Delete any `safeParse` of the provider result; replace `createRemoteProvider` → `createDialogueProvider`. Screens calling `produceDialogueLine(...).then(...)` need no change.

- [ ] **Step 6: Migrate consumer tests**

Inline providers → new contract + `capabilities`:
```ts
const provider: DialogueProvider = {
  id: "synthetic", kind: "generative",
  capabilities: { strictTools: true, promptCaching: false, batch: false },
  generate: (req) => Promise.resolve(ok<DialogueProviderResult>({ speaker: req.speakerId, text: "本宫累了，陛下早些歇息。", choices: [], proposedClaims: [] })),
};
```
- `provider.test.ts`: move the malformed-response case OUT (now adapter-parse, Task 5); replace with "a `ProviderError` surfaces as the mapped `GameError`".
- `remoteProvider.test.ts`: `createDialogueProvider({ model: { provider: "anthropic", model: "x" } })` refuses `config/not_configured`.
- `pr5Integration.test.ts` / `runner.test.ts` / `memory.test.ts`: update inline providers.

- [ ] **Step 7: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: green; preserved scripted expression still works. Park any case moving to Task 5 with `it.skip` + a `// → anthropicProvider.test.ts (Task 5)` note.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(dialogue): 原子迁移 provider 返回契约（保留 scripted expression；createDialogueProvider 终形）"
```

---

### Task 4: Anthropic adapter — structured transport, request build, parse, deadline/cancel

**Files:**
- Create: `src/engine/dialogue/providers/anthropicProvider.ts`
- Test: `tests/dialogue/anthropicProvider.test.ts`
- Create: `tests/dialogue/fixtures/anthropic.ts`

**Interfaces:**
- Consumes: Task 1 contract; `ok`/`err` from `../../infra/result`; `DialogueProvider`/`DialogueRequest`/`DialogueGenerationOptions` (types).
- Produces: `AnthropicRequestPayload`, `AnthropicToolUseResponse`, `AnthropicTransportResult`, `AnthropicTransportFailure`, `TransportOptions`, `AnthropicTransport`, `buildAnthropicToolRequest`, `createAnthropicProvider`.

- [ ] **Step 1: Write the fixture helpers**

```ts
// tests/dialogue/fixtures/anthropic.ts
import { createNewGameState } from "../../../src/engine/state/newGame";
import { loadRealContent } from "../../helpers/contentFixture";
import { assembleDialogueRequest } from "../../../src/engine/dialogue/orchestrator";
import { ok, err } from "../../../src/engine/infra/result";
import type { DialogueToolOutput } from "../../../src/engine/dialogue/providerContract";
import type { AnthropicTransport, AnthropicTransportResult, AnthropicTransportFailure } from "../../../src/engine/dialogue/providers/anthropicProvider";

const db = loadRealContent();
const state = createNewGameState(db);

export function makeRequest(speakerId: string) {
  const r = assembleDialogueRequest(db, state, speakerId, "zichendian");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

export function envelope(input: DialogueToolOutput, requestId = "req_test"): AnthropicTransportResult {
  return { requestId, message: { id: "msg_abc", stop_reason: "tool_use", content: [{ type: "tool_use", name: "emit_dialogue_line", input }], usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 1000 } } };
}
export function msg(over: Partial<AnthropicTransportResult["message"]>): AnthropicTransportResult {
  return { requestId: "req_f", message: { id: "msg_f", stop_reason: "tool_use", content: [], ...over } };
}
/** Transports returning a structured Result. */
export const okTransport = (input: DialogueToolOutput, requestId?: string): AnthropicTransport => ({ send: () => Promise.resolve(ok(envelope(input, requestId))) });
export const msgTransport = (m: AnthropicTransportResult): AnthropicTransport => ({ send: () => Promise.resolve(ok(m)) });
export const failTransport = (f: AnthropicTransportFailure): AnthropicTransport => ({ send: () => Promise.resolve(err(f)) });
export const hangingTransport = (): AnthropicTransport => ({ send: () => new Promise(() => {}) }); // never resolves, ignores signal
```

- [ ] **Step 2: Write the failing success test**

```ts
// tests/dialogue/anthropicProvider.test.ts
import { describe, it, expect } from "vitest";
import { createAnthropicProvider } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okTransport, makeRequest } from "./fixtures/anthropic";
import type { AnthropicTransport } from "../../src/engine/dialogue/providers/anthropicProvider";

describe("anthropicProvider — success", () => {
  it("forces a single tool, parses input, derives speaker, fills meta from envelope", async () => {
    let toolChoice: unknown;
    const transport: AnthropicTransport = { send: (p) => okTransport({ text: "本宫安好。", proposedClaims: [] }, "req_x").send(p).then((r) => { toolChoice = p.tool_choice; return r; }) };
    const provider = createAnthropicProvider({ model: "claude-sonnet-4-6", transport });
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.speaker).toBe("shen_zhibai");
    expect(r.value.text).toBe("本宫安好。");
    expect(r.value.choices).toEqual([]);
    expect(r.value.providerMeta).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6", requestId: "req_x" });
    expect(provider.capabilities).toEqual({ strictTools: true, promptCaching: false, batch: false });
    expect(toolChoice).toEqual({ type: "tool", name: "emit_dialogue_line", disable_parallel_tool_use: true });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the adapter**

```ts
// src/engine/dialogue/providers/anthropicProvider.ts
import { ok, err, type Result } from "../../infra/result";
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
  system: { type: "text"; text: string }[];
  messages: { role: "user"; content: string }[];
  tools: { name: string; description: string; strict: true; input_schema: unknown }[];
  tool_choice: { type: "tool"; name: string; disable_parallel_tool_use: true };
}
export interface TransportOptions { signal?: AbortSignal; }
export interface AnthropicTransportResult { message: AnthropicToolUseResponse; requestId?: string; }
/** Structured failure — transport classifies HTTP/network itself; adapter never inspects raw Error shapes. */
export interface AnthropicTransportFailure { kind: "http" | "network" | "offline"; status?: number; requestId?: string; retryAfterMs?: number; message?: string; }
/** Injected seam. send NEVER throws for HTTP/network — returns a Result. Real SDK transport is a separate relay PR. */
export interface AnthropicTransport { send(payload: AnthropicRequestPayload, options?: TransportOptions): Promise<Result<AnthropicTransportResult, AnthropicTransportFailure>>; }

export function buildAnthropicToolRequest(request: DialogueRequest, model: string, options?: DialogueGenerationOptions): AnthropicRequestPayload {
  // LLM-1 minimal payload. NO scripted text (avoids the model copying fallback prose). LLM-2 adds the full compiler + caching.
  const system = `你只把既定意图写成符合人物身份的中文台词。proposedClaims 只填台词中真正说出口、且来源在请求中提供的事实。`;
  const user = JSON.stringify({
    speakerId: request.speakerId,
    profile: request.speakerContext.profile,
    voice: request.speakerContext.voice,
    relevantMemories: request.speakerContext.relevantMemories,
  });
  return {
    model, max_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: user }],
    tools: [{ name: TOOL_NAME, description: "提交角色台词及其结构化事实。", strict: true, input_schema: dialogueToolOutputJsonSchema }],
    tool_choice: { type: "tool", name: TOOL_NAME, disable_parallel_tool_use: true },
  };
}

const TIMEOUT = Symbol("timeout");
const CANCEL = Symbol("cancel");

export function createAnthropicProvider(opts: { model: string; transport: AnthropicTransport }): DialogueProvider {
  return {
    id: `anthropic:${opts.model}`,
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: false, batch: false },
    async generate(request, options): Promise<ProviderResult<DialogueProviderResult>> {
      if (options?.signal?.aborted) return err<ProviderError>({ kind: "cancelled", retryable: false }); // pre-aborted
      const payload = buildAnthropicToolRequest(request, opts.model, options);
      const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let resolveCancel!: (v: typeof CANCEL) => void;
      const deadline = new Promise<typeof TIMEOUT>((res) => { timer = setTimeout(() => res(TIMEOUT), timeoutMs); });
      const cancel = new Promise<typeof CANCEL>((res) => { resolveCancel = res; });
      const onCallerAbort = () => resolveCancel(CANCEL);
      options?.signal?.addEventListener("abort", onCallerAbort, { once: true });
      try {
        // Promise.race guarantees the deadline/cancel even if the transport ignores the signal.
        const winner = await Promise.race([opts.transport.send(payload, { signal: controller.signal }), deadline, cancel]);
        if (winner === TIMEOUT) { controller.abort(); return err<ProviderError>({ kind: "transport", retryable: true, cause: "timeout" }); }
        if (winner === CANCEL) { controller.abort(); return err<ProviderError>({ kind: "cancelled", retryable: false }); }
        if (!winner.ok) return err(classifyTransportFailure(winner.error));
        return parseToolUse(winner.value, request, opts.model);
      } finally {
        options?.signal?.removeEventListener("abort", onCallerAbort); // remove even when transport returns first
        if (timer) clearTimeout(timer);
      }
    },
  };
}

function parseToolUse(res: AnthropicTransportResult, request: DialogueRequest, model: string): ProviderResult<DialogueProviderResult> {
  const m = res.message;
  const meta = res.requestId !== undefined ? { requestId: res.requestId } : undefined;
  switch (m.stop_reason) {
    case "tool_use": break;
    case "max_tokens": return err<ProviderError>({ kind: "protocol", retryable: true, cause: "truncated", meta });
    case "refusal": return err<ProviderError>({ kind: "refused", retryable: false, meta });
    case "pause_turn": return err<ProviderError>({ kind: "protocol", retryable: false, cause: "pause_turn", meta }); // v1: not a plain retry
    case "model_context_window_exceeded": return err<ProviderError>({ kind: "config", retryable: false, cause: "request_too_large", meta });
    default: return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  }
  const blocks = m.content.filter((b) => b.type === "tool_use");
  if (blocks.length === 0) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  if (blocks.length > 1) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "multiple_tool_calls", meta });
  if (blocks[0]!.name !== TOOL_NAME) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "wrong_tool", meta });
  const parsed = dialogueToolOutputSchema.safeParse(blocks[0]!.input);
  if (!parsed.success) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta });
  const u = m.usage;
  return ok<DialogueProviderResult>({
    speaker: request.speakerId,
    text: parsed.data.text,
    choices: [],
    proposedClaims: parsed.data.proposedClaims,
    ...(u ? { usage: { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0,
      ...(u.cache_read_input_tokens !== undefined ? { cacheReadTokens: u.cache_read_input_tokens } : {}),
      ...(u.cache_creation_input_tokens !== undefined ? { cacheCreationTokens: u.cache_creation_input_tokens } : {}) } } : {}),
    providerMeta: { provider: "anthropic", model, ...(res.requestId ? { requestId: res.requestId } : {}) },
  });
}

function classifyTransportFailure(f: AnthropicTransportFailure): ProviderError {
  const meta = { ...(f.requestId ? { requestId: f.requestId } : {}), ...(f.status ? { statusCode: f.status } : {}) };
  if (f.kind === "offline") return { kind: "offline", retryable: false, meta };
  if (f.kind === "network") return { kind: "transport", retryable: true, cause: "network", meta };
  switch (f.status) {           // f.kind === "http"
    case 408: return { kind: "transport", retryable: true, cause: "timeout", meta };
    case 401: case 403: return { kind: "config", retryable: false, cause: "auth", meta };
    case 402: return { kind: "config", retryable: false, cause: "billing", meta };
    case 404: return { kind: "config", retryable: false, cause: "model_not_found", meta };
    case 413: return { kind: "config", retryable: false, cause: "request_too_large", meta };
    case 429: return { kind: "transport", retryable: true, cause: "rate_limit", meta: { ...meta, ...(f.retryAfterMs ? { retryAfterMs: f.retryAfterMs } : {}) } };
    default:
      if (typeof f.status === "number" && f.status >= 500) return { kind: "transport", retryable: true, cause: "5xx", meta };
      if (typeof f.status === "number" && f.status >= 400) return { kind: "config", retryable: false, cause: "invalid_request", meta }; // all other 4xx → not retryable
      return { kind: "transport", retryable: true, cause: "network", meta };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: PASS.

- [ ] **Step 6: Add deadline/cancel tests (pre-abort, timeout, cancel)**

```ts
// append to tests/dialogue/anthropicProvider.test.ts
import { hangingTransport } from "./fixtures/anthropic";

describe("anthropicProvider — deadline & cancel", () => {
  it("pre-aborted caller signal → cancelled, transport never called", async () => {
    let called = false;
    const t: AnthropicTransport = { send: () => { called = true; return Promise.resolve({ ok: true } as never); } };
    const ac = new AbortController(); ac.abort();
    const r = await createAnthropicProvider({ model: "claude-sonnet-4-6", transport: t }).generate(makeRequest("shen_zhibai"), { signal: ac.signal });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "cancelled" });
    expect(called).toBe(false);
  });
  it("timeout fires (even if transport ignores signal) → transport/timeout retryable", async () => {
    const r = await createAnthropicProvider({ model: "claude-sonnet-4-6", transport: hangingTransport() }).generate(makeRequest("shen_zhibai"), { timeoutMs: 5 });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "transport", cause: "timeout", retryable: true });
  });
  it("caller aborts mid-flight → cancelled (not retryable)", async () => {
    const ac = new AbortController();
    const p = createAnthropicProvider({ model: "claude-sonnet-4-6", transport: hangingTransport() }).generate(makeRequest("shen_zhibai"), { signal: ac.signal, timeoutMs: 10000 });
    ac.abort();
    const r = await p;
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "cancelled", retryable: false });
  });
});
```

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: PASS (success + 3 deadline/cancel).

- [ ] **Step 7: Commit**

```bash
git add src/engine/dialogue/providers/anthropicProvider.ts tests/dialogue/anthropicProvider.test.ts tests/dialogue/fixtures/anthropic.ts
git commit -m "feat(dialogue): anthropic adapter（结构化 transport Result、Promise.race deadline、pre-abort、单工具 parse）"
```

---

### Task 5: Adapter classification — protocol + structured transport-failure table

**Files:**
- Modify: `tests/dialogue/anthropicProvider.test.ts`

(Classification code landed in Task 4; this task proves it exhaustively against the structured failure envelope. Fix the matching branch if a case fails.)

- [ ] **Step 1: Add protocol + failure tests**

```ts
// append to tests/dialogue/anthropicProvider.test.ts
import { msg, msgTransport, failTransport } from "./fixtures/anthropic";

const run = (t: ReturnType<typeof msgTransport>) => createAnthropicProvider({ model: "claude-sonnet-4-6", transport: t }).generate(makeRequest("shen_zhibai"));
const expectErr = async (p: Promise<{ ok: boolean }>, m: object) => { const x = await p as { ok: boolean; error?: object }; expect(x.ok).toBe(false); if (!x.ok) expect(x.error).toMatchObject(m); };

describe("anthropicProvider — protocol classification", () => {
  it("wrong tool", () => expectErr(run(msgTransport(msg({ content: [{ type: "tool_use", name: "other", input: {} }] }))), { kind: "protocol", cause: "wrong_tool" }));
  it("multiple tool calls", () => expectErr(run(msgTransport(msg({ content: [
    { type: "tool_use", name: "emit_dialogue_line", input: { text: "a", proposedClaims: [] } },
    { type: "tool_use", name: "emit_dialogue_line", input: { text: "b", proposedClaims: [] } }] }))), { kind: "protocol", cause: "multiple_tool_calls" }));
  it("max_tokens → truncated", () => expectErr(run(msgTransport(msg({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "半", proposedClaims: [] } }] }))), { kind: "protocol", cause: "truncated" }));
  it("refusal → refused", () => expectErr(run(msgTransport(msg({ stop_reason: "refusal" }))), { kind: "refused" }));
  it("pause_turn → protocol NOT retryable", () => expectErr(run(msgTransport(msg({ stop_reason: "pause_turn" }))), { kind: "protocol", cause: "pause_turn", retryable: false }));
  it("context exceeded → config/request_too_large", () => expectErr(run(msgTransport(msg({ stop_reason: "model_context_window_exceeded" }))), { kind: "config", cause: "request_too_large" }));
  it("end_turn no tool → no_tool_call", () => expectErr(run(msgTransport(msg({ stop_reason: "end_turn", content: [{ type: "text" }] }))), { kind: "protocol", cause: "no_tool_call" }));
  it("invalid tool input → schema_invalid", () => expectErr(run(msgTransport(msg({ content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "", proposedClaims: [] } }] }))), { kind: "protocol", cause: "schema_invalid" }));
});

describe("anthropicProvider — transport-failure classification", () => {
  const fail = (f: Parameters<typeof failTransport>[0]) => createAnthropicProvider({ model: "claude-sonnet-4-6", transport: failTransport(f) }).generate(makeRequest("shen_zhibai"));
  it("offline → offline (not retryable)", () => expectErr(fail({ kind: "offline" }), { kind: "offline", retryable: false }));
  it("network → transport/network", () => expectErr(fail({ kind: "network" }), { kind: "transport", cause: "network" }));
  it("http 400 → config/invalid_request", () => expectErr(fail({ kind: "http", status: 400 }), { kind: "config", cause: "invalid_request", retryable: false }));
  it("http 401 → config/auth", () => expectErr(fail({ kind: "http", status: 401 }), { kind: "config", cause: "auth" }));
  it("http 402 → config/billing", () => expectErr(fail({ kind: "http", status: 402 }), { kind: "config", cause: "billing" }));
  it("http 404 → config/model_not_found", () => expectErr(fail({ kind: "http", status: 404 }), { kind: "config", cause: "model_not_found" }));
  it("http 408 → transport/timeout (retryable)", () => expectErr(fail({ kind: "http", status: 408 }), { kind: "transport", cause: "timeout", retryable: true }));
  it("http 413 → config/request_too_large", () => expectErr(fail({ kind: "http", status: 413 }), { kind: "config", cause: "request_too_large" }));
  it("http 422 (other 4xx) → config/invalid_request (not retryable)", () => expectErr(fail({ kind: "http", status: 422 }), { kind: "config", cause: "invalid_request", retryable: false }));
  it("http 429 → transport/rate_limit + retryAfterMs", () => expectErr(fail({ kind: "http", status: 429, retryAfterMs: 2000, requestId: "req_429" }), { kind: "transport", cause: "rate_limit", meta: { retryAfterMs: 2000, requestId: "req_429" } }));
  it("http 503 → transport/5xx", () => expectErr(fail({ kind: "http", status: 503 }), { kind: "transport", cause: "5xx" }));
});
```

- [ ] **Step 2: Run to verify (fail → fix branch → pass)**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add tests/dialogue/anthropicProvider.test.ts tests/dialogue/fixtures/anthropic.ts src/engine/dialogue/providers/anthropicProvider.ts
git commit -m "test(dialogue): adapter 协议 + 结构化传输失败分类全覆盖（4xx 不重试，408 timeout，pause_turn 不重试）"
```

---

### Task 6: `createDialogueProvider` routes anthropic by explicit `ModelRef.provider`

**Files:**
- Modify: `src/engine/dialogue/providers/remoteProvider.ts`
- Modify: `tests/dialogue/remoteProvider.test.ts`

**Interfaces:**
- Consumes: `createAnthropicProvider`, `AnthropicTransport` (Task 4); `ModelRef` (Task 1).
- Produces: `createDialogueProvider({ model: ModelRef; transport?: AnthropicTransport }): DialogueProvider`.

> Real SDK transport (relay/native) is OUT of LLM-1. Without an injected `transport`, the anthropic case returns `config/not_configured`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dialogue/remoteProvider.test.ts (replace)
import { describe, it, expect } from "vitest";
import { createDialogueProvider } from "../../src/engine/dialogue/providers/remoteProvider";
import { okTransport, makeRequest } from "./fixtures/anthropic";

describe("createDialogueProvider routing", () => {
  it("anthropic + injected transport → routed to the adapter", async () => {
    const provider = createDialogueProvider({ model: { provider: "anthropic", model: "claude-sonnet-4-6" }, transport: okTransport({ text: "臣妾遵旨。", proposedClaims: [] }) });
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
Expected: FAIL — `transport` param / routing absent.

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
git commit -m "feat(dialogue): createDialogueProvider 按 ModelRef.provider 显式路由 anthropic"
```

---

### Task 7: Acceptance — full `claim gate → text gate → mention writeback` (state-invariance asserted)

**Files:**
- Test: `tests/dialogue/anthropicProvider.integration.test.ts`

**Interfaces:**
- Consumes: `createAnthropicProvider` (Task 4); `assembleDialogueRequest`/`buildDialoguePolicyContext`/`produceDialogueLineWithPolicy` (orchestrator); `okTransport` (fixtures).

- [ ] **Step 1: Write the failing tests (4 chains; ranks read from state, not hardcoded; failures assert no mutation)**

```ts
// tests/dialogue/anthropicProvider.integration.test.ts
import { describe, it, expect } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { assembleDialogueRequest, buildDialoguePolicyContext, produceDialogueLineWithPolicy } from "../../src/engine/dialogue/orchestrator";
import { createAnthropicProvider } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okTransport } from "./fixtures/anthropic";
import type { ProposedClaim } from "../../src/engine/dialogue/claims";

const db = loadRealContent();
const state = createNewGameState(db);
const SPEAKER = "shen_zhibai";
const correctRank = state.standing[SPEAKER]!.rank;                                   // real value from state
const wrongRank = Object.keys(db.ranks).find((r) => r !== correctRank)!;             // any other valid rank

function ctx(text: string, claims: ProposedClaim[]) {
  const req = assembleDialogueRequest(db, state, SPEAKER, "zichendian");
  if (!req.ok) throw new Error(req.error.message);
  const policy = buildDialoguePolicyContext(db, state, req.value);
  const provider = createAnthropicProvider({ model: "claude-sonnet-4-6", transport: okTransport({ text, proposedClaims: claims }) });
  return { req: req.value, policy, provider };
}
const rankClaim = (id: string, object: string, sourceIds: string[]): ProposedClaim =>
  ({ claim: { id, predicate: "holds_rank", subjectId: SPEAKER, object, modality: "assert" }, sourceContextIds: sourceIds, modality: "assert", certainty: 90 });
function firstOffered(ids: ReadonlySet<string>): string {
  const offered = [...ids][0];
  expect(offered).toBeDefined();
  if (!offered) throw new Error("fixture must offer memory context (speaker initial memories changed?)");
  return offered;
}

describe("anthropic provider — full PR5 pipeline acceptance", () => {
  it("(a) valid claim with a real offered source → passes, mentionLog grows", async () => {
    const { req, policy, provider } = ctx("本宫累了，陛下早些歇息。", []);
    const offered = firstOffered(policy.offeredContextIds);
    const { req: r2, policy: p2, provider: pr2 } = ctx("本宫累了。", [rankClaim("c1", correctRank, [offered])]);
    void req; void policy; void provider;
    const r = await produceDialogueLineWithPolicy(db, pr2, r2, p2, state);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.nextState.mentionLog.length).toBeGreaterThan(state.mentionLog.length);
  });

  it("(b) claim contradicts belief → CLAIM_REJECTED, state.mentionLog unchanged", async () => {
    const before = structuredClone(state.mentionLog);
    const offered = firstOffered(ctx("本宫累了。", []).policy.offeredContextIds);
    const { req, policy, provider } = ctx("本宫累了。", [rankClaim("c2", wrongRank, [offered])]);
    const r = await produceDialogueLineWithPolicy(db, provider, req, policy, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("CLAIM_REJECTED");
    expect(state.mentionLog).toEqual(before);
  });

  it("(c) unknown source context → reject, state.mentionLog unchanged", async () => {
    const before = structuredClone(state.mentionLog);
    const { req, policy, provider } = ctx("本宫累了。", [rankClaim("c3", correctRank, ["not_offered_xyz"])]);
    const r = await produceDialogueLineWithPolicy(db, provider, req, policy, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("CLAIM_REJECTED");
    expect(state.mentionLog).toEqual(before);
  });

  it("(d) claim valid but text has a forbidden term → text reject, state.mentionLog unchanged", async () => {
    const before = structuredClone(state.mentionLog);
    const probe = ctx("本宫累了。", []);
    const offered = firstOffered(probe.policy.offeredContextIds);
    const { req, policy, provider } = ctx("皇上圣明。", [rankClaim("c4", correctRank, [offered])]);
    const r = await produceDialogueLineWithPolicy(db, provider, req, policy, state);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error.code).toBe("GATE_REJECTED");
    expect(state.mentionLog).toEqual(before);
  });
});
```

- [ ] **Step 2: Run to verify (fail → fix wiring → pass)**

Run: `npx vitest run tests/dialogue/anthropicProvider.integration.test.ts`
Expected: all four pass. A failure reveals a contract mismatch — fix in the relevant task's file. (If `holds_rank`/`assert` with `certainty 90` doesn't trip belief-contradiction for `wrongRank`, mirror the exact claim the existing `pr5Integration.test.ts` chain (b) uses.)

- [ ] **Step 3: Full suite + typecheck**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green; re-enable any `it.skip` parked in Task 3.

- [ ] **Step 4: Commit**

```bash
git add tests/dialogue/anthropicProvider.integration.test.ts
git commit -m "test(dialogue): adapter 全链路验收（claim 接受写 mention；三类拒绝断言 state.mentionLog 不变）"
```

---

## Self-Review

**This round's required fixes — all incorporated:**
1. Scripted `choices` contradiction → constraint now states scripted has only `{text, expression?}`; mock `choices: []` is correct, not a regression; "authored choices must survive" claim removed. ✅
2. `DialogueToolOutput = z.infer<typeof dialogueToolOutputSchema>` (one Zod source); `proposedClaims` capped at 8. ✅
3. timeout/cancel races → pre-abort early return; `Promise.race` against deadline/cancel sentinels guarantees deadline even if transport ignores the signal; tests for pre-abort, timeout-ignoring-transport, mid-flight cancel. ✅
4. Transport failure is a **structured `Result<…, AnthropicTransportFailure>`** — adapter never casts `unknown`/touches raw Error; remaining 4xx → `config/invalid_request` (not retryable); 408 → retryable timeout. ✅
5. `pause_turn` → `protocol` with `retryable: false` in v1 (no plain retry). ✅
6. Task 7 asserts `state.mentionLog` unchanged on every failure chain and reads ranks from `state`/`db.ranks` instead of hardcoding. ✅

**Non-blocking tightenings:** `promptCaching: false` in LLM-1 (no cacheable prefix yet; `cache_control` removed from the v1 system block); `request.scripted` no longer sent to the model. ✅

**Out of scope:** LLM-3 (AuthorizedClaim/factKey/polarity/claim_not_allowed/ContextRef/live planner), LLM-2 (prompt compiler + caching + eval + batch), separate relay PR (real SDK transport + resolveCredential).

**Placeholder scan:** none. **Type consistency:** `dialogueToolOutputSchema`/`DialogueToolOutput`, `DialogueProviderResult`, `ProviderError`, `AnthropicTransport.send: Promise<Result<AnthropicTransportResult, AnthropicTransportFailure>>`, `createAnthropicProvider`/`createDialogueProvider` consistent across tasks; `produceDialogueLine` keeps `Result<DialogueLine, GameError>`.

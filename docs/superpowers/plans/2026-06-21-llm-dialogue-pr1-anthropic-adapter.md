# LLM-1 Anthropic Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dialogue provider stub with a real,厂商无关 contract and a working Anthropic adapter (forced strict tool, fixture-tested, zero live network in CI), without touching the live planner.

**Architecture:** One atomic breaking migration of `DialogueProvider.generate`'s return contract (`DialogueProviderResult` + `ProviderError`), then an `anthropicProvider` built around an **injected transport seam** so the strict-tool request-build / response-parse logic is unit-tested with recorded fixtures. `remoteProvider` becomes a facade routing by explicit `ModelRef.provider`. The adapter does ZERO fact/etiquette validation — its parsed result flows through the existing `claim gate → text gate → mention writeback` unchanged.

**Tech Stack:** TypeScript, Zod 4, Vitest. `@anthropic-ai/sdk` added as the *default* transport only (never invoked in tests).

## Global Constraints

- Spec of record: `docs/superpowers/specs/2026-06-21-llm-dialogue-provider-design.md`. Every decision below is from it.
- Determinism in tests: no real network, no `Math.random()`, no wall-clock. Anthropic calls go through an injected transport; tests pass recorded fixtures.
- `speaker` is derived by the adapter from `request.speakerId` — **never** trusted from model output. `usage`/`providerMeta` are adapter-supplied from the HTTP response.
- Tool schema is derived **only** from `DialogueToolOutput` (`dialogueToolOutputSchema`), never from `DialogueProviderResult`.
- Adapter performs no fact/etiquette/claim validation — delegated to existing `claimGate` + `gates`.
- v1: model does NOT render player choices. Adapter sets `choices: []` (no `choiceCandidates` infra until LLM-3). System prompt tells the model to return `choices: []`.
- `ProviderError` must not leak into the engine: convert at the orchestrator boundary via `mapProviderErrorToGameError`.
- This is a breaking migration — pre-release ([[no-save-backcompat]]); migrate ALL consumers in the same commit, keep the full suite green.
- Logs store only error classification + `requestId`; never API key or full prompt.
- This PR does NOT wire live `planReaction`/`assembleClaims`/`AuthorizedClaim`/`ContextRef`/`claim_not_allowed` — those are LLM-3.

---

### Task 1: Provider contract types + tool-output schema (additive)

Introduce the new types and the single-source tool-output schema **alongside** the existing contract (no behavior change yet, nothing flipped).

**Files:**
- Create: `src/engine/dialogue/providerContract.ts`
- Test: `tests/dialogue/providerContract.test.ts`

**Interfaces:**
- Consumes: `proposedClaimSchema`, `ProposedClaim` from `./claims`.
- Produces: `DialogueToolOutput`, `RenderedDialogueChoice`, `DialogueProviderResult`, `ProviderError`, `ProviderErrorMeta`, `ModelRef`, `ProviderCapabilities`, `ProviderResult<T>`, `dialogueToolOutputSchema`, `dialogueToolOutputJsonSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dialogue/providerContract.test.ts
import { describe, it, expect } from "vitest";
import {
  dialogueToolOutputSchema,
  dialogueToolOutputJsonSchema,
} from "../../src/engine/dialogue/providerContract";

describe("dialogueToolOutputSchema", () => {
  it("accepts a minimal valid tool output (empty choices, no claims)", () => {
    const r = dialogueToolOutputSchema.safeParse({ text: "本宫累了。", choices: [], proposedClaims: [] });
    expect(r.success).toBe(true);
  });
  it("defaults proposedClaims to [] when omitted", () => {
    const r = dialogueToolOutputSchema.safeParse({ text: "嗯。", choices: [] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.proposedClaims).toEqual([]);
  });
  it("rejects empty text", () => {
    expect(dialogueToolOutputSchema.safeParse({ text: "", choices: [], proposedClaims: [] }).success).toBe(false);
  });
  it("rejects more than 4 choices", () => {
    const choices = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}`, text: "x" }));
    expect(dialogueToolOutputSchema.safeParse({ text: "嗯。", choices, proposedClaims: [] }).success).toBe(false);
  });
  it("exposes a JSON schema object for the Anthropic tool input_schema", () => {
    expect(dialogueToolOutputJsonSchema).toMatchObject({ type: "object" });
    expect((dialogueToolOutputJsonSchema as { properties: object }).properties).toHaveProperty("text");
    // speaker/usage/providerMeta are NOT model-generated → must be absent from the tool schema
    expect((dialogueToolOutputJsonSchema as { properties: object }).properties).not.toHaveProperty("speaker");
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

/** A player-choice option rendered to text. v1: produced by the engine (authored), not the model. */
export interface RenderedDialogueChoice {
  id: string;
  text: string;
  tone?: "friendly" | "neutral" | "guarded" | "hostile" | "flirty"; // retained from existing pipeline; spec listed minimal id+text
}

/** EXACTLY the part the model produces via the forced tool. Tool schema derives only from this. */
export interface DialogueToolOutput {
  text: string;
  choices: RenderedDialogueChoice[];
  proposedClaims: ProposedClaim[];
}

/** Adapter-assembled result: model output + adapter-supplied speaker/usage/providerMeta. */
export interface DialogueProviderResult {
  speaker: string;
  text: string;
  choices: RenderedDialogueChoice[];
  proposedClaims: ProposedClaim[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  providerMeta?: { provider: string; model: string; requestId?: string };
}

export interface ProviderErrorMeta {
  message?: string;
  statusCode?: number;
  retryAfterMs?: number;
  requestId?: string;
}

export type ProviderError =
  | { kind: "transport"; retryable: true; cause: "timeout" | "rate_limit" | "5xx" | "network"; meta?: ProviderErrorMeta }
  | { kind: "protocol"; retryable: true; cause: "no_tool_call" | "wrong_tool" | "schema_invalid" | "truncated" | "multiple_tool_calls"; meta?: ProviderErrorMeta }
  | { kind: "config"; retryable: false; cause: "not_configured" | "auth" | "incompatible_schema"; meta?: ProviderErrorMeta }
  | { kind: "offline"; retryable: false; meta?: ProviderErrorMeta }
  | { kind: "refused"; retryable: false; meta?: ProviderErrorMeta };

export type ProviderResult<T> = Result<T, ProviderError>;

export interface ModelRef {
  provider: "anthropic" | "openai" | "qwen" | "kimi" | "deepseek";
  model: string;
}

export interface ProviderCapabilities {
  strictTools: boolean;
  promptCaching: boolean;
  batch: boolean;
}

const renderedChoiceSchema = z.strictObject({
  id: z.string().min(1),
  text: z.string().min(1).max(120),
  tone: z.enum(["friendly", "neutral", "guarded", "hostile", "flirty"]).optional(),
});

/** SINGLE SOURCE for the forced-tool input schema (no speaker/usage/providerMeta). */
export const dialogueToolOutputSchema = z.strictObject({
  text: z.string().min(1).max(600),
  choices: z.array(renderedChoiceSchema).max(4),
  proposedClaims: z.array(proposedClaimSchema).default([]),
});

/** JSON-schema view for Anthropic tool input_schema, derived from the same zod source. */
export const dialogueToolOutputJsonSchema = z.toJSONSchema(dialogueToolOutputSchema);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/dialogue/providerContract.test.ts`
Expected: PASS (5 tests). If `z.toJSONSchema` is unavailable in the installed Zod, replace with a hand-written constant mirroring the schema and add an equivalence test; Zod 4.4.3 here ships `z.toJSONSchema`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/dialogue/providerContract.ts tests/dialogue/providerContract.test.ts
git commit -m "feat(dialogue): provider contract types + dialogueToolOutputSchema 单源（additive）"
```

---

### Task 2: `mapProviderErrorToGameError` boundary

Pure mapping so transport-layer errors never leak into the engine as raw `ProviderError`.

**Files:**
- Create: `src/engine/dialogue/providerError.ts`
- Test: `tests/dialogue/providerError.test.ts`

**Interfaces:**
- Consumes: `ProviderError` from `./providerContract`; `aiError`, `GameError` from `../infra/errors`.
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
  { e: { kind: "config", retryable: false, cause: "not_configured" }, code: "PROVIDER_CONFIG" },
  { e: { kind: "offline", retryable: false }, code: "PROVIDER_OFFLINE" },
  { e: { kind: "refused", retryable: false }, code: "PROVIDER_REFUSED" },
];

describe("mapProviderErrorToGameError", () => {
  it("maps each ProviderError kind to a stable ai GameError code", () => {
    for (const { e, code } of cases) {
      const g = mapProviderErrorToGameError(e);
      expect(g.category).toBe("ai");
      expect(g.code).toBe(code);
    }
  });
  it("carries requestId into context but never a key or full prompt", () => {
    const g = mapProviderErrorToGameError({ kind: "transport", retryable: true, cause: "5xx", meta: { requestId: "req_1", statusCode: 503 } });
    expect(g.context).toMatchObject({ requestId: "req_1", statusCode: 503, cause: "5xx" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/providerError.test.ts`
Expected: FAIL — `Cannot find module './providerError'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/engine/dialogue/providerError.ts
import { aiError, type GameError } from "../infra/errors";
import type { ProviderError } from "./providerContract";

const CODE: Record<ProviderError["kind"], string> = {
  transport: "PROVIDER_TRANSPORT",
  protocol: "PROVIDER_PROTOCOL",
  config: "PROVIDER_CONFIG",
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
git commit -m "feat(dialogue): mapProviderErrorToGameError 边界（ProviderError 不入引擎）"
```

---

### Task 3: Atomic contract flip — migrate ALL consumers

Flip `DialogueProvider.generate` to the new return contract and migrate every consumer in one commit. Behavior of the mock path is unchanged (still echoes scripted text); only the carried type changes.

**Files:**
- Modify: `src/engine/dialogue/types.ts` (DialogueProvider; remove `RawDialogueResponse*` reliance from the provider seam — keep the schema only where the orchestrator still parses, see below)
- Modify: `src/engine/dialogue/providers/mockProvider.ts`
- Modify: `src/engine/dialogue/providers/remoteProvider.ts`
- Modify: `src/engine/dialogue/orchestrator.ts` (`produceDialogueLine`, `produceDialogueLineWithPolicy`, `finalizeLine`)
- Modify: `src/engine/scenes/runner.ts`
- Modify: `src/ui/screens/BedchamberScene.tsx`, `src/ui/screens/DialogueScreen.tsx`, `src/ui/screens/ReactionScreen.tsx`
- Modify tests: `tests/dialogue/provider.test.ts`, `tests/dialogue/pr5Integration.test.ts`, `tests/dialogue/remoteProvider.test.ts`, `tests/scenes/runner.test.ts`, `tests/memory/memory.test.ts`

**Interfaces:**
- Consumes: `DialogueProviderResult`, `ProviderError`, `ProviderCapabilities` (Task 1); `mapProviderErrorToGameError` (Task 2).
- Produces: `DialogueProvider.generate(request, options?): Promise<ProviderResult<DialogueProviderResult>>`; `DialogueProvider.capabilities: ProviderCapabilities`.

- [ ] **Step 1: Update the contract in `types.ts`**

Replace the `DialogueProvider` interface and drop the provider seam's use of `RawDialogueResponseInput`. Keep `rawDialogueResponseSchema`/`DialogueLine` (the orchestrator still uses `DialogueLine`). Add the imports.

```ts
// src/engine/dialogue/types.ts — replace the DialogueProvider block
import type {
  DialogueProviderResult,
  ProviderResult,
  ProviderCapabilities,
} from "./providerContract";

export interface DialogueGenerationOptions {
  model?: import("./providerContract").ModelRef;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxTokens?: number;
}

export interface DialogueProvider {
  readonly id: string;
  readonly kind: "scripted" | "generative";
  readonly capabilities: ProviderCapabilities;
  generate(
    request: DialogueRequest,
    options?: DialogueGenerationOptions,
  ): Promise<ProviderResult<DialogueProviderResult>>;
}
```

- [ ] **Step 2: Migrate `mockProvider`**

```ts
// src/engine/dialogue/providers/mockProvider.ts
import { aiError } from "../../infra/errors";
import { err, ok } from "../../infra/result";
import type { DialogueProvider } from "../types";
import type { ProviderError, DialogueProviderResult } from "../providerContract";

const NO_SCRIPT: ProviderError = { kind: "config", retryable: false, cause: "not_configured" };

export const mockProvider: DialogueProvider = {
  id: "mock",
  kind: "scripted",
  capabilities: { strictTools: false, promptCaching: false, batch: false },
  generate(request) {
    if (!request.scripted) {
      // mock can only echo authored scripts; a non-scripted request is a misconfiguration.
      return Promise.resolve(err<ProviderError>(NO_SCRIPT));
    }
    const result: DialogueProviderResult = {
      speaker: request.speakerId,
      text: request.scripted.text,
      choices: [],
      proposedClaims: [],
      providerMeta: { provider: "mock", model: "mock" },
    };
    return Promise.resolve(ok(result));
  },
};
```

Note: the old mock returned `expression` from the script. Expression is resolved by `finalizeLine` against the character's expression list; with the new contract the scripted expression is no longer carried on the provider result. If any test asserts the scripted expression survives, carry it via a new optional `expression?` on `DialogueProviderResult` — but the current `provider.test.ts` only checks neutral-fallback behavior, so omit it (YAGNI). Confirm in Step 8.

- [ ] **Step 3: Migrate `remoteProvider` to a config-error stub**

```ts
// src/engine/dialogue/providers/remoteProvider.ts — replace createRemoteProvider body
import { err } from "../../infra/result";
import type { DialogueProvider, DialogueRequest } from "../types";
import type { ProviderError, DialogueProviderResult, ProviderResult } from "../providerContract";

export interface ProviderAdapter {
  readonly id: string;
  generate(
    request: DialogueRequest,
    options?: import("../types").DialogueGenerationOptions,
  ): Promise<ProviderResult<DialogueProviderResult>>;
}

export interface RemoteProviderConfig {
  readonly model: string;
  readonly apiKeyRef?: string; // reference only — never a key value
  readonly adapter?: ProviderAdapter; // when absent, generate refuses with config/not_configured
}

export function createRemoteProvider(config: RemoteProviderConfig): DialogueProvider {
  return {
    id: `remote:${config.model}`,
    kind: "generative",
    capabilities: config.adapter ? { strictTools: true, promptCaching: true, batch: false }
                                 : { strictTools: false, promptCaching: false, batch: false },
    generate(request, options) {
      if (!config.adapter) {
        const e: ProviderError = { kind: "config", retryable: false, cause: "not_configured" };
        return Promise.resolve(err(e));
      }
      return config.adapter.generate(request, options);
    },
  };
}
```

- [ ] **Step 4: Migrate the orchestrator**

In `produceDialogueLine` and `produceDialogueLineWithPolicy`, the provider now returns a parsed `DialogueProviderResult` (no `safeParse` of raw wire). Map provider errors at this boundary; build `RawDialogueResponse`-equivalent input for `finalizeLine` from the result.

```ts
// src/engine/dialogue/orchestrator.ts — replace produceDialogueLine
import { mapProviderErrorToGameError } from "./providerError";
import type { DialogueProviderResult } from "./providerContract";

export async function produceDialogueLine(
  db: ContentDB,
  provider: DialogueProvider,
  request: DialogueRequest,
  logger?: RingBufferLogger,
): Promise<Result<DialogueLine, GameError>> {
  const raw = await provider.generate(request);
  if (!raw.ok) return err(mapProviderErrorToGameError(raw.error));
  return finalizeLine(db, provider, request, raw.value, logger);
}
```

Change `finalizeLine`'s response param type from `RawDialogueResponse` to `DialogueProviderResult` (its fields `speaker`/`text`/`choices`/`expression?` are compatible; `expression` is now absent so the neutral fallback always applies unless added later). In `produceDialogueLineWithPolicy`, replace the `provider.generate` + `safeParse` block the same way and pass `raw.value` (a `DialogueProviderResult`) to the claim gate (`response.proposedClaims`) and `finalizeLine`.

```ts
// produceDialogueLineWithPolicy — replace the generate+parse prologue
const raw = await provider.generate(request);
if (!raw.ok) return err(mapProviderErrorToGameError(raw.error));
const response: DialogueProviderResult = raw.value;
// ...existing claim gate uses response.proposedClaims; finalizeLine(db, provider, request, response, logger)
```

Remove the now-unused `rawDialogueResponseSchema` import from the orchestrator (the schema lives in providerContract for the adapter). Keep `DialogueLine` import.

- [ ] **Step 5: Migrate `scenes/runner.ts` and the 3 UI screens**

These only call `produceDialogueLine`/construct providers; the signature of `produceDialogueLine` is unchanged (still `Result<DialogueLine, GameError>`), so the only required change is any direct use of `provider.generate` return shape or `RawDialogueResponse`. Grep and fix:

Run: `grep -rn "RawDialogueResponse\|\.generate(" src/engine/scenes/runner.ts src/ui/screens/*.tsx`
For each hit, if it reads `.value.speaker/text/choices`, it already matches `DialogueProviderResult`; if it `safeParse`s, delete the parse (the provider already returns a parsed result). Most screens just `produceDialogueLine(...).then(r => r.ok && setLine(r.value))` and need **no change**.

- [ ] **Step 6: Migrate the consumer tests**

- `tests/dialogue/provider.test.ts`: providers built inline must now return `ok<DialogueProviderResult>({ speaker, text, choices: [], proposedClaims: [] })` and include `capabilities`. The malformed-response test (`garbage`) now belongs to the **adapter** (Task 5), so move/replace it: a provider returning a `ProviderError` should surface as a mapped `GameError`. Update assertions to the new contract.
- `tests/dialogue/pr5Integration.test.ts`: `makeProvider` already returns `ok<RawDialogueResponseInput>(...)`; change its return type to `DialogueProviderResult` (add `speaker`, drop nothing) and add `capabilities` to the provider object.
- `tests/dialogue/remoteProvider.test.ts`: assert `createRemoteProvider({ model })` with no adapter refuses with `ProviderError { kind: "config", cause: "not_configured" }`.
- `tests/scenes/runner.test.ts`, `tests/memory/memory.test.ts`: update any inline provider to the new contract + `capabilities`.

```ts
// pattern for an inline test provider
const provider: DialogueProvider = {
  id: "synthetic", kind: "generative",
  capabilities: { strictTools: true, promptCaching: false, batch: false },
  generate: (req) => Promise.resolve(ok<DialogueProviderResult>({
    speaker: req.speakerId, text: "本宫累了，陛下早些歇息。", choices: [], proposedClaims: [],
  })),
};
```

- [ ] **Step 7: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean. Fix any consumer the grep missed until green.

- [ ] **Step 8: Run the full suite**

Run: `npx vitest run`
Expected: all pass (counts equal to baseline minus any test intentionally moved to the adapter in Task 5; if a moved test isn't replaced yet, temporarily `it.skip` it with a `// moved to anthropicProvider.test.ts (Task 5)` note and re-enable there).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(dialogue): 原子迁移 provider 返回契约到 DialogueProviderResult/ProviderError（mock/remote/orchestrator/runner/UI/测试）"
```

---

### Task 4: Anthropic adapter — transport seam + request build + parse

Build `anthropicProvider` around an injected transport so the forced-tool request build and response parse are unit-tested with fixtures. No network in tests.

**Files:**
- Create: `src/engine/dialogue/providers/anthropicProvider.ts`
- Test: `tests/dialogue/anthropicProvider.test.ts`
- Create fixtures: `tests/dialogue/fixtures/anthropic.ts`

**Interfaces:**
- Consumes: `dialogueToolOutputSchema`, `DialogueProviderResult`, `ProviderError`, `ProviderResult`, `ModelRef` (Task 1); `DialogueRequest`, `DialogueProvider`, `DialogueGenerationOptions` (types).
- Produces: `AnthropicTransport` (injected fn type), `createAnthropicProvider(opts: { model: string; transport: AnthropicTransport }): DialogueProvider`, `buildAnthropicToolRequest(request, model, options?)`.

- [ ] **Step 1: Write the failing test (success path)**

```ts
// tests/dialogue/anthropicProvider.test.ts
import { describe, it, expect } from "vitest";
import { createAnthropicProvider, type AnthropicTransport } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okToolUse } from "./fixtures/anthropic";
import { makeRequest } from "./fixtures/anthropic"; // helper builds a real DialogueRequest

describe("anthropicProvider — success", () => {
  it("forces emit_dialogue_line, parses tool input, derives speaker from request", async () => {
    let sentToolChoice: unknown;
    const transport: AnthropicTransport = (payload) => {
      sentToolChoice = payload.tool_choice;
      return Promise.resolve(okToolUse({ text: "本宫安好，多谢陛下挂念。", choices: [], proposedClaims: [] }, { requestId: "req_x" }));
    };
    const provider = createAnthropicProvider({ model: "claude-sonnet-4-6", transport });
    const req = makeRequest("shen_zhibai");
    const r = await provider.generate(req);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.speaker).toBe("shen_zhibai");          // from request, not model
    expect(r.value.text).toBe("本宫安好，多谢陛下挂念。");
    expect(r.value.providerMeta).toMatchObject({ provider: "anthropic", model: "claude-sonnet-4-6", requestId: "req_x" });
    expect(sentToolChoice).toEqual({ type: "tool", name: "emit_dialogue_line" });
  });
});
```

- [ ] **Step 2: Write the fixture helper**

```ts
// tests/dialogue/fixtures/anthropic.ts
import { createNewGameState } from "../../../src/engine/state/newGame";
import { loadRealContent } from "../../helpers/contentFixture";
import { assembleDialogueRequest } from "../../../src/engine/dialogue/orchestrator";
import type { DialogueToolOutput } from "../../../src/engine/dialogue/providerContract";

const db = loadRealContent();
const state = createNewGameState(db);

export function makeRequest(speakerId: string) {
  const r = assembleDialogueRequest(db, state, speakerId, "zichendian");
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

// Minimal shape of an Anthropic messages response carrying a forced tool_use block.
export function okToolUse(input: DialogueToolOutput, meta?: { requestId?: string }) {
  return {
    id: meta?.requestId ?? "req_test",
    stop_reason: "tool_use" as const,
    content: [{ type: "tool_use" as const, name: "emit_dialogue_line", input }],
    usage: { input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 1000 },
  };
}
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: FAIL — `Cannot find module '.../anthropicProvider'`.

- [ ] **Step 4: Implement the adapter (success path + request build)**

```ts
// src/engine/dialogue/providers/anthropicProvider.ts
import { err, ok } from "../../infra/result";
import { dialogueToolOutputSchema, dialogueToolOutputJsonSchema,
         type DialogueProviderResult, type ProviderError, type ProviderResult } from "../providerContract";
import type { DialogueProvider, DialogueRequest, DialogueGenerationOptions } from "../types";

const TOOL_NAME = "emit_dialogue_line";

/** Minimal Anthropic messages response shape this adapter reads. */
export interface AnthropicToolUseResponse {
  id?: string;
  stop_reason: string;
  content: { type: string; name?: string; input?: unknown }[];
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

export interface AnthropicRequestPayload {
  model: string;
  max_tokens: number;
  system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
  messages: { role: "user"; content: string }[];
  tools: { name: string; description: string; strict: true; input_schema: unknown }[];
  tool_choice: { type: "tool"; name: string };
}

/** Injected seam: real default uses @anthropic-ai/sdk; tests pass fixtures. */
export type AnthropicTransport = (
  payload: AnthropicRequestPayload,
  options?: DialogueGenerationOptions,
) => Promise<AnthropicToolUseResponse>;

export function buildAnthropicToolRequest(
  request: DialogueRequest,
  model: string,
  options?: DialogueGenerationOptions,
): AnthropicRequestPayload {
  // LLM-1: minimal prompt — full DialoguePromptPayload compiler is LLM-2.
  const system = `你只把既定意图写成符合人物身份的中文台词。proposedClaims 只填台词中真正说出口、且来源在请求中提供的事实。v1：choices 返回空数组。`;
  const user = JSON.stringify({
    speakerId: request.speakerId,
    profile: request.speakerContext.profile,
    voice: request.speakerContext.voice,
    relevantMemories: request.speakerContext.relevantMemories,
    scripted: request.scripted,
  });
  return {
    model,
    max_tokens: options?.maxTokens ?? 400,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    tools: [{ name: TOOL_NAME, description: "提交角色台词及其结构化事实。", strict: true, input_schema: dialogueToolOutputJsonSchema }],
    tool_choice: { type: "tool", name: TOOL_NAME },
  };
}

export function createAnthropicProvider(opts: { model: string; transport: AnthropicTransport }): DialogueProvider {
  return {
    id: `anthropic:${opts.model}`,
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: true, batch: true },
    async generate(request, options): Promise<ProviderResult<DialogueProviderResult>> {
      const payload = buildAnthropicToolRequest(request, opts.model, options);
      let res: AnthropicToolUseResponse;
      try {
        res = await opts.transport(payload, options);
      } catch (cause) {
        return err(classifyTransportError(cause)); // Task 5
      }
      return parseToolUse(res, request, opts.model); // Task 5 fills protocol errors
    },
  };
}
```

Add a temporary minimal `parseToolUse` + `classifyTransportError` so the success test passes; Task 5 hardens them:

```ts
function parseToolUse(res: AnthropicToolUseResponse, request: DialogueRequest, model: string): ProviderResult<DialogueProviderResult> {
  const block = res.content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
  if (!block) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta: { requestId: res.id } });
  const parsed = dialogueToolOutputSchema.safeParse(block.input);
  if (!parsed.success) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta: { requestId: res.id } });
  const result: DialogueProviderResult = {
    speaker: request.speakerId, // never trust model
    text: parsed.data.text,
    choices: [], // v1: model does not render choices
    proposedClaims: parsed.data.proposedClaims,
    ...(res.usage ? { usage: { inputTokens: res.usage.input_tokens ?? 0, outputTokens: res.usage.output_tokens ?? 0,
      ...(res.usage.cache_read_input_tokens !== undefined ? { cacheReadTokens: res.usage.cache_read_input_tokens } : {}),
      ...(res.usage.cache_creation_input_tokens !== undefined ? { cacheCreationTokens: res.usage.cache_creation_input_tokens } : {}) } } : {}),
    providerMeta: { provider: "anthropic", model, ...(res.id ? { requestId: res.id } : {}) },
  };
  return ok(result);
}

function classifyTransportError(_cause: unknown): ProviderError {
  return { kind: "transport", retryable: true, cause: "network" }; // Task 5 refines
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/engine/dialogue/providers/anthropicProvider.ts tests/dialogue/anthropicProvider.test.ts tests/dialogue/fixtures/anthropic.ts
git commit -m "feat(dialogue): anthropicProvider 注入式 transport + 强制 emit_dialogue_line + parse（success path）"
```

---

### Task 5: Adapter error classification (protocol + transport)

Fixture-drive every protocol/transport failure to a precise `ProviderError`.

**Files:**
- Modify: `src/engine/dialogue/providers/anthropicProvider.ts` (`parseToolUse`, `classifyTransportError`)
- Modify: `tests/dialogue/anthropicProvider.test.ts`
- Modify: `tests/dialogue/fixtures/anthropic.ts` (add failure fixtures)

**Interfaces:**
- Consumes: Task 4 exports.
- Produces: hardened `parseToolUse`/`classifyTransportError`.

- [ ] **Step 1: Write failing tests (protocol + transport table)**

```ts
// append to tests/dialogue/anthropicProvider.test.ts
import { wrongTool, multipleTools, truncated, malformedInput } from "./fixtures/anthropic";

describe("anthropicProvider — protocol failures", () => {
  const make = (res: AnthropicToolUseResponse) =>
    createAnthropicProvider({ model: "claude-sonnet-4-6", transport: () => Promise.resolve(res) }).generate(makeRequest("shen_zhibai"));

  it("no tool_use block → no_tool_call", async () => {
    const r = await make({ stop_reason: "end_turn", content: [{ type: "text" }] } as AnthropicToolUseResponse);
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "protocol", cause: "no_tool_call" });
  });
  it("different tool name → wrong_tool", async () => {
    const r = await make(wrongTool());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "protocol", cause: "wrong_tool" });
  });
  it("two tool_use blocks → multiple_tool_calls", async () => {
    const r = await make(multipleTools());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "protocol", cause: "multiple_tool_calls" });
  });
  it("stop_reason max_tokens → truncated", async () => {
    const r = await make(truncated());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "protocol", cause: "truncated" });
  });
  it("tool input fails schema → schema_invalid", async () => {
    const r = await make(malformedInput());
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "protocol", cause: "schema_invalid" });
  });
});

describe("anthropicProvider — transport failures", () => {
  const makeThrow = (cause: unknown) =>
    createAnthropicProvider({ model: "claude-sonnet-4-6", transport: () => Promise.reject(cause) }).generate(makeRequest("shen_zhibai"));

  it("AbortError → timeout", async () => {
    const r = await makeThrow(Object.assign(new Error("aborted"), { name: "AbortError" }));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "transport", cause: "timeout" });
  });
  it("status 429 → rate_limit with retryAfterMs", async () => {
    const r = await makeThrow({ status: 429, headers: { "retry-after": "2" }, request_id: "req_429" });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "transport", cause: "rate_limit", meta: { retryAfterMs: 2000, requestId: "req_429" } });
  });
  it("status 503 → 5xx", async () => {
    const r = await makeThrow({ status: 503 });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "transport", cause: "5xx" });
  });
  it("status 401 → config/auth (not retryable)", async () => {
    const r = await makeThrow({ status: 401 });
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "config", cause: "auth", retryable: false });
  });
});
```

- [ ] **Step 2: Add the failure fixtures**

```ts
// append to tests/dialogue/fixtures/anthropic.ts
import type { AnthropicToolUseResponse } from "../../../src/engine/dialogue/providers/anthropicProvider";
export const wrongTool = (): AnthropicToolUseResponse => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "other_tool", input: {} }] });
export const multipleTools = (): AnthropicToolUseResponse => ({ stop_reason: "tool_use", content: [
  { type: "tool_use", name: "emit_dialogue_line", input: { text: "a", choices: [], proposedClaims: [] } },
  { type: "tool_use", name: "emit_dialogue_line", input: { text: "b", choices: [], proposedClaims: [] } },
]});
export const truncated = (): AnthropicToolUseResponse => ({ stop_reason: "max_tokens", content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "半句", choices: [], proposedClaims: [] } }] });
export const malformedInput = (): AnthropicToolUseResponse => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "emit_dialogue_line", input: { text: "", choices: [], proposedClaims: [] } }] });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: FAIL on the new cases (current stubs return `no_tool_call`/`network` only).

- [ ] **Step 4: Harden `parseToolUse` and `classifyTransportError`**

```ts
function parseToolUse(res: AnthropicToolUseResponse, request: DialogueRequest, model: string): ProviderResult<DialogueProviderResult> {
  const blocks = res.content.filter((b) => b.type === "tool_use");
  const named = blocks.filter((b) => b.name === TOOL_NAME);
  if (named.length === 0) {
    const cause = blocks.length > 0 ? "wrong_tool" : "no_tool_call";
    return err<ProviderError>({ kind: "protocol", retryable: true, cause, meta: { requestId: res.id } });
  }
  if (named.length > 1) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "multiple_tool_calls", meta: { requestId: res.id } });
  if (res.stop_reason === "max_tokens") return err<ProviderError>({ kind: "protocol", retryable: true, cause: "truncated", meta: { requestId: res.id } });
  const parsed = dialogueToolOutputSchema.safeParse(named[0]!.input);
  if (!parsed.success) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta: { requestId: res.id } });
  // ...build DialogueProviderResult exactly as Task 4 Step 4 (speaker from request, choices: [], usage/meta)...
}

function classifyTransportError(cause: unknown): ProviderError {
  const e = cause as { name?: string; status?: number; headers?: Record<string, string>; request_id?: string };
  const meta = { ...(e.request_id ? { requestId: e.request_id } : {}) };
  if (e.name === "AbortError") return { kind: "transport", retryable: true, cause: "timeout", meta };
  if (e.status === 429) {
    const ra = e.headers?.["retry-after"]; const retryAfterMs = ra ? Number(ra) * 1000 : undefined;
    return { kind: "transport", retryable: true, cause: "rate_limit", meta: { ...meta, ...(retryAfterMs ? { retryAfterMs } : {}) } };
  }
  if (e.status === 401 || e.status === 403) return { kind: "config", retryable: false, cause: "auth", meta };
  if (typeof e.status === "number" && e.status >= 500) return { kind: "transport", retryable: true, cause: "5xx", meta: { ...meta, statusCode: e.status } };
  return { kind: "transport", retryable: true, cause: "network", meta };
}
```

(Keep the `DialogueProviderResult` build from Task 4 Step 4 inline where the `...` marker is.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/dialogue/anthropicProvider.test.ts`
Expected: PASS (success + 5 protocol + 4 transport).

- [ ] **Step 6: Commit**

```bash
git add src/engine/dialogue/providers/anthropicProvider.ts tests/dialogue/anthropicProvider.test.ts tests/dialogue/fixtures/anthropic.ts
git commit -m "feat(dialogue): anthropic adapter 协议/传输错误分类（fixture 驱动，CI 不调网络）"
```

---

### Task 6: `remoteProvider` routes by explicit `ModelRef.provider` + default SDK transport

Make `remoteProvider` a facade that routes to the anthropic adapter by explicit provider (no string-guessing), and add the real (untested-in-CI) default transport.

**Files:**
- Create: `src/engine/dialogue/providers/anthropicTransport.ts` (default transport over `@anthropic-ai/sdk`)
- Modify: `src/engine/dialogue/providers/remoteProvider.ts`
- Modify: `tests/dialogue/remoteProvider.test.ts`
- Modify: `package.json` (add `@anthropic-ai/sdk`)

**Interfaces:**
- Consumes: `createAnthropicProvider`, `AnthropicTransport` (Task 4); `ModelRef` (Task 1).
- Produces: `createDialogueProvider(config: { model: ModelRef; transport?: AnthropicTransport; apiKeyRef?: string }): DialogueProvider`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/dialogue/remoteProvider.test.ts (replace)
import { describe, it, expect } from "vitest";
import { createDialogueProvider } from "../../src/engine/dialogue/providers/remoteProvider";
import { okToolUse, makeRequest } from "./fixtures/anthropic";

describe("createDialogueProvider routing", () => {
  it("routes anthropic ModelRef to the anthropic adapter (explicit provider, no name guessing)", async () => {
    const provider = createDialogueProvider({
      model: { provider: "anthropic", model: "claude-sonnet-4-6" },
      transport: () => Promise.resolve(okToolUse({ text: "臣妾遵旨。", choices: [], proposedClaims: [] })),
    });
    expect(provider.capabilities.strictTools).toBe(true);
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(true); if (r.ok) expect(r.value.providerMeta?.provider).toBe("anthropic");
  });
  it("refuses an unimplemented provider with config/not_configured", async () => {
    const provider = createDialogueProvider({ model: { provider: "deepseek", model: "x" } });
    const r = await provider.generate(makeRequest("shen_zhibai"));
    expect(r.ok).toBe(false); if (!r.ok) expect(r.error).toMatchObject({ kind: "config", cause: "not_configured" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/remoteProvider.test.ts`
Expected: FAIL — `createDialogueProvider` not exported.

- [ ] **Step 3: Implement the facade + default transport**

```ts
// src/engine/dialogue/providers/remoteProvider.ts (replace createRemoteProvider with the facade)
import { err } from "../../infra/result";
import type { DialogueProvider } from "../types";
import type { ModelRef, ProviderError } from "../providerContract";
import { createAnthropicProvider, type AnthropicTransport } from "./anthropicProvider";
import { createAnthropicTransport } from "./anthropicTransport";

export function createDialogueProvider(config: {
  model: ModelRef;
  transport?: AnthropicTransport;   // injected in tests; default wires the SDK
  apiKeyRef?: string;
}): DialogueProvider {
  switch (config.model.provider) {
    case "anthropic":
      return createAnthropicProvider({
        model: config.model.model,
        transport: config.transport ?? createAnthropicTransport({ apiKeyRef: config.apiKeyRef }),
      });
    default: {
      const e: ProviderError = { kind: "config", retryable: false, cause: "not_configured" };
      return {
        id: `remote:${config.model.provider}:${config.model.model}`,
        kind: "generative",
        capabilities: { strictTools: false, promptCaching: false, batch: false },
        generate: () => Promise.resolve(err(e)),
      };
    }
  }
}
```

```ts
// src/engine/dialogue/providers/anthropicTransport.ts — default transport (NOT exercised in CI)
import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicTransport } from "./anthropicProvider";

/** Real transport over the SDK. Key is read from a relay/native layer, never the browser bundle. */
export function createAnthropicTransport(_opts?: { apiKeyRef?: string }): AnthropicTransport {
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the relay process env
  return async (payload, options) => {
    const res = await client.messages.create(
      { model: payload.model, max_tokens: payload.max_tokens, system: payload.system,
        messages: payload.messages, tools: payload.tools, tool_choice: payload.tool_choice } as never,
      { signal: options?.signal },
    );
    return res as never; // shape matches AnthropicToolUseResponse fields the adapter reads
  };
}
```

- [ ] **Step 4: Add the dependency**

Run: `npm install @anthropic-ai/sdk`
Then confirm: `node -p "require('./package.json').dependencies['@anthropic-ai/sdk']"`

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run tests/dialogue/remoteProvider.test.ts && npx tsc --noEmit`
Expected: PASS + clean. (`anthropicTransport.ts` compiles; never imported by tests.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(dialogue): remoteProvider facade 按 ModelRef.provider 显式路由 + 默认 SDK transport"
```

---

### Task 7: Acceptance — fixture-backed Anthropic provider flows through existing gates

Prove the adapter's parsed result runs the existing `claim gate → text gate → mention writeback` unchanged, with no fact validation duplicated in the adapter.

**Files:**
- Test: `tests/dialogue/anthropicProvider.integration.test.ts`

**Interfaces:**
- Consumes: `createAnthropicProvider` (Task 4); `assembleDialogueRequest`, `buildDialoguePolicyContext`, `produceDialogueLineWithPolicy` (orchestrator).

- [ ] **Step 1: Write the failing test**

```ts
// tests/dialogue/anthropicProvider.integration.test.ts
import { describe, it, expect } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import { assembleDialogueRequest, buildDialoguePolicyContext, produceDialogueLineWithPolicy } from "../../src/engine/dialogue/orchestrator";
import { createAnthropicProvider } from "../../src/engine/dialogue/providers/anthropicProvider";
import { okToolUse } from "./fixtures/anthropic";

const db = loadRealContent();
const state = createNewGameState(db);

describe("anthropic provider through the full PR5 pipeline", () => {
  it("a clean line with no claims passes text gate + writeback (mentionLog unchanged)", async () => {
    const req = assembleDialogueRequest(db, state, "shen_zhibai", "zichendian");
    if (!req.ok) throw new Error(req.error.message);
    const policy = buildDialoguePolicyContext(db, state, req.value);
    const provider = createAnthropicProvider({
      model: "claude-sonnet-4-6",
      transport: () => Promise.resolve(okToolUse({ text: "本宫累了，陛下早些歇息。", choices: [], proposedClaims: [] })),
    });
    const r = await produceDialogueLineWithPolicy(db, provider, req.value, policy, state);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.line.text).toBe("本宫累了，陛下早些歇息。");
    expect(r.value.nextState.mentionLog.length).toBe(state.mentionLog.length);
  });

  it("forbidden term from the model still fails the text gate", async () => {
    const req = assembleDialogueRequest(db, state, "shen_zhibai", "zichendian");
    if (!req.ok) throw new Error(req.error.message);
    const policy = buildDialoguePolicyContext(db, state, req.value);
    const provider = createAnthropicProvider({
      model: "claude-sonnet-4-6",
      transport: () => Promise.resolve(okToolUse({ text: "皇上圣明。", choices: [], proposedClaims: [] })),
    });
    const r = await produceDialogueLineWithPolicy(db, provider, req.value, policy, state);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("GATE_REJECTED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/dialogue/anthropicProvider.integration.test.ts`
Expected: FAIL if any wiring is off; otherwise iterate until the two cases hold.

- [ ] **Step 3: Make it pass**

No new production code expected — these reuse Tasks 1-6. If a failure appears, it reveals a contract mismatch (fix in the relevant task's file, not here).

- [ ] **Step 4: Run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: all green; re-enable any `it.skip` parked in Task 3 Step 8.

- [ ] **Step 5: Commit**

```bash
git add tests/dialogue/anthropicProvider.integration.test.ts
git commit -m "test(dialogue): anthropic provider 经既有 claim/text gate + writeback 全链路验收"
```

---

## Self-Review

**Spec coverage (LLM-1 scope):**
- 拆 `DialogueToolOutput`/`DialogueProviderResult`, tool schema 单源 → Task 1. ✅
- 原子破坏性迁移 + `ProviderError` + `mapProviderErrorToGameError` 边界 → Task 2 + Task 3. ✅
- `ModelRef` 显式路由 + `ProviderCapabilities` → Task 1 (types) + Task 6 (routing). ✅
- strict forced `emit_dialogue_line` + parse + speaker-from-request + usage/meta from response → Task 4. ✅
- 录制 fixture 协议/传输错误分类，CI 不调网络 → Task 5. ✅
- 默认 SDK transport(不在 CI 跑) + key 经 relay → Task 6. ✅
- choices v1 authored/空，模型只写台词 → Task 4 (choices: []), system prompt. ✅
- adapter 不复制事实校验；结果进既有 claim/text gate + writeback → Task 7 acceptance. ✅
- 不接 live planner（无 `AuthorizedClaim`/`ContextRef`/`claim_not_allowed`/factKey/polarity） → out of scope, deferred to LLM-3. ✅

**Out of scope (LLM-3, intentionally not here):** `AuthorizedClaim` provenance, `factKey` w/o modality, polarity split, `claim_not_allowed`, typed `ContextRef`, live `planReaction`/`assembleClaims`, `choiceCandidates` rendering. The full prompt compiler + caching boundary is LLM-2.

**Placeholder scan:** No "TBD"/"add error handling"/"similar to Task N" — every code step shows the actual code. The one `...` marker (Task 5 Step 4) explicitly points back to the Task 4 Step 4 build block, repeated rather than referenced.

**Type consistency:** `DialogueToolOutput`/`DialogueProviderResult`/`ProviderError`/`ModelRef`/`ProviderCapabilities`/`AnthropicTransport`/`AnthropicToolUseResponse`/`createAnthropicProvider`/`createDialogueProvider` are used with the same signatures across tasks. `produceDialogueLine` keeps its `Result<DialogueLine, GameError>` return (only its internal generate-handling changes).

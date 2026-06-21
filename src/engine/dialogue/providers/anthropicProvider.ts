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

/**
 * OpenAI dialogue provider — forced function calling onto the shared
 * dialogueToolOutputSchema. Mirrors anthropicProvider's shape: build payload →
 * inject transport → runWithDeadline → parse tool call → map errors onto the
 * shared ProviderError union. The SDK call lives behind OpenAITransport so this
 * module is unit-testable without network.
 */
import { ok, err, type Result } from "../../infra/result";
import {
  dialogueToolOutputSchema,
  dialogueToolOutputJsonSchema,
  makeUsageFromTotal,
  type DialogueProviderResult,
  type ProviderError,
  type ProviderResult,
  type ProviderErrorMeta,
  type NormalizedUsage,
} from "../providerContract";
import type { DialogueProvider, DialogueGenerationOptions, DialogueRequest } from "../types";
import { WORLD_RULES_TEXT, renderEtiquetteBlock } from "./anthropicProvider";
import { compilePromptPayload } from "../promptPayload";
import { runWithDeadline } from "./withDeadline";

const TOOL_NAME = "emit_dialogue_line";
const DEFAULT_MAX_TOKENS = 800;

export interface OpenAIRequestPayload {
  model: string;
  /** OpenAI deprecated max_tokens for chat completions; use max_completion_tokens. */
  max_completion_tokens: number;
  messages: { role: "system" | "user"; content: string }[];
  tools: { type: "function"; function: { name: string; description: string; parameters: unknown; strict: true } }[];
  tool_choice: { type: "function"; function: { name: string } };
}
export interface OpenAIToolResponse {
  finish_reason: string;
  tool_calls?: { function: { name: string; arguments: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
}
export interface OpenAITransportResult {
  message: OpenAIToolResponse;
  requestId?: string;
}
export interface OpenAITransportFailure {
  kind: "http" | "network" | "offline";
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
  message?: string;
}
export interface OpenAITransport {
  send(
    payload: OpenAIRequestPayload,
    opts?: { signal?: AbortSignal },
  ): Promise<Result<OpenAITransportResult, OpenAITransportFailure>>;
}

export function buildOpenAIToolRequest(
  request: DialogueRequest,
  model: string,
  options?: DialogueGenerationOptions,
): OpenAIRequestPayload {
  const payload = compilePromptPayload(request);
  const etiquette = renderEtiquetteBlock(
    request.etiquette,
    payload.speaker.standing.selfRefs,
    payload.audience.targetRole,
  );
  return {
    model,
    max_completion_tokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    messages: [
      { role: "system", content: `${WORLD_RULES_TEXT}\n\n${etiquette}` },
      { role: "user", content: JSON.stringify(payload) },
    ],
    tools: [
      {
        type: "function",
        function: { name: TOOL_NAME, description: "提交角色台词及其结构化事实。", parameters: dialogueToolOutputJsonSchema, strict: true },
      },
    ],
    tool_choice: { type: "function", function: { name: TOOL_NAME } },
  };
}

export function createOpenAIProvider(opts: { model: string; transport: OpenAITransport }): DialogueProvider {
  return {
    id: `openai:${opts.model}`,
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: true, batch: false },
    async generate(request, options): Promise<ProviderResult<DialogueProviderResult>> {
      const payload = buildOpenAIToolRequest(request, opts.model, options);
      const outcome = await runWithDeadline((signal) => opts.transport.send(payload, { signal }), {
        timeoutMs: options?.timeoutMs,
        signal: options?.signal,
      });
      if (outcome.kind === "timeout") return err<ProviderError>({ kind: "transport", retryable: true, cause: "timeout" });
      if (outcome.kind === "cancel") return err<ProviderError>({ kind: "cancelled", retryable: false });
      const r = outcome.value;
      if (!r.ok) return err(classifyOpenAIFailure(r.error));
      return parseOpenAIToolCall(r.value, request, opts.model);
    },
  };
}

function extractOpenAIUsage(m: OpenAIToolResponse): NormalizedUsage | undefined {
  const u = m.usage;
  if (!u) return undefined;
  // Raw values (no `?? 0`): a missing required token count → undefined usage.
  return makeUsageFromTotal({
    totalInputTokens: u.prompt_tokens,
    outputTokens: u.completion_tokens,
    ...(u.prompt_tokens_details?.cached_tokens !== undefined ? { cacheReadTokens: u.prompt_tokens_details.cached_tokens } : {}),
  });
}

function parseOpenAIToolCall(
  res: OpenAITransportResult,
  request: DialogueRequest,
  model: string,
): ProviderResult<DialogueProviderResult> {
  const m = res.message;
  const usage = extractOpenAIUsage(m);
  const meta: ProviderErrorMeta = {
    ...(res.requestId !== undefined ? { requestId: res.requestId } : {}),
    ...(usage ? { usage } : {}),
  };
  if (m.finish_reason === "length") return err<ProviderError>({ kind: "protocol", retryable: true, cause: "truncated", meta });
  if (m.finish_reason === "content_filter") return err<ProviderError>({ kind: "refused", retryable: false, meta });
  const calls = m.tool_calls ?? [];
  if (calls.length === 0) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  if (calls.length > 1) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "multiple_tool_calls", meta });
  if (calls[0]!.function.name !== TOOL_NAME) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "wrong_tool", meta });
  let raw: unknown;
  try {
    raw = JSON.parse(calls[0]!.function.arguments);
  } catch {
    return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta });
  }
  const parsed = dialogueToolOutputSchema.safeParse(raw);
  if (!parsed.success) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta });
  return ok<DialogueProviderResult>({
    speaker: request.speakerId,
    text: parsed.data.text,
    choices: [],
    proposedClaims: parsed.data.proposedClaims,
    mentionedContextRefs: parsed.data.mentionedContextRefs,
    ...(usage ? { usage } : {}),
    providerMeta: { provider: "openai", model, ...(res.requestId ? { requestId: res.requestId } : {}) },
  });
}

function classifyOpenAIFailure(f: OpenAITransportFailure): ProviderError {
  const meta = { ...(f.requestId ? { requestId: f.requestId } : {}), ...(f.status ? { statusCode: f.status } : {}) };
  if (f.kind === "offline") return { kind: "offline", retryable: false, meta };
  if (f.kind === "network") return { kind: "transport", retryable: true, cause: "network", meta };
  switch (f.status) {
    case 408:
      return { kind: "transport", retryable: true, cause: "timeout", meta };
    case 401:
    case 403:
      return { kind: "config", retryable: false, cause: "auth", meta };
    case 402:
      return { kind: "config", retryable: false, cause: "billing", meta };
    case 404:
      return { kind: "config", retryable: false, cause: "model_not_found", meta };
    case 413:
      return { kind: "config", retryable: false, cause: "request_too_large", meta };
    case 429:
      return {
        kind: "transport",
        retryable: true,
        cause: "rate_limit",
        meta: { ...meta, ...(f.retryAfterMs ? { retryAfterMs: f.retryAfterMs } : {}) },
      };
    default:
      if (typeof f.status === "number" && f.status >= 500) return { kind: "transport", retryable: true, cause: "5xx", meta };
      if (typeof f.status === "number" && f.status >= 400) return { kind: "config", retryable: false, cause: "invalid_request", meta };
      return { kind: "transport", retryable: true, cause: "network", meta };
  }
}

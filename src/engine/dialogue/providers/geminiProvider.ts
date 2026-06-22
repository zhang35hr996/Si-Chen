/**
 * Google/Gemini dialogue provider — forced function calling onto the shared
 * dialogueToolOutputSchema via @google/genai. The shared schema is NOT changed
 * to suit Gemini; instead sanitizeJsonSchemaForGemini strips the JSON-schema
 * keywords Gemini's dialect rejects (additionalProperties, $schema, default…).
 * The SDK call lives behind GeminiTransport so this module is unit-testable
 * without network.
 */
import { ok, err, type Result } from "../../infra/result";
import {
  dialogueToolOutputSchema,
  dialogueToolOutputJsonSchema,
  type DialogueProviderResult,
  type ProviderError,
  type ProviderResult,
} from "../providerContract";
import type { DialogueProvider, DialogueGenerationOptions, DialogueRequest } from "../types";
import { WORLD_RULES_TEXT, renderEtiquetteBlock } from "./anthropicProvider";
import { compilePromptPayload } from "../promptPayload";
import { runWithDeadline } from "./withDeadline";

const TOOL_NAME = "emit_dialogue_line";
const DEFAULT_MAX_TOKENS = 800;

/** JSON-schema keywords Gemini's parametersJsonSchema dialect does not accept. */
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
  model: string;
  systemInstruction: string;
  contents: string;
  maxOutputTokens: number;
  functionDeclaration: { name: string; description: string; parametersJsonSchema: unknown };
}
export interface GeminiTransportResult {
  functionCalls?: { name: string; args: unknown }[];
  finishReason?: string;
  usage?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
  requestId?: string;
}
export interface GeminiTransportFailure {
  kind: "http" | "network" | "offline";
  status?: number;
  requestId?: string;
  retryAfterMs?: number;
  message?: string;
}
export interface GeminiTransport {
  send(
    payload: GeminiRequestPayload,
    opts?: { signal?: AbortSignal },
  ): Promise<Result<GeminiTransportResult, GeminiTransportFailure>>;
}

export function buildGeminiToolRequest(
  request: DialogueRequest,
  model: string,
  options?: DialogueGenerationOptions,
): GeminiRequestPayload {
  const payload = compilePromptPayload(request);
  const etiquette = renderEtiquetteBlock(
    request.etiquette,
    payload.speaker.standing.selfRefs,
    payload.audience.targetRole,
  );
  return {
    model,
    maxOutputTokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
    systemInstruction: `${WORLD_RULES_TEXT}\n\n${etiquette}`,
    contents: JSON.stringify(payload),
    functionDeclaration: {
      name: TOOL_NAME,
      description: "提交角色台词及其结构化事实。",
      parametersJsonSchema: sanitizeJsonSchemaForGemini(dialogueToolOutputJsonSchema),
    },
  };
}

export function createGeminiProvider(opts: { model: string; transport: GeminiTransport }): DialogueProvider {
  return {
    id: `google:${opts.model}`,
    kind: "generative",
    capabilities: { strictTools: true, promptCaching: false, batch: false },
    async generate(request, options): Promise<ProviderResult<DialogueProviderResult>> {
      const payload = buildGeminiToolRequest(request, opts.model, options);
      const outcome = await runWithDeadline((signal) => opts.transport.send(payload, { signal }), {
        timeoutMs: options?.timeoutMs,
        signal: options?.signal,
      });
      if (outcome.kind === "timeout") return err<ProviderError>({ kind: "transport", retryable: true, cause: "timeout" });
      if (outcome.kind === "cancel") return err<ProviderError>({ kind: "cancelled", retryable: false });
      const r = outcome.value;
      if (!r.ok) return err(classifyGeminiFailure(r.error));
      return parseGeminiCall(r.value, request, opts.model);
    },
  };
}

function parseGeminiCall(
  res: GeminiTransportResult,
  request: DialogueRequest,
  model: string,
): ProviderResult<DialogueProviderResult> {
  const meta = res.requestId !== undefined ? { requestId: res.requestId } : undefined;
  if (res.finishReason === "MAX_TOKENS") return err<ProviderError>({ kind: "protocol", retryable: true, cause: "truncated", meta });
  if (res.finishReason === "SAFETY" || res.finishReason === "PROHIBITED_CONTENT")
    return err<ProviderError>({ kind: "refused", retryable: false, meta });
  const calls = res.functionCalls ?? [];
  if (calls.length === 0) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "no_tool_call", meta });
  if (calls.length > 1) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "multiple_tool_calls", meta });
  if (calls[0]!.name !== TOOL_NAME) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "wrong_tool", meta });
  const parsed = dialogueToolOutputSchema.safeParse(calls[0]!.args);
  if (!parsed.success) return err<ProviderError>({ kind: "protocol", retryable: true, cause: "schema_invalid", meta });
  const u = res.usage;
  return ok<DialogueProviderResult>({
    speaker: request.speakerId,
    text: parsed.data.text,
    choices: [],
    proposedClaims: parsed.data.proposedClaims,
    ...(u
      ? {
          usage: {
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: u.candidatesTokenCount ?? 0,
            ...(u.cachedContentTokenCount !== undefined ? { cacheReadTokens: u.cachedContentTokenCount } : {}),
          },
        }
      : {}),
    providerMeta: { provider: "google", model, ...(res.requestId ? { requestId: res.requestId } : {}) },
  });
}

function classifyGeminiFailure(f: GeminiTransportFailure): ProviderError {
  const meta = { ...(f.requestId ? { requestId: f.requestId } : {}), ...(f.status ? { statusCode: f.status } : {}) };
  if (f.kind === "offline") return { kind: "offline", retryable: false, meta };
  if (f.kind === "network") return { kind: "transport", retryable: true, cause: "network", meta };
  switch (f.status) {
    case 400:
      return { kind: "config", retryable: false, cause: "invalid_request", meta };
    case 401:
    case 403:
      return { kind: "config", retryable: false, cause: "auth", meta };
    case 404:
      return { kind: "config", retryable: false, cause: "model_not_found", meta };
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

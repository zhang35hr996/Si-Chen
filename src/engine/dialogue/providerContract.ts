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

/**
 * Provider-normalized token usage. Vendors disagree on what "input tokens" means
 * (Anthropic input_tokens EXCLUDES cache read/creation; OpenAI prompt_tokens and
 * Gemini promptTokenCount INCLUDE cached tokens), so we record explicit fields
 * with one fixed meaning for every provider:
 *
 *   uncachedInputTokens  — input billed at the standard input rate (no cache).
 *   totalInputTokens     — full prompt size = uncached + cacheRead + cacheCreation.
 *   outputTokens         — generated tokens.
 *   cacheReadTokens      — cached input read back (discounted).
 *   cacheCreationTokens  — cache-write tokens (Anthropic only; premium).
 *
 * Invariant: totalInputTokens === uncachedInputTokens + (cacheReadTokens ?? 0)
 *            + (cacheCreationTokens ?? 0).
 */
export interface NormalizedUsage {
  uncachedInputTokens: number;
  totalInputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Build NormalizedUsage when the provider reports UNCACHED input (Anthropic). */
export function makeUsage(parts: {
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}): NormalizedUsage {
  const cacheRead = parts.cacheReadTokens ?? 0;
  const cacheCreation = parts.cacheCreationTokens ?? 0;
  return {
    uncachedInputTokens: parts.uncachedInputTokens,
    totalInputTokens: parts.uncachedInputTokens + cacheRead + cacheCreation,
    outputTokens: parts.outputTokens,
    ...(parts.cacheReadTokens !== undefined ? { cacheReadTokens: parts.cacheReadTokens } : {}),
    ...(parts.cacheCreationTokens !== undefined ? { cacheCreationTokens: parts.cacheCreationTokens } : {}),
  };
}

/** Build NormalizedUsage when the provider reports TOTAL input incl. cache (OpenAI, Gemini). */
export function makeUsageFromTotal(parts: {
  totalInputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
}): NormalizedUsage {
  const cacheRead = parts.cacheReadTokens ?? 0;
  return {
    uncachedInputTokens: Math.max(0, parts.totalInputTokens - cacheRead),
    totalInputTokens: parts.totalInputTokens,
    outputTokens: parts.outputTokens,
    ...(parts.cacheReadTokens !== undefined ? { cacheReadTokens: parts.cacheReadTokens } : {}),
  };
}

export interface DialogueProviderResult {
  speaker: string;
  text: string;
  expression?: string;                 // scripted authored; Anthropic omits → neutral fallback
  choices: RenderedDialogueChoice[];    // engine-authored; v1 adapter sets []
  proposedClaims: ProposedClaim[];
  usage?: NormalizedUsage;
  providerMeta?: { provider: string; model: string; requestId?: string };
}

/** usage is carried even on protocol failures — a billed-but-unparseable turn still cost money. */
export interface ProviderErrorMeta { message?: string; statusCode?: number; retryAfterMs?: number; requestId?: string; usage?: NormalizedUsage; }
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
export interface ModelRef { provider: "anthropic" | "openai" | "google" | "qwen" | "kimi" | "deepseek"; model: string; }
export interface ProviderCapabilities { strictTools: boolean; promptCaching: boolean; batch: boolean; }

import { z } from "zod";
import { proposedClaimSchema, contextRefSchema, type ProposedClaim, type ContextRef } from "./claims";
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
  // Context the model actually drew on this turn (memories/events), independent of
  // factual claims. Drives the mention cooldown so a trauma referenced without a
  // claim still cools down instead of repeating every turn (PR-A item 6).
  mentionedContextRefs: z.array(contextRefSchema).max(8).default([]),
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

/** A token count must be a non-negative, finite integer (Number.isInteger rejects NaN/Infinity). */
const isCount = (n: number): boolean => Number.isInteger(n) && n >= 0;

/**
 * Build NormalizedUsage when the provider reports UNCACHED input (Anthropic).
 * Returns undefined when a REQUIRED field is missing or any field is not a
 * non-negative integer — a partial/garbled usage object must NOT be treated as a
 * priced zero-cost run. The invariant holds by construction.
 */
export function makeUsage(parts: {
  uncachedInputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}): NormalizedUsage | undefined {
  const { uncachedInputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = parts;
  if (uncachedInputTokens === undefined || outputTokens === undefined) return undefined;
  if (!isCount(uncachedInputTokens) || !isCount(outputTokens)) return undefined;
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined;
  if (cacheCreationTokens !== undefined && !isCount(cacheCreationTokens)) return undefined;
  const cr = cacheReadTokens ?? 0;
  const cc = cacheCreationTokens ?? 0;
  return {
    uncachedInputTokens,
    totalInputTokens: uncachedInputTokens + cr + cc,
    outputTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
    ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
  };
}

/**
 * Build NormalizedUsage when the provider reports TOTAL input incl. cache
 * (OpenAI, Gemini). Returns undefined on a missing required field, a non-integer
 * count, or contradictory data (cacheRead > total). Never clamps a contradiction
 * into an invariant-violating object.
 */
export function makeUsageFromTotal(parts: {
  totalInputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
}): NormalizedUsage | undefined {
  const { totalInputTokens, outputTokens, cacheReadTokens } = parts;
  if (totalInputTokens === undefined || outputTokens === undefined) return undefined;
  if (!isCount(totalInputTokens) || !isCount(outputTokens)) return undefined;
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined;
  const cr = cacheReadTokens ?? 0;
  if (cr > totalInputTokens) return undefined; // cached input cannot exceed the total prompt
  return {
    uncachedInputTokens: totalInputTokens - cr,
    totalInputTokens,
    outputTokens,
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
  };
}

export interface DialogueProviderResult {
  speaker: string;
  text: string;
  expression?: string;                 // scripted authored; Anthropic omits → neutral fallback
  choices: RenderedDialogueChoice[];    // engine-authored; v1 adapter sets []
  proposedClaims: ProposedClaim[];
  /** Context items (memories/events) the model referenced; drives mention cooldown. */
  mentionedContextRefs?: ContextRef[];
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

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
export interface ModelRef { provider: "anthropic" | "openai" | "google" | "qwen" | "kimi" | "deepseek"; model: string; }
export interface ProviderCapabilities { strictTools: boolean; promptCaching: boolean; batch: boolean; }

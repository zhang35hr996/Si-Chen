/**
 * Remote provider SKELETON (skeleton-plan §11 + §14). Types only — ZERO network
 * code, no API-key handling, no streaming. It exists so the future LLM adapter
 * (DESIGN §5.7 adapters + routing) slots into the SAME `DialogueProvider` seam
 * MockProvider already proves; `generate` always refuses with NOT_CONFIGURED.
 *
 * Nothing in the runtime imports this file — only the PR 11 tests do, asserting
 * the seam compiles and refuses cleanly. Connecting a real model is a later PR
 * that fills in an adapter and the network call; the contract here does not
 * change when it does.
 */
import { aiError, type GameError } from "../../infra/errors";
import { err, type Result } from "../../infra/result";
import type { DialogueProvider, DialogueRequest, RawDialogueResponse } from "../types";

/**
 * Translates between the engine's request/response shapes and a specific
 * vendor's wire format. v0 ships the interface only; no implementation exists.
 */
export interface ProviderAdapter {
  readonly id: string;
  /** Shape a DialogueRequest into a provider-agnostic wire payload. */
  toWire(request: DialogueRequest): unknown;
  /** Parse a raw wire response back into the validated RawDialogueResponse shape. */
  fromWire(raw: unknown): Result<RawDialogueResponse, GameError>;
}

export interface RemoteProviderConfig {
  readonly endpoint: string;
  readonly model: string;
  /**
   * A REFERENCE to where a key would be sourced (env var name, proxy id) — never
   * a key value. v0 does no key handling at all; this field documents the future
   * shape so callers don't bake secrets into config later.
   */
  readonly apiKeyRef?: string;
  readonly adapter: ProviderAdapter;
}

/**
 * Build a remote provider stub. It satisfies the DialogueProvider contract and
 * refuses every call until the network path is implemented in a later PR.
 */
export function createRemoteProvider(config: RemoteProviderConfig): DialogueProvider {
  return {
    id: `remote:${config.model}`,
    kind: "generative",
    generate(): Promise<Result<RawDialogueResponse, GameError>> {
      return Promise.resolve(
        err(
          aiError(
            "NOT_CONFIGURED",
            "remote dialogue provider is a v0 skeleton — no network, no API keys yet",
            { context: { endpoint: config.endpoint, model: config.model, adapter: config.adapter.id } },
          ),
        ),
      );
    },
  };
}

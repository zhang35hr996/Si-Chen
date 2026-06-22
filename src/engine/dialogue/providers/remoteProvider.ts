/**
 * Dialogue provider factory — final-shape facade (Task 3).
 * `createDialogueProvider` is the public API; Anthropic provider is wired via
 * HttpAnthropicTransport. Other providers return not_configured until wired.
 *
 * Old `ProviderAdapter`/`RemoteProviderConfig`/`createRemoteProvider` are
 * intentionally deleted here; they were a skeleton that is superseded by
 * this contract.
 */
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

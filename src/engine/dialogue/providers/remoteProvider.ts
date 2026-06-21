/**
 * Dialogue provider factory — final-shape facade (Task 3).
 * `createDialogueProvider` is the public API; it returns config/not_configured
 * for all providers until a real adapter is wired in a later task.
 *
 * Old `ProviderAdapter`/`RemoteProviderConfig`/`createRemoteProvider` are
 * intentionally deleted here; they were a skeleton that is superseded by
 * this contract.
 */
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

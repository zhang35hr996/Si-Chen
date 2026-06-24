import type { DialogueProvider, DialogueTurnOptions } from "./types";
import type { RingBufferLogger } from "../infra/logger";
import type { KnowledgeRetriever } from "./knowledge/types";

/**
 * Unified runtime dependency bundle for all generative dialogue entry points.
 * Browser-safe: only interface imports, no SQLite/Node-only modules.
 */
export interface DialogueRuntimeDeps {
  readonly provider: DialogueProvider;
  readonly logger?: RingBufferLogger;
  readonly knowledgeRetriever?: KnowledgeRetriever;
  readonly knowledgeFailureMode?: DialogueTurnOptions["knowledgeFailureMode"];
}

/** Convert a runtime deps bundle into the options accepted by produceDialogueTurn. */
export function toDialogueTurnOptions(deps: DialogueRuntimeDeps): DialogueTurnOptions {
  const opts: DialogueTurnOptions = {};
  if (deps.logger !== undefined) opts.logger = deps.logger;
  if (deps.knowledgeRetriever !== undefined) opts.retriever = deps.knowledgeRetriever;
  if (deps.knowledgeFailureMode !== undefined) opts.knowledgeFailureMode = deps.knowledgeFailureMode;
  return opts;
}

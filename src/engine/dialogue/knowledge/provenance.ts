import { contextRefKey, type ContextRef } from "../types";
import type { ProposedClaim } from "../claims";
import type { KnowledgeRetrievalStatus } from "../types";
import type { PromptKnowledgeChunk } from "./types";

export interface KnowledgeProvenance {
  /**
   * Stable first-seen union of all offered context refs from:
   *   1. accepted claim sourceRefs (claim order, then ref order)
   *   2. mentionedContextRefs (in order)
   * Filtered to `offeredRefKeys`; preserves all kinds (memory, event, fact, knowledge).
   */
  readonly sourceRefs: ContextRef[];
  /** Present when a retriever was wired (knowledgeContext !== undefined). */
  readonly knowledge:
    | {
        readonly chunkIds: string[];
        readonly degraded: boolean;
        readonly degradationKind?: "vector_degraded" | "fatal_degraded";
        readonly degradationReason?: import("../../knowledge/retrieval/types").VectorDegradation["reason"];
      }
    | undefined;
  /** Refs returned by the model that were NOT in offeredRefKeys. Requires diagnostics. */
  readonly unknownRefs: ContextRef[];
}

/**
 * Extracts full provenance from the validation pipeline outputs.
 *
 * `knowledgeContext = undefined` → no retriever wired → knowledge: undefined.
 * `knowledgeContext = []`        → retriever ran, returned empty hits.
 *
 * Degradation is derived from `retrievalStatus`, NEVER from `knowledgeContext.length`:
 *   - status "ok"              → degraded: false
 *   - status "vector_degraded" → degraded: true, degradationKind/Reason set
 *   - status "fatal_degraded"  → degraded: true, degradationKind set
 *   - status "not_configured"  → knowledge: undefined (same as knowledgeContext undefined)
 */
export function extractProvenance(
  acceptedClaims: readonly ProposedClaim[],
  mentionedContextRefs: readonly ContextRef[],
  offeredRefKeys: ReadonlySet<string>,
  knowledgeContext: readonly PromptKnowledgeChunk[] | undefined,
  retrievalStatus: KnowledgeRetrievalStatus,
): KnowledgeProvenance {
  const seen = new Set<string>();
  const seenUnknown = new Set<string>();
  const sourceRefs: ContextRef[] = [];
  const unknownRefs: ContextRef[] = [];
  const knowledgeChunkIds: string[] = [];

  function processRef(ref: ContextRef): void {
    const key = contextRefKey(ref);
    if (!offeredRefKeys.has(key)) {
      if (!seenUnknown.has(key)) {
        seenUnknown.add(key);
        unknownRefs.push(ref);
      }
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    sourceRefs.push(ref);
    if (ref.kind === "knowledge") {
      knowledgeChunkIds.push(ref.id);
    }
  }

  for (const pc of acceptedClaims) {
    for (const ref of pc.sourceRefs) {
      processRef(ref);
    }
  }
  for (const ref of mentionedContextRefs) {
    processRef(ref);
  }

  if (knowledgeContext === undefined || retrievalStatus.kind === "not_configured") {
    return { sourceRefs, knowledge: undefined, unknownRefs };
  }

  switch (retrievalStatus.kind) {
    case "ok":
      return {
        sourceRefs,
        knowledge: { chunkIds: knowledgeChunkIds, degraded: false },
        unknownRefs,
      };
    case "vector_degraded":
      return {
        sourceRefs,
        knowledge: {
          chunkIds: knowledgeChunkIds,
          degraded: true,
          degradationKind: "vector_degraded",
          degradationReason: retrievalStatus.reason,
        },
        unknownRefs,
      };
    case "fatal_degraded":
      return {
        sourceRefs,
        knowledge: {
          chunkIds: knowledgeChunkIds,
          degraded: true,
          degradationKind: "fatal_degraded",
        },
        unknownRefs,
      };
    case "skipped_runtime_state":
      // Retriever was configured but bypassed intentionally — not a failure.
      return {
        sourceRefs,
        knowledge: { chunkIds: [], degraded: false },
        unknownRefs,
      };
  }
}

// Backward-compat alias: old callers passed vectorDegraded: boolean.
// New code must call extractProvenance with KnowledgeRetrievalStatus.
/** @deprecated Use extractProvenance with KnowledgeRetrievalStatus */
export const extractKnowledgeProvenance = (
  acceptedClaims: readonly ProposedClaim[],
  mentionedContextRefs: readonly ContextRef[],
  knowledgeContext: readonly PromptKnowledgeChunk[] | undefined,
  vectorDegraded: boolean,
) =>
  extractProvenance(
    acceptedClaims,
    mentionedContextRefs,
    new Set(knowledgeContext?.map((c) => `knowledge:${c.id}`) ?? []),
    knowledgeContext,
    vectorDegraded ? { kind: "vector_degraded", reason: "provider_error" } : { kind: "ok" },
  );

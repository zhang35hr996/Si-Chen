import { contextRefKey, type ContextRef } from "../types";
import type { ProposedClaim } from "../claims";
import type { PromptKnowledgeChunk } from "./types";

export interface KnowledgeProvenance {
  /**
   * Stable first-seen union of all offered context refs drawn from:
   *   1. accepted claim sourceRefs (in claim order, then ref order)
   *   2. mentionedContextRefs (in order)
   * Deduplication by contextRefKey; refs NOT in offeredRefKeys are excluded.
   * Preserves all kinds (memory, event, fact, knowledge).
   */
  readonly sourceRefs: ContextRef[];
  /** Present when knowledge chunks were offered to the LLM this turn (knowledgeContext !== undefined). */
  readonly knowledge: { readonly chunkIds: string[]; readonly degraded: boolean } | undefined;
  /** Refs returned by the model that were not in offeredRefKeys (hallucinated or out-of-scope). */
  readonly unknownRefs: ContextRef[];
}

/**
 * Extracts full provenance from the validation pipeline outputs.
 *
 * - `sourceRefs`: stable first-seen union of all offered refs from accepted claims
 *   and mentionedContextRefs (all kinds). Unoffered refs are excluded and collected
 *   in `unknownRefs` for diagnostics.
 * - `knowledge.chunkIds`: IDs from the knowledge-kind subset of sourceRefs, in first-seen order.
 * - `knowledge.degraded`: true when vector retrieval degraded OR when knowledgeContext
 *   was empty (meaning retrieval ran but returned nothing, or failed fatally).
 * - `unknownRefs`: refs returned by the model that were not offered in offeredRefKeys.
 *
 * `knowledgeContext = undefined` → no retriever wired → `knowledge: undefined`.
 * `knowledgeContext = []`        → retriever ran, returned empty → `knowledge: { chunkIds: [], degraded: true }`.
 */
export function extractProvenance(
  acceptedClaims: readonly ProposedClaim[],
  mentionedContextRefs: readonly ContextRef[],
  offeredRefKeys: ReadonlySet<string>,
  knowledgeContext: readonly PromptKnowledgeChunk[] | undefined,
  vectorDegraded: boolean,
): KnowledgeProvenance {
  const seen = new Set<string>();
  const sourceRefs: ContextRef[] = [];
  const unknownRefs: ContextRef[] = [];
  const knowledgeChunkIds: string[] = [];

  function processRef(ref: ContextRef): void {
    const key = contextRefKey(ref);
    if (!offeredRefKeys.has(key)) {
      unknownRefs.push(ref);
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

  if (knowledgeContext === undefined) {
    return { sourceRefs, knowledge: undefined, unknownRefs };
  }

  // knowledgeContext is defined (possibly empty) → retriever was wired.
  // Degraded if: vector channel degraded, OR retrieval ran but produced no chunks.
  const degraded = vectorDegraded || knowledgeContext.length === 0;
  return {
    sourceRefs,
    knowledge: { chunkIds: knowledgeChunkIds, degraded },
    unknownRefs,
  };
}

// Keep the old name as an alias for backward compatibility with existing test imports.
// New code should call extractProvenance directly.
/** @deprecated Use extractProvenance */
export const extractKnowledgeProvenance = (
  acceptedClaims: readonly ProposedClaim[],
  mentionedContextRefs: readonly ContextRef[],
  knowledgeContext: readonly PromptKnowledgeChunk[] | undefined,
  vectorDegraded: boolean,
) =>
  extractProvenance(
    acceptedClaims,
    mentionedContextRefs,
    // Old callers didn't filter by offeredRefKeys — supply an all-accepting set
    // using the knowledge context IDs as the offered set (preserving old behaviour).
    new Set(knowledgeContext?.map((c) => `knowledge:${c.id}`) ?? []),
    knowledgeContext,
    vectorDegraded,
  );

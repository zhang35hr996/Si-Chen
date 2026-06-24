import type { ContextRef, ProposedClaim } from "../claims";
import type { PromptKnowledgeChunk } from "./types";

export interface KnowledgeProvenance {
  /** Knowledge refs drawn from mentionedContextRefs or accepted claim refs (knowledge kind only). */
  readonly sourceRefs: ContextRef[];
  /** Present when knowledge chunks were offered to the LLM this turn. */
  readonly knowledge: { readonly chunkIds: string[]; readonly degraded: boolean } | undefined;
}

/**
 * Extracts knowledge provenance from the validation pipeline outputs.
 * - `sourceRefs` are knowledge refs found in accepted claims or mentionedContextRefs.
 * - `knowledge.chunkIds` are the IDs of chunks that were offered and actually referenced.
 * - `knowledge.degraded` reflects whether vector retrieval was degraded this turn.
 */
export function extractKnowledgeProvenance(
  acceptedClaims: readonly ProposedClaim[],
  mentionedContextRefs: readonly ContextRef[],
  knowledgeContext: readonly PromptKnowledgeChunk[] | undefined,
  vectorDegraded: boolean,
): KnowledgeProvenance {
  if (!knowledgeContext || knowledgeContext.length === 0) {
    return { sourceRefs: [], knowledge: undefined };
  }

  const offeredIds = new Set(knowledgeContext.map((c) => c.id));
  const usedIds = new Set<string>();

  for (const pc of acceptedClaims) {
    for (const ref of pc.sourceRefs) {
      if (ref.kind === "knowledge" && offeredIds.has(ref.id)) usedIds.add(ref.id);
    }
  }
  for (const ref of mentionedContextRefs) {
    if (ref.kind === "knowledge" && offeredIds.has(ref.id)) usedIds.add(ref.id);
  }

  const chunkIds = [...usedIds].sort();
  const sourceRefs: ContextRef[] = chunkIds.map((id) => ({ kind: "knowledge" as const, id }));

  return {
    sourceRefs,
    knowledge: { chunkIds, degraded: vectorDegraded },
  };
}

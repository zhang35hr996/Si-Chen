import { VISIBILITY_RANK, type KnowledgeVisibility } from "../../knowledge/model";
import type { KnowledgeHybridHit } from "../../knowledge/retrieval/types";
import type { PromptKnowledgeChunk } from "./types";

const MAX_PROMPT_CHUNKS = 4;
const MAX_PROMPT_CHARS = 3200;

/**
 * Packs hybrid retrieval hits into at most MAX_PROMPT_CHUNKS chunks that fit
 * within MAX_PROMPT_CHARS. Chunks whose visibility exceeds the ceiling are
 * silently dropped (defense-in-depth: the retriever should already filter them,
 * but the packer enforces the ceiling independently).
 */
export function packPromptKnowledge(
  hits: readonly KnowledgeHybridHit[],
  ceiling: KnowledgeVisibility,
): PromptKnowledgeChunk[] {
  const ceilingRank = VISIBILITY_RANK[ceiling];
  const packed: PromptKnowledgeChunk[] = [];
  let totalChars = 0;

  for (const hit of hits) {
    if (packed.length >= MAX_PROMPT_CHUNKS) break;
    const chunk = hit.chunk;
    if (VISIBILITY_RANK[chunk.visibility] > ceilingRank) continue;
    const chunkChars = chunk.title.length + chunk.text.length;
    if (totalChars + chunkChars > MAX_PROMPT_CHARS) break;
    packed.push({
      id: chunk.id,
      title: chunk.title,
      text: chunk.text,
      sourceType: chunk.sourceType,
      visibility: chunk.visibility,
    });
    totalChars += chunkChars;
  }

  return packed;
}

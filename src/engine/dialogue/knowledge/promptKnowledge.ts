import { VISIBILITY_RANK, type KnowledgeVisibility } from "../../knowledge/model";
import type { KnowledgeHybridHit } from "../../knowledge/retrieval/types";
import type { PromptKnowledgeChunk } from "./types";

const MAX_PROMPT_CHUNKS = 4;
const MAX_PROMPT_CHARS = 3200;

/**
 * Packs hybrid retrieval hits into at most MAX_PROMPT_CHUNKS unique chunks that fit
 * within MAX_PROMPT_CHARS.
 *
 * - Chunks whose visibility exceeds the ceiling are skipped (defense-in-depth: the
 *   retriever should already filter them, but the packer enforces the ceiling independently).
 * - An oversized chunk is SKIPPED (not a break): later shorter chunks may still be included.
 * - Duplicate chunk IDs are skipped (a hit list may contain the same chunk via keyword
 *   and vector channels).
 * - Original rank order among accepted chunks is preserved.
 * - `visibility` is intentionally excluded from the packed output.
 */
export function packPromptKnowledge(
  hits: readonly KnowledgeHybridHit[],
  ceiling: KnowledgeVisibility,
): PromptKnowledgeChunk[] {
  const ceilingRank = VISIBILITY_RANK[ceiling];
  const packed: PromptKnowledgeChunk[] = [];
  const seenIds = new Set<string>();
  let totalChars = 0;

  for (const hit of hits) {
    if (packed.length >= MAX_PROMPT_CHUNKS) break;
    const chunk = hit.chunk;
    if (seenIds.has(chunk.id)) continue;
    if (VISIBILITY_RANK[chunk.visibility] > ceilingRank) continue;
    const chunkChars = chunk.title.length + chunk.text.length;
    if (totalChars + chunkChars > MAX_PROMPT_CHARS) continue;
    packed.push({
      id: chunk.id,
      title: chunk.title,
      text: chunk.text,
      sourceType: chunk.sourceType,
    });
    seenIds.add(chunk.id);
    totalChars += chunkChars;
  }

  return packed;
}

/**
 * Query intent classification for the knowledge retrieval layer.
 *
 * "runtime_state" queries ask about character-specific or time-specific facts
 * that cannot be answered from static lore (e.g. who is currently pregnant,
 * who received imperial favour yesterday). The retrieval layer should bypass
 * static corpus lookup for these and route to the runtime state system instead.
 *
 * "static_lore" queries ask about world rules, titles, institutions, or
 * general etiquette that are documented in the knowledge corpus.
 */

export type KnowledgeQueryIntent = "static_lore" | "runtime_state";

/** Time-relative markers indicating the query concerns current/recent state. */
const TEMPORAL_MARKERS = /现在|当前|最近|昨天|今天|方才|刚刚|目前|近来|上次|前几天/;

/** Vocabulary denoting dynamic character state that lives outside static lore. */
const DYNAMIC_STATE_VOCAB = /受宠|怀孕|禁足|宣召|召见|暗恋|病假|请假/;

/**
 * Classifies a free-text query into a retrieval intent category.
 *
 * Returns "runtime_state" if the query contains temporal markers or dynamic
 * state vocabulary that indicate it is asking about real-time character data.
 * Otherwise returns "static_lore".
 *
 * This is intentionally conservative: false negatives (runtime queries
 * classified as static_lore) are less harmful than false positives (static
 * queries skipping retrieval entirely).
 */
export function classifyQueryIntent(query: string): KnowledgeQueryIntent {
  if (TEMPORAL_MARKERS.test(query) || DYNAMIC_STATE_VOCAB.test(query)) {
    return "runtime_state";
  }
  return "static_lore";
}

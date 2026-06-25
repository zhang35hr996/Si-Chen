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
 * Requires the query to also name a specific person, record, or ranking —
 * the hallmark of a runtime lookup rather than a rule or institution question.
 */
const PERSON_OR_RECORD_SELECTOR = /谁|哪位|何人|哪个(?:侍君|皇嗣|官员|人)|谁最|名单|排名|记录/;

/**
 * Explicit markers that identify a question about rules, institutions, or
 * etiquette, even when temporal or dynamic vocabulary is also present.
 * Matching any of these overrides the runtime_state classification.
 */
const STATIC_RULE_MARKERS =
  /制度|规则|礼制|称谓|位分|如何称|为什么|能否|是否可以|期间|影响/;

/**
 * Classifies a free-text query into a retrieval intent category.
 *
 * A query is "runtime_state" only when it asks for a specific person/ranking
 * AND uses temporal or dynamic-state vocabulary — i.e. it is looking up live
 * character data, not asking about a world rule.
 *
 * An explicit static-rule marker (system/institution/etiquette vocabulary)
 * overrides the runtime classification even when other signals are present.
 *
 * This is intentionally conservative on false positives: a static query that
 * slips through to retrieval is always less harmful than a legitimate lore
 * question that gets silently skipped.
 */
export function classifyQueryIntent(query: string): KnowledgeQueryIntent {
  if (STATIC_RULE_MARKERS.test(query)) {
    return "static_lore";
  }
  if (
    PERSON_OR_RECORD_SELECTOR.test(query) &&
    (TEMPORAL_MARKERS.test(query) || DYNAMIC_STATE_VOCAB.test(query))
  ) {
    return "runtime_state";
  }
  return "static_lore";
}

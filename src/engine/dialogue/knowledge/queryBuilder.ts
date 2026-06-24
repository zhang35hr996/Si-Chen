import type { KnowledgeVisibility } from "../../knowledge/model";
import type { KnowledgeHybridQuery } from "../../knowledge/retrieval/types";
import type { DialogueRequest } from "../types";

const MAX_DIRECTIVE_CHARS = 120;
const MAX_TOPICS_CHARS = 80;
const MAX_TARGET_CHARS = 100;
const MAX_QUERY_CHARS = 300;
const FALLBACK_QUERY = "宫廷礼仪";

/** Collapse all whitespace runs to a single space and trim the result. */
function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Truncate to `max` chars without splitting a character sequence. */
function cap(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/**
 * Builds a deterministic KnowledgeHybridQuery from the current dialogue context.
 *
 * Query field order (fixed for determinism):
 *   directive: <sceneDirective>
 *   topics: <topicTags>
 *   target: <latest transcript line from request.targetId>
 *
 * Design decisions:
 * - `currentTime` is taken directly from `request.time` — no separate parameter
 *   avoids any possibility of caller-side inconsistency.
 * - Only the LATEST line spoken by `request.targetId` (usually "player") is included
 *   to avoid a feedback loop where the speaker's own prior output influences retrieval.
 * - Each field is individually capped before concatenation; the full query is also
 *   capped to MAX_QUERY_CHARS so embedding inputs remain bounded.
 * - `vectorFailureMode: "keyword_only"` degrades gracefully when the vector index
 *   is absent — dialogue turns must never fail on a missing embedding index.
 */
export function buildDialogueKnowledgeQuery(
  request: DialogueRequest,
  visibilityCeiling: KnowledgeVisibility,
): KnowledgeHybridQuery {
  const parts: string[] = [];

  if (request.sceneDirective) {
    const d = cap(normalizeWs(request.sceneDirective), MAX_DIRECTIVE_CHARS);
    if (d) parts.push(`directive: ${d}`);
  }

  if (request.topicTags.length > 0) {
    const t = cap(normalizeWs(request.topicTags.join(" ")), MAX_TOPICS_CHARS);
    if (t) parts.push(`topics: ${t}`);
  }

  // Find the latest transcript line from the target (player) — prevents feedback loop
  // where the speaker's own prior words influence knowledge retrieval.
  const targetLines = request.transcript.filter((l) => l.speaker === request.targetId);
  const lastTargetLine = targetLines[targetLines.length - 1];
  if (lastTargetLine !== undefined) {
    const tl = cap(normalizeWs(lastTargetLine.text), MAX_TARGET_CHARS);
    if (tl) parts.push(`target: ${tl}`);
  }

  const joined = cap(normalizeWs(parts.join(" ")), MAX_QUERY_CHARS);
  const text = joined || FALLBACK_QUERY;

  return {
    text,
    limit: 8,
    visibilityCeiling,
    currentTime: request.time,
    vectorFailureMode: "keyword_only",
  };
}

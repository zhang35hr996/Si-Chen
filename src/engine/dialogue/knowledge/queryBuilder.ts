import type { GameTime } from "../../calendar/time";
import type { KnowledgeVisibility } from "../../knowledge/model";
import type { KnowledgeHybridQuery } from "../../knowledge/retrieval/types";
import type { DialogueRequest } from "../types";

/**
 * Builds a deterministic KnowledgeHybridQuery from the current dialogue context.
 * Always passes `currentTime` (enforces temporal filtering) and `visibilityCeiling`.
 * Uses `vectorFailureMode: "keyword_only"` so a missing embedding index does not
 * fail the turn — the dialogue pipeline degrades gracefully.
 */
export function buildDialogueKnowledgeQuery(
  request: DialogueRequest,
  currentTime: GameTime,
  visibilityCeiling: KnowledgeVisibility,
): KnowledgeHybridQuery {
  const parts: string[] = [];
  if (request.sceneDirective) parts.push(request.sceneDirective);
  if (request.topicTags.length > 0) parts.push(request.topicTags.join(" "));
  const text = parts.join(" ").trim() || "宫廷礼仪";

  return {
    text,
    limit: 8,
    visibilityCeiling,
    currentTime,
    vectorFailureMode: "keyword_only",
  };
}

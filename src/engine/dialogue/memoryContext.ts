import { recallCandidates, type RecallQuery } from "./recall";
import { rankCandidates } from "./rerank";
import type { ActivationContext } from "./retrievalScore";
import type { CourtEvent, GameState, MemoryEntry } from "../state/types";

export interface DialogueMemoryContext {
  activatedMemories: MemoryEntry[];
  knownEvents: CourtEvent[];
}

export function buildMemoryContext(
  state: GameState, query: RecallQuery, ctx: ActivationContext, topN = 5,
): DialogueMemoryContext {
  const recalled = recallCandidates(state, query);
  const ranked = rankCandidates(state, ctx, recalled, topN);
  return {
    activatedMemories: ranked.flatMap((c) => (c.kind === "memory" ? [c.memory] : [])),
    // knownEvents 已生成，但 DialogueRequest 尚无对应字段（PR5 接入）
    knownEvents: ranked.flatMap((c) => (c.kind === "event" ? [c.event] : [])),
  };
}

import { retrievalScore, eventActivationScore, type ActivationContext } from "./retrievalScore";
import { MEMORY_CONFIG } from "./decay";
import type { CourtEvent, GameState, MemoryEntry } from "../state/types";

export type RecallCandidate =
  | { kind: "memory"; memory: MemoryEntry; score: number }
  | { kind: "event"; event: CourtEvent; score: number };

export function rankCandidates(
  state: GameState,
  ctx: ActivationContext,
  recalled: { memories: MemoryEntry[]; events: CourtEvent[] },
  topN = 5,
): RecallCandidate[] {
  const mem: RecallCandidate[] = recalled.memories
    .map((memory) => ({ kind: "memory" as const, memory, score: retrievalScore(state, memory, ctx) }))
    .filter((c) => c.memory.retention === "permanent" || c.score >= MEMORY_CONFIG.minimumRetrievalSalience);
  const evt: RecallCandidate[] = recalled.events.map((event) => ({ kind: "event" as const, event, score: eventActivationScore(state, event, ctx) }));
  const idOf = (c: RecallCandidate) => (c.kind === "memory" ? c.memory.id : c.event.id);
  return [...mem, ...evt]
    .sort((a, b) => (b.score - a.score) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0))
    .slice(0, topN);
}

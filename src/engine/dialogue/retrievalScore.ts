import { effectiveStrength } from "./decay";
import { recentMentionPenalty } from "./mention";
import type { GameTime } from "../calendar/time";
import type { CourtEvent, GameState, MemoryEntry } from "../state/types";

const W = {
  BASE_RELEVANCE: 0.4, TOPIC_WEIGHT: 0.6,
  ANNIVERSARY_WEIGHT: 60, LOCATION_WEIGHT: 30, SUBJECT_WEIGHT: 35, UNRESOLVED_WEIGHT: 15, CONDITION_WEIGHT: 40,
} as const;

export interface ActivationContext {
  now: GameTime; topicTags: string[]; presentCharacterIds: string[];
  locationId?: string; audienceId: string; speakerId: string;
}

function isAnniversary(origin: GameTime, now: GameTime): boolean {
  return origin.month === now.month && now.year > origin.year; // 同月、跨年=忌辰
}

/**
 * Whether the memory is bound to the current location (PR-A item 7).
 *
 * Keyed to the memory's SOURCE EVENT location — its place of occurrence, or for
 * a move, its from/to — not the old broken heuristic (any "residence"-tagged
 * memory whose subject was the speaker, which fired regardless of where the
 * speaker actually stood). Authored memories without a sourceEventId cannot be
 * located yet (deferred to a memory-side triggerContext) and score 0.
 */
function locationMatches(chronicle: readonly CourtEvent[], memory: MemoryEntry, locationId: string): boolean {
  if (memory.sourceEventId === undefined) return false;
  const event = chronicle.find((e) => e.id === memory.sourceEventId);
  if (event === undefined) return false;
  if (event.locationId === locationId) return true;
  return event.payload["from"] === locationId || event.payload["to"] === locationId;
}

export function retrievalScore(state: GameState, memory: MemoryEntry, ctx: ActivationContext): number {
  const eff = effectiveStrength(memory, ctx.now);
  const topicMatch = ctx.topicTags.length && memory.triggerTags.some((t) => ctx.topicTags.includes(t)) ? 1 : 0;
  const anniversaryMatch = memory.triggerTags.includes("anniversary") && isAnniversary(memory.createdAt, ctx.now) ? 1 : 0;
  const locationMatch = ctx.locationId && locationMatches(state.chronicle, memory, ctx.locationId) ? 1 : 0;
  const subjectPresentMatch = memory.subjectIds.some((s) => ctx.presentCharacterIds.includes(s)) ? 1 : 0;
  const conditionMatch = state.emotionalConditions.some(
    (c) => c.ownerId === memory.ownerId && memory.sourceEventId !== undefined && c.sourceEventId === memory.sourceEventId,
  ) ? 1 : 0;
  const penalty = recentMentionPenalty(state, { speakerId: ctx.speakerId, audienceId: ctx.audienceId, memoryId: memory.id, now: ctx.now });
  return (
    eff * (W.BASE_RELEVANCE + W.TOPIC_WEIGHT * topicMatch)
    + W.ANNIVERSARY_WEIGHT * anniversaryMatch
    + W.LOCATION_WEIGHT * locationMatch
    + W.SUBJECT_WEIGHT * subjectPresentMatch
    + W.UNRESOLVED_WEIGHT * (memory.unresolved ? 1 : 0)
    + W.CONDITION_WEIGHT * conditionMatch
    - penalty
  );
}

import { effectiveStrength } from "./decay";
import { recentMentionPenalty } from "./mention";
import type { GameTime } from "../calendar/time";
import type { GameState, MemoryEntry } from "../state/types";

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

export function retrievalScore(state: GameState, memory: MemoryEntry, ctx: ActivationContext): number {
  const eff = effectiveStrength(memory, ctx.now);
  const topicMatch = ctx.topicTags.length && memory.triggerTags.some((t) => ctx.topicTags.includes(t)) ? 1 : 0;
  const anniversaryMatch = memory.triggerTags.includes("anniversary") && isAnniversary(memory.createdAt, ctx.now) ? 1 : 0;
  const locationMatch = ctx.locationId && memory.triggerTags.includes("residence") && memory.subjectIds.includes(ctx.speakerId) ? 1 : 0;
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

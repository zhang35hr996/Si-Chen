import { effectiveStrength } from "./decay";
import { recentMentionPenalty } from "./mention";
import { effectiveConditionSeverity } from "../chronicle/conditions";
import type { GameTime } from "../calendar/time";
import type { CourtEvent, GameState, MemoryEntry } from "../state/types";

const W = {
  BASE_RELEVANCE: 0.4, TOPIC_WEIGHT: 0.6,
  ANNIVERSARY_WEIGHT: 60, LOCATION_WEIGHT: 30, SUBJECT_WEIGHT: 35, UNRESOLVED_WEIGHT: 15, CONDITION_WEIGHT: 40,
} as const;

/** Below this effective severity an emotional condition is treated as inactive. */
const CONDITION_ACTIVE_THRESHOLD = 10;

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

/**
 * Activation multiplier (0–1) from emotional conditions tied to this memory's
 * source event. Uses the strongest matching condition's CURRENT severity; below
 * CONDITION_ACTIVE_THRESHOLD the condition is inactive and contributes nothing.
 */
function conditionActivationFor(state: GameState, memory: MemoryEntry, now: GameTime): number {
  if (memory.sourceEventId === undefined) return 0;
  let best = 0;
  for (const c of state.emotionalConditions) {
    if (c.ownerId !== memory.ownerId || c.sourceEventId !== memory.sourceEventId) continue;
    const sev = effectiveConditionSeverity(c, now);
    if (sev > best) best = sev;
  }
  return best >= CONDITION_ACTIVE_THRESHOLD ? best / 100 : 0;
}

export function retrievalScore(state: GameState, memory: MemoryEntry, ctx: ActivationContext): number {
  const eff = effectiveStrength(memory, ctx.now);
  const topicMatch = ctx.topicTags.length && memory.triggerTags.some((t) => ctx.topicTags.includes(t)) ? 1 : 0;
  const anniversaryMatch = memory.triggerTags.includes("anniversary") && isAnniversary(memory.createdAt, ctx.now) ? 1 : 0;
  const locationMatch = ctx.locationId && locationMatches(state.chronicle, memory, ctx.locationId) ? 1 : 0;
  const subjectPresentMatch = memory.subjectIds.some((s) => ctx.presentCharacterIds.includes(s)) ? 1 : 0;
  // Condition activation scales with the CURRENT (decayed) severity of any matching
  // condition, not a flat permanent bonus — an acute_grief fades instead of pinning
  // its memory at the top forever (PR-A item 8).
  const conditionActivation = conditionActivationFor(state, memory, ctx.now);
  const penalty = recentMentionPenalty(state, { speakerId: ctx.speakerId, audienceId: ctx.audienceId, memoryId: memory.id, now: ctx.now });
  return (
    eff * (W.BASE_RELEVANCE + W.TOPIC_WEIGHT * topicMatch)
    + W.ANNIVERSARY_WEIGHT * anniversaryMatch
    + W.LOCATION_WEIGHT * locationMatch
    + W.SUBJECT_WEIGHT * subjectPresentMatch
    + W.UNRESOLVED_WEIGHT * (memory.unresolved ? 1 : 0)
    + W.CONDITION_WEIGHT * conditionActivation
    - penalty
  );
}

/**
 * Condition DSL evaluators (skeleton-plan §4). Closed predicate set — there
 * are deliberately NO resource/bloodline predicates (§2 scaffold guard), so
 * event logic structurally cannot read scaffold-only fields.
 */
import type { ContentDB } from "../content/loader";
import type { TriggerCondition } from "../content/schemas";
import type { GameState } from "../state/types";

export interface ConditionContext {
  db: ContentDB;
  state: GameState;
}

/** A flag counts as "set" when present and not false. */
export function isFlagSet(state: GameState, key: string): boolean {
  const value = state.flags[key];
  return value !== undefined && value !== false;
}

export function hasEventFired(state: GameState, eventId: string): boolean {
  return state.eventLog.some((entry) => entry.eventId === eventId);
}

export function evaluateCondition(condition: TriggerCondition, ctx: ConditionContext): boolean {
  const { db, state } = ctx;
  if ("all" in condition) return condition.all.every((c) => evaluateCondition(c, ctx));
  if ("any" in condition) return condition.any.some((c) => evaluateCondition(c, ctx));
  if ("not" in condition) return !evaluateCondition(condition.not, ctx);
  if ("flagSet" in condition) return isFlagSet(state, condition.flagSet);
  if ("monthAtLeast" in condition) return state.calendar.month >= condition.monthAtLeast;
  if ("periodIs" in condition) return state.calendar.period === condition.periodIs;
  if ("atLocation" in condition) return state.playerLocation === condition.atLocation;
  if ("relationshipAtLeast" in condition) {
    const { char, field, value } = condition.relationshipAtLeast;
    return (state.relationships[char]?.[field] ?? 0) >= value;
  }
  if ("favorAtLeast" in condition) {
    const { char, value } = condition.favorAtLeast;
    return (state.standing[char]?.favor ?? 0) >= value;
  }
  if ("rankAtLeast" in condition) {
    const { char, rank } = condition.rankAtLeast;
    const held = state.standing[char] ? db.ranks[state.standing[char].rank] : undefined;
    const target = db.ranks[rank];
    return held !== undefined && target !== undefined && held.order >= target.order;
  }
  return hasEventFired(state, condition.eventFired);
}

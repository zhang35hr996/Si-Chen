/**
 * Condition DSL evaluators (skeleton-plan §4). Closed predicate set — there
 * are deliberately NO resource/bloodline predicates (§2 scaffold guard), so
 * event logic structurally cannot read scaffold-only fields.
 */
import type { ContentDB } from "../content/loader";
import type { TriggerCondition } from "../content/schemas";
import type { EligibilityFailure } from "../trace/domainEvents";
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

/** True when `char` holds at least one memory entry carrying `tag`. */
export function hasMemoryTag(state: GameState, char: string, tag: string): boolean {
  return state.memories[char]?.entries.some((entry) => entry.triggerTags.includes(tag)) ?? false;
}

export interface EligibilityExplanation {
  eligible: boolean;
  failedConditions: EligibilityFailure[];
}

/**
 * Like evaluateCondition but also returns which leaf conditions failed.
 * Only active in trace mode — the boolean evaluateCondition delegates to this.
 */
export function explainCondition(condition: TriggerCondition, ctx: ConditionContext): EligibilityExplanation {
  const { db, state } = ctx;
  if ("all" in condition) {
    const results = condition.all.map((c) => explainCondition(c, ctx));
    const eligible = results.every((r) => r.eligible);
    return { eligible, failedConditions: eligible ? [] : results.flatMap((r) => r.failedConditions) };
  }
  if ("any" in condition) {
    const results = condition.any.map((c) => explainCondition(c, ctx));
    const eligible = results.some((r) => r.eligible);
    return { eligible, failedConditions: eligible ? [] : results.flatMap((r) => r.failedConditions) };
  }
  if ("not" in condition) {
    const inner = explainCondition(condition.not, ctx);
    const eligible = !inner.eligible;
    return { eligible, failedConditions: eligible ? [] : [{ conditionType: "not" }] };
  }
  if ("flagSet" in condition) {
    const eligible = isFlagSet(state, condition.flagSet);
    return { eligible, failedConditions: eligible ? [] : [{ conditionType: "flagSet", expected: true, actual: false, path: condition.flagSet }] };
  }
  if ("monthAtLeast" in condition) {
    const eligible = state.calendar.month >= condition.monthAtLeast;
    return { eligible, failedConditions: eligible ? [] : [{ conditionType: "monthAtLeast", expected: condition.monthAtLeast, actual: state.calendar.month }] };
  }
  if ("periodIs" in condition) {
    const eligible = state.calendar.period === condition.periodIs;
    return { eligible, failedConditions: eligible ? [] : [{ conditionType: "periodIs", expected: condition.periodIs, actual: state.calendar.period }] };
  }
  if ("atLocation" in condition) {
    const eligible = state.playerLocation === condition.atLocation;
    return { eligible, failedConditions: eligible ? [] : [{ conditionType: "atLocation", expected: condition.atLocation, actual: state.playerLocation }] };
  }
  if ("favorAtLeast" in condition) {
    const { char, value } = condition.favorAtLeast;
    const actual = state.standing[char]?.favor ?? 0;
    const eligible = actual >= value;
    return { eligible, failedConditions: eligible ? [] : [{ conditionType: "favorAtLeast", expected: value, actual, subjectId: char }] };
  }
  if ("rankAtLeast" in condition) {
    const { char, rank } = condition.rankAtLeast;
    const held = state.standing[char] ? db.ranks[state.standing[char].rank] : undefined;
    const target = db.ranks[rank];
    const eligible = held !== undefined && target !== undefined && held.order >= target.order;
    return { eligible, failedConditions: eligible ? [] : [{ conditionType: "rankAtLeast", expected: rank, actual: state.standing[char]?.rank, subjectId: char }] };
  }
  if ("hasMemoryTag" in condition) {
    const { char, tag } = condition.hasMemoryTag;
    const eligible = hasMemoryTag(state, char, tag);
    return { eligible, failedConditions: eligible ? [] : [{ conditionType: "hasMemoryTag", expected: tag, actual: null, subjectId: char }] };
  }
  const eligible = hasEventFired(state, condition.eventFired);
  return { eligible, failedConditions: eligible ? [] : [{ conditionType: "eventFired", expected: condition.eventFired, actual: null }] };
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
  if ("hasMemoryTag" in condition) {
    const { char, tag } = condition.hasMemoryTag;
    return hasMemoryTag(state, char, tag);
  }
  return hasEventFired(state, condition.eventFired);
}

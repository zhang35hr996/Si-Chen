import type { ContentDB } from "../content/loader";
import { explainCondition, hasEventFired } from "../events/conditions";
import { getEligibleEvents } from "../events/engine";
import type { GameEventContent } from "../content/schemas";
import type { GameState } from "../state/types";
import type { EligibilityFailure } from "./domainEvents";
import type { TraceCollector } from "./collector";

/**
 * Full eligibility explanation covering all three filter layers:
 * 1. `once` already fired, 2. cooldown not ready, 3. condition predicates.
 * Returns all failure reasons for a given event in a given state.
 */
export function explainEventEligibility(
  db: ContentDB,
  state: GameState,
  event: GameEventContent,
): { eligible: boolean; failures: EligibilityFailure[] } {
  if (event.once && hasEventFired(state, event.id)) {
    return { eligible: false, failures: [{ conditionType: "once_already_fired", actual: event.id }] };
  }
  if (event.cooldown) {
    let lastDayIndex: number | null = null;
    for (let i = state.eventLog.length - 1; i >= 0; i--) {
      const entry = state.eventLog[i]!;
      if (entry.eventId === event.id) { lastDayIndex = entry.firedAt.dayIndex; break; }
    }
    if (lastDayIndex !== null && state.calendar.dayIndex < lastDayIndex + event.cooldown.actionDays) {
      return {
        eligible: false,
        failures: [{
          conditionType: "cooldown_not_ready",
          expected: event.cooldown.actionDays,
          actual: state.calendar.dayIndex - lastDayIndex,
        }],
      };
    }
  }
  const { eligible, failedConditions } = explainCondition(event.condition, { db, state });
  return { eligible, failures: failedConditions };
}

/**
 * Capture eligibility transitions between two game states into the collector.
 * Only call this on successful (committed) transactions that have ContentDB access.
 * Do NOT call on rolled-back transactions.
 *
 * Compares all events across all checkpoints. Each event emits at most one
 * EligibilityTraceEvent per transaction (became_eligible or became_ineligible).
 */
export function captureEligibilityTransitions(
  db: ContentDB,
  before: GameState,
  after: GameState,
  collector: TraceCollector,
): void {
  const checkpoints = [...new Set(Object.values(db.events).map((e) => e.checkpoint))];

  const beforeEligible = new Set<string>();
  const afterEligible = new Set<string>();
  for (const cp of checkpoints) {
    for (const { event } of getEligibleEvents(db, before, cp)) beforeEligible.add(event.id);
    for (const { event } of getEligibleEvents(db, after, cp)) afterEligible.add(event.id);
  }

  for (const event of Object.values(db.events)) {
    const wasBefore = beforeEligible.has(event.id);
    const isAfter = afterEligible.has(event.id);

    if (!wasBefore && isAfter) {
      const { failures } = explainEventEligibility(db, before, event);
      collector.recordEligibilityEvent({
        eventId: event.id,
        transition: "became_eligible",
        failedBefore: failures,
        failedAfter: [],
        phase: "boundary_diff",
      });
    } else if (wasBefore && !isAfter) {
      const { failures } = explainEventEligibility(db, after, event);
      collector.recordEligibilityEvent({
        eventId: event.id,
        transition: "became_ineligible",
        failedBefore: [],
        failedAfter: failures,
        phase: "boundary_diff",
      });
    }
  }
}

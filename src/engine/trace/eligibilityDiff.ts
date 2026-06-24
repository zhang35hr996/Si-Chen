import type { ContentDB } from "../content/loader";
import { explainCondition } from "../events/conditions";
import { getEligibleEvents } from "../events/engine";
import type { GameState } from "../state/types";
import type { TraceCollector } from "./collector";

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
      const { failedConditions } = explainCondition(event.condition, { db, state: before });
      collector.recordEligibilityEvent({
        eventId: event.id,
        transition: "became_eligible",
        failedBefore: failedConditions,
        failedAfter: [],
        phase: "boundary_diff",
      });
    } else if (wasBefore && !isAfter) {
      const { failedConditions } = explainCondition(event.condition, { db, state: after });
      collector.recordEligibilityEvent({
        eventId: event.id,
        transition: "became_ineligible",
        failedBefore: [],
        failedAfter: failedConditions,
        phase: "boundary_diff",
      });
    }
  }
}

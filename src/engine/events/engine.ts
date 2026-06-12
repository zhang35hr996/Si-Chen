/**
 * EventEngine (skeleton-plan §6): evaluates declarative triggers at
 * checkpoints. Eligibility and affordability are separate facts — an
 * eligible-but-unaffordable event is surfaced (UI shows 行动点不足) but can
 * never start, and never auto-advances time.
 */
import type { ContentDB } from "../content/loader";
import type { GameEventContent } from "../content/schemas";
import type { GameState } from "../state/types";
import { evaluateCondition, hasEventFired } from "./conditions";

export type Checkpoint = GameEventContent["checkpoint"];

export interface EligibleEvent {
  event: GameEventContent;
  /** Engine-side affordability — the UI is informed, never trusted. */
  affordable: boolean;
}

function lastFiredDayIndex(state: GameState, eventId: string): number | null {
  for (let i = state.eventLog.length - 1; i >= 0; i--) {
    const entry = state.eventLog[i]!;
    if (entry.eventId === eventId) return entry.firedAt.dayIndex;
  }
  return null;
}

function cooldownReady(state: GameState, event: GameEventContent): boolean {
  if (!event.cooldown) return true;
  const last = lastFiredDayIndex(state, event.id);
  if (last === null) return true;
  return state.calendar.dayIndex >= last + event.cooldown.actionDays;
}

/**
 * All eligible events for a checkpoint, sorted by priority desc, id asc
 * (deterministic tiebreak), each flagged with affordability.
 */
export function getEligibleEvents(
  db: ContentDB,
  state: GameState,
  checkpoint: Checkpoint,
): EligibleEvent[] {
  return Object.values(db.events)
    .filter((event) => event.checkpoint === checkpoint)
    .filter((event) => !(event.once && hasEventFired(state, event.id)))
    .filter((event) => cooldownReady(state, event))
    .filter((event) => evaluateCondition(event.condition, { db, state }))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
    .map((event) => ({ event, affordable: event.apCost <= state.calendar.ap }));
}

/** The single event a checkpoint auto-starts: highest-priority AFFORDABLE pick. */
export function pickNextEvent(
  db: ContentDB,
  state: GameState,
  checkpoint: Checkpoint,
): GameEventContent | null {
  return getEligibleEvents(db, state, checkpoint).find((e) => e.affordable)?.event ?? null;
}

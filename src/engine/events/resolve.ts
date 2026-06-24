/**
 * Event resolution — ONE transaction (skeleton-plan §6, review rule #4):
 *
 *   affordability check → effects through the SAME funnel → spend apCost
 *   → append eventLog entry (mark fired)
 *
 * All-or-nothing. Rejected effects never mark fired, never spend AP.
 * The eventLog records only completed resolutions — it is player-world
 * history; rejected batches live in diagnostics (EffectReport) only.
 */
import { toGameTime } from "../calendar/time";
import type { ContentDB } from "../content/loader";
import type { EventEffect } from "../content/schemas";
import { applyEffects, type EffectContext } from "../effects/funnel";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import { applyCommand } from "../state/reducer";
import type { GameState } from "../state/types";
import { hasEventFired } from "./conditions";

export interface EventResolution {
  state: GameState;
  /** True if spending apCost rolled the action-day (time_advance follows). */
  rolledOver: boolean;
}

export function resolveEvent(
  db: ContentDB,
  state: GameState,
  eventId: string,
  effects: readonly EventEffect[],
  context?: Pick<EffectContext, "collector">,
): Result<EventResolution, GameError[]> {
  const event = db.events[eventId];
  if (!event) {
    return err([stateError("BAD_EVENT_REF", `event "${eventId}" does not exist`)]);
  }
  if (event.once && hasEventFired(state, eventId)) {
    return err([stateError("EVENT_ALREADY_FIRED", `once-event "${eventId}" already fired`)]);
  }
  // Engine-side affordability — rule #1/#2: the UI is not trusted, and
  // insufficient AP blocks resolution outright (no auto time advance).
  if (event.apCost > state.calendar.ap) {
    return err([
      stateError("AP_INSUFFICIENT", `event "${eventId}" needs ${event.apCost} AP, ${state.calendar.ap} remaining`, {
        context: { eventId, apCost: event.apCost, ap: state.calendar.ap },
      }),
    ]);
  }

  // Effects through the one funnel. Rejection → nothing else happens.
  // The scene id rides along so memory entries carry their origin trace.
  const applied = applyEffects(db, state, effects, { sceneId: event.sceneId, ...context });
  if (!applied.ok) return err(applied.error);

  // The event "happened" on the action-day it was resolved — stamp before
  // any rollover from spending its cost.
  const firedAt = toGameTime(state.calendar);

  let next = applied.value;
  let rolledOver = false;
  if (event.apCost > 0) {
    const spent = applyCommand(next, { type: "SPEND_AP", amount: event.apCost });
    if (!spent.ok) return err([spent.error]); // unreachable after the check above; backstop
    next = spent.value.state;
    rolledOver = spent.value.rolledOver;
  }

  next = {
    ...next,
    eventLog: [...next.eventLog, { eventId, firedAt }],
    sceneHistory: [...next.sceneHistory, event.sceneId], // completed scenes — same transaction
  };
  return ok({ state: next, rolledOver });
}

/**
 * Travel legality + command construction (skeleton-plan §5). The reducer's
 * AP backstop still applies; these checks exist so the UI can disable nodes
 * with a reason instead of dispatching doomed commands.
 */
import type { ContentDB } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import { err, ok, type Result } from "../infra/result";
import type { GameCommand } from "../state/commands";
import type { GameState } from "../state/types";

export interface TravelPlan {
  to: string;
  costAp: number;
}

export function checkTravel(db: ContentDB, state: GameState, to: string): Result<TravelPlan, GameError> {
  const target = db.locations[to];
  if (!target) {
    return err(stateError("UNKNOWN_LOCATION", `location "${to}" does not exist`));
  }
  if (to === state.playerLocation) {
    return err(stateError("ALREADY_THERE", `already at "${to}"`));
  }
  const current = db.locations[state.playerLocation];
  if (!current || !current.connections.includes(to)) {
    return err(
      stateError("NOT_CONNECTED", `no path from "${state.playerLocation}" to "${to}"`),
    );
  }
  const costAp = target.travelCost.ap;
  if (costAp > state.calendar.ap) {
    // 行动点不足 — same affordability rule scenes use (plan §6); no auto-rollover.
    return err(
      stateError("AP_INSUFFICIENT", `travel needs ${costAp} AP, ${state.calendar.ap} remaining`, {
        context: { costAp, ap: state.calendar.ap },
      }),
    );
  }
  return ok({ to, costAp });
}

/** One atomic batch: move + spend. Rollover is reported by the reducer. */
export function buildTravelBatch(
  db: ContentDB,
  state: GameState,
  to: string,
): Result<GameCommand[], GameError> {
  const plan = checkTravel(db, state, to);
  if (!plan.ok) return plan;
  return ok([
    { type: "MOVE_TO_LOCATION", locationId: plan.value.to },
    { type: "SPEND_AP", amount: plan.value.costAp },
  ]);
}

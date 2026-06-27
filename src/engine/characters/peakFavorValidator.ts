import type { GameState } from "../state/types";
import type { GameError } from "../infra/errors";
import { stateError } from "../infra/errors";

/**
 * Validate peakFavor invariants for all consorts in standing.
 * - 0 <= favor <= peakFavor <= 100
 */
export function validatePeakFavor(state: GameState): GameError[] {
  const errors: GameError[] = [];
  for (const [charId, st] of Object.entries(state.standing)) {
    if (typeof st.peakFavor !== "number") {
      errors.push(stateError("PEAK_FAVOR_MISSING", `"${charId}" has no peakFavor`));
      continue;
    }
    if (st.peakFavor < st.favor) {
      errors.push(stateError("PEAK_FAVOR_BELOW_FAVOR", `"${charId}" peakFavor ${st.peakFavor} < favor ${st.favor}`));
    }
    if (st.peakFavor < 0 || st.peakFavor > 100) {
      errors.push(stateError("PEAK_FAVOR_OUT_OF_RANGE", `"${charId}" peakFavor ${st.peakFavor} out of [0,100]`));
    }
  }
  return errors;
}

import type { GameState } from "../../state/types";

/**
 * Returns the max effective grievance strength that actor holds against target.
 * Only counts: ownerId=actor, kind=grievance, unresolved=true, subjectIds includes target.
 * Returns 0 if none found.
 * Phase 5A-1: uses raw strength (no decay API available yet).
 */
export function unresolvedGrievanceStrength(
  state: GameState,
  ownerId: string,
  subjectId: string,
): number {
  const store = state.memories[ownerId];
  if (!store) return 0;

  let max = 0;
  for (const entry of store.entries) {
    if (
      entry.kind === "grievance" &&
      entry.unresolved === true &&
      entry.subjectIds.includes(subjectId)
    ) {
      if (entry.strength > max) {
        max = entry.strength;
      }
    }
  }
  return max;
}

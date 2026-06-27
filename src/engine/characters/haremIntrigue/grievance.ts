import type { GameState } from "../../state/types";

/**
 * Build an index of max grievance strength from each actor to each target.
 * Only counts: kind=grievance, unresolved=true.
 * Returns: actorId → targetId → maxGrievanceStrength
 *
 * Centralizes the grievance scan so callers don't repeat O(n²×m) lookups.
 */
export function buildUnresolvedGrievanceIndex(
  state: GameState,
  consortIds: readonly string[],
): Map<string, Map<string, number>> {
  const index = new Map<string, Map<string, number>>();
  for (const actorId of consortIds) {
    const targetMap = new Map<string, number>();
    index.set(actorId, targetMap);
    const store = state.memories[actorId];
    if (store) {
      for (const entry of store.entries) {
        if (entry.kind === "grievance" && entry.unresolved === true) {
          for (const subjectId of entry.subjectIds) {
            const curr = targetMap.get(subjectId) ?? 0;
            if (entry.strength > curr) {
              targetMap.set(subjectId, entry.strength);
            }
          }
        }
      }
    }
  }
  return index;
}

/**
 * Returns the max effective grievance strength that actor holds against target.
 * Convenience wrapper around buildUnresolvedGrievanceIndex for single-pair lookups.
 */
export function unresolvedGrievanceStrength(
  state: GameState,
  ownerId: string,
  subjectId: string,
): number {
  const idx = buildUnresolvedGrievanceIndex(state, [ownerId]);
  return idx.get(ownerId)?.get(subjectId) ?? 0;
}

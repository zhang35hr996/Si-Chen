/**
 * Harem faction selectors.  Faction is stored ONLY in CharacterStanding
 * (single source of truth).  Generated consorts default to undefined (no
 * faction).  Do not read CharacterContent for faction data.
 */
import type { GameState } from "../state/types";

export function getHaremFactionId(state: GameState, charId: string): string | undefined {
  return state.standing[charId]?.haremFactionId;
}

/**
 * Returns true iff both characters belong to the same non-empty faction.
 * Two characters with no faction are NOT considered the same faction.
 */
export function sameHaremFaction(state: GameState, aId: string, bId: string): boolean {
  const a = getHaremFactionId(state, aId);
  const b = getHaremFactionId(state, bId);
  return a !== undefined && a === b;
}

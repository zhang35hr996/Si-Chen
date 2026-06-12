/**
 * Presence v0 (skeleton-plan §3): a character is at their defaultLocation
 * every action-day. Schedules/presence-overrides are the designed-but-deferred
 * upgrade; this function's signature already takes GameState so callers won't
 * change when they land.
 */
import type { ContentDB } from "../content/loader";
import type { CharacterContent } from "../content/schemas";
import type { GameState } from "../state/types";

export function getCharacterLocation(
  db: ContentDB,
  _state: GameState,
  charId: string,
): string | null {
  return db.characters[charId]?.defaultLocation ?? null;
}

/** Characters present at a location, sorted by rank order (highest first). */
export function getPresentAt(
  db: ContentDB,
  state: GameState,
  locationId: string,
): CharacterContent[] {
  return Object.values(db.characters)
    .filter((character) => getCharacterLocation(db, state, character.id) === locationId)
    .sort(
      (a, b) =>
        (db.ranks[b.initialStanding.rank]?.order ?? 0) -
        (db.ranks[a.initialStanding.rank]?.order ?? 0),
    );
}

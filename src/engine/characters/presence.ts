/**
 * Presence v0 (skeleton-plan §3): a character is at their defaultLocation
 * every action-day. Schedules/presence-overrides are the designed-but-deferred
 * upgrade; this function's signature already takes GameState so callers won't
 * change when they land.
 */
import type { ContentDB } from "../content/loader";
import type { CharacterContent } from "../content/schemas";
import type { GameState } from "../state/types";
import { effectiveOrder } from "./standing";

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
        (db.ranks[b.initialStanding?.rank ?? ""]?.order ?? 0) -
        (db.ranks[a.initialStanding?.rank ?? ""]?.order ?? 0),
    );
}

/** 宫中侍君：在宫（非冷宫）、未故的侍君（含凤后），按位分降序。查看侍君与翻牌子共用。 */
export function inPalaceConsorts(db: ContentDB, state: GameState): CharacterContent[] {
  return Object.values(db.characters)
    .filter(
      (c) =>
        c.kind === "consort" &&
        state.standing[c.id]?.lifecycle !== "deceased" &&
        c.defaultLocation !== "lenggong",
    )
    .sort((a, b) => {
      const ra = state.standing[a.id];
      const rb = state.standing[b.id];
      if (!ra || !rb) return 0; // 无 standing（如存档后新增）按中性处理
      return (
        effectiveOrder(db.ranks[rb.rank]!, rb.title !== undefined) -
        effectiveOrder(db.ranks[ra.rank]!, ra.title !== undefined)
      );
    });
}

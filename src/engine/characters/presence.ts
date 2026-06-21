/**
 * Presence v0 (skeleton-plan §3): a character is at their defaultLocation
 * every action-day, unless 搬迁 has moved them — standing.residence overrides
 * the authored defaultLocation. Schedules/presence-overrides remain the
 * designed-but-deferred upgrade.
 */
import type { ContentDB } from "../content/loader";
import type { CharacterContent } from "../content/schemas";
import type { GameState } from "../state/types";
import { effectiveOrder } from "./standing";

export function getCharacterLocation(
  db: ContentDB,
  state: GameState,
  charId: string,
): string | null {
  if (!db.characters[charId]) return null;
  // 搬迁后 standing.residence 覆盖 content 的 defaultLocation。
  return state.standing[charId]?.residence ?? db.characters[charId]!.defaultLocation ?? null;
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
        c.defaultLocation !== "changmengong",
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

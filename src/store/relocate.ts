/**
 * 搬迁侍君：把侍君（除皇后外）迁到另一座设宫室居所的空宫室。住处记在
 * standing.residence（覆盖 content 的 defaultLocation）+ standing.chamber，
 * 经 relocate effect 走效果漏斗落地。此处只组装效果与给 UI 提供宫室占用视图。
 */
import { CHAMBERED_PALACE_ORDER, CHAMBERS, chamberOf, hasChambers } from "../engine/characters/chambers";
import { getCharacterLocation } from "../engine/characters/presence";
import type { ContentDB } from "../engine/content/loader";
import type { CharacterContent, EventEffect } from "../engine/content/schemas";
import type { ChamberId, GameState } from "../engine/state/types";

export interface ChamberSlot {
  id: ChamberId;
  name: string;
  /** 当前住客（在宫、未故的侍君）；空置为 undefined。 */
  occupant: CharacterContent | undefined;
}

export interface PalaceVacancy {
  id: string;
  name: string;
  chambers: ChamberSlot[];
}

/** 某座设宫室居所的 5 间宫室占用情况（用于搬迁选殿）。 */
export function palaceChambers(db: ContentDB, state: GameState, locationId: string): ChamberSlot[] {
  const occupants = Object.values(db.characters).filter(
    (c) =>
      c.kind === "consort" &&
      state.standing[c.id]?.lifecycle !== "deceased" &&
      getCharacterLocation(db, state, c.id) === locationId,
  );
  return CHAMBERS.map((ch) => ({
    id: ch.id,
    name: ch.name,
    occupant: occupants.find((c) => chamberOf(state.standing[c.id]) === ch.id),
  }));
}

/** 所有可作搬迁目标的设宫室居所及其宫室占用（按既定顺序）。 */
export function relocationTargets(db: ContentDB, state: GameState): PalaceVacancy[] {
  return CHAMBERED_PALACE_ORDER.filter((id) => db.locations[id]).map((id) => ({
    id,
    name: db.locations[id]!.name,
    chambers: palaceChambers(db, state, id),
  }));
}

/**
 * 组装搬迁效果；无变化（已在该宫该室）或目标非法时返回 null（不触发）。
 * 占用冲突由效果漏斗再行校验。
 */
export function buildRelocate(
  db: ContentDB,
  state: GameState,
  charId: string,
  location: string,
  chamber: ChamberId,
): EventEffect[] | null {
  const st = state.standing[charId];
  if (!st || st.rank === "huanghou") return null;
  if (!hasChambers(location)) return null;
  const here = getCharacterLocation(db, state, charId) === location && chamberOf(st) === chamber;
  if (here) return null;
  return [{ type: "relocate", char: charId, location, chamber }];
}

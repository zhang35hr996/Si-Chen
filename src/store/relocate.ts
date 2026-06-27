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

const CHINESE_GRADE_NUM: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};

function gradeNumber(gradeStr: string): number {
  for (const [ch, n] of Object.entries(CHINESE_GRADE_NUM)) {
    if (gradeStr.includes(ch)) return n;
  }
  return 9;
}

/** 按品级返回优先尝试的宫室顺序（正四品以上可住主殿）。 */
function chamberPreference(grade: number): ChamberId[] {
  if (grade <= 3) return ["main", "east_side", "west_side", "east_annex", "west_annex"];
  if (grade <= 4) return ["main", "west_side", "east_side", "east_annex", "west_annex"];
  if (grade <= 5) return ["west_side", "east_side", "east_annex", "west_annex"];
  if (grade <= 7) return ["east_annex", "west_annex", "east_side", "west_side"];
  return ["west_annex", "east_annex", "east_side", "west_side"];
}

/**
 * 按品级自动分配：找到第一个符合优先级的空宫室。
 * 无可用宫室时返回 null（侍君暂留储秀宫）。
 */
export function autoAssignChamber(
  db: ContentDB,
  state: GameState,
  rankId: string,
): { locationId: string; chamberId: ChamberId } | null {
  const grade = gradeNumber(db.ranks[rankId]?.grade ?? "九品");
  const prefs = chamberPreference(grade);
  const targets = relocationTargets(db, state);
  for (const chamberId of prefs) {
    for (const palace of targets) {
      const slot = palace.chambers.find((c) => c.id === chamberId && !c.occupant);
      if (slot) return { locationId: palace.id, chamberId };
    }
  }
  return null;
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

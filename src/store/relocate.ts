/**
 * 搬迁侍君：把侍君（除皇后外）迁到另一座设宫室居所的空宫室。住处记在
 * standing.residence（覆盖 content 的 defaultLocation）+ standing.chamber，
 * 经 relocate effect 走效果漏斗落地。此处同时提供殿选后由皇后自动安排住处的
 * 纯规划器；玩家亲自选择不受位分推荐限制，只受空室与合法地点约束。
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

export interface ResidenceAssignment {
  location: string;
  chamber: ChamberId;
}

function livingConsortEntries(db: ContentDB, state: GameState): Array<{ content: CharacterContent; id: string }> {
  return Object.keys(state.standing).flatMap((id) => {
    const standing = state.standing[id];
    if (!standing || standing.lifecycle === "deceased") return [];
    const content = db.characters[id] ?? state.generatedConsorts[id];
    return content?.kind === "consort" ? [{ content, id }] : [];
  });
}

/** 某座设宫室居所的 5 间宫室占用情况（用于搬迁选殿）。 */
export function palaceChambers(db: ContentDB, state: GameState, locationId: string): ChamberSlot[] {
  const occupants = livingConsortEntries(db, state).filter(
    ({ id }) => getCharacterLocation(db, state, id) === locationId,
  );
  return CHAMBERS.map((ch) => ({
    id: ch.id,
    name: ch.name,
    occupant: occupants.find(({ id }) => chamberOf(state.standing[id]) === ch.id)?.content,
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

const GRADE_NUMERAL: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/**
 * 皇后自动安排时的宫室优先级。
 *
 * - 主殿仅正四品及以上可先行考虑；从四品不属于“正四品以上”。
 * - 一至三品主殿满后取东侧殿；四、五品取西侧殿；六、七品取东偏殿；八、九品取西偏殿。
 * - 正宫/超品按最高组处理。玩家手动选择不调用此函数，因此皇帝亲裁优先于礼制推荐。
 */
export function automaticChamberPreferences(grade: string): ChamberId[] {
  if (grade === "正宫" || grade === "超品") return ["main", "east_side"];
  const match = grade.match(/^([正从])([一二三四五六七八九])品/);
  if (!match) return ["west_annex"];
  const prefix = match[1]!;
  const gradeNumber = GRADE_NUMERAL[match[2]!]!;
  const mainAllowed = gradeNumber < 4 || (gradeNumber === 4 && prefix === "正");
  const secondary: ChamberId =
    gradeNumber <= 3
      ? "east_side"
      : gradeNumber <= 5
        ? "west_side"
        : gradeNumber <= 7
          ? "east_annex"
          : "west_annex";
  return mainAllowed ? ["main", secondary] : [secondary];
}

/**
 * 由皇后为新晋侍君寻找符合位分规则的第一间空室。先穷尽所有宫殿的首选宫室，
 * 再尝试该位分的次选宫室；没有符合空室则返回 null，侍君继续暂住储秀宫。
 * `reserved` 是本次殿选中尚未落库、但已为前面人选预留的宫室，防止批内撞房。
 */
export function autoAssignResidence(
  db: ContentDB,
  state: GameState,
  rankId: string,
  reserved: readonly ResidenceAssignment[] = [],
): ResidenceAssignment | null {
  const rank = db.ranks[rankId];
  if (!rank) return null;
  const occupied = new Set<string>();
  for (const { id } of livingConsortEntries(db, state)) {
    const location = getCharacterLocation(db, state, id);
    if (!location || !hasChambers(location)) continue;
    occupied.add(`${location}:${chamberOf(state.standing[id])}`);
  }
  for (const assignment of reserved) occupied.add(`${assignment.location}:${assignment.chamber}`);

  for (const chamber of automaticChamberPreferences(rank.grade)) {
    for (const location of CHAMBERED_PALACE_ORDER) {
      if (!db.locations[location]) continue;
      if (!occupied.has(`${location}:${chamber}`)) return { location, chamber };
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

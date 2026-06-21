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
import { shichenSlot, MAO_SLOT } from "../calendar/time";
import { isExcused, wanderChance, wanders } from "./greeting";

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

/** 某侍君在给定 slot 的实际所在 locationId（设计 §4）。非侍君返回其住处。 */
export function consortLocationAt(
  db: ContentDB,
  state: GameState,
  charId: string,
  slot: number,
): string {
  const home = getCharacterLocation(db, state, charId) ?? "";
  const char = db.characters[charId];
  if (!char || char.kind !== "consort") return home;
  const st = state.standing[charId];
  if (!st || st.lifecycle === "deceased" || st.lifecycle === "candidate") return home;
  // 冷宫 / 待选(储秀宫) / 凤后(坤宁宫常驻) 不请安不游走。
  if (home === "changmengong" || home === "chuxiu_gong" || home === "kunninggong") return home;

  if (slot === MAO_SLOT) {
    const o = state.overnightWith;
    if (o && o.charId === charId && o.morningDayIndex === state.calendar.dayIndex) return home; // 留宿未离宫
    if (isExcused(state, charId)) return home;
    return "kunninggong";
  }
  if (slot >= 1 && slot <= 3 && wanders(state.rngSeed, state.calendar.dayIndex, slot, charId, wanderChance(char))) {
    return "yuhuayuan";
  }
  return home;
}

/** 此刻（当前 slot）实际在 locationId 的角色，按位分降序。LocationScreen 用「此处此刻有谁」。 */
export function presentAt(db: ContentDB, state: GameState, locationId: string): CharacterContent[] {
  const slot = shichenSlot(state.calendar);
  return Object.values(db.characters)
    .filter((character) => consortLocationAt(db, state, character.id, slot) === locationId)
    .sort(
      (a, b) =>
        (db.ranks[b.initialStanding?.rank ?? ""]?.order ?? 0) -
        (db.ranks[a.initialStanding?.rank ?? ""]?.order ?? 0),
    );
}

/** 住客（住处花名册）中此刻不在 locationId 者 → 其当前所在。供缺席禀报用。 */
export function absentAt(db: ContentDB, state: GameState, locationId: string): Record<string, string> {
  const slot = shichenSlot(state.calendar);
  const here = new Set(presentAt(db, state, locationId).map((c) => c.id));
  const out: Record<string, string> = {};
  for (const c of getPresentAt(db, state, locationId)) {
    if (!here.has(c.id)) out[c.id] = consortLocationAt(db, state, c.id, slot);
  }
  return out;
}

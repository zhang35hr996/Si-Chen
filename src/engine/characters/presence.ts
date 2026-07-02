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
import { getGreetingLocation } from "./haremAdministration";
import { isInColdPalace } from "./coldPalace";
import { canCharacterParticipate } from "./restrictions";

export function getCharacterLocation(
  db: ContentDB,
  state: GameState,
  charId: string,
): string | null {
  const character = db.characters[charId] ?? state.generatedConsorts[charId];
  if (!character) return null;
  // 搬迁后 standing.residence 覆盖 content 的 defaultLocation。
  return state.standing[charId]?.residence ?? character.defaultLocation ?? null;
}

/** Deduplicated union of state.generatedConsorts and db.characters, keyed by id.
 *  db.characters wins on collision: in App.tsx's runtime db it already contains the
 *  merged generated consorts, so the spread is a no-op; in raw-db tests it ensures
 *  the full CharacterContent from db prevails over any partial state.generatedConsorts
 *  entry that a test may have set up. */
export function allCharacters(db: ContentDB, state: GameState): CharacterContent[] {
  return Object.values({ ...state.generatedConsorts, ...db.characters });
}

/** Characters present at a location, sorted by rank order (highest first). */
export function getPresentAt(
  db: ContentDB,
  state: GameState,
  locationId: string,
): CharacterContent[] {
  return allCharacters(db, state)
    .filter((character) => {
      // event_only consorts without standing are not yet active in this playthrough.
      if (character.kind === "consort" && !state.standing[character.id]) return false;
      return (
        state.standing[character.id]?.lifecycle !== "deceased" &&
        getCharacterLocation(db, state, character.id) === locationId
      );
    })
    .sort((a, b) => byRankDesc(db, state)(a, b));
}

/** 位分降序比较子（封号计入有效序）：侍君各列表统一排序入口。无 standing 视为中性。 */
export function byRankDesc(
  db: ContentDB,
  state: GameState,
): (a: CharacterContent, b: CharacterContent) => number {
  return (a, b) => {
    const ra = state.standing[a.id];
    const rb = state.standing[b.id];
    if (!ra || !rb) return 0; // 无 standing（如存档后新增）按中性处理
    return (
      effectiveOrder(db.ranks[rb.rank]!, rb.title !== undefined) -
      effectiveOrder(db.ranks[ra.rank]!, ra.title !== undefined)
    );
  };
}

/** 宫中侍君：在宫（非冷宫）、未故的侍君（含皇后），按位分降序。查看侍君与翻牌子共用。 */
export function inPalaceConsorts(db: ContentDB, state: GameState): CharacterContent[] {
  return allCharacters(db, state)
    .filter(
      (c) =>
        c.kind === "consort" &&
        state.standing[c.id] !== undefined &&
        state.standing[c.id]?.lifecycle !== "deceased" &&
        !isInColdPalace(state, c.id) &&
        (state.standing[c.id]?.residence ?? c.defaultLocation) !== "changmengong",
    )
    .sort(byRankDesc(db, state));
}

/** 某侍君在给定 slot 的实际所在 locationId（设计 §4）。非侍君返回其住处。 */
export function consortLocationAt(
  db: ContentDB,
  state: GameState,
  charId: string,
  slot: number,
): string {
  const home = getCharacterLocation(db, state, charId) ?? "";
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  if (!char || char.kind !== "consort") return home;
  const st = state.standing[charId];
  if (!st || st.lifecycle === "deceased" || st.lifecycle === "candidate") return home;
  // 禁足：闭锁本宫，不请安、不游走、不外出（统一行动许可层）。
  if (!canCharacterParticipate(state, charId, "leave_palace")) return home;
  // 冷宫 / 待选(储秀宫) / 皇后(坤宁宫常驻) 不请安不游走。
  if (home === "changmengong" || home === "chuxiu_gong" || home === "kunninggong") return home;

  if (slot === MAO_SLOT) {
    const o = state.overnightWith;
    if (o && o.charId === charId && o.morningDayIndex === state.calendar.dayIndex) return home; // 留宿未离宫
    if (isExcused(state, charId)) return home;
    // 生病/重病自动免请安，留在自己的寝殿静养；不写入手动免请安状态。
    if (!canCharacterParticipate(state, charId, "greeting")) return home;
    // 请安地点由六宫主理权动态决定（坤宁宫/协理者寝殿/null=无正式请安→留家）。
    return getGreetingLocation(db, state) ?? home;
  }
  // 物理位置只由 (rngSeed, dayIndex, slot, charId) 确定性决定——**绝不依赖 state.playerLocation**：
  // 否则玩家同一时辰、零行动力移动到侍君住处会使其被重算回宫（御花园↔寝殿瞬移），破坏单一物理位置不变量。
  // 「皇帝临幸时侍君陪驾」的体验由召见/翻牌子（不依赖物理位置）承担；走到空宫则由缺席禀报如实呈现。
  if (slot >= 1 && slot <= 3 && wanders(state.rngSeed, state.calendar.dayIndex, slot, charId, wanderChance(char))) {
    return "yuhuayuan";
  }
  return home;
}

/** 此刻（当前 slot）实际在 locationId 的角色，按位分降序。LocationScreen 用「此处此刻有谁」。 */
export function presentAt(db: ContentDB, state: GameState, locationId: string): CharacterContent[] {
  const slot = shichenSlot(state.calendar);
  return allCharacters(db, state)
    .filter((character) => {
      if (character.kind === "consort" && !state.standing[character.id]) return false;
      return (
        state.standing[character.id]?.lifecycle !== "deceased" &&
        consortLocationAt(db, state, character.id, slot) === locationId
      );
    })
    .sort((a, b) => byRankDesc(db, state)(a, b));
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

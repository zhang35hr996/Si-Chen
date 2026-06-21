/**
 * 角色「存在 / 在场 / 生死」三态严格区分（皇嗣感知化）。
 * - characterExists：可寻址（死者仍存在），供 alive 谓词等需查询死者者。
 * - isCurrentlyPresent：可作当前对话参与者（死者/未来/未知为 false）。
 * 供 canKnowEvent / belief 可见性共用，让皇嗣不再被当未知角色。
 */
import { compareGameTime, toGameTime } from "../calendar/time";
import type { GameTime } from "../calendar/time";
import type { GameState } from "../state/types";

function heirOf(state: GameState, charId: string) {
  return state.resources.bloodline.heirs.find((h) => h.id === charId); // 任何 lifecycle
}

/** 在状态中可寻址：有 standing，或 id 在 bloodline.heirs 内。死者仍存在 → true。 */
export function characterExists(state: GameState, charId: string): boolean {
  return state.standing[charId] !== undefined || heirOf(state, charId) !== undefined;
}

/** 生死：薨逝侍君 / 夭折皇嗣 → true。 */
export function isDeceased(state: GameState, charId: string): boolean {
  const st = state.standing[charId];
  if (st) return st.lifecycle === "deceased";
  return heirOf(state, charId)?.lifecycle === "deceased";
}

/** 侍君=palaceEnteredAt；皇嗣=birthAt（任何 lifecycle）；否则 undefined（官员无入场时刻）。 */
export function characterEntryTime(state: GameState, charId: string): GameTime | undefined {
  const st = state.standing[charId];
  if (st) return st.palaceEnteredAt;
  return heirOf(state, charId)?.birthAt;
}

/** 可作当前对话参与者：存在 ∧ 未逝 ∧ 入场时刻 ≤ now。 */
export function isCurrentlyPresent(state: GameState, charId: string): boolean {
  if (!characterExists(state, charId) || isDeceased(state, charId)) return false;
  const entry = characterEntryTime(state, charId);
  if (entry && compareGameTime(entry, toGameTime(state.calendar)) > 0) return false;
  return true;
}

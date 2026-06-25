/**
 * 冷宫（cold_palace）—— 角色持续状态的唯一权威查询入口。
 *
 * 设计要点：
 *  - 活跃判定只看 startTurn / liftedTurn。
 *  - 手动解除立即失效：liftedTurn 一旦 <= currentTurn 即不再活跃。
 *  - 历史保留：解除就地标 lifted，不物理删除，便于追溯与 LLM 记忆。
 */
import type {
  CharacterStatusEffect,
  ColdPalaceEffect,
  GameState,
} from "../state/types";

function isColdPalaceEffect(e: CharacterStatusEffect): e is ColdPalaceEffect {
  return e.kind === "cold_palace";
}

/** 某冷宫记录在给定旬是否「活跃」（仍在生效）。 */
export function isColdPalaceEffectActiveAt(effect: ColdPalaceEffect, turn: number): boolean {
  if (effect.liftedTurn !== undefined && turn >= effect.liftedTurn) return false;
  return turn >= effect.startTurn;
}

/** 该角色所有冷宫记录（含历史）。 */
export function coldPalaceEffectsOf(state: GameState, charId: string): ColdPalaceEffect[] {
  return state.statusEffects.filter(
    (e): e is ColdPalaceEffect => isColdPalaceEffect(e) && e.characterId === charId,
  );
}

/** 该角色在给定旬（缺省=当前旬）的活跃冷宫记录；无则 undefined。 */
export function activeColdPalaceEffectFor(
  state: GameState,
  charId: string,
  turn: number = state.calendar.dayIndex,
): ColdPalaceEffect | undefined {
  return coldPalaceEffectsOf(state, charId).find((e) => isColdPalaceEffectActiveAt(e, turn));
}

/** 该角色当前（或给定旬）是否在冷宫——唯一权威判定入口。 */
export function isInColdPalace(
  state: GameState,
  charId: string,
  turn: number = state.calendar.dayIndex,
): boolean {
  return activeColdPalaceEffectFor(state, charId, turn) !== undefined;
}

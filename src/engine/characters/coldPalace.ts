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

/** UI 前置校验：该侍君是否可被打入冷宫（状态层校验，不替代后端约束）。 */
export function canSendToColdPalace(
  state: GameState,
  charId: string,
): { ok: true } | { ok: false; reason: string } {
  const standing = state.standing[charId];
  if (!standing) return { ok: false, reason: "此人无在案记录" };
  if (standing.lifecycle === "deceased") return { ok: false, reason: "斯人已逝，无从处置" };
  if (standing.lifecycle === "candidate") return { ok: false, reason: "候选人不受此令" };
  if (isInColdPalace(state, charId)) return { ok: false, reason: "已身处冷宫" };
  return { ok: true };
}

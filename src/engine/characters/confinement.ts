/**
 * 禁足（confinement）—— 角色持续状态的唯一权威查询入口。
 *
 * 设计要点（任务 §3/§4）：
 *  - 活跃判定只看 startTurn / endTurnExclusive，不存「剩余月份」。
 *  - 当前旬即第一旬：`currentTurn >= startTurn && (end === null || currentTurn < end)`。
 *  - 有期限到期后自然失效（无需删除）；无诏不得出（end === null）永不自动到期。
 *  - 手动解除立即失效：liftedTurn 一旦 <= currentTurn 即不再活跃。
 *  - 历史保留：解除就地标 lifted，不物理删除，便于追溯与 LLM 记忆。
 */
import type {
  CharacterStatusEffect,
  ConfinementEffect,
  GameState,
} from "../state/types";

/** 禁足期限（旬）。一个月 = 3 旬；无诏不得出 = 不自动到期。 */
export const CONFINEMENT_DURATIONS = {
  one_month: 3,
  three_months: 9,
  half_year: 18,
  one_year: 36,
  indefinite: null,
} as const satisfies Record<string, number | null>;

export type ConfinementDurationKey = keyof typeof CONFINEMENT_DURATIONS;

export const CONFINEMENT_DURATION_LABELS: Record<ConfinementDurationKey, string> = {
  one_month: "一个月",
  three_months: "三个月",
  half_year: "半年",
  one_year: "一年",
  indefinite: "无诏不得出",
};

/** 顺序固定的期限选项（UI 渲染用）。 */
export const CONFINEMENT_DURATION_ORDER: readonly ConfinementDurationKey[] = [
  "one_month",
  "three_months",
  "half_year",
  "one_year",
  "indefinite",
];

function isConfinement(e: CharacterStatusEffect): e is ConfinementEffect {
  return e.kind === "confinement";
}

/** 某禁足记录在给定旬是否「活跃」（仍在生效）。 */
export function isConfinementActiveAt(effect: ConfinementEffect, turn: number): boolean {
  if (effect.liftedTurn !== undefined && turn >= effect.liftedTurn) return false;
  if (turn < effect.startTurn) return false;
  return effect.endTurnExclusive === null || turn < effect.endTurnExclusive;
}

/** 该角色所有禁足记录（含历史）。 */
export function confinementsOf(state: GameState, charId: string): ConfinementEffect[] {
  return state.statusEffects.filter(
    (e): e is ConfinementEffect => isConfinement(e) && e.characterId === charId,
  );
}

/** 该角色在给定旬（缺省=当前旬）的活跃禁足记录；无则 undefined。 */
export function activeConfinement(
  state: GameState,
  charId: string,
  turn: number = state.calendar.dayIndex,
): ConfinementEffect | undefined {
  return confinementsOf(state, charId).find((e) => isConfinementActiveAt(e, turn));
}

/** 该角色当前（或给定旬）是否被禁足——唯一权威判定入口。 */
export function isConfined(
  state: GameState,
  charId: string,
  turn: number = state.calendar.dayIndex,
): boolean {
  return activeConfinement(state, charId, turn) !== undefined;
}

/**
 * 已到期但尚未写「期满」记录的禁足（end !== null 且 currentTurn >= end 且未 lifted）。
 * 自动到期 sweep 用：返回需结案的记录，sweep 据此写 liftedTurn=endTurnExclusive 并记一次史。
 */
export function expiredUnrecordedConfinements(
  state: GameState,
  turn: number = state.calendar.dayIndex,
): ConfinementEffect[] {
  return state.statusEffects.filter(
    (e): e is ConfinementEffect =>
      isConfinement(e) &&
      e.liftedTurn === undefined &&
      e.endTurnExclusive !== null &&
      turn >= e.endTurnExclusive,
  );
}

/** 下一个持续状态 id（"status_<charId>_NNNNNN" 单调）。 */
export function nextStatusEffectId(state: GameState, charId: string): string {
  const re = new RegExp(`^status_${charId}_(\\d{6})$`);
  let max = 0;
  for (const e of state.statusEffects) {
    const m = re.exec(e.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `status_${charId}_${String(max + 1).padStart(6, "0")}`;
}

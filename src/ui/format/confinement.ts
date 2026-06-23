/**
 * 禁足相关的展示文案（精确到旬）。所有 UI 入口共用，避免「只显示禁足一个月」而不显示
 * 实际到期旬（任务 §8）。
 */
import { formatGameTime, fromTurnIndex } from "../../engine/calendar/time";
import type { ConfinementEffect } from "../../engine/state/types";

/** 起始旬文案，如「昭元三年五月中旬」。 */
export function confinementStartLabel(effect: ConfinementEffect, eraName: string): string {
  return formatGameTime({ ...effect.imposedAt, eraName });
}

/** 到期旬文案；无诏不得出返回「无诏不得出」。 */
export function confinementReleaseLabel(effect: ConfinementEffect, eraName: string): string {
  if (effect.endTurnExclusive === null) return "无诏不得出";
  return formatGameTime({ ...fromTurnIndex(effect.endTurnExclusive), eraName });
}

/** 一句话现状，如「自昭元三年五月中旬起禁足，至昭元三年六月中旬解除」。 */
export function describeActiveConfinement(effect: ConfinementEffect, eraName: string): string {
  const start = confinementStartLabel(effect, eraName);
  if (effect.endTurnExclusive === null) {
    return `自${start}起无诏不得出。`;
  }
  return `自${start}起禁足，至${confinementReleaseLabel(effect, eraName)}解除。`;
}

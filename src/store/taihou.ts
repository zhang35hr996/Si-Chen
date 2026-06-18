/** 太后系统纯逻辑（生病/侍疾/敲打），种子化确定性。 */
import { gestationRoll } from "../engine/characters/gestation";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export const TAIHOU_BASE_ILL_CHANCE = 5;
export const TAIHOU_ILL_CHANCE_CAP = 25;
export const TAIHOU_RECOVER_CHANCE = 50;

export interface TaihouBeats {
  effects: EventEffect[];
  beats: { speakerId: string; lines: string[] }[];
}

/** 元年=5%，逐年+1%，封顶 25%。 */
export function taihouIllnessChance(year: number): number {
  return Math.min(TAIHOU_BASE_ILL_CHANCE + Math.max(0, year - 1), TAIHOU_ILL_CHANCE_CAP);
}

/** 旬翻转掷骰：未病→可能生病（含提示）；已病→可能自愈（无提示）。无变化返回 null。 */
export function buildTaihouIllnessTick(state: GameState, seedKey: string): TaihouBeats | null {
  if (!state.taihou.ill) {
    const chance = taihouIllnessChance(state.calendar.year);
    if (gestationRoll(`taihou:ill:${seedKey}`) % 100 >= chance) return null;
    return {
      effects: [{ type: "set_taihou_illness", ill: true }],
      beats: [{ speakerId: "sili_nvguan", lines: ["司礼官急奏：太后凤体违和，太医已往慈宁宫诊视。"] }],
    };
  }
  if (gestationRoll(`taihou:recover:${seedKey}`) % 100 >= TAIHOU_RECOVER_CHANCE) return null;
  return { effects: [{ type: "set_taihou_illness", ill: false }], beats: [] };
}

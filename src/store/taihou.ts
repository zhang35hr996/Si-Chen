/** 太后系统纯逻辑（生病/侍疾/敲打），种子化确定性。 */
import { gestationRoll } from "../engine/characters/gestation";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
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

export const TAIHOU_SHIZHI_CHANCE = 50;

export interface ShizhiPlan {
  attendantId: string;
  effects: EventEffect[];
  beats: { speakerId: string; lines: string[] }[];
}

/** 在宫存活的侍君 + 凤后。 */
function attendantPool(db: ContentDB, state: GameState): string[] {
  return Object.values(db.characters)
    .filter((c) => {
      if (c.kind !== "consort") return false;
      if (c.defaultLocation === "lenggong") return false;
      return state.standing[c.id]?.lifecycle !== "deceased";
    })
    .map((c) => c.id);
}

/** 病中进慈宁宫遇侍君/凤后侍疾。seedKey 按旬钉死。无遭遇/无候选→null。 */
export function buildShizhiEncounter(db: ContentDB, state: GameState, seedKey: string): ShizhiPlan | null {
  if (!state.taihou.ill) return null;
  if (gestationRoll(`taihou:shizhi:gate:${seedKey}`) % 100 >= TAIHOU_SHIZHI_CHANCE) return null;
  const pool = attendantPool(db, state);
  if (pool.length === 0) return null;
  const attendantId = pool[gestationRoll(`taihou:shizhi:pick:${seedKey}`) % pool.length]!;
  const char = db.characters[attendantId]!;
  const st = state.standing[attendantId];
  const name = resolveDisplayName(char, st, st ? db.ranks[st.rank] : undefined);
  return {
    attendantId,
    effects: [
      { type: "set_taihou_illness", ill: false },
      { type: "favor", char: attendantId, delta: 5 },
      {
        type: "memory",
        char: attendantId,
        entry: {
          kind: "event",
          summary: "太后凤体违和，臣往慈宁宫侍疾，蒙太后与陛下嘉许。",
          salience: 55,
          tags: ["taihou", "favor"],
          participants: ["taihou", attendantId, "player"],
        },
      },
    ],
    beats: [
      { speakerId: "taihou", lines: [`哀家病中，难为${name}日日来侍奉汤药，难得这份孝心。`] },
      { speakerId: "player", lines: [`${name}侍疾辛劳，朕都看在眼里。`] },
      { speakerId: attendantId, lines: [`侍奉太后，是臣的本分，不敢当太后与陛下夸赞。`] },
    ],
  };
}

export const TAIHOU_REBUKE_CHANCE = 5;

export interface RebukePlan {
  targetId: string;
  effects: EventEffect[];
  beats: { speakerId: string; lines: string[] }[];
}

/** 候选：在宫存活侍君，排除凤后。 */
function rebukePool(db: ContentDB, state: GameState): { id: string; favor: number }[] {
  return Object.values(db.characters)
    .filter((c) => {
      if (c.kind !== "consort" || c.id === "feng_hou") return false;
      if (c.defaultLocation === "lenggong") return false;
      return state.standing[c.id]?.lifecycle !== "deceased";
    })
    .map((c) => ({ id: c.id, favor: state.standing[c.id]?.favor ?? 0 }));
}

/** 每行动点 5% 敲打；病中不掷。按 favor 加权选人（宠高更易中）。无候选→null。 */
export function buildTaihouRebuke(db: ContentDB, state: GameState, seedKey: string): RebukePlan | null {
  if (state.taihou.ill) return null;
  if (gestationRoll(`taihou:rebuke:gate:${seedKey}`) % 100 >= TAIHOU_REBUKE_CHANCE) return null;
  const pool = rebukePool(db, state);
  if (pool.length === 0) return null;

  // favor-weighted pick; favor 全 0 时退化为均匀。
  const total = pool.reduce((sum, p) => sum + p.favor, 0);
  let pickId: string;
  if (total <= 0) {
    pickId = pool[gestationRoll(`taihou:rebuke:pick:${seedKey}`) % pool.length]!.id;
  } else {
    let roll = gestationRoll(`taihou:rebuke:pick:${seedKey}`) % total;
    pickId = pool[pool.length - 1]!.id;
    for (const p of pool) {
      if (roll < p.favor) { pickId = p.id; break; }
      roll -= p.favor;
    }
  }

  const char = db.characters[pickId]!;
  const st = state.standing[pickId];
  const name = resolveDisplayName(char, st, st ? db.ranks[st.rank] : undefined);
  return {
    targetId: pickId,
    effects: [
      { type: "favor", char: pickId, delta: -5 },
      { type: "resource", pillar: "harem", field: "harmony", delta: 2 },
      {
        type: "memory",
        char: pickId,
        entry: {
          kind: "event",
          summary: "被太后召去慈宁宫训诫，戒臣勿恃宠骄纵、独占圣心。",
          salience: 65,
          tags: ["taihou", "rebuke"],
          participants: ["taihou", pickId],
        },
      },
    ],
    beats: [
      { speakerId: "taihou", lines: [`${name}近来圣眷正浓，哀家有句话须叮嘱：宠不可恃，更不可独揽圣心，免招后宫非议。`] },
      { speakerId: pickId, lines: [`${name}惶恐领训，谨记太后教诲，不敢有违。`] },
    ],
  };
}

/** 太后系统纯逻辑（侍疾/敲打），种子化确定性。*/
import { gestationRoll, gestationRollRaw } from "../engine/characters/gestation";
import { isConfined } from "../engine/characters/confinement";
import { isIll } from "../engine/characters/health";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";

export interface TaihouBeats {
  effects: EventEffect[];
  beats: { speakerId: string; lines: string[] }[];
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
      if (c.defaultLocation === "changmengong") return false;
      if (isConfined(state, c.id)) return false; // 禁足者不往慈宁宫侍疾
      return state.standing[c.id]?.lifecycle !== "deceased";
    })
    .map((c) => c.id);
}

/** 病中进慈宁宫遇侍君/凤后侍疾。seedKey 按旬钉死。无遭遇/无候选→null。 */
export function buildShizhiEncounter(db: ContentDB, state: GameState, seedKey: string): ShizhiPlan | null {
  if (state.taihou.deceased) return null; // 太后已薨：不再触发侍疾。
  if (!isIll(state.taihou.healthStatus)) return null;
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
      // 侍疾不再免费治愈太后（病情仅由月度 tick / Phase 3 太医改变）。
      { type: "favor", char: attendantId, delta: 5 },
      {
        type: "memory",
        char: attendantId,
        entry: {
          kind: "episodic",
          summary: "太后凤体违和，臣往慈宁宫侍疾，蒙太后与陛下嘉许。",
          strength: 55,
          retention: "slow",
          subjectIds: ["taihou", attendantId, "player"],
          perspective: "witness",
          triggerTags: ["taihou", "favor"],
          unresolved: false,
          emotions: { joy: 30 },
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
      if (c.kind !== "consort" || c.id === "shen_zhibai") return false;
      if (c.defaultLocation === "changmengong") return false;
      if (isConfined(state, c.id)) return false; // 禁足者不被太后召见训诫
      return state.standing[c.id]?.lifecycle !== "deceased";
    })
    .map((c) => ({ id: c.id, favor: state.standing[c.id]?.favor ?? 0 }));
}

/** 每行动点 5% 敲打；病中不掷。按 favor 加权选人（宠高更易中）。无候选→null。 */
export function buildTaihouRebuke(db: ContentDB, state: GameState, seedKey: string): RebukePlan | null {
  if (state.taihou.deceased) return null; // 太后已薨：不再触发敲打。
  if (isIll(state.taihou.healthStatus)) return null;
  if (gestationRoll(`taihou:rebuke:gate:${seedKey}`) % 100 >= TAIHOU_REBUKE_CHANCE) return null;
  const pool = rebukePool(db, state);
  if (pool.length === 0) return null;

  // favor-weighted pick; favor 全 0 时退化为均匀。
  const total = pool.reduce((sum, p) => sum + p.favor, 0);
  let pickId: string;
  if (total <= 0) {
    pickId = pool[gestationRoll(`taihou:rebuke:pick:${seedKey}`) % pool.length]!.id;
  } else {
    let roll = gestationRollRaw(`taihou:rebuke:pick:${seedKey}`) % total;
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
      {
        type: "memory",
        char: pickId,
        entry: {
          kind: "episodic",
          summary: "被太后召去慈宁宫训诫，戒臣勿恃宠骄纵、独占圣心。",
          strength: 65,
          retention: "slow",
          subjectIds: ["taihou", pickId],
          perspective: "target",
          triggerTags: ["taihou", "rebuke"],
          unresolved: true,
          emotions: { shame: 30, fear: 20 },
        },
      },
    ],
    beats: [
      { speakerId: "taihou", lines: [`${name}近来圣眷正浓，哀家有句话须叮嘱：宠不可恃，更不可独揽圣心，免招后宫非议。`] },
      { speakerId: pickId, lines: [`${name}惶恐领训，谨记太后教诲，不敢有违。`] },
    ],
  };
}

/**
 * 把一次侍寝组装成（效果批 + 体验台词 + 初夜/受孕标记）供 UI 消费。返回 null
 * 表示对象不是侍君。效果走正常漏斗；台词经对话缝隙重放（与 rankOps 同构）。
 */
import { conceives } from "../engine/characters/conception";
import { DEFAULT_TIERS, type BedchamberThresholds } from "../engine/characters/favorTier";
import { renderSelfRef, resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { BedchamberMode, GameState } from "../engine/state/types";

export const DEFAULT_CONCEPTION_CHANCE = 30;

const FALLBACK_SCRIPT: Record<BedchamberMode, string[]> = {
  passion: ["{name}敛衽称是，上前服侍帝王。承欢一夕，陛下只觉神清气爽。"],
  pleasure: ["{name}近前奉茶解乏，一夕清谈相伴，陛下神清气爽。"],
};

export interface BedchamberConfig {
  conceptionChance: number;
  tiers: BedchamberThresholds;
}

export function bedchamberConfig(db: ContentDB): BedchamberConfig {
  return {
    conceptionChance: db.world.bedchamber?.conceptionChance ?? DEFAULT_CONCEPTION_CHANCE,
    tiers: db.world.bedchamber?.tiers ?? DEFAULT_TIERS,
  };
}

export interface BedchamberPlan {
  charId: string;
  effects: EventEffect[];
  lines: string[];
  isFirstNight: boolean;
  conceived: boolean;
}

export function buildBedchamber(
  db: ContentDB,
  state: GameState,
  charId: string,
  mode: BedchamberMode,
): BedchamberPlan | null {
  const character = db.characters[charId];
  const record = state.bedchamber[charId];
  if (!character || character.kind !== "consort" || !record) return null;

  const isFirstNight = record.encounters.length === 0;
  const effects: EventEffect[] = [{ type: "bedchamber", char: charId, mode }];

  const cfg = bedchamberConfig(db);
  const conceived =
    mode === "passion" &&
    state.resources.bloodline.pregnancy.status === "none" &&
    conceives(state.rngSeed, state.calendar.dayIndex, charId, cfg.conceptionChance);
  if (conceived) effects.push({ type: "pregnancy", op: "begin" });

  const standing = state.standing[charId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = resolveDisplayName(character, standing, rank);
  const self = renderSelfRef(rank);
  const raw = db.world.bedchamberScript?.[mode]?.lines ?? FALLBACK_SCRIPT[mode];
  const lines = raw.map((s) => s.replaceAll("{name}", name).replaceAll("{self}", self));

  return { charId, effects, lines, isFirstNight, conceived };
}

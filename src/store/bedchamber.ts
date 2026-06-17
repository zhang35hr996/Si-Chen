/**
 * 把一次侍寝组装成（效果批 + 体验台词 + 初夜/受孕标记）供 UI 消费。返回 null
 * 表示对象不是侍君。效果走正常漏斗；台词经对话缝隙重放（与 rankOps 同构）。
 */
import { conceives } from "../engine/characters/conception";
import { DEFAULT_TIERS, type BedchamberThresholds } from "../engine/characters/favorTier";
import { renderSelfRef, resolveDisplayName } from "../engine/characters/standing";
import { monthOrdinal } from "../engine/calendar/time";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { BedchamberMode, GameState } from "../engine/state/types";

export const DEFAULT_CONCEPTION_CHANCE = 30;

const FALLBACK_SCRIPT: Record<BedchamberMode, string[]> = {
  passion: ["{name}敛衽称是，上前服侍帝王。承欢一夕，陛下只觉神清气爽。"],
  pleasure: ["{name}近前奉茶解乏，一夕清谈相伴，陛下神清气爽。"],
  companionship: ["{name}近前相伴，理妆奉茶、轻声叙话，陪着陛下闲话家常。"],
};

/** 陪伴按 (帝王有孕, 侍君有孕) 分四种台词的引擎内置 fallback（content 缺省时用）。 */
const FALLBACK_COMPANIONSHIP = {
  neither: ["{name}近前相伴，理妆奉茶、轻声叙话，陪着陛下闲话家常。"],
  sovereign: ["{name}见陛下凤体有孕，扶坐奉茶，轻声宽慰，唯恐惊动龙胎。"],
  consort: ["{name}腹中已怀皇嗣，陛下亲来探视，命其安坐，不必多礼。"],
  both: ["陛下与{name}皆怀身孕，相对而坐，彼此叮咛保重。"],
};

/**
 * 陪伴台词：按帝王自身是否有孕、且本侍君是否承嗣有孕，四选一。
 * 优先 content（world.json）的对应分支，缺省回退到 lines / 引擎内置 fallback。
 */
function companionshipLines(db: ContentDB, sovereignPregnant: boolean, consortPregnant: boolean): string[] {
  const s = db.world.bedchamberScript?.companionship;
  if (sovereignPregnant && consortPregnant) return s?.bothPregnant ?? s?.lines ?? FALLBACK_COMPANIONSHIP.both;
  if (sovereignPregnant) return s?.sovereignPregnant ?? s?.lines ?? FALLBACK_COMPANIONSHIP.sovereign;
  if (consortPregnant) return s?.consortPregnant ?? s?.lines ?? FALLBACK_COMPANIONSHIP.consort;
  return s?.lines ?? FALLBACK_COMPANIONSHIP.neither;
}

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

/**
 * 帝王自身是否正在孕育（pending/carrying）。多线孕育下，仅帝王自身的孕情阻断
 * 再次受孕；已传嗣的侍君各自承嗣不影响帝王再孕。
 */
export function hasActiveGestation(state: GameState): boolean {
  return state.resources.bloodline.pregnancy.status !== "none";
}

/** 激情可选：非承嗣君怀胎中、且不在产后休养中。 */
export function passionAllowed(state: GameState, charId: string): boolean {
  const st = state.standing[charId];
  if (!st) return false;
  if (st.lifecycle === "carrying") return false;
  if (st.recoverUntilMonth !== undefined && monthOrdinal(state.calendar) < st.recoverUntilMonth) return false;
  return true;
}

/** 可召侍寝：非已故。 */
export function canSummon(state: GameState, charId: string): boolean {
  return state.standing[charId]?.lifecycle !== "deceased";
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
    !hasActiveGestation(state) &&
    passionAllowed(state, charId) &&
    conceives(state.rngSeed, state.calendar.dayIndex, charId, cfg.conceptionChance);
  if (conceived) effects.push({ type: "pregnancy", op: "begin" });

  const standing = state.standing[charId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = resolveDisplayName(character, standing, rank);
  const self = renderSelfRef(rank);
  // 陪伴按双方孕情四分；其余模式走单一脚本。
  const raw =
    mode === "companionship"
      ? companionshipLines(
          db,
          state.resources.bloodline.pregnancy.status !== "none",
          state.resources.bloodline.gestations.some((g) => g.carrier === charId),
        )
      : (db.world.bedchamberScript?.[mode]?.lines ?? FALLBACK_SCRIPT[mode]);
  const lines = raw.map((s) => s.replaceAll("{name}", name).replaceAll("{self}", self));

  return { charId, effects, lines, isFirstNight, conceived };
}

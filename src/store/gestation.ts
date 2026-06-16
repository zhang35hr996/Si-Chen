/**
 * 孕育流程装配层（供 App 编排）：解析配置 → 纯函数裁决 → 组装 effects + 反应台词。
 * effects 走正常漏斗；lines 经 ReactionScreen 对话缝隙重放。
 */
import { monthOrdinal, toGameTime } from "../engine/calendar/time";
import { resolveBirth } from "../engine/characters/birth";
import {
  DEFAULT_GESTATION,
  birthSlot,
  plannedBirthMonth,
  recoverUntilMonth,
  type GestationConfig,
} from "../engine/characters/gestation";
import { resolveDisplayName } from "../engine/characters/standing";
import type { ContentDB } from "../engine/content/loader";
import type { EventEffect } from "../engine/content/schemas";
import type { GameState } from "../engine/state/types";
import { bedchamberConfig } from "./bedchamber";

export function gestationConfig(db: ContentDB): GestationConfig {
  return db.world.gestation ?? DEFAULT_GESTATION;
}

function displayName(db: ContentDB, state: GameState, charId: string): string {
  const ch = db.characters[charId];
  if (!ch) return charId;
  const st = state.standing[charId];
  return resolveDisplayName(ch, st, st ? db.ranks[st.rank] : undefined);
}

export interface BirthTiming {
  birthMonthOrdinal: number;
  birthSlot: number;
}

/** 确定的生产月 + 当月行动点 slot。无 gestation 返回 null。 */
export function plannedBirth(db: ContentDB, state: GameState): BirthTiming | null {
  const gest = state.resources.bloodline.gestation;
  if (!gest) return null;
  const cfg = gestationConfig(db);
  const bm = plannedBirthMonth(state.rngSeed, gest.conceivedAt, gest.carrier, cfg);
  return { birthMonthOrdinal: bm, birthSlot: birthSlot(state.rngSeed, bm, state.calendar.apMax) };
}

/** 是否已到生产时机（到月 + slot；过月即补触发）。 */
export function birthDue(db: ContentDB, state: GameState): boolean {
  const timing = plannedBirth(db, state);
  if (!timing) return false;
  const cur = monthOrdinal(state.calendar);
  if (cur > timing.birthMonthOrdinal) return true;
  if (cur < timing.birthMonthOrdinal) return false;
  const slot = state.calendar.apMax - state.calendar.ap;
  return slot >= timing.birthSlot;
}

export type BirthOutcome = "safe" | "child_dies" | "bearer_dies" | "both";

export interface GestationPlan {
  effects: EventEffect[];
  lines: string[];
  /** 生产承载侍君（非自孕安产时供产后晋升用）；自孕为 "sovereign"。 */
  bearer: "sovereign" | string;
  bearerOutcome: BirthOutcome;
}

/** 生产裁决 → birth effect + 播报台词。无 gestation 返回 null。 */
export function buildBirth(db: ContentDB, state: GameState): GestationPlan | null {
  const gest = state.resources.bloodline.gestation;
  if (!gest) return null;
  const cfg = gestationConfig(db);
  const now = toGameTime(state.calendar);
  const bearerIsFenghou = gest.carrier === "feng_hou";

  const verdict = resolveBirth({
    rngSeed: state.rngSeed,
    now,
    carrier: gest.carrier,
    fatherId: gest.fatherId ?? null,
    transferredAtMonth: gest.transferredAtMonth,
    bearerIsFenghou,
    carrierRecord: gest.carrier === "sovereign" ? undefined : state.bedchamber[gest.carrier],
    thresholds: bedchamberConfig(db).tiers,
    cfg,
  });

  const safe = verdict.bearerOutcome === "safe";
  const recover =
    gest.carrier !== "sovereign" && (safe || verdict.bearerOutcome === "child_dies")
      ? recoverUntilMonth(monthOrdinal(now), safe, cfg)
      : undefined;

  const childNoun = verdict.sex === "daughter" ? "皇子" : "皇郎";
  const lines = buildBirthLines(db, state, gest.carrier, verdict.bearerOutcome, childNoun);

  return {
    effects: [
      {
        type: "birth",
        sex: verdict.sex,
        fatherId: verdict.fatherId,
        bearer: verdict.bearer,
        legitimate: verdict.legitimate,
        favor: verdict.favor,
        bearerOutcome: verdict.bearerOutcome,
        ...(recover !== undefined ? { recoverUntilMonth: recover } : {}),
      },
    ],
    lines,
    bearer: gest.carrier,
    bearerOutcome: verdict.bearerOutcome,
  };
}

function buildBirthLines(
  db: ContentDB,
  state: GameState,
  carrier: string,
  outcome: BirthOutcome,
  childNoun: string,
): string[] {
  if (carrier === "sovereign") {
    return [`陛下临盆，诞下一位${childNoun}，母子均安，举宫称庆。`];
  }
  const name = displayName(db, state, carrier);
  switch (outcome) {
    case "safe":
      return [`${name}临盆，顺利诞下一位${childNoun}，母子均安。`];
    case "child_dies":
      return [`${name}难产，胎死腹中，太医勉力保住了${name}性命。噩耗传来，宫中一片缄默。`];
    case "bearer_dies":
      return [`${name}难产，拼死诞下一位${childNoun}，自己却血崩而亡。宫人垂泪相送。`];
    case "both":
      return [`${name}难产，一尸两命。太医跪地请罪，宫中举哀。`];
  }
}

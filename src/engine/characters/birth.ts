/**
 * 生产裁决（纯函数，确定性）：性别、难产结局、子嗣宠爱初值。
 * 帝王自孕（carrier="sovereign"）永不难产。宠爱按生产当月承载侍君的受宠程度派生。
 */
import { monthOrdinal, type GameTime } from "../calendar/time";
import { computeFavorStats, type BedchamberThresholds, type FavorTier } from "./favorTier";
import { dystociaChance, gestationRoll, type GestationConfig } from "./gestation";
import type { BedchamberRecord, HeirSex } from "../state/types";

export type BearerOutcome = "safe" | "child_dies" | "bearer_dies" | "both";

export interface BirthInput {
  rngSeed: number;
  now: GameTime;
  carrier: "sovereign" | string;
  fatherId: string | null;
  transferredAtMonth: number | undefined;
  bearerIsFenghou: boolean;
  /** 承载侍君的侍寝日志（自孕传 undefined）。 */
  carrierRecord: BedchamberRecord | undefined;
  thresholds: BedchamberThresholds;
  cfg: GestationConfig;
}

export interface BirthVerdict {
  sex: HeirSex;
  fatherId: string | null;
  bearer: "sovereign" | string;
  legitimate: boolean;
  favor: number;
  bearerOutcome: BearerOutcome;
}

const FENGHOU_CAP = 80;

function tierValue(tier: FavorTier, cfg: GestationConfig): number {
  return cfg.childFavor.tierValues[tier];
}

function pickOutcome(roll: number, cfg: GestationConfig): Exclude<BearerOutcome, "safe"> {
  const { childDies, bearerDies } = cfg.dystocia.outcomeSplit;
  if (roll < childDies) return "child_dies";
  if (roll < childDies + bearerDies) return "bearer_dies";
  return "both";
}

export function resolveBirth(input: BirthInput): BirthVerdict {
  const { rngSeed, now, carrier, fatherId, transferredAtMonth, bearerIsFenghou } = input;
  const bm = monthOrdinal(now);

  const sex: HeirSex = gestationRoll(`sex:${rngSeed}:${bm}:${carrier}`) % 2 === 0 ? "daughter" : "son";
  const legitimate = bearerIsFenghou || carrier === "sovereign";

  // 宠爱初值
  let favor: number;
  if (carrier === "sovereign") {
    favor = input.cfg.childFavor.selfPregnancy;
  } else {
    const stats = computeFavorStats(input.carrierRecord, now, input.thresholds);
    favor = tierValue(stats.tier, input.cfg);
    if (bearerIsFenghou) favor = Math.min(FENGHOU_CAP, favor + input.cfg.childFavor.fenghouBonus);
  }

  // 难产裁决（自孕不判定）
  let bearerOutcome: BearerOutcome = "safe";
  if (carrier !== "sovereign") {
    const chance = dystociaChance(transferredAtMonth ?? input.cfg.transferEarliestMonth, input.cfg);
    const hit = chance > 0 && gestationRoll(`dystocia:${rngSeed}:${bm}:${carrier}`) < chance;
    if (hit) bearerOutcome = pickOutcome(gestationRoll(`outcome:${rngSeed}:${bm}:${carrier}`), input.cfg);
  }

  return { sex, fatherId, bearer: carrier, legitimate, favor, bearerOutcome };
}

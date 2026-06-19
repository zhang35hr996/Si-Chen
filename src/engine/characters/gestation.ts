/**
 * 孕育生命周期纯逻辑：孕月数、难产几率、提前生产、生产月/行动点 slot、产后休养。
 * 全部确定性（fnv1a64Hex 取模，不改 rngSeed）。配置由调用方传入（保持引擎纯净）。
 */
import { fnv1a64Hex } from "../save/canonical";
import { monthOrdinal, type GameTime } from "../calendar/time";

export interface GestationConfig {
  termMonths: number;
  transferEarliestMonth: number;
  earlyBirth: { month8: number; month9: number };
  recovery: { safeMonths: number; dystociaMonths: number };
  dystocia: {
    baseAtMonth3: number;
    perMonthAfter: number;
    outcomeSplit: { childDies: number; bearerDies: number; both: number };
  };
  childFavor: {
    selfPregnancy: number;
    fenghouBonus: number;
    tierValues: { abundant: number; favored: number; small: number; fallen: number; none: number };
  };
}

export const DEFAULT_GESTATION: GestationConfig = {
  termMonths: 10,
  transferEarliestMonth: 3,
  earlyBirth: { month8: 10, month9: 20 },
  recovery: { safeMonths: 1, dystociaMonths: 3 },
  dystocia: { baseAtMonth3: 5, perMonthAfter: 8, outcomeSplit: { childDies: 50, bearerDies: 30, both: 20 } },
  childFavor: {
    selfPregnancy: 100,
    fenghouBonus: 30,
    tierValues: { abundant: 50, favored: 38, small: 25, fallen: 12, none: 0 },
  },
};

const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

/** 确定性 0–99 取模 roll。 */
export function gestationRoll(seedString: string): number {
  return parseInt(fnv1a64Hex(seedString).slice(0, 8), 16) % 100;
}

/** 确定性 32 位整数 roll（未取模 100）；用于权重区间大于 100 的加权抽取。 */
export function gestationRollRaw(seedString: string): number {
  return parseInt(fnv1a64Hex(seedString).slice(0, 8), 16);
}

/** 孕月数（受孕月=1）。 */
export function gestationMonth(
  now: Pick<GameTime, "year" | "month">,
  conceivedAt: Pick<GameTime, "year" | "month">,
): number {
  return monthOrdinal(now) - monthOrdinal(conceivedAt) + 1;
}

/** 难产几率：base + max(0, atMonth−3)*perMonthAfter，钳 0–100。 */
export function dystociaChance(transferredAtMonth: number, cfg: GestationConfig): number {
  return clampPct(cfg.dystocia.baseAtMonth3 + Math.max(0, transferredAtMonth - 3) * cfg.dystocia.perMonthAfter);
}

/** 提前生产命中判定（孕八月用 month8，孕九月用 month9；其它月不判定）。 */
export function earlyBirthHit(
  rngSeed: number,
  birthMonthOrdinal: number,
  carrierId: string,
  gestMonth: 8 | 9,
  cfg: GestationConfig,
): boolean {
  const chance = gestMonth === 8 ? cfg.earlyBirth.month8 : cfg.earlyBirth.month9;
  if (chance <= 0) return false;
  if (chance >= 100) return true;
  return gestationRoll(`early:${rngSeed}:${birthMonthOrdinal}:${carrierId}:${gestMonth}`) < chance;
}

/**
 * 确定的生产月（monthOrdinal）。自孕固定孕十月；承嗣君孕八/九月各判一次提前。
 * carrier="sovereign" 或承载侍君 charId。
 */
export function plannedBirthMonth(
  rngSeed: number,
  conceivedAt: Pick<GameTime, "year" | "month">,
  carrier: string,
  cfg: GestationConfig,
): number {
  const base = monthOrdinal(conceivedAt);
  const term = base + (cfg.termMonths - 1); // 孕十月
  if (carrier === "sovereign") return term;
  const month8 = base + 7;
  const month9 = base + 8;
  if (earlyBirthHit(rngSeed, month8, carrier, 8, cfg)) return month8;
  if (earlyBirthHit(rngSeed, month9, carrier, 9, cfg)) return month9;
  return term;
}

/** 生产当月的确定性行动点 slot（0..apMax−1）。 */
export function birthSlot(rngSeed: number, birthMonthOrdinal: number, apMax: number): number {
  return gestationRoll(`birthslot:${rngSeed}:${birthMonthOrdinal}`) % apMax;
}

/** 产后休养截止月序：安产 +safeMonths+1；难产存活 +dystociaMonths+1（截止月当月仍虚弱）。 */
export function recoverUntilMonth(birthMonthOrdinal: number, safe: boolean, cfg: GestationConfig): number {
  const months = safe ? cfg.recovery.safeMonths : cfg.recovery.dystociaMonths;
  return birthMonthOrdinal + months + 1;
}

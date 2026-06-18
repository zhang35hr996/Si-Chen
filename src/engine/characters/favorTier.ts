/**
 * 受宠程度（盛宠/宠爱/小宠/失宠/无宠）+ 近一月/近三月/近一年次数 — 纯函数，
 * 由侍寝日志按月窗口实时派生（不存储）。窗口按月边界，结尾对齐当前月。
 */
import { monthOrdinal } from "../calendar/time";
import type { GameTime } from "../calendar/time";
import type { BedchamberRecord } from "../state/types";

export type FavorTier = "abundant" | "favored" | "small" | "fallen" | "none";

export const FAVOR_TIER_LABEL: Record<FavorTier, string> = {
  abundant: "盛宠",
  favored: "宠爱",
  small: "小宠",
  fallen: "失宠",
  none: "无宠",
};

export interface BedchamberThresholds {
  small: number;
  favored: number;
  abundant: number;
}

export const DEFAULT_TIERS: BedchamberThresholds = { small: 3, favored: 5, abundant: 10 };

export interface FavorStats {
  lastMonth: number;
  lastThreeMonths: number;
  lastYear: number;
  tier: FavorTier;
}

/** count encounters whose month is within `span` months ending at `cur`. */
function countWindow(record: BedchamberRecord, cur: number, span: number): number {
  let n = 0;
  for (const e of record.encounters) {
    const diff = cur - monthOrdinal(e.at);
    if (diff >= 0 && diff <= span - 1) n += 1;
  }
  return n;
}

/** Highest 3-month-window count over every month from first encounter to now. */
function peakThreeMonth(record: BedchamberRecord, cur: number): number {
  if (record.encounters.length === 0) return 0;
  const first = record.encounters.reduce((min, e) => Math.min(min, monthOrdinal(e.at)), Infinity);
  let peak = 0;
  for (let m = first; m <= cur; m++) {
    peak = Math.max(peak, countWindow(record, m, 3));
  }
  return peak;
}

export function computeFavorStats(
  record: BedchamberRecord | undefined,
  now: GameTime,
  th: BedchamberThresholds,
): FavorStats {
  if (!record || record.encounters.length === 0) {
    return { lastMonth: 0, lastThreeMonths: 0, lastYear: 0, tier: "none" };
  }
  const cur = monthOrdinal(now);
  const lastMonth = countWindow(record, cur, 1);
  const lastThreeMonths = countWindow(record, cur, 3);
  const lastYear = countWindow(record, cur, 12);

  let tier: FavorTier;
  if (lastThreeMonths >= th.abundant) tier = "abundant";
  else if (lastThreeMonths >= th.favored) tier = "favored";
  else if (lastThreeMonths >= th.small) tier = "small";
  else tier = peakThreeMonth(record, cur) >= th.favored ? "fallen" : "none";

  return { lastMonth, lastThreeMonths, lastYear, tier };
}

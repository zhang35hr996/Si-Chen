/**
 * Calendar (skeleton-plan §4 Time):
 *   1 year = 12 months; 1 month = 3 action-days (上旬/中旬/下旬);
 *   1 action-day = apMax action points (default 5).
 *
 * GameTime is the pure timestamp stored on records (memories, eventLog);
 * CalendarState is the live clock and additionally carries AP bookkeeping.
 * A timestamp must never carry "how many AP the player had left".
 */

export type MonthPeriod = "early" | "mid" | "late";

export interface GameTime {
  /** 1 = 元年 */
  readonly year: number;
  /** 1–12 */
  readonly month: number;
  /** 上旬 / 中旬 / 下旬 */
  readonly period: MonthPeriod;
  /** Derived action-day index — stored for cooldown math & sorting. */
  readonly dayIndex: number;
}

export interface CalendarState extends GameTime {
  /** Remaining action points this action-day: apMax → 0. */
  readonly ap: number;
  readonly apMax: number;
}

export const DEFAULT_AP_MAX = 6;

// ── 时辰 / 时段 (skeleton-plan §4 Time, art pass) ─────────────────────
// A day has apMax = 6 action slots; the slot you are about to act in maps to
// a 时辰 and a time-of-day bucket that drives which background variant shows.
// Slot index = apMax − ap (fresh day = slot 0). The clock never rests at ap=0:
// spending the last AP rolls the day (reducer), so slot ∈ [0, apMax−1].
export type TimeOfDay = "day" | "twilight" | "night";

interface Shichen {
  /** 干支时辰名, e.g. 卯时. */
  readonly name: string;
  /** 通俗时段, e.g. 早上. */
  readonly label: string;
  readonly timeOfDay: TimeOfDay;
}

const SHICHEN: readonly Shichen[] = [
  { name: "卯时", label: "早上", timeOfDay: "day" },
  { name: "辰时", label: "上午", timeOfDay: "day" },
  { name: "申时", label: "下午", timeOfDay: "day" },
  { name: "酉时", label: "黄昏", timeOfDay: "twilight" },
  { name: "戌时", label: "晚上", timeOfDay: "night" },
  { name: "子时", label: "深夜", timeOfDay: "night" },
];

/** 0-based action slot of the AP about to be spent; clamped into the 时辰 table. */
export function shichenSlot(calendar: CalendarState): number {
  const slot = calendar.apMax - calendar.ap;
  if (slot < 0) return 0;
  if (slot > SHICHEN.length - 1) return SHICHEN.length - 1;
  return slot;
}

/** Time-of-day bucket for background selection (day/twilight/night). */
export function timeOfDay(calendar: CalendarState): TimeOfDay {
  return SHICHEN[shichenSlot(calendar)]!.timeOfDay;
}

/** e.g. 卯时（早上） — what the HUD shows instead of a raw AP count. */
export function formatShichen(calendar: CalendarState): string {
  const sc = SHICHEN[shichenSlot(calendar)]!;
  return `${sc.name}（${sc.label}）`;
}

const PERIOD_ORDINAL: Record<MonthPeriod, number> = { early: 0, mid: 1, late: 2 };
const PERIOD_NAME: Record<MonthPeriod, string> = { early: "上旬", mid: "中旬", late: "下旬" };

export function dayIndexOf(year: number, month: number, period: MonthPeriod): number {
  return ((year - 1) * 12 + (month - 1)) * 3 + PERIOD_ORDINAL[period];
}

/** Month index from 元年一月 = 1 (period-agnostic) — drives 受宠 windows. */
export function monthOrdinal(time: Pick<GameTime, "year" | "month">): number {
  return (time.year - 1) * 12 + time.month;
}

export function makeGameTime(year: number, month: number, period: MonthPeriod): GameTime {
  return { year, month, period, dayIndex: dayIndexOf(year, month, period) };
}

/** Strip AP bookkeeping — what gets written onto records. */
export function toGameTime(calendar: CalendarState): GameTime {
  return {
    year: calendar.year,
    month: calendar.month,
    period: calendar.period,
    dayIndex: calendar.dayIndex,
  };
}

export interface CalendarStart {
  year?: number;
  month?: number;
  period?: MonthPeriod;
  apMax?: number;
}

export function createCalendar(start: CalendarStart = {}): CalendarState {
  const year = start.year ?? 1;
  const month = start.month ?? 1;
  const period = start.period ?? "early";
  const apMax = start.apMax ?? DEFAULT_AP_MAX;
  return { ...makeGameTime(year, month, period), ap: apMax, apMax };
}

/** 上旬→中旬→下旬→次月上旬; 十二月下旬→次年一月上旬. AP refills to apMax. */
export function advanceActionDay(calendar: CalendarState): CalendarState {
  let { year, month } = calendar;
  let period: MonthPeriod;
  if (calendar.period === "early") {
    period = "mid";
  } else if (calendar.period === "mid") {
    period = "late";
  } else {
    period = "early";
    if (month === 12) {
      month = 1;
      year += 1;
    } else {
      month += 1;
    }
  }
  return { ...makeGameTime(year, month, period), ap: calendar.apMax, apMax: calendar.apMax };
}

/** Structural invariant check — skeleton-plan §10 #10 (impossible calendar state). */
export function calendarInvariantViolation(calendar: CalendarState): string | null {
  if (!Number.isInteger(calendar.year) || calendar.year < 1) return `year ${calendar.year}`;
  if (!Number.isInteger(calendar.month) || calendar.month < 1 || calendar.month > 12)
    return `month ${calendar.month}`;
  if (!(calendar.period in PERIOD_ORDINAL)) return `period ${String(calendar.period)}`;
  if (!Number.isInteger(calendar.apMax) || calendar.apMax < 1) return `apMax ${calendar.apMax}`;
  if (!Number.isInteger(calendar.ap) || calendar.ap < 0 || calendar.ap > calendar.apMax)
    return `ap ${calendar.ap}/${calendar.apMax}`;
  if (calendar.dayIndex !== dayIndexOf(calendar.year, calendar.month, calendar.period))
    return `dayIndex ${calendar.dayIndex}`;
  return null;
}

// ── Chinese formatting ────────────────────────────────────────────────

const DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1–99 → 中文数字 (一, 十, 十一, 二十, 二十一 …). */
export function chineseNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    throw new RangeError(`chineseNumeral supports 1–99, got ${n}`);
  }
  if (n < 10) return DIGITS[n]!;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const tensPart = tens === 1 ? "十" : `${DIGITS[tens]}十`;
  return ones === 0 ? tensPart : `${tensPart}${DIGITS[ones]}`;
}

export function formatYear(year: number): string {
  return year === 1 ? "元年" : `${chineseNumeral(year)}年`;
}

/** e.g. 元年一月上旬, 二年十二月下旬. */
export function formatGameTime(time: GameTime): string {
  return `${formatYear(time.year)}${chineseNumeral(time.month)}月${PERIOD_NAME[time.period]}`;
}

/** e.g. 行动点：5/5. */
export function formatAp(calendar: CalendarState): string {
  return `行动点：${calendar.ap}/${calendar.apMax}`;
}

/**
 * 子嗣命名 / 年龄 / 列表派生（纯逻辑）。两表（皇子=女 / 皇郎=男）各按出生序独立编号，
 * 1→大、≥2→中文数字。id 单调（heir_NNNNNN）。
 */
import { chineseNumeral, monthOrdinal, type GameTime } from "../calendar/time";
import type { Heir, HeirSex } from "../state/types";

const SEX_NOUN: Record<HeirSex, string> = { daughter: "皇子", son: "皇郎" };

/** ordinal 1-based → 大皇子 / 二皇郎 …。 */
export function heirName(sex: HeirSex, ordinal: number): string {
  const prefix = ordinal === 1 ? "大" : chineseNumeral(ordinal);
  return `${prefix}${SEX_NOUN[sex]}`;
}

export interface NamedHeir {
  heir: Heir;
  name: string;
  ordinal: number;
}

/** 某性别的子嗣，按出生序（dayIndex）升序编号。 */
export function listHeirsBySex(heirs: readonly Heir[], sex: HeirSex): NamedHeir[] {
  return heirs
    .filter((h) => h.sex === sex)
    .sort((a, b) => a.birthAt.dayIndex - b.birthAt.dayIndex)
    .map((heir, i) => ({ heir, name: heirName(sex, i + 1), ordinal: i + 1 }));
}

/** 周岁：出生当年记 0 岁，按年份差。 */
export function heirAge(heir: Heir, now: Pick<GameTime, "year">): number {
  return now.year - heir.birthAt.year;
}

/** 下一个子嗣 id（heirs 仅追加，故按当前数量递增）。 */
export function nextHeirId(currentCount: number): string {
  return `heir_${String(currentCount + 1).padStart(6, "0")}`;
}

export type HeirStage = "infant" | "toddler" | "schooling";

/** 外观阶段（五档，与教育/居住阶段独立）。 */
export type HeirAppearanceStage = "baby" | "kid" | "child" | "teen" | "adult";

/** 月龄：按 monthOrdinal 差（出生当月为 0）。 */
export function heirAgeMonths(heir: Heir, now: Pick<GameTime, "year" | "month">): number {
  return monthOrdinal(now) - monthOrdinal(heir.birthAt);
}

/** 成长阶段：[0,3岁)=infant；[3,5岁)=toddler；≥5岁=schooling（对话/UI 用途）。 */
export function heirStage(heir: Heir, now: Pick<GameTime, "year">): HeirStage {
  const years = heirAge(heir, now);
  if (years >= 5) return "schooling";
  if (years >= 3) return "toddler";
  return "infant";
}

/** 外观阶段：baby=0岁；kid=1–7岁；child=8–11岁；teen=12–17岁；adult=18岁+。 */
export function heirAppearanceStage(heir: Heir, now: Pick<GameTime, "year">): HeirAppearanceStage {
  const age = heirAge(heir, now);
  if (age >= 18) return "adult";
  if (age >= 12) return "teen";
  if (age >= 8) return "child";
  if (age >= 1) return "kid";
  return "baby";
}

/** 开蒙年龄（按性别）：皇子（女）5 岁，皇郎（男）7 岁。 */
export function enlightenmentAge(sex: HeirSex): number {
  return sex === "daughter" ? 5 : 7;
}

/** 百日宴待办：满 3 月龄且尚未赐正名。 */
export function centennialDue(heir: Heir, now: Pick<GameTime, "year" | "month">): boolean {
  return heir.givenName === undefined && heirAgeMonths(heir, now) >= 3;
}

/** 是否已开蒙（皇子≥5岁，皇郎≥7岁，可入文昭殿）。 */
export function isEnrolled(heir: Heir, now: Pick<GameTime, "year">): boolean {
  return heirAge(heir, now) >= enlightenmentAge(heir.sex);
}

/** 迁居毓庆宫的年龄门槛：皇子（女）满 5 岁、皇郎（男）满 7 岁。 */
const YUQING_MOVE_AGE: Record<HeirSex, number> = { daughter: 5, son: 7 };

/** 是否已迁居毓庆宫（按性别年龄门槛）。未达龄者仍由乳母照护，不在此列。 */
export function residesInYuqing(heir: Heir, now: Pick<GameTime, "year">): boolean {
  return heirAge(heir, now) >= YUQING_MOVE_AGE[heir.sex];
}

/** 当前外观阶段的立绘集 id（来自出生时固定的 portraitVariants）。 */
export function heirPortraitSet(heir: Heir, now: Pick<GameTime, "year">): string {
  const stage = heirAppearanceStage(heir, now);
  const key = stage === "adult" ? "teen" : stage;
  return heir.portraitVariants[key];
}

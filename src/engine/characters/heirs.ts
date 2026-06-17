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

/** 月龄：按 monthOrdinal 差（出生当月为 0）。 */
export function heirAgeMonths(heir: Heir, now: Pick<GameTime, "year" | "month">): number {
  return monthOrdinal(now) - monthOrdinal(heir.birthAt);
}

/** 成长阶段：[0,3岁)=infant；[3,5岁)=toddler；≥5岁=schooling。 */
export function heirStage(heir: Heir, now: Pick<GameTime, "year">): HeirStage {
  const years = heirAge(heir, now);
  if (years >= 5) return "schooling";
  if (years >= 3) return "toddler";
  return "infant";
}

/** 百日宴待办：满 3 月龄且尚未赐正名。 */
export function centennialDue(heir: Heir, now: Pick<GameTime, "year" | "month">): boolean {
  return heir.givenName === undefined && heirAgeMonths(heir, now) >= 3;
}

/** 是否已开蒙（≥5 周岁，可入上书房）。 */
export function isEnrolled(heir: Heir, now: Pick<GameTime, "year">): boolean {
  return heirStage(heir, now) === "schooling";
}

/** 阶段→立绘 portraitSet（婴幼共用襁褓立绘，开蒙后换学童立绘）。 */
export function heirPortraitSet(heir: Heir, now: Pick<GameTime, "year">): "child_baby" | "child_school" {
  return heirStage(heir, now) === "schooling" ? "child_school" : "child_baby";
}

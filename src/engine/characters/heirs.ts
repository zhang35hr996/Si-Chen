/**
 * 子嗣命名 / 年龄 / 列表派生（纯逻辑）。两表（皇子=女 / 皇郎=男）各按出生序独立编号，
 * 1→大、≥2→中文数字。id 单调（heir_NNNNNN）。
 */
import { chineseNumeral, type GameTime } from "../calendar/time";
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

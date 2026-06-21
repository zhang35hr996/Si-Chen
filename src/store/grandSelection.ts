/**
 * 大选（三年一次殿选）：日历门控触发、候选秀男生成、推荐位分、落库、NPC 自留。
 * 纯逻辑集中于此；殿选界面与 App 接线只调用本模块。确定性随机走 gestationRoll。
 */
import type { ContentDB } from "../engine/content/loader";
import type { CharacterRank } from "../engine/content/schemas";

/** 大选年：元年、四年、七年…（每三年）。 */
export function isDaxuanYear(year: number): boolean {
  return (year - 1) % 3 === 0;
}

export function daxuanAnnounceFlagKey(year: number): string {
  return `daxuan:announce:${year}`;
}

export function daxuanDianxuanFlagKey(year: number): string {
  return `daxuan:dianxuan:${year}`;
}

/** 皇后推荐位分：父官品(gradeOrder 18=正一品…) 或平民 → rank id。 */
export function recommendRank(grade: number | "commoner"): string {
  if (grade === "commoner") return "gengyi";
  if (grade >= 17) return "guiren";   // 一品/皇亲
  if (grade >= 13) return "meiren";   // 二三品
  if (grade >= 9) return "changzai";  // 四五品
  if (grade >= 5) return "daying";    // 六七品
  return "gengyi";                    // 八品以下
}

/** 初始恩宠随位分缩放：更衣(50)→10，皇贵君(180)→20，线性，夹在 10–20。 */
export function initialFavorForRank(order: number): number {
  const raw = 10 + Math.round((10 * (order - 50)) / 130);
  return Math.max(10, Math.min(20, raw));
}

/** 玩家可选位分：order 50（更衣）–180（皇贵君），排除凤后；降序。 */
export function pickableRanks(db: ContentDB): CharacterRank[] {
  return Object.values(db.ranks)
    .filter((r) => r.domain === "harem" && r.id !== "fenghou" && r.order >= 50 && r.order <= 180)
    .sort((a, b) => b.order - a.order);
}

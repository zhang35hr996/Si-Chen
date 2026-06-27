import type { ContentDB } from "../content/loader";
import { isAssignableRank } from "../content/schemas";

/** 可授后宫位分按 order 升序排列（order 值越大位分越高）。 */
export function sortedHaremRanks(db: ContentDB) {
  return Object.values(db.ranks)
    .filter((r) => r.domain === "harem" && isAssignableRank(r))
    .sort((a, b) => a.order - b.order);
}

/**
 * 两个后宫位分之间的梯级距离（阶差）。
 *
 * 返回正整数：higherRankId 比 lowerRankId 高几级。
 * 若两者相同或不在后宫位分梯级中，返回 0 / null。
 *
 * @param higherRankId 位分较高者（order 较大）
 * @param lowerRankId  位分较低者（order 较小）
 */
export function haremRankStepDistance(
  db: ContentDB,
  higherRankId: string,
  lowerRankId: string,
): number | null {
  const ladder = sortedHaremRanks(db);
  const hiIdx = ladder.findIndex((r) => r.id === higherRankId);
  const loIdx = ladder.findIndex((r) => r.id === lowerRankId);
  if (hiIdx < 0 || loIdx < 0) return null;
  return hiIdx - loIdx;
}

/** 晋一级（上一个可授位分 id）。不存在时返回 null。 */
export function nextAdministrativeRank(db: ContentDB, currentRankId: string): string | null {
  const ladder = sortedHaremRanks(db);
  const idx = ladder.findIndex((r) => r.id === currentRankId);
  if (idx < 0 || idx + 1 >= ladder.length) return null;
  return ladder[idx + 1]!.id;
}

/** 降一级（下一个可授位分 id）。不存在时返回 null。 */
export function previousAdministrativeRank(db: ContentDB, currentRankId: string): string | null {
  const ladder = sortedHaremRanks(db);
  const idx = ladder.findIndex((r) => r.id === currentRankId);
  if (idx <= 0) return null;
  return ladder[idx - 1]!.id;
}

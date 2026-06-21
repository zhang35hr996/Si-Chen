/** 京城商铺：按品阶定价 + 货架确定性轮替。 */
import { gestationRoll, gestationRollRaw } from "../engine/characters/gestation";
import type { ContentDB } from "../engine/content/loader";
import type { ItemDef } from "../engine/content/schemas";

const TIER_RANGE: Record<ItemDef["tier"], [number, number]> = {
  common: [10, 50], fine: [50, 150], treasure: [150, 350], marvel: [350, 500],
};

export type ShopId = "wanbaolou" | "zuixianlou";
const FOOD = ["点心", "茶饮", "珍味"];

/** 区间内确定性随机定价。 */
export function priceOf(item: ItemDef, seedKey: string): number {
  const [lo, hi] = TIER_RANGE[item.tier];
  return lo + (gestationRollRaw(`price:${item.id}:${seedKey}`) % (hi - lo + 1));
}

function shopPool(db: ContentDB, shopId: ShopId): string[] {
  return Object.values(db.items)
    .filter((i) => (shopId === "zuixianlou" ? FOOD.includes(i.category) : !FOOD.includes(i.category)))
    .map((i) => i.id)
    .sort(); // 稳定基序
}

/** 6–10 件确定性抽样（dayIndex+shopId+seed）。 */
export function shopShelf(db: ContentDB, shopId: ShopId, dayIndex: number, seed: number): string[] {
  const pool = shopPool(db, shopId);
  if (pool.length === 0) return [];
  const base = `shelf:${shopId}:${dayIndex}:${seed}`;
  const size = Math.min(pool.length, 6 + (gestationRoll(`${base}:n`) % 5)); // 6–10
  // 确定性洗牌取前 size
  const idx = pool.map((id, i) => ({ id, r: gestationRoll(`${base}:${i}`) })).sort((a, b) => a.r - b.r);
  return idx.slice(0, size).map((x) => x.id);
}

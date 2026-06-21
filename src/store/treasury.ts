/**
 * 国库/私库纯函数：铜钱（nation.treasury）与物品库存（storehouse.items）的
 * 不可变增减，及赏赐结算（bestow，见下方任务补充）。
 */
import type { GameState } from "../engine/state/types";

export function grantCoins(state: GameState, amount: number): GameState {
  const treasury = Math.max(0, state.resources.nation.treasury + amount);
  return {
    ...state,
    resources: { ...state.resources, nation: { ...state.resources.nation, treasury } },
  };
}

export type SpendResult = { ok: true; state: GameState } | { ok: false };

export function spendCoins(state: GameState, amount: number): SpendResult {
  if (amount < 0 || state.resources.nation.treasury < amount) return { ok: false };
  return { ok: true, state: grantCoins(state, -amount) };
}

export function grantItem(state: GameState, itemId: string, count = 1): GameState {
  const items = { ...state.resources.storehouse.items };
  items[itemId] = (items[itemId] ?? 0) + count;
  return {
    ...state,
    resources: { ...state.resources, storehouse: { ...state.resources.storehouse, items } },
  };
}

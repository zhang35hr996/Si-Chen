/**
 * 国库/私库纯函数：铜钱（nation.treasury）与物品库存（storehouse.items）的
 * 不可变增减，及赏赐结算。
 *
 * bestow()：扣 1 件库存，按物品 tier 基础值更新受赏目标属性：
 *   侍君 → favor +base，affection +round(base/2)（投其所好 tag 命中则翻倍）；
 *   皇嗣 → favor +base，closeness +round(base/2)。
 * TIER_BASE：{ common:2, fine:4, treasure:7, marvel:12 }
 */
import type { GameState } from "../engine/state/types";
import type { ContentDB } from "../engine/content/loader";

export function grantItem(state: GameState, itemId: string, count = 1): GameState {
  const items = { ...state.resources.storehouse.items };
  items[itemId] = (items[itemId] ?? 0) + count;
  return {
    ...state,
    resources: { ...state.resources, storehouse: { ...state.resources.storehouse, items } },
  };
}

export const TIER_BASE = { common: 2, fine: 4, treasure: 7, marvel: 12 } as const;
const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

export type RecipientKind = "consort" | "heir";
export type BestowResult = { ok: true; state: GameState } | { ok: false; reason: string };

export function bestow(
  state: GameState,
  db: ContentDB,
  itemId: string,
  recipient: { kind: RecipientKind; id: string },
): BestowResult {
  const item = db.items[itemId];
  if (!item) return { ok: false, reason: "未知物品" };
  const have = state.resources.storehouse.items[itemId] ?? 0;
  if (have < 1) return { ok: false, reason: "库存不足" };
  const base = TIER_BASE[item.tier];

  // 扣 1 件（不可变）
  const items = { ...state.resources.storehouse.items };
  if (have - 1 <= 0) delete items[itemId];
  else items[itemId] = have - 1;
  let next: GameState = {
    ...state,
    resources: { ...state.resources, storehouse: { ...state.resources.storehouse, items } },
  };

  if (recipient.kind === "consort") {
    const st = next.standing[recipient.id];
    if (!st) return { ok: false, reason: "侍君不存在" };
    const character = db.characters[recipient.id];
    const likes = character?.attributes?.likes ?? [];
    const hit = item.tags.some((t) => likes.includes(t));
    let affDelta = Math.round(base / 2);
    if (hit) affDelta += Math.round(base / 2);
    const baseAff = st.affection ?? character?.hidden?.affection ?? 0;
    next = {
      ...next,
      standing: {
        ...next.standing,
        [recipient.id]: {
          ...st,
          favor: clampPct(st.favor + base),
          peakFavor: Math.max(st.peakFavor, clampPct(st.favor + base)),
          affection: clampPct(baseAff + affDelta),
        },
      },
    };
  } else {
    const heirs = next.resources.bloodline.heirs;
    const idx = heirs.findIndex((h) => h.id === recipient.id);
    if (idx < 0) return { ok: false, reason: "皇嗣不存在" };
    const h = heirs[idx]!;
    const updated = {
      ...h,
      favor: clampPct(h.favor + base),
      closeness: clampPct(h.closeness + Math.round(base / 2)),
    };
    const nextHeirs = heirs.slice();
    nextHeirs[idx] = updated;
    next = {
      ...next,
      resources: { ...next.resources, bloodline: { ...next.resources.bloodline, heirs: nextHeirs } },
    };
  }
  return { ok: true, state: next };
}

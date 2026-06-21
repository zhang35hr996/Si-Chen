/**
 * StorehouseScreen 库房菜单。
 *
 * 顶部显示国库铜钱（nation.treasury）；物品列表遍历 storehouse.items；
 * 「赏赐」按钮打开 BestowModal（3-tab 选人弹窗）。
 */
import { useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { formatCoins } from "../format";
import { BestowModal } from "../components/BestowModal";

// ── StorehouseScreen ─────────────────────────────────────────────────────

export function StorehouseScreen({
  db,
  store,
  onClose,
}: {
  db: ContentDB;
  store: GameStore;
  onClose: () => void;
}) {
  const state = useGameState(store);
  const [rewardItem, setRewardItem] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const storehouseItems = Object.entries(state.resources.storehouse.items).filter(
    ([, n]) => n > 0,
  );

  return (
    <div className="storehouse">
      <header className="storehouse__header">
        <h1 className="storehouse__title">库房</h1>
        <button type="button" className="storehouse__close" onClick={onClose}>
          返回
        </button>
      </header>

      <div className="storehouse__coins">
        铜钱：<span className="storehouse__coins-value">{formatCoins(state.resources.nation.treasury)}</span> 两
      </div>

      {feedback && (
        <p className="storehouse__feedback" role="status">
          {feedback}
        </p>
      )}

      {storehouseItems.length === 0 ? (
        <p className="storehouse__empty">库房空空如也</p>
      ) : (
        <ul className="storehouse__list">
          {storehouseItems.map(([id, n]) => {
            const itemDef = db.items[id];
            return (
              <li key={id} className="storehouse__item">
                <span className="storehouse__item-name">
                  {itemDef?.name ?? id}
                </span>
                <span className="storehouse__item-count">×{n}</span>
                <button
                  type="button"
                  className="storehouse__bestow-btn"
                  onClick={() => {
                    setFeedback(null);
                    setRewardItem(id);
                  }}
                >
                  赏赐
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {rewardItem && (
        <BestowModal
          db={db}
          store={store}
          itemId={rewardItem}
          onClose={() => setRewardItem(null)}
          onConfirmed={() => setFeedback("已赏赐")}
        />
      )}
    </div>
  );
}

/**
 * StorehouseScreen 库房菜单 + 3-tab 赏赐弹窗。
 *
 * 顶部显示国库铜钱（nation.treasury）；物品列表遍历 storehouse.items；
 * 「赏赐」按钮打开弹窗，3 个 tab（侍君/皇嗣/宗亲），宗亲 tab 暂无数据。
 * 确认赏赐 → store.applyBestow()。
 */
import { useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import type { RecipientKind } from "../../store/treasury";
import { resolveDisplayName } from "../../engine/characters/standing";

// ── Pure helpers ─────────────────────────────────────────────────────────

export function formatCoins(n: number): string {
  return n.toLocaleString("en-US");
}

export interface BestowTarget {
  id: string;
  name: string;
  kind: RecipientKind;
}

export function bestowTargets(
  db: ContentDB,
  state: GameState,
): { consorts: BestowTarget[]; heirs: BestowTarget[]; clan: BestowTarget[] } {
  const consorts: BestowTarget[] = [];
  for (const c of Object.values(db.characters)) {
    if (c.kind !== "consort") continue;
    const st = state.standing[c.id];
    if (st?.lifecycle === "deceased") continue;
    consorts.push({
      id: c.id,
      kind: "consort",
      name: resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined),
    });
  }
  const heirs: BestowTarget[] = state.resources.bloodline.heirs.map((h) => ({
    id: h.id,
    kind: "heir" as const,
    name: h.givenName || h.petName || h.id,
  }));
  return { consorts, heirs, clan: [] };
}

// ── Tab types ────────────────────────────────────────────────────────────

type TabId = "consorts" | "heirs" | "clan";

const TAB_LABELS: Record<TabId, string> = {
  consorts: "侍君",
  heirs: "皇嗣",
  clan: "宗亲",
};

// ── BestowModal ──────────────────────────────────────────────────────────

function BestowModal({
  db,
  state,
  itemId,
  onConfirm,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  itemId: string;
  onConfirm: (target: BestowTarget) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<TabId>("consorts");
  const [selected, setSelected] = useState<BestowTarget | null>(null);
  const targets = bestowTargets(db, state);
  const item = db.items[itemId];

  const tabList: TabId[] = ["consorts", "heirs", "clan"];

  function listForTab(tab: TabId): BestowTarget[] {
    if (tab === "consorts") return targets.consorts;
    if (tab === "heirs") return targets.heirs;
    return targets.clan;
  }

  function handleConfirm() {
    if (selected) {
      onConfirm(selected);
    }
  }

  return (
    <div className="bestow-modal__overlay" role="dialog" aria-modal="true">
      <div className="bestow-modal">
        <header className="bestow-modal__header">
          <h2 className="bestow-modal__title">赏赐 · {item?.name ?? itemId}</h2>
          <button type="button" className="bestow-modal__close" onClick={onClose}>
            ✕
          </button>
        </header>

        <nav className="bestow-modal__tabs">
          {tabList.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`bestow-modal__tab${activeTab === tab ? " bestow-modal__tab--active" : ""}`}
              onClick={() => {
                setActiveTab(tab);
                setSelected(null);
              }}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </nav>

        <div className="bestow-modal__body">
          {activeTab === "clan" ? (
            <p className="bestow-modal__empty">暂无宗亲</p>
          ) : listForTab(activeTab).length === 0 ? (
            <p className="bestow-modal__empty">此类无可选之人</p>
          ) : (
            <ul className="bestow-modal__list">
              {listForTab(activeTab).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`bestow-modal__person${selected?.id === t.id ? " bestow-modal__person--selected" : ""}`}
                    onClick={() => setSelected(selected?.id === t.id ? null : t)}
                  >
                    {t.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="bestow-modal__footer">
          <button
            type="button"
            className="bestow-modal__confirm"
            disabled={selected === null}
            onClick={handleConfirm}
          >
            确认赏赐
          </button>
          <button type="button" className="bestow-modal__cancel" onClick={onClose}>
            取消
          </button>
        </footer>
      </div>
    </div>
  );
}

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

  function handleBestow(target: BestowTarget) {
    if (!rewardItem) return;
    const result = store.applyBestow(db, rewardItem, { kind: target.kind, id: target.id });
    if (result.ok) {
      setFeedback(`已将此物赏赐给 ${target.name}`);
    } else {
      setFeedback(`赏赐失败：${"reason" in result ? result.reason : "未知错误"}`);
    }
    setRewardItem(null);
  }

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
          state={state}
          itemId={rewardItem}
          onConfirm={handleBestow}
          onClose={() => setRewardItem(null)}
        />
      )}
    </div>
  );
}

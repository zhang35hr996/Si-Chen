/**
 * BestowModal 赏赐弹窗（库房与进贡共用）。
 *
 * 3-tab 选人（侍君/皇嗣/宗亲），宗亲 tab 暂无数据（占位）。
 * 确认赏赐 → store.applyBestow(db, itemId, recipient)，成功后调用 onConfirmed?.() 再 onClose()。
 */
import { useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import type { RecipientKind } from "../../store/treasury";
import { resolveDisplayName } from "../../engine/characters/standing";

// ── Pure helpers ─────────────────────────────────────────────────────────

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

export function BestowModal({
  db,
  store,
  itemId,
  onClose,
  onConfirmed,
}: {
  db: ContentDB;
  store: GameStore;
  itemId: string;
  onClose: () => void;
  onConfirmed?: () => void;
}) {
  const state = useGameState(store);
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
    if (!selected) return;
    const result = store.applyBestow(db, itemId, { kind: selected.kind, id: selected.id });
    if (result.ok) {
      onConfirmed?.();
    }
    onClose();
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

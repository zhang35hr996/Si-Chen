/**
 * 紫宸殿·前朝奏折批阅（Phase 4A）。只读展示奏折卡 + 调 store.resolveMemorial；后果全在引擎/funnel。
 * 绝不在 UI 直接改 runtime state。成功批阅后由父层 onCommitted 持久化。
 */
import { useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { getPendingMemorials } from "../../engine/court/memorials";
import { memorialCard } from "./memorialsView";

export interface MemorialsScreenProps {
  db: ContentDB;
  store: GameStore;
  onBack: () => void;
  onCommitted: () => void;
}

export function MemorialsScreen({ db, store, onBack, onCommitted }: MemorialsScreenProps) {
  const state = useGameState(store);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = getPendingMemorials(state);

  const resolve = (memorialId: string, optionId: string, label: string) => {
    const r = store.resolveMemorial(db, memorialId, optionId);
    if (!r.ok) {
      setNotice(`${label}未成：${r.error.message}`);
      return;
    }
    onCommitted();
    setNotice(`已批：${label}。`);
  };

  return (
    <div className="memorials-screen">
      <header className="memorials-screen__header">
        <button type="button" className="memorials-screen__back" onClick={onBack}>← 返回紫宸殿</button>
        <h2 className="memorials-screen__title">前朝奏折</h2>
      </header>

      {pending.length === 0 ? (
        <p className="memorials-screen__empty">暂无待批前朝奏折。</p>
      ) : (
        <ul className="memorials-screen__list">
          {pending.map((m) => {
            const card = memorialCard(m);
            return (
              <li key={card.id} className="memorial-card">
                <p className="memorial-card__kind">
                  {card.categoryLabel}{card.regionName ? ` · ${card.regionName}` : ""}{card.severityLabel ? ` · ${card.severityLabel}` : ""}
                </p>
                <p className="memorial-card__title">{card.title}</p>
                <p className="memorial-card__summary">{card.summary}</p>
                <div className="memorial-card__options">
                  {card.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="memorial-option__btn"
                      onClick={() => resolve(card.id, o.id, o.label)}
                    >
                      <span className="memorial-option__label">{o.label}</span>
                      <span className="memorial-option__effects">{o.effectSummary}</span>
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {notice && <p className="memorials-screen__notice" role="status">{notice}</p>}
    </div>
  );
}

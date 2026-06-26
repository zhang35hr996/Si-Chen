/**
 * 紫宸殿·人事奏折与请托裁决（Phase 3 PR3C-3b）。只读展示决策卡 + 调 store.resolvePersonnelDecision；
 * 业务全在引擎/命令层。绝不在此恢复官员名册的自由任免，绝不直接改 runtime state。
 *
 * 行政升迁与皇帝亲发惩戒（降职/免官）在每个选项上明确标注；空缺/目标不足的惩戒/升迁按钮禁用并说明原因。
 * 成功裁决后由父层 onCommitted 持久化。
 */
import { useState } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import type { PersonnelDecisionResolution } from "../../engine/state/types";
import { getPendingPersonnelDecisions } from "../../engine/officials/personnelDecisions";
import { personnelDecisionCard, type DecisionOptionView } from "./personnelDecisionView";

export interface PersonnelDecisionsScreenProps {
  db: ContentDB;
  store: GameStore;
  onBack: () => void;
  /** 裁决成功提交后回调（App 用于 autosave）。 */
  onCommitted: () => void;
}

export function PersonnelDecisionsScreen({ db, store, onBack, onCommitted }: PersonnelDecisionsScreenProps) {
  const state = useGameState(store);
  const [notice, setNotice] = useState<string | null>(null);
  const pending = getPendingPersonnelDecisions(state);

  const resolve = (decisionId: string, resolution: PersonnelDecisionResolution, label: string) => {
    const r = store.resolvePersonnelDecision(db, decisionId, resolution);
    if (!r.ok) {
      setNotice(`${label}未成：${r.error.message}`);
      return;
    }
    onCommitted();
    setNotice(`${label}已办妥。`);
  };

  return (
    <div className="personnel-screen">
      <header className="personnel-screen__header">
        <button type="button" className="personnel-screen__back" onClick={onBack}>← 返回紫宸殿</button>
        <h2 className="personnel-screen__title">人事奏折</h2>
      </header>

      {pending.length === 0 ? (
        <p className="personnel-screen__empty">暂无待裁人事奏折与请托。</p>
      ) : (
        <ul className="personnel-screen__list">
          {pending.map((d) => {
            const card = personnelDecisionCard(db, state, d);
            return (
              <li key={card.id} className="personnel-card">
                <p className="personnel-card__kind">{card.kindLabel}</p>
                <p className="personnel-card__source">{card.source}</p>
                <dl className="personnel-card__facts">
                  <div><dt>相关官员</dt><dd>{card.officialName}</dd></div>
                  {card.consortName && <div><dt>相关侍君</dt><dd>{card.consortName}</dd></div>}
                  {card.familyName && <div><dt>家族</dt><dd>{card.familyName}</dd></div>}
                  <div><dt>当前官职</dt><dd>{card.currentPostLabel}</dd></div>
                  {card.recommendedPostLabel && <div><dt>建议官职</dt><dd>{card.recommendedPostLabel}</dd></div>}
                  {card.merit !== undefined && <div><dt>政绩</dt><dd>{card.merit}</dd></div>}
                  {card.aptitudeFit !== undefined && <div><dt>能力适配</dt><dd>{card.aptitudeFit}</dd></div>}
                </dl>
                <div className="personnel-card__options">
                  {card.options.map((opt) => (
                    <DecisionButton key={opt.resolution} option={opt} onResolve={() => resolve(card.id, opt.resolution, opt.label)} />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {notice && <p className="personnel-screen__notice" role="status">{notice}</p>}
    </div>
  );
}

function DecisionButton({ option, onResolve }: { option: DecisionOptionView; onResolve: () => void }) {
  return (
    <div className={`personnel-option personnel-option--${option.tone}`}>
      <button
        type="button"
        className="personnel-option__btn"
        disabled={option.disabled}
        title={option.disabledReason}
        onClick={onResolve}
      >
        {option.label}
      </button>
      {option.note && <span className="personnel-option__note">{option.note}</span>}
      {option.disabled && option.disabledReason && (
        <span className="personnel-option__reason" role="note">{option.disabledReason}</span>
      )}
    </div>
  );
}

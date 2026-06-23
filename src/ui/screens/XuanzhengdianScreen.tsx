/**
 * 宣政殿朝议屏（scene-ui-narrative-refactor §9 / PR4 Task 4.2）。两态：
 *  - 议程态（未上朝）：背景 + 真实可议议程预览（courtAgendaPreview 标题）+「升朝」+ 返回；无议程显空状态。
 *  - 结果态（朝议毕）：真实 diffCourtMetrics 摘要（资源 + 官员/侍君态度）；无变化不臆造。
 *
 * 纯展示 + 回调：组件不读/改 store、不抽事务、不算 diff（议程/摘要/门槛由 App 以引擎纯函数算好喂入）。
 * SceneShell 由本屏注入；GameShell（顶栏/孕月/国情）由 App 外层提供。升朝按一次性认领防双击重复扣点。
 */
import { useRef, useState } from "react";
import { SceneShell } from "../components/SceneShell";
import type { CourtAgendaItem } from "../../engine/court/agenda";
import type { CourtHoldGate, CourtSummaryRow, CourtSummaryView } from "../xuanzhengView";

export interface XuanzhengdianScreenProps {
  background: string;
  isFallbackBackground?: boolean;
  backgroundPosition?: string;
  agenda: CourtAgendaItem[];
  holdGate: CourtHoldGate;
  onHoldCourt: () => void;
  onLeave: () => void;
  /** 非空 = 结果态（朝议毕）；空/缺省 = 议程态。 */
  summary?: CourtSummaryView | null;
  onBackToHall: () => void;
  onBackToMap: () => void;
}

function deltaText(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/** 着色按极性而非 delta 正负：中性(polarity 0)不着色；正向指标 delta*polarity>0 为 gain，<0 为 loss。 */
function toneClass(r: CourtSummaryRow): string {
  if (r.polarity === 0 || r.delta === 0) return "";
  return r.delta * r.polarity > 0 ? " is-gain" : " is-loss";
}

export function XuanzhengdianScreen(props: XuanzhengdianScreenProps) {
  const heldRef = useRef(false);
  const [held, setHeld] = useState(false);

  if (props.summary) {
    const s = props.summary;
    return (
      <SceneShell
        background={props.background}
        isFallback={props.isFallbackBackground}
        backgroundPosition={props.backgroundPosition}
        ariaLabel="朝议结果"
        stage={
          <div className="court-result">
            <h1 className="court-result__title">朝议已毕</h1>
            {s.empty ? (
              <p className="court-result__empty">朝议平和，诸事无大起落。</p>
            ) : (
              <>
                {s.resources.length > 0 && (
                  <section className="court-result__group" aria-label="国政变化">
                    <h2 className="court-result__group-title">国政</h2>
                    <ul className="court-result__list">
                      {s.resources.map((r) => (
                        <li key={r.id} className={`court-result__row${toneClass(r)}`}>
                          <span className="court-result__label">{r.label}</span>
                          <span className="court-result__delta">{deltaText(r.delta)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                {s.attitudes.length > 0 && (
                  <section className="court-result__group" aria-label="人心向背">
                    <h2 className="court-result__group-title">人心</h2>
                    <ul className="court-result__list">
                      {s.attitudes.map((r) => (
                        <li key={r.id} className={`court-result__row${toneClass(r)}`}>
                          <span className="court-result__label">{r.label}</span>
                          <span className="court-result__delta">{deltaText(r.delta)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            )}
          </div>
        }
        actions={
          <>
            <button type="button" className="action-btn action-btn--key" onClick={props.onBackToHall}>
              返回宣政殿
            </button>
            <button type="button" className="action-btn" onClick={props.onBackToMap}>
              返回地图
            </button>
          </>
        }
      />
    );
  }

  const holdCourt = () => {
    if (heldRef.current || !props.holdGate.ok) return; // 一次性认领，防双击重复扣点
    heldRef.current = true;
    setHeld(true);
    props.onHoldCourt();
  };

  return (
    <SceneShell
      background={props.background}
      isFallback={props.isFallbackBackground}
      backgroundPosition={props.backgroundPosition}
      ariaLabel="宣政殿"
      stage={
        <div className="court-agenda">
          <h1 className="court-agenda__title">宣政殿</h1>
          {props.agenda.length === 0 ? (
            <p className="court-agenda__empty">尚无待议政务。</p>
          ) : (
            <>
              <p className="court-agenda__hint">今日可议政务：</p>
              <ul className="court-agenda__list">
                {props.agenda.map((a) => (
                  <li key={a.id} className="court-agenda__item">{a.title}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      }
      actions={
        <>
          <button
            type="button"
            className="action-btn action-btn--key"
            onClick={holdCourt}
            disabled={held || !props.holdGate.ok}
            title={!props.holdGate.ok ? props.holdGate.reason : undefined}
          >
            升朝
          </button>
          {!props.holdGate.ok && <span className="court-agenda__reason" role="note">{props.holdGate.reason}</span>}
          <button type="button" className="action-btn" onClick={props.onLeave}>
            返回
          </button>
        </>
      }
    />
  );
}

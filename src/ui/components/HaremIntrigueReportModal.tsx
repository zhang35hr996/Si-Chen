/**
 * Phase 5A-3b / 5B-1B: 宫斗情报报告弹窗。
 * 全局中断 "harem_intrigue_report" 的 UI。
 *
 * 设计约束：
 *  - 点击遮罩不确认（强制全局通报，必须显式操作）；
 *  - guard ref 防双击；
 *  - 只读取 HaremIntrigueReport 公开字段，不从 haremSchemes/haremIncidents 补全后台信息；
 *  - 立案失败时弹窗不关闭，显示错误；
 *  - "命人查办"只对可立案 reportKind（anomaly / rumor / exposure）显示。
 */
import { useRef, type ReactNode } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, HaremIntrigueReport } from "../../engine/state/types";
import { resolveDisplayName } from "../../engine/characters/standing";
import { presentHaremIntrigueReport } from "../haremIntrigueReportPresenter";

const INVESTIGATABLE_KINDS = new Set<string>(["anomaly", "rumor", "exposure"]);

function resolveCharName(db: ContentDB, state: GameState, charId: string): string {
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const standing = state.standing[charId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  return char ? resolveDisplayName(char, standing, rank) : charId;
}

export interface HaremIntrigueReportModalProps {
  db: ContentDB;
  state: GameState;
  report: HaremIntrigueReport;
  /** 玩家点"知道了"：仅 acknowledge，不立案。MUST be idempotent. */
  onAcknowledge: () => void;
  /** 玩家点"命人查办"：立案。失败时不关闭弹窗，父层通过 errorMessage 传回错误文字。 */
  onInvestigate?: () => void;
  /** 上次立案调用失败时由父层传入的错误文字；成功或未尝试时为 undefined。 */
  errorMessage?: string;
}

export function HaremIntrigueReportModal({
  db,
  state,
  report,
  onAcknowledge,
  onInvestigate,
  errorMessage,
}: HaremIntrigueReportModalProps) {
  const submitted = useRef(false);

  const resolveName = (id: string) => resolveCharName(db, state, id);
  const pres = presentHaremIntrigueReport(report, resolveName);

  const canInvestigate = onInvestigate !== undefined && INVESTIGATABLE_KINDS.has(report.reportKind);

  function guard(action: () => void): () => void {
    return () => {
      if (submitted.current) return;
      submitted.current = true;
      action();
    };
  }

  // 立案失败后要允许再次点击，重置 guard
  function guardResettable(action: () => void): () => void {
    return () => {
      if (submitted.current) return;
      submitted.current = true;
      action();
      // 父层若不关闭弹窗（即失败），需要重置 guard 让玩家可以重试。
      // 父层通过 errorMessage 控制弹窗关闭；此处在下一微任务重置，
      // 使双击防护仍然生效但立案错误后可重试。
      Promise.resolve().then(() => { submitted.current = false; });
    };
  }

  return (
    <Backdrop>
      <h2 className="intrigue-report-modal__title">{pres.title}</h2>
      <div className="intrigue-report-modal__body">
        {pres.body.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <div className="intrigue-report-modal__meta">
        {pres.targetLabels.length > 0 && (
          <p>
            <span className="intrigue-report-modal__label">受影响之人：</span>
            {pres.targetLabels.join("、")}
          </p>
        )}
        {pres.actorLabel && (
          <p>
            <span className="intrigue-report-modal__label">涉事之人：</span>
            {pres.actorLabel}
          </p>
        )}
        <p>
          <span className="intrigue-report-modal__label">结果：</span>
          {pres.outcomeLabel}
        </p>
        <p>
          <span className="intrigue-report-modal__label">可信程度：</span>
          {pres.confidenceLabel}
        </p>
        <p>
          <span className="intrigue-report-modal__label">通报时间：</span>
          {pres.timeLabel}
        </p>
      </div>
      {errorMessage && (
        <p className="intrigue-report-modal__error" role="alert">{errorMessage}</p>
      )}
      <div className="intrigue-report-modal__actions">
        <button
          type="button"
          className="punish-btn"
          onClick={guard(onAcknowledge)}
        >
          知道了
        </button>
        {canInvestigate && (
          <button
            type="button"
            className="punish-btn punish-btn--primary"
            onClick={guardResettable(onInvestigate!)}
          >
            命人查办
          </button>
        )}
      </div>
    </Backdrop>
  );
}

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="punish-modal intrigue-report-modal">
        {children}
      </div>
    </div>
  );
}

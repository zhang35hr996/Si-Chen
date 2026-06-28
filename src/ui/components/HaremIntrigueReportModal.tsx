/**
 * Phase 5A-3b: 宫斗情报报告弹窗。
 * 全局中断 "harem_intrigue_report" 的 UI；App 在 activeGlobalInterrupt === "harem_intrigue_report" 时渲染。
 * 展示玩家已知信息；anomaly 报告不显示施害方/真实 kind。
 *
 * 设计约束：
 *  - 点击遮罩不确认（强制全局通报，必须显式操作）；
 *  - guard ref 防双击；
 *  - 只读取 HaremIntrigueReport 公开字段，不从 haremSchemes/haremIncidents 补全后台信息。
 */
import { useRef, type ReactNode } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, HaremIntrigueReport } from "../../engine/state/types";
import { resolveDisplayName } from "../../engine/characters/standing";
import { presentHaremIntrigueReport } from "../haremIntrigueReportPresenter";

function resolveCharName(db: ContentDB, state: GameState, charId: string): string {
  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const standing = state.standing[charId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  return char ? resolveDisplayName(char, standing, rank) : charId;
}

export function HaremIntrigueReportModal({
  db,
  state,
  report,
  onAcknowledge,
}: {
  db: ContentDB;
  state: GameState;
  report: HaremIntrigueReport;
  /** Called when player confirms. MUST be idempotent. */
  onAcknowledge: () => void;
}) {
  const submitted = useRef(false);

  const resolveName = (id: string) => resolveCharName(db, state, id);
  const pres = presentHaremIntrigueReport(report, resolveName);

  function guard(action: () => void): () => void {
    return () => {
      if (submitted.current) return;
      submitted.current = true;
      action();
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
      <div className="intrigue-report-modal__actions">
        <button
          type="button"
          className="punish-btn"
          onClick={guard(onAcknowledge)}
        >
          知道了
        </button>
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

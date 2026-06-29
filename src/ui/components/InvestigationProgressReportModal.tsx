/**
 * Phase 5B-2B2a: 证据案件调查进展通报弹窗（全局中断 "harem_intrigue_report" 的证据分支）。
 *
 * 知识边界：只读取 InvestigationProgressPublicReport 公开字段（summaryCode / confidence /
 * reportKind）；绝不接收 truthId / sourceEvidenceNodeId / evidenceNode 内部信息。
 * 文案为本阶段占位（简体结构化），EvidenceClaim 细节文案留待 5B-2B2b。
 */
import { useRef, type ReactNode } from "react";
import type { InvestigationProgressPublicReport } from "../../engine/characters/haremInvestigation/types";

/** summaryCode → 占位文案。未知 code 给安全 fallback，绝不回显 raw code。 */
function summaryText(summaryCode: string): string {
  if (summaryCode === "investigation_no_new_evidence") return "查访一番，未获新证。";
  if (summaryCode.startsWith("evidence_")) return "查得一项新的证据。";
  return "调查有了进展。";
}

const CONFIDENCE_LABEL: Record<string, string> = {
  tenuous: "尚难定论",
  plausible: "略有眉目",
  strong: "颇为确凿",
  confirmed: "已然明朗",
};

export interface InvestigationProgressReportModalProps {
  report: InvestigationProgressPublicReport;
  /** 玩家点"知道了"：acknowledge。MUST be idempotent。 */
  onAcknowledge: () => void;
}

export function InvestigationProgressReportModal({
  report,
  onAcknowledge,
}: InvestigationProgressReportModalProps) {
  const submitted = useRef(false);
  const guard = () => {
    if (submitted.current) return;
    submitted.current = true;
    onAcknowledge();
  };

  const title = report.reportKind === "investigation_final" ? "调查已得结论" : "调查有了进展";

  return (
    <Backdrop>
      <h2 className="intrigue-report-modal__title">{title}</h2>
      <div className="intrigue-report-modal__body">
        <p>{summaryText(report.summaryCode)}</p>
      </div>
      <div className="intrigue-report-modal__meta">
        <p>
          <span className="intrigue-report-modal__label">可信程度：</span>
          {CONFIDENCE_LABEL[report.confidence] ?? report.confidence}
        </p>
      </div>
      <div className="intrigue-report-modal__actions">
        <button type="button" className="punish-btn" onClick={guard}>
          知道了
        </button>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="punish-modal intrigue-report-modal">{children}</div>
    </div>
  );
}

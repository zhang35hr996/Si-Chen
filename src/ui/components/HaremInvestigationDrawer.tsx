/**
 * Phase 5B-3: 宫中案件抽屉 — 交互层。
 * 展示案件列表与详情，支持派发调查任务、取消案件、裁定主谋。
 * 知识边界：仅读取玩家已知字段，不访问 haremSchemes / haremIncidents / investigationTruths。
 */
import { useState } from "react";
import type { InvestigationDetailPresentation, AvailableActionView } from "../haremInvestigationPresenter";
import { CASE_STATUS_LABELS } from "../haremInvestigationPresenter";
import type { IntrigueInvestigationStatus, InvestigationMethod } from "../../engine/characters/haremInvestigation/types";
import { isActiveCase } from "../../engine/characters/haremInvestigation/types";
import type { GameTime } from "../../engine/calendar/time";

export type InvestigationReviewDecision =
  | { type: "continue" }
  | { type: "close_unresolved" }
  | { type: "confirm"; suspectId: string };

export interface HaremInvestigationCaseView {
  id: string;
  presentation: InvestigationDetailPresentation;
  status: IntrigueInvestigationStatus;
  openedAt: GameTime;
}

export interface HaremInvestigationDrawerCallbacks {
  onStartTask: (caseId: string, method: InvestigationMethod, subjectId?: string) => Promise<string | null>;
  onCancelCase: (caseId: string) => Promise<string | null>;
  onReviewCase: (caseId: string, decision: InvestigationReviewDecision) => Promise<string | null>;
}

const PERIOD_ORDER = { early: 0, mid: 1, late: 2 } as const;

function compareGameTimeDesc(a: GameTime, b: GameTime): number {
  if (a.year !== b.year) return b.year - a.year;
  if (a.month !== b.month) return b.month - a.month;
  return PERIOD_ORDER[b.period] - PERIOD_ORDER[a.period];
}

export function HaremInvestigationDrawer({
  cases,
  playerAp,
  onClose,
  callbacks,
}: {
  cases: readonly HaremInvestigationCaseView[];
  playerAp: number;
  onClose: () => void;
  callbacks: HaremInvestigationDrawerCallbacks;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId !== null ? cases.find((c) => c.id === selectedId) : undefined;

  const sorted = [...cases].sort((a, b) => {
    const aActive = isActiveCase(a.status) ? 0 : 1;
    const bActive = isActiveCase(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return compareGameTimeDesc(a.openedAt, b.openedAt);
  });

  return (
    <div className="pending-audience-drawer" role="dialog" aria-label="宫中案件">
      <div className="pending-audience-drawer__header">
        <h2 className="pending-audience-drawer__title">宫中案件</h2>
        <button type="button" className="pending-audience-drawer__close" onClick={onClose} aria-label="关闭">✕</button>
      </div>

      {selected ? (
        <CaseDetail
          caseView={selected}
          playerAp={playerAp}
          onBack={() => setSelectedId(null)}
          callbacks={callbacks}
        />
      ) : (
        <CaseList cases={sorted} onSelect={(id) => setSelectedId(id)} />
      )}
    </div>
  );
}

function CaseList({
  cases,
  onSelect,
}: {
  cases: readonly HaremInvestigationCaseView[];
  onSelect: (id: string) => void;
}) {
  if (cases.length === 0) {
    return <p className="investigation-drawer__empty">暂无调查案件</p>;
  }

  const active = cases.filter((c) => isActiveCase(c.status));
  const closed = cases.filter((c) => !isActiveCase(c.status));

  return (
    <div className="investigation-drawer__list">
      {active.length > 0 && (
        <section>
          <h3 className="investigation-drawer__section-title">进行中</h3>
          <ul className="investigation-case-list">
            {active.map((c) => <CaseListItem key={c.id} caseView={c} onSelect={onSelect} />)}
          </ul>
        </section>
      )}
      {closed.length > 0 && (
        <section>
          <h3 className="investigation-drawer__section-title">已结案</h3>
          <ul className="investigation-case-list">
            {closed.map((c) => <CaseListItem key={c.id} caseView={c} onSelect={onSelect} />)}
          </ul>
        </section>
      )}
    </div>
  );
}

function CaseListItem({
  caseView,
  onSelect,
}: {
  caseView: HaremInvestigationCaseView;
  onSelect: (id: string) => void;
}) {
  const { presentation: pres } = caseView;
  return (
    <li className="investigation-case-list__item">
      <button
        type="button"
        className="investigation-case-list__btn"
        onClick={() => onSelect(caseView.id)}
      >
        <span className="investigation-case-list__title">{pres.title}</span>
        <span className="investigation-case-list__meta">
          {pres.openedAtLabel}　状态：{pres.statusLabel}
        </span>
      </button>
    </li>
  );
}

function CaseDetail({
  caseView,
  playerAp,
  onBack,
  callbacks,
}: {
  caseView: HaremInvestigationCaseView;
  playerAp: number;
  onBack: () => void;
  callbacks: HaremInvestigationDrawerCallbacks;
}) {
  const { presentation: pres, id: caseId, status } = caseView;
  const [error, setError] = useState<string | null>(null);
  const [selectedSubjectByMethod, setSelectedSubjectByMethod] = useState<Record<string, string>>({});
  const [selectedSuspectForReview, setSelectedSuspectForReview] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleStartTask(action: AvailableActionView) {
    const subjectId = action.subjects ? selectedSubjectByMethod[action.method] ?? undefined : undefined;
    if (action.subjects && !subjectId) {
      setError("请先选择调查对象");
      return;
    }
    if (playerAp < action.apCost) {
      setError(`行动力不足（需要 ${action.apCost}，当前 ${playerAp}）`);
      return;
    }
    setPending(true);
    setError(null);
    const err = await callbacks.onStartTask(caseId, action.method, subjectId);
    setPending(false);
    if (err) setError(err);
    else setSelectedSubjectByMethod({});
  }

  async function handleCancel() {
    setPending(true);
    setError(null);
    const err = await callbacks.onCancelCase(caseId);
    setPending(false);
    if (err) setError(err);
  }

  async function handleReview(intent: "confirm" | "close_unresolved" | "continue") {
    if (intent === "confirm" && !selectedSuspectForReview) {
      setError("请先选择确认主谋");
      return;
    }
    const decision: InvestigationReviewDecision =
      intent === "confirm"
        ? { type: "confirm", suspectId: selectedSuspectForReview! }
        : intent === "close_unresolved"
          ? { type: "close_unresolved" }
          : { type: "continue" };
    setPending(true);
    setError(null);
    const err = await callbacks.onReviewCase(caseId, decision);
    setPending(false);
    if (err) setError(err);
    else setSelectedSuspectForReview(null);
  }

  const canConfirmCulprit = pres.canConfirmCulprit;

  return (
    <div className="investigation-drawer__detail">
      <button type="button" className="investigation-drawer__back" onClick={onBack}>← 返回列表</button>
      <h3 className="investigation-drawer__detail-title">{pres.title}</h3>

      <dl className="investigation-drawer__fields">
        <dt>立案时间</dt><dd>{pres.openedAtLabel}</dd>
        <dt>案件状态</dt><dd>{pres.statusLabel}</dd>
        <dt>受影响之人</dt>
        <dd>{pres.targetLabels.length > 0 ? pres.targetLabels.join("、") : "—"}</dd>
        <dt>目前嫌疑人</dt>
        <dd>{pres.suspectLabels.length > 0 ? pres.suspectLabels.join("、") : pres.emptySuspectText}</dd>
        <dt>已知手段</dt>
        <dd>{pres.kindLabels.length > 0 ? pres.kindLabels.join("、") : pres.emptyKindText}</dd>
        <dt>可信程度</dt><dd>{pres.confidenceLabel}</dd>
      </dl>

      {/* 当前任务进度 */}
      {pres.currentTask && (
        <div className="investigation-drawer__current-task">
          <p>当前正在{pres.currentTask.methodLabel}
            {pres.currentTask.subjectLabel ? `（${pres.currentTask.subjectLabel}）` : ""}
          </p>
          <p className="investigation-drawer__due">预计 {pres.currentTask.dueAtLabel} 回报</p>
        </div>
      )}

      {/* 历史线索 */}
      {pres.leadViews.length > 0 && (
        <section className="investigation-drawer__leads">
          <h4>已有线索</h4>
          <ul>
            {pres.leadViews.map((l) => (
              <li key={l.id} className="investigation-drawer__lead-item">
                <span className="lead-time">{l.discoveredAtLabel}</span>
                <span className="lead-method">{l.methodLabel}</span>
                <span className="lead-summary">{l.summary}</span>
                <span className="lead-strength">{l.strengthLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 裁定主谋（closed_confirmed） */}
      {pres.confirmedCulpritLabel && (
        <div className="investigation-drawer__verdict">
          <p>已认定主谋：<strong>{pres.confirmedCulpritLabel}</strong></p>
        </div>
      )}

      {/* open — 可用行动 */}
      {status === "open" && pres.availableActionViews.length > 0 && (
        <section className="investigation-drawer__actions">
          <h4>调查行动</h4>
          {pres.availableActionViews.map((action) => {
            const needsSubject = !!action.subjects;
            const selected = selectedSubjectByMethod[action.method] ?? "";
            return (
              <div key={action.method} className="investigation-action">
                {needsSubject && (
                  <select
                    className="investigation-action__select"
                    value={selected}
                    onChange={(e) =>
                      setSelectedSubjectByMethod((prev) => ({
                        ...prev,
                        [action.method]: e.target.value,
                      }))
                    }
                    disabled={pending}
                  >
                    <option value="">— 选择对象 —</option>
                    {action.subjects!.map(({ id, label }) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="investigation-action__btn"
                  onClick={() => handleStartTask(action)}
                  disabled={pending || playerAp < action.apCost}
                >
                  {action.label}　{action.apCost} 行动力 · {action.durationDays} 旬
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="investigation-action__cancel"
            onClick={handleCancel}
            disabled={pending}
          >
            终止调查
          </button>
        </section>
      )}

      {/* in_progress — 等待结算 */}
      {status === "in_progress" && (
        <div className="investigation-drawer__waiting">
          <p>调查进行中，请等待回报。</p>
          <button
            type="button"
            className="investigation-action__cancel"
            onClick={handleCancel}
            disabled={pending}
          >
            终止调查
          </button>
        </div>
      )}

      {/* ready_for_review — 裁定 */}
      {status === "ready_for_review" && (
        <section className="investigation-drawer__review">
          <h4>待圣上裁定</h4>
          {canConfirmCulprit && pres.suspectViews.length > 0 && (
            <div className="investigation-action">
              <select
                className="investigation-action__select"
                value={selectedSuspectForReview ?? ""}
                onChange={(e) => setSelectedSuspectForReview(e.target.value || null)}
                disabled={pending}
              >
                <option value="">— 选择主谋 —</option>
                {pres.suspectViews.map(({ id, label }) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="investigation-drawer__review-buttons">
            <button
              type="button"
              className="investigation-action__btn investigation-action__btn--primary"
              onClick={() => handleReview("confirm")}
              disabled={pending || !canConfirmCulprit || !selectedSuspectForReview}
            >
              确认主谋
            </button>
            <button
              type="button"
              className="investigation-action__btn"
              onClick={() => handleReview("close_unresolved")}
              disabled={pending}
            >
              证据不足，结案
            </button>
          </div>
          <button
            type="button"
            className="investigation-action__cancel"
            onClick={() => handleReview("continue")}
            disabled={pending}
          >
            继续调查
          </button>
        </section>
      )}

      {/* 已结案 */}
      {(status === "closed_confirmed" || status === "closed_unresolved" || status === "cancelled") && (
        <div className="investigation-drawer__closed">
          {status === "closed_confirmed" && <p>已经查明，认定主谋：{pres.confirmedCulpritLabel ?? "—"}</p>}
          {status === "closed_unresolved" && <p>证据不足，未能查明。</p>}
          {status === "cancelled" && <p>圣上已下令终止调查。</p>}
        </div>
      )}

      {error && <p className="investigation-drawer__error" role="alert">{error}</p>}
    </div>
  );
}


export function getCaseStatusLabel(status: IntrigueInvestigationStatus): string {
  return CASE_STATUS_LABELS[status];
}

/**
 * Phase 5B-1B: 宫中案件抽屉。
 * 只读：展示调查案件列表及详情，不提供取消操作（5B-2 后开放）。
 *
 * 知识边界：仅展示玩家已知字段，不从 haremSchemes / haremIncidents 补全真相。
 */
import { useState } from "react";
import type { HaremInvestigationPresentation } from "../haremInvestigationPresenter";
import { CASE_STATUS_LABELS } from "../haremInvestigationPresenter";
import type { IntrigueInvestigationStatus } from "../../engine/characters/haremInvestigation/types";
import { isActiveCase } from "../../engine/characters/haremInvestigation/types";

export interface HaremInvestigationCaseView {
  id: string;
  presentation: HaremInvestigationPresentation;
  status: IntrigueInvestigationStatus;
}

export function HaremInvestigationDrawer({
  cases,
  onClose,
}: {
  cases: readonly HaremInvestigationCaseView[];
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = selectedId !== null ? cases.find((c) => c.id === selectedId) : undefined;

  // 排序：活跃优先，同组按 openedAtLabel 倒序（字典序逆推时间，格式"元年N月X旬"可能不完全稳定
  // 但 5B-1 没有 openedAt timestamp 展示接口，用 label 近似即可）
  const sorted = [...cases].sort((a, b) => {
    const aActive = isActiveCase(a.status) ? 0 : 1;
    const bActive = isActiveCase(b.status) ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    // 同组：openedAtLabel 倒序（字符串比较）
    return b.presentation.openedAtLabel.localeCompare(a.presentation.openedAtLabel, "zh");
  });

  return (
    <div className="pending-audience-drawer" role="dialog" aria-label="宫中案件">
      <div className="pending-audience-drawer__header">
        <h2 className="pending-audience-drawer__title">宫中案件</h2>
        <button type="button" className="pending-audience-drawer__close" onClick={onClose} aria-label="关闭">✕</button>
      </div>

      {selected ? (
        <CaseDetail caseView={selected} onBack={() => setSelectedId(null)} />
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
  onBack,
}: {
  caseView: HaremInvestigationCaseView;
  onBack: () => void;
}) {
  const { presentation: pres } = caseView;
  return (
    <div className="investigation-drawer__detail">
      <button type="button" className="investigation-drawer__back" onClick={onBack}>← 返回列表</button>
      <h3 className="investigation-drawer__detail-title">{pres.title}</h3>
      <dl className="investigation-drawer__fields">
        <dt>立案时间</dt>
        <dd>{pres.openedAtLabel}</dd>

        <dt>案件状态</dt>
        <dd>{pres.statusLabel}</dd>

        <dt>受影响之人</dt>
        <dd>{pres.targetLabels.length > 0 ? pres.targetLabels.join("、") : "—"}</dd>

        <dt>目前嫌疑人</dt>
        <dd>
          {pres.suspectLabels.length > 0
            ? pres.suspectLabels.join("、")
            : pres.emptySuspectText}
        </dd>

        <dt>已知手段</dt>
        <dd>
          {pres.kindLabels.length > 0
            ? pres.kindLabels.join("、")
            : pres.emptyKindText}
        </dd>

        <dt>可信程度</dt>
        <dd>{pres.confidenceLabel}</dd>
      </dl>
    </div>
  );
}

/** 获取状态分类标签（供外部列表分组时使用）。 */
export function getCaseStatusLabel(status: IntrigueInvestigationStatus): string {
  return CASE_STATUS_LABELS[status];
}

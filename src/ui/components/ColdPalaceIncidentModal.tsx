/**
 * PUNISH-4C: 冷宫事件通报弹窗。
 * 全局中断 "cold_palace_report" 的 UI；由 App 在 activeGlobalInterrupt === "cold_palace_report" 时渲染。
 * 只呈报，不决策——所有状态变更（健康扣减）已在月度 tick 写入，此处仅供玩家确认。
 *
 * 设计约束：
 *  - 点击遮罩不确认（强制全局通报，必须显式操作）；
 *  - 三个操作按钮均有同步 ref guard，防双击；
 *  - 以 incident.effectId 定位历史冷宫效果，不依赖当前 active effect；
 *  - 「召回」按钮仅在 linked effect 仍然活跃时显示。
 */
import { useRef, type ReactNode } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { ColdPalaceIncident, GameState } from "../../engine/state/types";
import { resolveDisplayName } from "../../engine/characters/standing";
import { resolveLinkedEffect, isLinkedEffectStillActive } from "../../engine/characters/coldPalaceIncidents";
import { formatGameTime } from "../../engine/calendar/time";

function confinementDuration(startYear: number, startMonth: number, nowYear: number, nowMonth: number): string {
  const totalMonths = (nowYear - startYear) * 12 + (nowMonth - startMonth);
  if (totalMonths <= 0) return "不足一月";
  if (totalMonths < 12) return `${totalMonths}个月`;
  const years = Math.floor(totalMonths / 12);
  const rem = totalMonths % 12;
  return rem > 0 ? `${years}年${rem}个月` : `${years}年`;
}

export function ColdPalaceIncidentModal({
  db,
  state,
  incident,
  onAcknowledge,
  onNavigate,
  onRestore,
}: {
  db: ContentDB;
  state: GameState;
  incident: ColdPalaceIncident;
  /** Called on 知道了. MUST be idempotent (modal unmounts after first call). */
  onAcknowledge: () => void;
  /** 前往长门宫 */
  onNavigate?: () => void;
  /** 召回 — only offered when linked effect is still active. */
  onRestore?: (charId: string) => void;
}) {
  const submitted = useRef(false);
  const { residentId, kind, occurredAt } = incident;
  const healthDelta = incident.kind === "health_deterioration" ? incident.healthDelta : undefined;

  const char = db.characters[residentId] ?? state.generatedConsorts[residentId];
  const standing = state.standing[residentId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = char ? resolveDisplayName(char, standing, rank) : residentId;
  const rankLabel = rank?.name ?? standing?.rank ?? "";

  // Use the specific linked effect (not current active) for confinement history display.
  const linkedEffect = resolveLinkedEffect(state, incident);
  const sentAt = linkedEffect
    ? formatGameTime({ ...linkedEffect.startedAt, eraName: state.calendar.eraName })
    : undefined;
  const duration = linkedEffect
    ? confinementDuration(
        linkedEffect.startedAt.year,
        linkedEffect.startedAt.month,
        occurredAt.year,
        occurredAt.month,
      )
    : undefined;
  const occurredLabel = formatGameTime({ ...occurredAt, eraName: state.calendar.eraName });

  // 召回 only makes sense when linked effect is still active for this resident.
  const canRestore = onRestore !== undefined && isLinkedEffectStillActive(state, incident);

  const incidentTitle = kind === "petition" ? "上书陈情" : "身体每况愈下";
  const incidentBody =
    kind === "petition"
      ? `${name}自幽居长门宫以来，遣人呈递陈情书，恳请圣恩宽赦，早日离宫。`
      : `${name}自入住长门宫以来，水土不服，身子每况愈下${healthDelta !== undefined ? `，身体有所损伤` : ""}。宫人上报，请圣上知悉。`;

  function guard(action: () => void): () => void {
    return () => {
      if (submitted.current) return;
      submitted.current = true;
      action();
    };
  }

  return (
    <Backdrop>
      <h2>长门宫通报</h2>
      <p className="punish-modal__subtitle">
        {rankLabel && <span>{rankLabel}　</span>}
        <strong>{name}</strong>　{incidentTitle}
      </p>
      <div className="punish-modal__confirm">
        <p>{incidentBody}</p>
        {sentAt && duration && (
          <p className="punish-modal__meta">
            入宫时间：{sentAt}　幽居已：{duration}
          </p>
        )}
        <p className="punish-modal__meta">通报时间：{occurredLabel}</p>
      </div>
      <div className="punish-modal__actions">
        <button
          type="button"
          className="punish-btn"
          onClick={guard(onAcknowledge)}
        >
          知道了
        </button>
        {onNavigate && (
          <button
            type="button"
            className="punish-btn punish-btn--minor"
            onClick={guard(() => { onAcknowledge(); onNavigate(); })}
          >
            前往长门宫
          </button>
        )}
        {canRestore && (
          <button
            type="button"
            className="punish-btn punish-btn--lift"
            onClick={guard(() => { onAcknowledge(); onRestore!(residentId); })}
          >
            召回
          </button>
        )}
      </div>
    </Backdrop>
  );
}

function Backdrop({ children }: { children: ReactNode }) {
  return (
    <div className="modal-backdrop">
      <div className="punish-modal">
        {children}
      </div>
    </div>
  );
}

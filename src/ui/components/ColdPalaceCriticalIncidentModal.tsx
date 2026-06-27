/**
 * PUNISH-4D: 冷宫严重病情决策弹窗。
 * 全局中断 "cold_palace_report" 中 kind=critical_illness 的决策 UI。
 *
 * 设计约束：
 *  - 点击遮罩不确认；
 *  - 所有按钮有同步 ref guard，防双击；
 *  - 召回仍通过现有 ColdPalaceRestoreModal 流程，不在此直接解除 effect；
 *  - historical / resolved 的严重通报不再展示本组件（App 层已过滤）。
 */
import { useRef, type ReactNode } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { ColdPalaceCriticalIllnessIncident, GameState } from "../../engine/state/types";
import { resolveDisplayName } from "../../engine/characters/standing";
import { resolveLinkedEffect, isLinkedEffectStillActive } from "../../engine/characters/coldPalaceIncidents";
import { hasColdPalaceMadness } from "../../engine/characters/coldPalace";
import { formatGameTime } from "../../engine/calendar/time";

function healthLabel(health: number): string {
  if (health <= 5) return "危在旦夕";
  if (health <= 10) return "病入膏肓";
  if (health <= 15) return "形销骨立";
  return "病势沉重";
}

export function ColdPalaceCriticalIncidentModal({
  db,
  state,
  incident,
  onPhysician,
  onIgnore,
  onRestore,
}: {
  db: ContentDB;
  state: GameState;
  incident: ColdPalaceCriticalIllnessIncident;
  /** 召太医诊治 */
  onPhysician: () => void;
  /** 置之不理 */
  onIgnore: () => void;
  /** 召回宫中 — opens ColdPalaceRestoreModal */
  onRestore?: (charId: string) => void;
}) {
  const submitted = useRef(false);
  const { residentId, occurredAt } = incident;

  const char = db.characters[residentId] ?? state.generatedConsorts[residentId];
  const standing = state.standing[residentId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = char ? resolveDisplayName(char, standing, rank) : residentId;
  const rankLabel = rank?.name ?? standing?.rank ?? "";
  const health = standing?.health ?? 100;

  const linkedEffect = resolveLinkedEffect(state, incident);
  const sentAt = linkedEffect
    ? formatGameTime({ ...linkedEffect.startedAt, eraName: state.calendar.eraName })
    : undefined;
  const occurredLabel = formatGameTime({ ...occurredAt, eraName: state.calendar.eraName });

  // Mad residents cannot be restored — per PUNISH-4F invariant.
  const canRestore = onRestore !== undefined
    && isLinkedEffectStillActive(state, incident)
    && !hasColdPalaceMadness(state, residentId);

  function guard(action: () => void): () => void {
    return () => {
      if (submitted.current) return;
      submitted.current = true;
      action();
    };
  }

  return (
    <Backdrop>
      <h2>长门宫病情急报</h2>
      <p className="punish-modal__subtitle">
        {rankLabel && <span>{rankLabel}　</span>}
        <strong>{name}</strong>　{healthLabel(health)}
      </p>
      <div className="punish-modal__confirm">
        <p>
          {name}自幽居长门宫以来，积郁成疾，近日病势骤重，
          {healthLabel(health)}，宫人惶惶，急请圣上定夺。
        </p>
        {sentAt && (
          <p className="punish-modal__meta">幽居始于：{sentAt}</p>
        )}
        <p className="punish-modal__meta">通报时间：{occurredLabel}</p>
      </div>
      <div className="punish-modal__actions">
        <button
          type="button"
          className="punish-btn"
          onClick={guard(onPhysician)}
        >
          召太医诊治
        </button>
        <button
          type="button"
          className="punish-btn punish-btn--minor"
          onClick={guard(onIgnore)}
        >
          置之不理
        </button>
        {canRestore && (
          <button
            type="button"
            className="punish-btn punish-btn--lift"
            onClick={guard(() => onRestore!(residentId))}
          >
            召回宫中
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

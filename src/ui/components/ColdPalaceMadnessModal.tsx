/**
 * PUNISH-4F: 冷宫精神失常通报弹窗。
 * 全局中断 "cold_palace_report" 中 kind=mental_breakdown 的通报 UI。
 *
 * 不可逆通报：无治疗选项，无召回选项。
 * 仅供玩家知悉，确认后队列继续。
 */
import { useRef, type ReactNode } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { ColdPalaceMentalBreakdownIncident, GameState } from "../../engine/state/types";
import { resolveDisplayName } from "../../engine/characters/standing";
import { resolveLinkedEffect } from "../../engine/characters/coldPalaceIncidents";
import { formatGameTime } from "../../engine/calendar/time";

export function ColdPalaceMadnessModal({
  db,
  state,
  incident,
  onAcknowledge,
  onNavigate,
}: {
  db: ContentDB;
  state: GameState;
  incident: ColdPalaceMentalBreakdownIncident;
  /** Called on 知道了. MUST be idempotent (modal unmounts after first call). */
  onAcknowledge: () => void;
  /** 前往长门宫 */
  onNavigate?: () => void;
}) {
  const submitted = useRef(false);
  const { residentId, occurredAt } = incident;

  const char = db.characters[residentId] ?? state.generatedConsorts[residentId];
  const standing = state.standing[residentId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = char ? resolveDisplayName(char, standing, rank) : residentId;
  const rankLabel = rank?.name ?? standing?.rank ?? "";

  const linkedEffect = resolveLinkedEffect(state, incident);
  const sentAt = linkedEffect
    ? formatGameTime({ ...linkedEffect.startedAt, eraName: state.calendar.eraName })
    : undefined;
  const occurredLabel = formatGameTime({ ...occurredAt, eraName: state.calendar.eraName });

  function guard(action: () => void): () => void {
    return () => {
      if (submitted.current) return;
      submitted.current = true;
      action();
    };
  }

  return (
    <Backdrop>
      <h2>长门宫急报</h2>
      <p className="punish-modal__subtitle">
        {rankLabel && <span>{rankLabel}　</span>}
        <strong>{name}</strong>　神志昏乱
      </p>
      <div className="punish-modal__confirm">
        <p>
          长门宫来报：{name}幽居日久，神志已乱，已不能辨识宫人，时常哭笑无常。
        </p>
        {sentAt && (
          <p className="punish-modal__meta">幽居始于：{sentAt}</p>
        )}
        <p className="punish-modal__meta">通报时间：{occurredLabel}</p>
        <p className="punish-modal__meta punish-modal__meta--warn">
          此人神志已乱，不得再召回宫中。
        </p>
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

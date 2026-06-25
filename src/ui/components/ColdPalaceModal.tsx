/**
 * 冷宫召回确认弹窗（PUNISH-4B）。
 * 供玩家在长门宫场景点击「召回」后二次确认，选择召回原因并提交。
 * 不负责计算恢复居所；居所由 store.restoreFromColdPalace 决定。
 */
import { useState, type ReactNode } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";
import { resolveDisplayName } from "../../engine/characters/standing";
import { formatGameTime, toGameTime } from "../../engine/calendar/time";

export type ColdPalaceLiftReason = "lifted_by_emperor" | "pardoned";

type Step = "choose" | { reason: ColdPalaceLiftReason };

export function ColdPalaceRestoreModal({
  db,
  state,
  charId,
  onConfirm,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  charId: string;
  onConfirm: (reason: ColdPalaceLiftReason) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>("choose");

  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const standing = state.standing[charId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = char ? resolveDisplayName(char, standing, rank) : charId;

  const sentAt = (() => {
    const effect = state.statusEffects.find(
      (e) => e.kind === "cold_palace" && e.characterId === charId && (e as { liftedTurn?: number }).liftedTurn === undefined,
    );
    if (!effect) return undefined;
    const started = (effect as { startedAt?: import("../../engine/calendar/time").GameTime }).startedAt;
    if (!started) return undefined;
    return formatGameTime({ ...started, eraName: state.calendar.eraName });
  })();

  if (step === "choose") {
    return (
      <Backdrop onClose={onClose}>
        <h2>{name}　召回</h2>
        {sentAt && (
          <p className="punish-modal__confirm">
            {name}自{sentAt}起幽居长门宫。
          </p>
        )}
        <p className="punish-modal__subtitle">请选择召回方式：</p>
        <div className="punish-modal__menu">
          <button
            type="button"
            className="punish-btn"
            onClick={() => setStep({ reason: "lifted_by_emperor" })}
          >
            奉旨召回
          </button>
          <button
            type="button"
            className="punish-btn"
            onClick={() => setStep({ reason: "pardoned" })}
          >
            特旨赦免
          </button>
        </div>
        <button type="button" className="punish-btn punish-btn--minor" onClick={onClose}>
          取消
        </button>
      </Backdrop>
    );
  }

  const { reason } = step;
  const reasonLabel = reason === "lifted_by_emperor" ? "奉旨召回" : "特旨赦免";
  const reasonDesc =
    reason === "lifted_by_emperor"
      ? "皇帝下旨召回，幽居即时解除。"
      : "皇帝念及旧情，特旨赦免，幽居即时解除。";
  const nowLabel = formatGameTime({ ...toGameTime(state.calendar), eraName: state.calendar.eraName });

  return (
    <Backdrop onClose={onClose}>
      <h2>{name}　{reasonLabel}</h2>
      <p className="punish-modal__confirm">
        {reasonDesc}
        <br />
        {name}将自{nowLabel}迁回原居所或最近空位宫室。
        <br />
        此操作正式记录在案，不可逆。
      </p>
      <div className="punish-modal__actions">
        <button
          type="button"
          className="punish-btn punish-btn--lift"
          onClick={() => onConfirm(reason)}
        >
          确认{reasonLabel}
        </button>
        <button
          type="button"
          className="punish-btn punish-btn--minor"
          onClick={() => setStep("choose")}
        >
          返回
        </button>
      </div>
    </Backdrop>
  );
}

function Backdrop({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="punish-modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

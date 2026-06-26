/**
 * PUNISH-4E: 长门宫探视确认弹窗。
 * 玩家在长门宫场景点击「亲临探视 / 遣太医」后弹出；在此处选择具体方式并确认。
 *
 * 设计约束：
 *  - 点击遮罩不确认；
 *  - 每个选项按钮有 double-click guard；失败后 guard 自动重置以允许重试；
 *  - 失败错误信息原地展示；
 *  - 文案统一用"恩宠"（对应 favor 属性）。
 */
import { useRef, useState, type ReactNode } from "react";
import type { ContentDB } from "../../engine/content/loader";
import type { ColdPalaceInterventionKind, GameState } from "../../engine/state/types";
import { canInterveneInColdPalace, COLD_PALACE_VISIT_FAVOR_DELTA, COLD_PALACE_PHYSICIAN_HEALTH_DELTA } from "../../engine/characters/coldPalaceIncidents";
import { resolveDisplayName } from "../../engine/characters/standing";

export function ColdPalaceInterventionModal({
  db,
  state,
  charId,
  onSelect,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  charId: string;
  /** Returns null on success (parent closes modal), error string on failure (shown in-place). */
  onSelect: (kind: ColdPalaceInterventionKind) => string | null;
  onClose: () => void;
}) {
  const submitted = useRef(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const standing = state.standing[charId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = char ? resolveDisplayName(char, standing, rank) : charId;
  const rankLabel = rank?.name ?? standing?.rank ?? "";

  const canVisit = canInterveneInColdPalace(state, charId, "personal_visit");
  const canPhysician = canInterveneInColdPalace(state, charId, "physician");

  function handleSelect(kind: ColdPalaceInterventionKind): void {
    if (submitted.current) return;
    submitted.current = true;
    setErrorMsg(null);
    const result = onSelect(kind);
    if (result !== null) {
      setErrorMsg(result);
      submitted.current = false; // reset so player can retry
    }
  }

  return (
    <Backdrop>
      <h2>探视长门宫</h2>
      <p className="punish-modal__subtitle">
        {rankLabel && <span>{rankLabel}　</span>}
        <strong>{name}</strong>
      </p>
      <div className="punish-modal__confirm">
        <p>请选择探视方式：</p>
        {errorMsg && <p className="punish-modal__error">{errorMsg}</p>}
      </div>
      <div className="punish-modal__actions">
        <button
          type="button"
          className="punish-btn"
          disabled={!canVisit}
          onClick={() => handleSelect("personal_visit")}
          title={canVisit ? undefined : "本月已探视、有待决病危，或行动点不足"}
        >
          亲临探视（恩宠 +{COLD_PALACE_VISIT_FAVOR_DELTA}）
        </button>
        <button
          type="button"
          className="punish-btn"
          disabled={!canPhysician}
          onClick={() => handleSelect("physician")}
          title={canPhysician ? undefined : "本月已探视、有待决病危、健康已满，或行动点不足"}
        >
          遣太医诊治（健康 +{COLD_PALACE_PHYSICIAN_HEALTH_DELTA}）
        </button>
        <button
          type="button"
          className="punish-btn punish-btn--minor"
          onClick={onClose}
        >
          取消
        </button>
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

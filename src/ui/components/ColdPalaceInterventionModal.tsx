/**
 * PUNISH-4E: 长门宫探视选项弹窗。
 * 供需要二次确认的调用方使用（例如：先点「探视/诊治」再选类型）。
 * FreeViewScreen 默认直接调用 interveneInColdPalace，无需本弹窗。
 *
 * 设计约束：
 *  - 点击遮罩不确认（需明确选择一项）；
 *  - 两个按钮均有 double-click guard；
 *  - disabled 时展示工具提示原因。
 */
import { useRef, type ReactNode } from "react";
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
  /** Called when user selects a kind. Returns error string on failure (displayed in-place), null on success (parent should close). */
  onSelect: (kind: ColdPalaceInterventionKind) => string | null;
  onClose: () => void;
}) {
  const submitted = useRef(false);

  const char = db.characters[charId] ?? state.generatedConsorts[charId];
  const standing = state.standing[charId];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const name = char ? resolveDisplayName(char, standing, rank) : charId;
  const rankLabel = rank?.name ?? standing?.rank ?? "";

  const canVisit = canInterveneInColdPalace(state, charId, "personal_visit");
  const canPhysician = canInterveneInColdPalace(state, charId, "physician");

  function guard(kind: ColdPalaceInterventionKind): () => void {
    return () => {
      if (submitted.current) return;
      submitted.current = true;
      onSelect(kind);
    };
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
      </div>
      <div className="punish-modal__actions">
        <button
          type="button"
          className="punish-btn"
          disabled={!canVisit}
          onClick={guard("personal_visit")}
          title={canVisit ? undefined : "本月已探视或行动点不足"}
        >
          亲临探视（+{COLD_PALACE_VISIT_FAVOR_DELTA} 好感）
        </button>
        <button
          type="button"
          className="punish-btn"
          disabled={!canPhysician}
          onClick={guard("physician")}
          title={canPhysician ? undefined : "本月已探视或行动点不足"}
        >
          遣太医诊治（+{COLD_PALACE_PHYSICIAN_HEALTH_DELTA} 健康）
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

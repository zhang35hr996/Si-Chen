/** 次月提示：从受孕当月的激情侍寝侍君中挑选 1–3 名生父。 */
import { useState } from "react";
import { resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function PregnancyModal({
  db,
  state,
  candidateIds,
  onConfirm,
}: {
  db: ContentDB;
  state: GameState;
  candidateIds: string[];
  onConfirm: (fatherIds: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 3 ? [...cur, id] : cur,
    );

  return (
    <div className="modal-backdrop">
      <div className="pregnancy-modal" onClick={(e) => e.stopPropagation()}>
        <h2>陛下喜脉初成</h2>
        <p className="pregnancy-modal__hint">
          太医诊得陛下已有身孕。择上月承欢侍君 1–3 人，记为皇嗣之父。
        </p>
        <ul className="pregnancy-modal__list">
          {candidateIds.map((id) => {
            const c = db.characters[id]!;
            const st = state.standing[id];
            return (
              <li key={id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.includes(id)}
                    onChange={() => toggle(id)}
                  />
                  {resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined)}
                </label>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          disabled={picked.length < 1 || picked.length > 3}
          onClick={() => onConfirm(picked)}
        >
          钦定生父（{picked.length}/3）
        </button>
      </div>
    </div>
  );
}

/** 孕二月敬事房上书：列「可能生父」，可即刻选定候选承嗣（全体在世侍君多选）。 */
import { useState } from "react";
import { resolveIdentityLabel } from "../../engine/characters/standing";
import { canSummon } from "../../store/bedchamber";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function JingshifangModal({
  db,
  state,
  fatherCandidates,
  onSelfPregnancy,
  onDesignate,
}: {
  db: ContentDB;
  state: GameState;
  fatherCandidates: string[];
  onSelfPregnancy: () => void;
  onDesignate: (charIds: string[]) => void;
}) {
  const [phase, setPhase] = useState<"ask" | "pick">("ask");
  const [picked, setPicked] = useState<string[]>([]);

  const name = (id: string) => {
    const c = db.characters[id]!;
    const st = state.standing[id];
    return resolveIdentityLabel(c, st, st ? db.ranks[st.rank] : undefined);
  };
  const fatherText = fatherCandidates.map(name).join(" 或 ");

  const living = Object.values(db.characters)
    .filter((c) => c.kind === "consort" && canSummon(state, c.id))
    .map((c) => c.id);

  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return (
    <div className="modal-backdrop">
      <div className="pregnancy-modal" onClick={(e) => e.stopPropagation()}>
        {phase === "ask" ? (
          <>
            <h2>敬事房主管上书</h2>
            <p className="pregnancy-modal__hint">
              陛下喜脉初成。皇嗣之父可能为{fatherText || "近月承欢侍君"}。是否即刻选定候选承嗣者？
            </p>
            <button type="button" onClick={() => setPhase("pick")}>
              即刻选定候选承嗣
            </button>
            <button type="button" onClick={onSelfPregnancy}>
              暂不（自孕）
            </button>
          </>
        ) : (
          <>
            <h2>选定候选承嗣</h2>
            <p className="pregnancy-modal__hint">于在世侍君中圈定候选承嗣（可多选）：</p>
            <ul className="pregnancy-modal__list">
              {living.map((id) => (
                <li key={id}>
                  <label>
                    <input type="checkbox" checked={picked.includes(id)} onChange={() => toggle(id)} />
                    {name(id)}
                  </label>
                </li>
              ))}
            </ul>
            <button type="button" disabled={picked.length < 1} onClick={() => onDesignate(picked)}>
              钦定候选承嗣（{picked.length}）
            </button>
            <button type="button" onClick={() => setPhase("ask")}>
              返回
            </button>
          </>
        )}
      </div>
    </div>
  );
}

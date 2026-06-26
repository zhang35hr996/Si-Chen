/** 宗正寺·传嗣：在世侍君中择承嗣君（高亮候选）。皇后无嗣时提示优先皇后承嗣。 */
import { useState } from "react";
import { resolveIdentityLabel } from "../../engine/characters/standing";
import { byRankDesc } from "../../engine/characters/presence";
import { canSummon } from "../../store/bedchamber";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function SuccessorModal({
  db,
  state,
  onTransfer,
  onKeep,
}: {
  db: ContentDB;
  state: GameState;
  onTransfer: (carrierId: string) => void;
  onKeep: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const candidateIds = state.resources.bloodline.pregnancy.candidateIds;
  const fenghouChildless = !state.resources.bloodline.heirs.some((h) => h.bearer === "shen_zhibai");

  // 已承嗣怀胎者不可再受传胎；从可选承嗣君中剔除。
  const alreadyCarrying = (id: string) => state.resources.bloodline.gestations.some((g) => g.carrier === id);
  const living = Object.values(db.characters)
    .filter((c) => c.kind === "consort" && canSummon(state, c.id) && !alreadyCarrying(c.id))
    .sort(byRankDesc(db, state))
    .map((c) => c.id);
  const name = (id: string) => {
    const c = db.characters[id]!;
    const st = state.standing[id];
    return resolveIdentityLabel(c, st, st ? db.ranks[st.rank] : undefined);
  };

  return (
    <div className="modal-backdrop">
      <div className="pregnancy-modal" onClick={(e) => e.stopPropagation()}>
        <h2>宗正寺上书</h2>
        <p className="pregnancy-modal__hint">
          宗正寺奏请陛下尽早择侍君承嗣，以固宗祧。
          {fenghouChildless ? "皇后尚无所出，可优先择皇后承嗣以生嫡子。" : ""}
        </p>
        <ul className="pregnancy-modal__list">
          {living.map((id) => (
            <li key={id}>
              <label>
                <input type="radio" name="successor" checked={picked === id} onChange={() => setPicked(id)} />
                {name(id)}
                {candidateIds.includes(id) ? "（候选承嗣）" : ""}
                {id === "shen_zhibai" && fenghouChildless ? "（嫡子）" : ""}
              </label>
            </li>
          ))}
        </ul>
        <button type="button" disabled={picked === null} onClick={() => picked && onTransfer(picked)}>
          传嗣
        </button>
        <button type="button" onClick={onKeep}>
          仍由帝王自孕
        </button>
      </div>
    </div>
  );
}

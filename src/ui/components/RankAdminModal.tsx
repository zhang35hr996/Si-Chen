/**
 * 位分/封号 management modal (rank/title system). Three independent ops, each
 * with its own confirm; each produces a reaction via onApply.
 */
import { useState } from "react";
import { effectiveOrder, resolveIdentityLabel } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import { isAssignableRank, type CharacterContent } from "../../engine/content/schemas";
import type { CharacterStanding } from "../../engine/state/types";
import type { RankOpRequest } from "../../store/rankOps";

export function RankAdminModal({
  db,
  character,
  standing,
  onApply,
  onClose,
}: {
  db: ContentDB;
  character: CharacterContent;
  standing: CharacterStanding;
  onApply: (req: RankOpRequest) => void;
  onClose: () => void;
}) {
  const [target, setTarget] = useState(standing.rank);
  const [title, setTitle] = useState("");
  const ladder = Object.values(db.ranks)
    .filter((r) => isAssignableRank(r) && r.domain === "harem" && r.id !== "fenghou")
    .sort((a, b) => effectiveOrder(b, false) - effectiveOrder(a, false));
  const titleValid = /^[一-龥]{1,4}$/.test(title);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{resolveIdentityLabel(character, standing, db.ranks[standing.rank])}　管理位分 / 封号</h2>
        <p className="rank-modal__current">
          当前：{db.ranks[standing.rank]?.name}
          {standing.title ? `　封号「${standing.title}」` : "　无封号"}
        </p>

        <section className="rank-modal__section">
          <label>调整位分：</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {ladder.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}（{r.grade}）
              </option>
            ))}
          </select>
          <button type="button" disabled={target === standing.rank} onClick={() => onApply({ kind: "set_rank", rank: target })}>
            确认调整
          </button>
        </section>

        <section className="rank-modal__section">
          <label>封号：</label>
          <input value={title} maxLength={4} placeholder="1–4 字" onChange={(e) => setTitle(e.target.value)} />
          <button type="button" disabled={!titleValid} onClick={() => onApply({ kind: "set_title", title })}>
            {standing.title ? "改封" : "加封"}
          </button>
          <button type="button" disabled={standing.title === undefined} onClick={() => onApply({ kind: "remove_title" })}>
            褫夺封号
          </button>
        </section>

        <button type="button" className="rank-modal__close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}

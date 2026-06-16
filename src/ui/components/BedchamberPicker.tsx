/** 御书房「翻牌子」：列出全部侍君，选一人来御书房侍寝。 */
import { effectiveOrder, resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";

export function BedchamberPicker({
  db,
  state,
  onPick,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  onPick: (charId: string) => void;
  onClose: () => void;
}) {
  const consorts = Object.values(db.characters)
    .filter((c) => c.kind === "consort")
    .sort((a, b) => {
      const ra = state.standing[a.id], rb = state.standing[b.id];
      if (!ra || !rb) return 0; // a consort without standing (e.g. added post-save) sorts neutrally
      return (
        effectiveOrder(db.ranks[rb.rank]!, rb.title !== undefined) -
        effectiveOrder(db.ranks[ra.rank]!, ra.title !== undefined)
      );
    });

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bedchamber-picker" onClick={(e) => e.stopPropagation()}>
        <h2>翻牌子</h2>
        <ul className="bedchamber-picker__list">
          {consorts.map((c) => {
            const st = state.standing[c.id]!;
            return (
              <li key={c.id}>
                <button type="button" onClick={() => onPick(c.id)}>
                  {resolveDisplayName(c, st, db.ranks[st.rank])}
                  <span className="bedchamber-picker__rank">{db.ranks[st.rank]?.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="bedchamber-picker__close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}

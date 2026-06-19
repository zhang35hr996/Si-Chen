/** 御书房「翻牌子」：托盘上排开宫中侍君的竖刻名牌，点牌即召见到御书房。 */
import { inPalaceConsorts } from "../../engine/characters/presence";
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
  const consorts = inPalaceConsorts(db, state);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="tablet-tray" onClick={(e) => e.stopPropagation()}>
        <h2 className="tablet-tray__title">翻牌子</h2>
        <div className="tablet-tray__rack">
          {consorts.map((c) => {
            const st = state.standing[c.id]!;
            return (
              <button
                key={c.id}
                type="button"
                className="tablet"
                onClick={() => onPick(c.id)}
              >
                <span className="tablet__name">{c.profile.name}</span>
                <span className="tablet__rank">{db.ranks[st.rank]?.name}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="bedchamber-picker__close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}

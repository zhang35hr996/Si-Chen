/** 召见皇嗣选择器：列出当前在世皇嗣，玩家选定后由父层设置召见态。 */
import { heirAge, listHeirsBySex } from "../../engine/characters/heirs";
import { resolveDisplayName } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { Heir, GameState } from "../../engine/state/types";

export interface HeirPickResult {
  heirId: string;
}

export function HeirSummonPicker({
  db,
  state,
  onPick,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  onPick: (result: HeirPickResult) => void;
  onClose: () => void;
}) {
  const allHeirs = [
    ...listHeirsBySex(state.resources.bloodline.heirs, "daughter"),
    ...listHeirsBySex(state.resources.bloodline.heirs, "son"),
  ].filter(({ heir }) => heir.lifecycle === "alive");

  const custodianName = (heir: Heir): string | undefined => {
    const custId = heir.adoptiveFatherId;
    if (!custId) return undefined;
    const c = db.characters[custId] ?? state.generatedConsorts[custId];
    if (!c) return custId;
    const st = state.standing[custId];
    return resolveDisplayName(c, st, st ? db.ranks[st.rank] : undefined);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
        <h2>召见皇嗣</h2>
        {allHeirs.length === 0 ? (
          <p>当前无皇嗣可召见。</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {allHeirs.map(({ heir, name }) => {
              const age = heirAge(heir, state.calendar);
              const custodian = custodianName(heir);
              return (
                <li key={heir.id} style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => onPick({ heirId: heir.id })}
                  >
                    <span>{name}</span>
                    {heir.givenName && <span>·{heir.givenName}</span>}
                    <span>　{age}岁</span>
                    {custodian && <span>　由{custodian}抚养</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button type="button" className="action-btn" onClick={onClose}>
          取消
        </button>
      </div>
    </div>
  );
}

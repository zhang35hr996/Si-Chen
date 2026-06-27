/**
 * 搬迁侍君弹窗：列出各设宫室居所的 5 间宫室，已住宫室显示住客，空置可选。
 * 点击空置宫室即把当前侍君迁入；侍君本人当前所居宫室标为「当前」。皇后不可搬迁
 * （调用方已排除）。零行动点的内务安排。
 */
import { getCharacterLocation } from "../../engine/characters/presence";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent } from "../../engine/content/schemas";
import type { ChamberId, GameState } from "../../engine/state/types";
import { relocationTargets } from "../../store/relocate";

export function RelocateModal({
  db,
  state,
  character,
  onRelocate,
  onClose,
}: {
  db: ContentDB;
  state: GameState;
  character: CharacterContent;
  onRelocate: (location: string, chamber: ChamberId) => void;
  onClose: () => void;
}) {
  const targets = relocationTargets(db, state);
  const currentLoc = getCharacterLocation(db, state, character.id);
  const currentChamber = state.standing[character.id]?.chamber ?? "main";
  const currentName = currentLoc ? db.locations[currentLoc]?.name ?? currentLoc : "未定";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="relocate-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{character.profile.name}　搬迁居所</h2>
        <p className="relocate-modal__current">
          当前：{currentName}
          {currentLoc ? `· ${chamberName(currentChamber)}` : ""}
        </p>
        <div className="relocate-modal__palaces">
          {targets.map((palace) => (
            <section key={palace.id} className="relocate-palace">
              <h3 className="relocate-palace__name">{palace.name}</h3>
              <div className="relocate-palace__chambers">
                {palace.chambers.map((slot) => {
                  const isCurrent = palace.id === currentLoc && slot.id === currentChamber;
                  const occupiedByOther = slot.occupant !== undefined && slot.occupant.id !== character.id;
                  const disabled = occupiedByOther || isCurrent;
                  return (
                    <button
                      key={slot.id}
                      type="button"
                      className={`relocate-chamber${isCurrent ? " is-current" : ""}${
                        occupiedByOther ? " is-occupied" : ""
                      }`}
                      disabled={disabled}
                      onClick={() => onRelocate(palace.id, slot.id)}
                    >
                      <span className="relocate-chamber__room">{slot.name}</span>
                      <span className="relocate-chamber__occupant">
                        {isCurrent
                          ? "当前"
                          : occupiedByOther
                            ? slot.occupant!.profile.name
                            : "空置"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <button type="button" className="relocate-modal__close" onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}

const CHAMBER_NAMES: Record<ChamberId, string> = {
  main: "主殿",
  east_side: "东侧殿",
  west_side: "西侧殿",
  east_annex: "东偏殿",
  west_annex: "西偏殿",
};

function chamberName(id: ChamberId): string {
  return CHAMBER_NAMES[id];
}

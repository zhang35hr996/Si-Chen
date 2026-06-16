/** 侍寝前选「激情/享受」。激情=纳入式（可能受孕）；享受=无受孕。 */
import type { BedchamberMode } from "../../engine/state/types";

export function BedchamberModal({
  name,
  onChoose,
  onClose,
}: {
  name: string;
  onChoose: (mode: BedchamberMode) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="bedchamber-modal" onClick={(e) => e.stopPropagation()}>
        <h2>召{name}侍寝</h2>
        <p className="bedchamber-modal__hint">择侍寝之法：</p>
        <div className="bedchamber-modal__choices">
          <button type="button" onClick={() => onChoose("passion")}>
            激情<small>　恩泽承嗣，或有孕育之机</small>
          </button>
          <button type="button" onClick={() => onChoose("pleasure")}>
            享受<small>　怡情解乏，不涉子嗣</small>
          </button>
        </div>
        <button type="button" className="bedchamber-modal__close" onClick={onClose}>
          罢了
        </button>
      </div>
    </div>
  );
}

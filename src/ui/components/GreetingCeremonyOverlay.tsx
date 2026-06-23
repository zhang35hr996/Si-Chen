/** 卯时请安场景：主持者起身率众行礼，问要事。现仅「无事」一项，结构预留扩展。 */
import type { GreetingHostView } from "../../engine/characters/haremAdministration";

export function GreetingCeremonyOverlay({
  hostView,
  onDone,
}: {
  hostView: GreetingHostView;
  onDone: () => void;
}) {
  const isEmpress = hostView.mode === "empress";
  return (
    <div className="modal-backdrop">
      <div className="event-overlay" onClick={(e) => e.stopPropagation()}>
        <h2 className="event-overlay__title">{hostView.locationName}　晨省</h2>
        <p className="event-overlay__hint">
          {hostView.hostName}起身，率众侍君向陛下行礼：「陛下万福金安。可有要事相告？」
        </p>
        <div className="event-overlay__choices">
          <button type="button" onClick={onDone}>
            {isEmpress ? "无事，只是来看看皇后" : `无事，只是来看看${hostView.hostName}`}
          </button>
        </div>
      </div>
    </div>
  );
}

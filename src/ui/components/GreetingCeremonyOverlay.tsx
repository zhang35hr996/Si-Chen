/** 卯时请安场景：皇后起身率众行礼，问要事。现仅「无事」一项，结构预留扩展。 */
export function GreetingCeremonyOverlay({
  empressName,
  onDone,
}: {
  empressName: string;
  onDone: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="event-overlay" onClick={(e) => e.stopPropagation()}>
        <h2 className="event-overlay__title">坤宁宫　晨省</h2>
        <p className="event-overlay__hint">
          {empressName}起身，率众侍君向陛下行礼：「陛下万福金安。可有要事相告？」
        </p>
        <div className="event-overlay__choices">
          <button type="button" onClick={onDone}>
            无事，只是来看看皇后
          </button>
        </div>
      </div>
    </div>
  );
}

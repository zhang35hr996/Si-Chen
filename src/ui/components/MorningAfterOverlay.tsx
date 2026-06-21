/** 翌晨离宫二选一：施恩免请安 或 默然离开（侍君照常请安）。均不耗行动点。 */
export function MorningAfterOverlay({
  consortName,
  onRest,
  onSilent,
}: {
  consortName: string;
  onRest: () => void;
  onSilent: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="event-overlay" onClick={(e) => e.stopPropagation()}>
        <h2 className="event-overlay__title">晨起辞行</h2>
        <p className="event-overlay__hint">{consortName}起身欲随众往坤宁宫请安。陛下……</p>
        <div className="event-overlay__choices">
          <button type="button" onClick={onRest}>
            「昨晚爱卿辛苦了，今日就多歇着吧。」
          </button>
        </div>
        <button type="button" className="event-overlay__later" onClick={onSilent}>
          （什么都不说，起驾离开）
        </button>
      </div>
    </div>
  );
}

/** 御书房·召见太医（0 行动点）。自孕中可流胎（红色二次确认）；已传嗣不可弃。 */
import { useState } from "react";

export function PhysicianModal({
  selfCarrying,
  consortCarrying,
  onAbort,
  onClose,
}: {
  selfCarrying: boolean;
  consortCarrying: boolean;
  onAbort: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="physician-modal" onClick={(e) => e.stopPropagation()}>
        <h2>太医院正请安</h2>
        {selfCarrying ? (
          confirming ? (
            <>
              <p className="physician-modal__warn">皇嗣是国家大事，可有不妥？此举不可挽回。</p>
              <button type="button" className="physician-modal__danger" onClick={onAbort}>
                执意流胎
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                取消
              </button>
            </>
          ) : (
            <>
              <p>陛下凤体有孕，院正候旨。</p>
              <button type="button" className="physician-modal__danger" onClick={() => setConfirming(true)}>
                流胎
              </button>
              <button type="button" onClick={onClose}>
                罢了
              </button>
            </>
          )
        ) : consortCarrying ? (
          <>
            <p>皇嗣已承于承嗣君，承养不可弃，唯静候临盆。</p>
            <button type="button" onClick={onClose}>
              知道了
            </button>
          </>
        ) : (
          <>
            <p>陛下凤体康健，院正无事可奏。陛下有何吩咐？</p>
            <button type="button" onClick={onClose}>
              退下
            </button>
          </>
        )}
      </div>
    </div>
  );
}

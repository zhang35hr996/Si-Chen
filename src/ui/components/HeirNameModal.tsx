/** 通用皇嗣命名框：出生起小名 / 百日宴赐正名。限 2 字 + 可随机。 */
import { useState } from "react";

export function HeirNameModal({
  title,
  hint,
  confirmLabel,
  onRandom,
  onConfirm,
  onDismiss,
}: {
  title: string;
  hint: string;
  confirmLabel: string;
  /** 提供则显示「随机」按钮（出生起小名用）。 */
  onRandom?: () => string;
  onConfirm: (name: string) => void;
  /** 提供则显示「稍后再说」按钮（可延迟命名用）。 */
  onDismiss?: () => void;
}) {
  const [name, setName] = useState("");
  const valid = [...name.trim()].length >= 1 && [...name.trim()].length <= 2;
  return (
    <div className="modal-backdrop">
      <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p>{hint}</p>
        <input
          className="heir-name__input"
          value={name}
          maxLength={2}
          placeholder="二字名"
          onChange={(e) => setName(e.target.value)}
        />
        <div className="yushufang-actions">
          {onRandom && (
            <button type="button" onClick={() => setName(onRandom())}>随机</button>
          )}
          <button type="button" disabled={!valid} onClick={() => onConfirm(name.trim())}>
            {confirmLabel}
          </button>
          {onDismiss && (
            <button type="button" onClick={onDismiss}>稍后再说</button>
          )}
        </div>
      </div>
    </div>
  );
}

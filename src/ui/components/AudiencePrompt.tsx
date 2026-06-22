/**
 * 非阻塞候见提示（scene-ui-narrative-refactor §6.2）。司礼/官员等在殿外候见时，以叙事口吻呈现，
 * 玩家可「宣进来」或「记入待宣」。纯展示 + 回调：组件不读/改 store、不查事件、不做导航，动作只经回调输出。
 *
 * 语义：作为前景对话 landmark（role="dialog" + aria-modal），自持初始焦点与 Escape（= 记入待宣）。
 * 视觉上仍是场景内叙事面板（无 .modal-backdrop 遮罩），由各屏置于 SceneShell 的 narrative 槽。
 * 防重复派发：admit/defer 一旦触发即同步上锁（ref），busy/不可承担时禁用对应按钮。
 */
import { useEffect, useId, useRef, useState } from "react";

export interface AudiencePromptProps {
  visitorName: string;
  visitorTitle?: string;
  message: string;
  portraitSrc?: string;
  /** 外部在派发中（如召见传令进行）：禁用两个动作。 */
  busy?: boolean;
  /** 宣入是否可承担（行动力）；false → 宣入禁用并显 disabledReason。缺省 true。 */
  affordable?: boolean;
  disabledReason?: string;
  onAdmit: () => void;
  onDefer: () => void;
}

export function AudiencePrompt({
  visitorName,
  visitorTitle,
  message,
  portraitSrc,
  busy = false,
  affordable = true,
  disabledReason,
  onAdmit,
  onDefer,
}: AudiencePromptProps) {
  const [dispatched, setDispatched] = useState(false);
  const dispatchedRef = useRef(false); // 同步上锁，防同一渲染内连点二次派发
  const admitRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const locked = busy || dispatched;

  const admit = () => {
    if (dispatchedRef.current || busy || !affordable) return;
    dispatchedRef.current = true;
    setDispatched(true);
    onAdmit();
  };
  const defer = () => {
    if (dispatchedRef.current || busy) return;
    dispatchedRef.current = true;
    setDispatched(true);
    onDefer();
  };

  // 初始焦点落在主动作（宣入）。
  useEffect(() => {
    admitRef.current?.focus();
  }, []);

  // Escape = 记入待宣。作用域内注册、卸载即移除（不留全局常驻监听）；ref 取最新 defer 避免闭包陈旧。
  const deferRef = useRef(defer);
  deferRef.current = defer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        deferRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="audience-prompt" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId}>
      {portraitSrc && (
        <img className="audience-prompt__portrait" src={portraitSrc} alt={visitorName} />
      )}
      <div className="audience-prompt__body">
        <p id={titleId} className="audience-prompt__visitor">
          <span className="audience-prompt__name">{visitorName}</span>
          {visitorTitle && <span className="audience-prompt__title">{visitorTitle}</span>}
        </p>
        <p id={descId} className="audience-prompt__message">{message}</p>
        <div className="audience-prompt__actions">
          <button
            ref={admitRef}
            type="button"
            className="action-btn action-btn--key"
            onClick={admit}
            disabled={locked || !affordable}
            title={!affordable ? disabledReason : undefined}
          >
            宣进来
          </button>
          <button type="button" className="action-btn" onClick={defer} disabled={locked}>
            记入待宣
          </button>
          {!affordable && disabledReason && (
            <span className="audience-prompt__reason" role="note">{disabledReason}</span>
          )}
        </div>
      </div>
    </div>
  );
}

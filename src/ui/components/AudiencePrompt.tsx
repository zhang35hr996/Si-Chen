/**
 * 非阻塞候见提示（scene-ui-narrative-refactor §6.2）。司礼/官员等在殿外候见时，以叙事口吻呈现，
 * 玩家可「宣进来」或「记入待宣」。纯展示 + 回调：组件不读/改 store、不查事件、不做导航，动作只经回调输出。
 *
 * 语义：作为前景对话 landmark（role="dialog" + aria-modal），自持焦点与 Escape（= 记入待宣）。
 * 视觉上仍是场景内叙事面板（无 .modal-backdrop 遮罩），由各屏置于 SceneShell 的 narrative 槽。
 *
 * 身份化生命周期：
 *  - 派发锁按 promptId 建模（非一生一次布尔）。父级在同一 JSX 位置把 A 换成 B（复用同实例）时，旧 ID
 *    的锁不会锁住新 B；同一渲染内连点仍由 ref 同步去重。
 *  - 初始/状态变化焦点落在「当前可用」目标：宣入可用→宣入；宣入禁用(不可承担)但待宣可用→待宣；
 *    两者皆禁用(busy)→对话容器（tabIndex=-1）。
 */
import { useEffect, useId, useRef, useState } from "react";

export interface AudiencePromptProps {
  /** 逻辑提示身份（用 AudienceItem.event.id）：决定派发锁与焦点归属随提示切换而重置。 */
  promptId: string;
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
  promptId,
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
  const [dispatchedPromptId, setDispatchedPromptId] = useState<string | null>(null);
  const dispatchedPromptIdRef = useRef<string | null>(null); // 同步去重，防同一渲染连点二次派发
  const admitRef = useRef<HTMLButtonElement>(null);
  const deferActionRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();

  const dispatched = dispatchedPromptId === promptId; // 仅当前 promptId 已派发才算锁定
  const locked = busy || dispatched;

  /** 认领本次 promptId 的唯一派发权（同步）。已派发返回 false。 */
  const claimDispatch = (): boolean => {
    if (dispatchedPromptIdRef.current === promptId) return false;
    dispatchedPromptIdRef.current = promptId;
    setDispatchedPromptId(promptId);
    return true;
  };

  const admit = () => {
    if (busy || !affordable || !claimDispatch()) return;
    onAdmit();
  };
  const defer = () => {
    if (busy || !claimDispatch()) return;
    onDefer();
  };

  // 焦点随逻辑提示/状态变化落到当前可用目标（非仅 mount）。
  useEffect(() => {
    if (!busy && affordable) admitRef.current?.focus();
    else if (!busy) deferActionRef.current?.focus();
    else dialogRef.current?.focus();
  }, [promptId, busy, affordable]);

  // Escape = 记入待宣。作用域内注册、卸载即移除（无全局常驻监听）；callback ref 取最新 defer 避免闭包陈旧。
  const deferCallbackRef = useRef(defer);
  deferCallbackRef.current = defer;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        deferCallbackRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      ref={dialogRef}
      className="audience-prompt"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={-1}
    >
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
          <button ref={deferActionRef} type="button" className="action-btn" onClick={defer} disabled={locked}>
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

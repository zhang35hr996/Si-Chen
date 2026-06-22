/**
 * 待宣事务抽屉（scene-ui-narrative-refactor §6.3）。列出已延期（pending/suppressed）的候见，玩家可
 * 重新「宣进来」。纯展示 + 回调：组件不查 store/ContentDB、不过滤 pending/suppressed、不本地删项、不结算、
 * 不直接启动事件——直接渲染 props.items，动作只经回调输出。视图模型由 ZichendianScreen（或其容器）从
 * 引擎 AudienceItem 映射而来。
 *
 * 前景 sheet/drawer：自持 role="dialog"+aria-modal、初始焦点（关闭按钮，busy 时为对话容器）、Escape=关闭、
 * 抽屉级同步去重（一次开启会话至多一个终结动作）、卸载时把焦点还给开启它的元素。
 */
import { useEffect, useId, useRef, useState } from "react";

export interface PendingAudienceViewItem {
  eventId: string;
  visitorName: string;
  visitorTitle?: string;
  message: string;
  portraitSrc?: string;
  status: "pending" | "suppressed";
  /** 「候见于 X 日」之类的延期标注（展示用，可选）。 */
  deferredLabel?: string;
  affordable: boolean;
  disabledReason?: string;
}

export interface PendingAudienceDrawerProps {
  items: readonly PendingAudienceViewItem[];
  /** 外部派发中：禁用全部动作、焦点落对话容器。 */
  busy?: boolean;
  onAdmit: (eventId: string) => void;
  onClose: () => void;
}

export function PendingAudienceDrawer({ items, busy = false, onAdmit, onClose }: PendingAudienceDrawerProps) {
  const [dispatched, setDispatched] = useState(false);
  const dispatchedRef = useRef(false); // 抽屉级同步去重：一次会话至多一个终结动作
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<Element | null>(null);
  const titleId = useId();
  const locked = busy || dispatched;

  const claim = (): boolean => {
    if (dispatchedRef.current || busy) return false;
    dispatchedRef.current = true;
    setDispatched(true);
    return true;
  };
  const admit = (eventId: string) => {
    if (!claim()) return;
    onAdmit(eventId);
  };
  const close = () => {
    if (!claim()) return;
    onClose();
  };
  const closeCallbackRef = useRef(close);
  closeCallbackRef.current = close;

  // 挂载：记下原焦点元素并把焦点移入抽屉（关闭按钮，busy 时对话容器）；卸载：若原元素仍在文档则还焦。
  useEffect(() => {
    prevFocusRef.current = document.activeElement;
    if (busy) dialogRef.current?.focus();
    else closeBtnRef.current?.focus();
    return () => {
      const prev = prevFocusRef.current as HTMLElement | null;
      if (prev && prev.isConnected && typeof prev.focus === "function") prev.focus();
    };
  }, []);

  // Escape = 关闭。作用域内注册、卸载即移除；callback ref 取最新避免闭包陈旧。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeCallbackRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="pending-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
      <header className="pending-drawer__header">
        <h2 id={titleId} className="pending-drawer__title">待宣事务</h2>
        <button ref={closeBtnRef} type="button" className="action-btn" onClick={close} disabled={locked}>
          关闭
        </button>
      </header>
      <div className="pending-drawer__body">
        {items.length === 0 ? (
          <p className="pending-drawer__empty">当前无待宣事务</p>
        ) : (
          <ul className="pending-drawer__list">
            {items.map((item) => (
              <li key={item.eventId} className="pending-drawer__item" data-status={item.status}>
                {item.portraitSrc && <img className="pending-drawer__portrait" src={item.portraitSrc} alt={item.visitorName} />}
                <div className="pending-drawer__item-body">
                  <p className="pending-drawer__visitor">
                    <span className="pending-drawer__name">{item.visitorName}</span>
                    {item.visitorTitle && <span className="pending-drawer__role">{item.visitorTitle}</span>}
                    {item.deferredLabel && <span className="pending-drawer__deferred">{item.deferredLabel}</span>}
                  </p>
                  <p className="pending-drawer__message">{item.message}</p>
                  <div className="pending-drawer__item-actions">
                    <button
                      type="button"
                      className="action-btn action-btn--key"
                      onClick={() => admit(item.eventId)}
                      disabled={locked || !item.affordable}
                      title={!item.affordable ? item.disabledReason : undefined}
                    >
                      宣进来
                    </button>
                    {!item.affordable && item.disabledReason && (
                      <span className="pending-drawer__reason" role="note">{item.disabledReason}</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

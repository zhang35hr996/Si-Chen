/**
 * 乘风传令谕令菜单（scene-ui-narrative-refactor §6.5 / Task 2.5）。空闲或普通互动时，陛下可「传乘风」，
 * 由御前侍卫总管乘风领旨去办：召见妃嫔 / 调整位分 / 安排迁居 / 赏赐 / 传太医。纯展示 + 回调：组件不读/改
 * store、不查事件、不做导航，每个谕令只经对应回调输出（具体业务仍走既有 applyRankOp/buildRelocate/BestowModal 等）。
 *
 * 语义：全屏模态层（.chengfeng-dispatch-layer：fixed/inset:0，遮挡并拦截背景指针）内置单一对话 landmark
 * （role="dialog" + aria-modal）。自持焦点与 Escape（= 作罢）。一次开启会话至多一个终结动作（抽屉级同步去重）
 * ——选定一道谕令或作罢后即锁死全部控件，避免连点/异步竞态二次派发。`interruptible=false`（关键事件/原子操作
 * 进行中）时五道谕令禁用并显 disabledReason，但终结动作认领前「作罢」仍可用以退出。
 *
 * 焦点归还区分「取消」与「业务交接」：作罢/Escape/外部撤销 → 卸载时还焦给开启者；选定谕令 → 不还焦，让下一个
 * 业务面板（册封/搬迁/赏赐等）自行接管焦点，乘风不抢回旧触发点。
 */
import { useEffect, useId, useRef, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export interface ChengfengDispatchProps {
  /** 当前场景是否可被打断而传令；false（关键事件/原子操作）→ 五道谕令禁用并显 disabledReason。 */
  interruptible: boolean;
  disabledReason?: string;
  onSummonConsort: () => void;
  onSummonHeir?: () => void;
  onManageRank: () => void;
  onBestow: () => void;
  onPhysician: () => void;
  onTransferHaremAdministration?: () => void;
  onClose: () => void;
}

interface Decree {
  label: string;
  run: () => void;
}

export function ChengfengDispatch({
  interruptible,
  disabledReason,
  onSummonConsort,
  onSummonHeir,
  onManageRank,
  onBestow,
  onPhysician,
  onTransferHaremAdministration,
  onClose,
}: ChengfengDispatchProps) {
  const [dispatched, setDispatched] = useState(false);
  const dispatchedRef = useRef(false); // 抽屉级同步去重：一次会话至多一个终结动作
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<Element | null>(null);
  useFocusTrap(dialogRef); // 真模态：Tab/Shift+Tab 循环锁在面板内，焦点不抵达背景控件
  const restoreFocusOnUnmountRef = useRef(true); // 取消路径还焦；选定谕令的业务交接路径不还焦
  const titleId = useId();
  // 五道谕令：不可中断 或 已派发 即禁用；「作罢」仅在已派发（终结动作已用）后禁用——
  // 不可中断时仍是唯一可用控件。一次会话至多一个终结动作。
  const decreesDisabled = dispatched || !interruptible;
  const closeDisabled = dispatched;

  /** 认领唯一终结派发权（同步，先于回调）。已派发返回 false。throw 也不解锁。 */
  const claim = (): boolean => {
    if (dispatchedRef.current) return false;
    dispatchedRef.current = true;
    setDispatched(true);
    return true;
  };
  const runDecree = (run: () => void) => {
    if (!interruptible || !claim()) return;
    restoreFocusOnUnmountRef.current = false; // 业务交接：让下一个业务面板接管焦点
    run();
  };
  const close = () => {
    if (!claim()) return;
    onClose();
  };
  const closeCallbackRef = useRef(close);
  closeCallbackRef.current = close;

  const decrees: Decree[] = [
    { label: "召见侍君", run: onSummonConsort },
    ...(onSummonHeir ? [{ label: "召见皇嗣", run: onSummonHeir }] : []),
    { label: "管理侍君", run: onManageRank },
    { label: "赏赐", run: onBestow },
    { label: "传太医", run: onPhysician },
    ...(onTransferHaremAdministration ? [{ label: "交付六宫主理权", run: onTransferHaremAdministration }] : []),
  ];

  // Effect A：仅 mount/unmount——记下原焦点元素，卸载时按归还策略还焦。取消路径还焦给开启者；
  // 业务交接路径（已选谕令）不还焦，避免从下一个业务面板手里抢回焦点。
  useEffect(() => {
    prevFocusRef.current = document.activeElement;
    return () => {
      if (!restoreFocusOnUnmountRef.current) return;
      const prev = prevFocusRef.current as HTMLElement | null;
      if (prev?.isConnected && typeof prev.focus === "function") prev.focus();
    };
  }, []);

  // Effect B：按当前状态管焦点——已派发→对话容器（不停留在禁用按钮）；不可中断→作罢（唯一可用控件）；
  // 否则→首道谕令。interruptible 动态变化、终结认领后父层未卸载等都会重算。终结锁不随 interruptible 重置。
  useEffect(() => {
    if (dispatched) dialogRef.current?.focus();
    else if (!interruptible) closeBtnRef.current?.focus();
    else firstActionRef.current?.focus();
  }, [interruptible, dispatched]);

  // Escape = 作罢。作用域内注册、卸载即移除（无全局常驻监听）；callback ref 取最新 close 避免闭包陈旧。
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
    // 全屏模态层：遮挡并拦截背景指针；不承担 dialog 语义，仅含唯一 landmark。不在背景点击时关闭。
    <div className="chengfeng-dispatch-layer">
      <div
        ref={dialogRef}
        className="chengfeng-dispatch"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="chengfeng-dispatch__header">
          <h2 id={titleId} className="chengfeng-dispatch__title">传乘风</h2>
          <button ref={closeBtnRef} type="button" className="action-btn" onClick={close} disabled={closeDisabled}>
            作罢
          </button>
        </header>
        <p className="chengfeng-dispatch__framing">
          <span className="chengfeng-dispatch__speaker">乘风</span>
          按刀拱手：「臣在。陛下要传什么谕令？」
        </p>
        <div className="chengfeng-dispatch__menu">
          {decrees.map((decree, i) => (
            <button
              key={decree.label}
              ref={i === 0 ? firstActionRef : undefined}
              type="button"
              className="action-btn action-btn--key"
              onClick={() => runDecree(decree.run)}
              disabled={decreesDisabled}
              title={!interruptible ? disabledReason : undefined}
            >
              {decree.label}
            </button>
          ))}
        </div>
        {!interruptible && disabledReason && (
          <p className="chengfeng-dispatch__reason" role="note">{disabledReason}</p>
        )}
      </div>
    </div>
  );
}

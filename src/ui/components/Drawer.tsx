/**
 * 右侧滑出宽抽屉原语（§八：人物详情 / 国情）。
 * 点击遮罩或关闭按钮收起；内容区滚动。禁止在抽屉内再开抽屉/弹窗。
 */
import type { ReactNode } from "react";

export function Drawer({
  title,
  subtitle,
  onClose,
  tabs,
  width = "wide",
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** 可选：标题下方的标签页条（由调用方自行管理选中态）。 */
  tabs?: ReactNode;
  width?: "wide" | "medium";
  children: ReactNode;
}) {
  return (
    <div className="drawer-scrim" onClick={onClose}>
      <aside
        className={`drawer drawer--${width}`}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer__head">
          <div className="drawer__heading">
            <h2 className="drawer__title">{title}</h2>
            {subtitle && <p className="drawer__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="drawer__close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        {tabs && <div className="drawer__tabs">{tabs}</div>}
        <div className="drawer__body">{children}</div>
      </aside>
    </div>
  );
}

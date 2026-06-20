/**
 * 地图右侧地点信息栏（§三.3）。点击节点先选中→在此展示用途/在场/待办，
 * 再点动作按钮进入；地图节点因此得以保持简洁，不再点击即跳转。
 */
export interface LocationInfo {
  title: string;
  /** 节点类型：当前所在 / 可前往 / 不可达 / 自由查看 / 区域入口。 */
  kind: "here" | "travel" | "blocked" | "free" | "portal";
  description?: string;
  presentCount?: number;
  hasEvent?: boolean;
  reason?: string | null;
  actionLabel: string;
  actionDisabled?: boolean;
  onAction: () => void;
}

export function LocationInfoPanel({ info }: { info: LocationInfo | null }) {
  if (!info) {
    return (
      <aside className="loc-info loc-info--empty">
        <p className="loc-info__hint">点击地图上的地点查看详情。</p>
      </aside>
    );
  }
  return (
    <aside className="loc-info">
      <h3 className="loc-info__title">{info.title}</h3>
      {info.description && <p className="loc-info__desc">{info.description}</p>}

      {info.presentCount !== undefined && info.kind !== "portal" && (
        <p className="loc-info__present">
          {info.presentCount > 0 ? `此处有 ${info.presentCount} 人` : "此处无人"}
        </p>
      )}
      {info.hasEvent && <p className="loc-info__event">● 有要事待陛下处置</p>}
      {info.kind === "blocked" && info.reason && <p className="loc-info__blocked">{info.reason}</p>}

      <button
        type="button"
        className="loc-info__action"
        disabled={info.actionDisabled}
        onClick={info.onAction}
      >
        {info.actionLabel}
      </button>
    </aside>
  );
}

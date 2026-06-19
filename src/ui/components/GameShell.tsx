/**
 * 全局游戏外壳：固定顶栏 + 面包屑 + 主内容区。
 * 各屏把自身内容作为 children 传入，统一日期/行动力/国情/存档与位置导航。
 * gameplay 回调（国情/存档/返回）由各屏从 App 透传，外壳只负责布局与呈现。
 */
import type { ReactNode } from "react";
import type { CalendarState } from "../../engine/calendar/time";
import { TopStatusBar } from "./TopStatusBar";
import { BreadcrumbBar } from "./BreadcrumbBar";

export function GameShell({
  calendar,
  crumbs,
  locationName,
  pregnant,
  onBack,
  onCrumb,
  onOpenResources,
  onOpenSave,
  className,
  children,
}: {
  calendar: CalendarState;
  crumbs: string[];
  /** Top-bar 当前地点. Defaults to the last crumb; override when the breadcrumb
   *  tracks something other than the player's physical location (e.g. the map's
   *  board path). */
  locationName?: string;
  pregnant?: boolean;
  onBack?: () => void;
  onCrumb?: (index: number) => void;
  onOpenResources?: () => void;
  onOpenSave?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const topLocation = locationName ?? crumbs[crumbs.length - 1];
  return (
    <div className={className ? `shell ${className}` : "shell"}>
      <TopStatusBar
        calendar={calendar}
        locationName={topLocation}
        pregnant={pregnant}
        onOpenResources={onOpenResources}
        onOpenSave={onOpenSave}
      />
      <BreadcrumbBar crumbs={crumbs} onBack={onBack} onCrumb={onCrumb} />
      <div className="shell__body">{children}</div>
    </div>
  );
}

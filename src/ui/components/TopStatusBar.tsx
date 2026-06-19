/**
 * 顶部状态栏（固定）：日期·时辰 / 行动力 / 当前地点 / 国情 · 存档。
 * 「返回」不在此处——它属于下方的面包屑（BreadcrumbBar），以免用户不知去向。
 * 「设置」暂无对应系统，故不列入。
 */
import type { CalendarState } from "../../engine/calendar/time";
import { formatGameTime, formatShichen } from "../../engine/calendar/time";

export function TopStatusBar({
  calendar,
  locationName,
  pregnant,
  onOpenResources,
  onOpenSave,
}: {
  calendar: CalendarState;
  locationName?: string;
  pregnant?: boolean;
  onOpenResources?: () => void;
  onOpenSave?: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar__time">
        <span className="topbar__date">{formatGameTime(calendar)}</span>
        <span className="topbar__shichen">{formatShichen(calendar)}</span>
      </div>

      <div className="topbar__center">
        <span className="topbar__ap" title="本日剩余行动力">
          <span className="topbar__ap-label">行动力</span>
          <span className="topbar__ap-val">
            {calendar.ap}
            <i>/{calendar.apMax}</i>
          </span>
        </span>
        {locationName && <span className="topbar__loc">{locationName}</span>}
        {pregnant && <span className="topbar__preg">怀胎</span>}
      </div>

      <nav className="topbar__actions" aria-label="全局">
        {onOpenResources && (
          <button type="button" className="topbar__btn" onClick={onOpenResources}>
            国情
          </button>
        )}
        {onOpenSave && (
          <button type="button" className="topbar__btn" onClick={onOpenSave}>
            存档
          </button>
        )}
      </nav>
    </header>
  );
}

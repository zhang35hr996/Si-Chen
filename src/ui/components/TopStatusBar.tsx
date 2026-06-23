/**
 * 顶部状态栏（固定）：日期·时辰 / 行动力 / 当前地点 / 国情 · 设置。
 * 「返回」不在此处——它属于下方的面包屑（BreadcrumbBar），以免用户不知去向。
 */
import type { CalendarState } from "../../engine/calendar/time";
import { formatGameTime, formatShichen } from "../../engine/calendar/time";

export function TopStatusBar({
  calendar,
  locationName,
  pregnancyMonth,
  onOpenResources,
  onOpenSettings,
  onOpenStorehouse,
}: {
  calendar: CalendarState;
  locationName?: string;
  /** 帝王当前孕月（受孕月=1）；提供时显示「怀胎 · 孕N月」，缺省不显示孕情（pending 披露前不在此暴露）。 */
  pregnancyMonth?: number;
  onOpenResources?: () => void;
  onOpenSettings?: () => void;
  onOpenStorehouse?: () => void;
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
        {pregnancyMonth !== undefined && <span className="topbar__preg">怀胎 · 孕{pregnancyMonth}月</span>}
      </div>

      <nav className="topbar__actions" aria-label="全局">
        {onOpenResources && (
          <button type="button" className="topbar__btn" onClick={onOpenResources}>
            国情
          </button>
        )}
        {onOpenStorehouse && (
          <button type="button" className="topbar__btn" onClick={onOpenStorehouse}>
            国库
          </button>
        )}
        {onOpenSettings && (
          <button type="button" className="topbar__btn" onClick={onOpenSettings}>
            设置
          </button>
        )}
      </nav>
    </header>
  );
}

/**
 * 事件进入方式推导（scene-ui-narrative-refactor 设计规格 §3.1）。
 *
 * `presentation.mode`（content 显式声明）优先；缺省时按 checkpoint + 宿主地点推导，
 * 使旧 content 不写 presentation 也能正确分流。`auto_on_enter` 可由推导得出；
 * `request_audience`/`exploration` 在其宿主地点（紫宸殿/御花园）由推导识别为「需 presentation」
 * （缺失由 validate-content 报错）；`manual` 无推导路径，只有显式声明才属于 manual。
 */
import type { GameEventContent, LocationContent } from "../content/schemas";

export type EventEntryMode =
  | "auto_on_enter"
  | "request_audience"
  | "exploration"
  | "manual"
  | "scheduled";

export function resolveEntryMode(
  event: GameEventContent,
  location: LocationContent | undefined,
): EventEntryMode {
  if (event.presentation) return event.presentation.mode;
  if (event.checkpoint === "court") return "scheduled";
  if (event.checkpoint === "location_enter") {
    if (location?.id === "zichendian") return "request_audience";
    if (location?.id === "yuhuayuan") return "exploration";
    return "auto_on_enter"; // 后宫/普通居所
  }
  return "auto_on_enter"; // game_start / scene_end / time_advance
}

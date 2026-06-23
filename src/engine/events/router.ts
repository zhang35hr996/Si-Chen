/**
 * 中央呈现路由（scene-ui-narrative-refactor 设计规格 §3.2）。
 *
 * `getEligibleEvents` 仍是纯资格判断（checkpoint/once/cooldown/condition）。本模块在其
 * 之上按 `resolveEntryMode` 过滤「可被自动 checkpoint 启动」的事件——**仅 `auto_on_enter`**。
 * `request_audience`/`exploration`/`manual` 绝不被自动拉起（分别由候见、子地点探索、玩家
 * 主动入口呈现）；`scheduled` 由专用入口（上朝）管理。App 的所有自动 checkpoint 调用点
 * （runCheckpoints / game_start / scene_end / time_advance）都应改走此处而非裸 pickNextEvent。
 */
import type { ContentDB } from "../content/loader";
import type { GameEventContent, LocationContent } from "../content/schemas";
import type { GameState } from "../state/types";
import { getEligibleEvents, type Checkpoint } from "./engine";
import { resolveEntryMode } from "./entryMode";

/** 自动 checkpoint 唯一可自动启动的事件：最高优先级、affordable、entryMode==="auto_on_enter"。 */
export function pickAutoStartEvent(
  db: ContentDB,
  state: GameState,
  checkpoint: Checkpoint,
  location: LocationContent | undefined,
): GameEventContent | null {
  return (
    getEligibleEvents(db, state, checkpoint)
      .filter((e) => e.affordable && resolveEntryMode(e.event, location) === "auto_on_enter")
      .map((e) => e.event)[0] ?? null
  );
}

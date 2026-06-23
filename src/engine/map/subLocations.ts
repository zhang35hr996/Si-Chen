/**
 * 御花园子地点事件调度（scene-ui-narrative-refactor §8 / PR3 Task 3.3）。
 * exploration 事件静态绑定 presentation.hostLocationId + subLocationId；进入某子地点时，
 * 在该子地点至多启动一个符合 eligibility 且可承担的 exploration 事件（最高优先级，id 升序破平）。
 * eligibility 一律走 getEligibleEvents 权威规则（含 condition / cooldown / once），不复制判断。
 */
import type { ContentDB } from "../content/loader";
import type { GameEventContent } from "../content/schemas";
import type { GameState } from "../state/types";
import { getEligibleEvents } from "../events/engine";
import { resolveEntryMode } from "../events/entryMode";

export function pickSubLocationEvent(
  db: ContentDB,
  state: GameState,
  locationId: string,
  subLocationId: string,
): GameEventContent | null {
  const loc = db.locations[locationId];
  // **不按 affordable 过滤**：进入子地点是玩家主动探索（类候见），事件「是否存在」与「是否可承担」须分离——
  // 否则 AP 不足会被误表现为「此处无事」。可承担性由调用方据 event.apCost 单独判定（见 subLocationEventAffordable）。
  return getEligibleEvents(db, state, "location_enter")
    .filter((e) => {
      const p = e.event.presentation;
      return (
        resolveEntryMode(e.event, loc) === "exploration" &&
        p?.mode === "exploration" &&
        p.hostLocationId === locationId &&
        p.subLocationId === subLocationId
      );
    })
    .map((e) => e.event)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))[0] ?? null;
}

/** 子地点探索事件此刻是否可承担（行动力）。事件存在但不可承担时，UI 应显「行动力不足」而非「普通游览」。 */
export function subLocationEventAffordable(state: GameState, event: GameEventContent): boolean {
  return event.apCost <= state.calendar.ap;
}

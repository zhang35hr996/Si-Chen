/**
 * 候见呈现生命周期（scene-ui-narrative-refactor 设计规格 §3.3）。
 *
 * 纯函数 + flags 承载（冒号分段），零存档迁移。三态：
 *   available  — 未延期、当前 eligible（主动弹候见提示）
 *   pending    — 已延期且到提醒点（shouldRemind 真，再次主动弹）
 *   suppressed — 已延期未到点（仅在待宣列表，不主动弹）
 *
 * 候见归属由 `presentation.hostLocationId` 静态决定（不依赖 condition.atLocation）；
 * eligibility（condition/cooldown/once）一律走 getEligibleEvents 的权威判断，不复制逻辑。
 */
import type { ContentDB } from "../content/loader";
import type { EventEffect, GameEventContent } from "../content/schemas";
import type { GameState } from "../state/types";
import { hasEventFired } from "./conditions";
import { getEligibleEvents } from "./engine";
import { resolveEntryMode } from "./entryMode";

/** defer 后多少 dayIndex 再主动提醒。1 dayIndex = 1 旬（calendar/time.ts），故 +1 = 下一旬。 */
export const AUDIENCE_REMIND_AFTER_PERIODS = 1;

export type AudienceStatus = "available" | "pending" | "suppressed";

/** UI 唯一消费的候见项：自带收窄 presentation + affordable + 日期，UI 不再读 flags/算 ap。 */
export interface AudienceItem {
  event: GameEventContent;
  presentation: {
    mode: "request_audience";
    hostLocationId: string;
    audienceCharacterId: string;
    audiencePrompt: string;
  };
  status: AudienceStatus;
  affordable: boolean;
  deferredAtDayIndex?: number;
  remindAtDayIndex?: number;
}

const PENDING = (id: string): string => `audience:pending:${id}`;
const SHOWN = (id: string): string => `audience:promptShownAt:${id}`;
const REMIND = (id: string): string => `audience:remindAt:${id}`;

const numFlag = (state: GameState, key: string): number | undefined => {
  const v = state.flags[key];
  return typeof v === "number" ? v : undefined;
};

export function defer(eventId: string, dayIndex: number): EventEffect[] {
  return [
    { type: "flag", key: PENDING(eventId), value: true },
    { type: "flag", key: SHOWN(eventId), value: dayIndex },
    { type: "flag", key: REMIND(eventId), value: dayIndex + AUDIENCE_REMIND_AFTER_PERIODS },
  ];
}

export function clearAudience(eventId: string): EventEffect[] {
  return [
    { type: "flag", key: PENDING(eventId), value: false },
    { type: "flag", key: SHOWN(eventId), value: 0 },
    { type: "flag", key: REMIND(eventId), value: 0 },
  ];
}

export function shouldRemind(state: GameState, eventId: string): boolean {
  if (state.flags[PENDING(eventId)] !== true) return false;
  const remindAt = numFlag(state, REMIND(eventId));
  return remindAt !== undefined && state.calendar.dayIndex >= remindAt;
}

export function audienceStatus(state: GameState, eventId: string): AudienceStatus {
  if (state.flags[PENDING(eventId)] !== true) return "available";
  return shouldRemind(state, eventId) ? "pending" : "suppressed";
}

type RequestAudiencePresentation = AudienceItem["presentation"];

/** 全部候见（三态）：校验 entryMode===request_audience、hostLocationId===locationId、当前 eligibility、once。 */
export function getAudienceQueue(db: ContentDB, state: GameState, locationId: string): AudienceItem[] {
  const loc = db.locations[locationId];
  return getEligibleEvents(db, state, "location_enter")
    .filter((e) => {
      const p = e.event.presentation;
      return (
        resolveEntryMode(e.event, loc) === "request_audience" &&
        p?.mode === "request_audience" &&
        p.hostLocationId === locationId &&
        !(e.event.once && hasEventFired(state, e.event.id))
      );
    })
    .map((e) => ({
      event: e.event,
      presentation: e.event.presentation as RequestAudiencePresentation,
      status: audienceStatus(state, e.event.id),
      affordable: e.affordable,
      deferredAtDayIndex: numFlag(state, SHOWN(e.event.id)),
      remindAtDayIndex: numFlag(state, REMIND(e.event.id)),
    }))
    .sort((a, b) => b.event.priority - a.event.priority || a.event.id.localeCompare(b.event.id));
}

/** 全部候见数（含 available）→「候见之人」。 */
export function audienceCount(db: ContentDB, state: GameState, locationId: string): number {
  return getAudienceQueue(db, state, locationId).length;
}

/** 仅已延期（pending+suppressed）→ 待宣列表（PendingAudienceDrawer 直接消费，不再过滤）。 */
export function getDeferredAudienceQueue(db: ContentDB, state: GameState, locationId: string): AudienceItem[] {
  return getAudienceQueue(db, state, locationId).filter((i) => i.status === "pending" || i.status === "suppressed");
}

export function deferredAudienceCount(db: ContentDB, state: GameState, locationId: string): number {
  return getDeferredAudienceQueue(db, state, locationId).length;
}

/**
 * 对账：清除「属于本 host 但已不合法」的 pending（纯函数，无副作用）。
 * eligibility 走 getEligibleEvents 权威规则；host 不匹配→跳过（不误删他 host）；
 * 事件损坏/缺失/非候见→清；属本 host 但已不 eligible（条件失效/cooldown/once 已发）→清。
 */
export function audienceReconciliationEffects(db: ContentDB, state: GameState, locationId: string): EventEffect[] {
  const validIds = new Set(
    getEligibleEvents(db, state, "location_enter")
      .filter(({ event }) => {
        const p = event.presentation;
        return p?.mode === "request_audience" && p.hostLocationId === locationId;
      })
      .map(({ event }) => event.id),
  );
  const out: EventEffect[] = [];
  for (const key of Object.keys(state.flags)) {
    if (!key.startsWith("audience:pending:") || state.flags[key] !== true) continue;
    const id = key.slice("audience:pending:".length);
    const p = db.events[id]?.presentation;
    if (!db.events[id] || p?.mode !== "request_audience") {
      out.push(...clearAudience(id)); // 损坏/非候见 → 清
      continue;
    }
    if (p.hostLocationId !== locationId) continue; // 属于其它 host → 跳过
    if (!validIds.has(id)) out.push(...clearAudience(id)); // 属本 host 但已不 eligible → 清
  }
  return out;
}

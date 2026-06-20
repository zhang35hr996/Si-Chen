/**
 * Free-view screen (art pass): a location you enter without spending AP or
 * relocating — 冷宫 (look only) and 朝会 (look + 上朝). An optional
 * `actionEventId` surfaces one AP-costing action; its cost/affordability come
 * from the event itself, and starting it runs through the normal scene path.
 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function FreeViewScreen({
  db,
  store,
  registry,
  locationId,
  onStartEvent,
  onClose,
  onOfferIncense,
  onDrawFortune,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  locationId: string;
  onStartEvent: (eventId: string) => void;
  onClose: () => void;
  onOfferIncense?: () => void;
  onDrawFortune?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations[locationId];
  if (!location) {
    return <p className="screen-error">未知地点：{locationId}</p>;
  }
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const action = location.actionEventId ? db.events[location.actionEventId] : undefined;
  const affordable = action ? state.calendar.ap >= action.apCost : false;
  // actionFirstSlotOnly：仅每日首个行动点（卯时早朝，ap===apMax）可行动。
  const slotBlocked = location.actionFirstSlotOnly === true && state.calendar.ap !== state.calendar.apMax;

  return (
    <main className="location-screen">
      <header className="hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatShichen(state.calendar)}
        </span>
        <button type="button" className="hud__button" onClick={onClose}>
          返回
        </button>
      </header>

      <section
        className="location-screen__stage"
        style={{ backgroundImage: `url("${background.url}")` }}
        data-fallback={background.isFallback || undefined}
      >
        <h1 className="location-screen__name">{location.name}</h1>
        <p className="location-screen__desc">{location.description}</p>
        <p className="location-screen__ambience">{location.ambience.join(" · ")}</p>
      </section>

      <section className="location-screen__events">
        {location.id === "simiao" ? (
          <div className="temple-menu">
            <button type="button" disabled={state.calendar.ap < 1} onClick={onOfferIncense}>上香</button>
            <button type="button" disabled={state.calendar.ap < 1} onClick={onDrawFortune}>求签</button>
          </div>
        ) : action ? (
          <>
            <button
              type="button"
              className="location-screen__event"
              disabled={!affordable || slotBlocked}
              onClick={() => onStartEvent(action.id)}
            >
              {action.title}
            </button>
            {slotBlocked && (
              <p className="location-screen__empty">朝时已过，请明日卯时早朝。</p>
            )}
          </>
        ) : (
          <p className="location-screen__empty">此处无人，亦无可为之事。</p>
        )}
      </section>
    </main>
  );
}

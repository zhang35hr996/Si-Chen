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
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  locationId: string;
  onStartEvent: (eventId: string) => void;
  onClose: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations[locationId];
  if (!location) {
    return <p className="screen-error">未知地点：{locationId}</p>;
  }
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const action = location.actionEventId ? db.events[location.actionEventId] : undefined;
  const affordable = action ? state.calendar.ap >= action.apCost : false;

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
        {action ? (
          <button
            type="button"
            className="location-screen__event"
            disabled={!affordable}
            onClick={() => onStartEvent(action.id)}
          >
            {action.title}
          </button>
        ) : (
          <p className="location-screen__empty">此处无人，亦无可为之事。</p>
        )}
      </section>
    </main>
  );
}

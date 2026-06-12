import type { AssetRegistry } from "../../engine/assets/registry";
import { formatAp, formatGameTime } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import { buildTravelBatch, checkTravel } from "../../engine/map/travel";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

const REASON_TEXT: Record<string, string> = {
  ALREADY_THERE: "当前所在",
  NOT_CONNECTED: "无路可达",
  AP_INSUFFICIENT: "行动点不足",
  UNKNOWN_LOCATION: "未知地点",
};

export function MapScreen({
  db,
  store,
  registry,
  onTravelled,
  onClose,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  onTravelled: () => void;
  onClose: () => void;
}) {
  const state = useGameState(store);
  const board = registry.resolve("map.palace", "map");

  const travel = (to: string) => {
    const batch = buildTravelBatch(db, state, to);
    if (!batch.ok) return; // button should be disabled; backstop only
    const result = store.dispatchBatch(batch.value);
    if (result.ok) onTravelled();
  };

  return (
    <main className="map-screen">
      <header className="hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatAp(state.calendar)}
        </span>
        <button type="button" className="hud__button" onClick={onClose}>
          返回
        </button>
      </header>

      <section
        className="map-screen__board"
        aria-label="宫城图"
        style={{ backgroundImage: `url("${board.url}")` }}
      >
        {Object.values(db.locations).map((location) => {
          const here = location.id === state.playerLocation;
          const check = checkTravel(db, state, location.id);
          const reason = check.ok ? null : (REASON_TEXT[check.error.code] ?? check.error.message);
          return (
            <button
              key={location.id}
              type="button"
              className={`map-node${here ? " map-node--here" : ""}`}
              style={{ left: `${location.position.x * 100}%`, top: `${location.position.y * 100}%` }}
              disabled={!check.ok}
              title={check.ok ? `前往（${location.travelCost.ap} 行动点）` : (reason ?? "")}
              onClick={() => travel(location.id)}
            >
              <span className="map-node__name">{location.name}</span>
              <span className="map-node__meta">
                {here ? "当前所在" : check.ok ? `${location.travelCost.ap} 行动点` : reason}
              </span>
            </button>
          );
        })}
      </section>
    </main>
  );
}

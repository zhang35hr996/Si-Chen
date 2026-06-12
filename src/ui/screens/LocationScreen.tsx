import type { AssetRegistry } from "../../engine/assets/registry";
import { formatAp, formatGameTime } from "../../engine/calendar/time";
import { getPresentAt } from "../../engine/characters/presence";
import type { ContentDB } from "../../engine/content/loader";
import { getEligibleEvents } from "../../engine/events/engine";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { CharacterCard } from "../components/CharacterCard";

export function LocationScreen({
  db,
  store,
  registry,
  onOpenMap,
  onStartEvent,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  onOpenMap: () => void;
  onStartEvent: (eventId: string) => void;
}) {
  const state = useGameState(store);
  const location = db.locations[state.playerLocation];
  if (!location) {
    // Loader guarantees startingLocation exists; this is the render-side backstop.
    return <p className="screen-error">未知地点：{state.playerLocation}</p>;
  }
  const present = getPresentAt(db, state, location.id);
  const background = registry.background(location.backgroundKey);
  const eligible = getEligibleEvents(db, state, "location_enter");

  return (
    <main className="location-screen">
      <header className="hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatAp(state.calendar)}
        </span>
        <button type="button" className="hud__button" onClick={onOpenMap}>
          宫城图
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

      {eligible.length > 0 && (
        <section className="location-screen__events">
          {eligible.map(({ event, affordable }) => (
            <button
              key={event.id}
              type="button"
              className="location-screen__event"
              disabled={!affordable}
              title={affordable ? `耗费 ${event.apCost} 行动点` : "行动点不足"}
              onClick={() => onStartEvent(event.id)}
            >
              {event.title}（{event.apCost} 行动点{affordable ? "" : " · 行动点不足"}）
            </button>
          ))}
        </section>
      )}

      <section className="location-screen__present">
        {present.length === 0 ? (
          <p className="location-screen__empty">此处无人。</p>
        ) : (
          present.map((character) => (
            <CharacterCard
              key={character.id}
              db={db}
              state={state}
              registry={registry}
              character={character}
            />
          ))
        )}
      </section>
    </main>
  );
}

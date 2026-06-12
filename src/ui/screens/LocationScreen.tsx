import type { AssetRegistry } from "../../engine/assets/registry";
import { formatAp, formatGameTime } from "../../engine/calendar/time";
import { getPresentAt } from "../../engine/characters/presence";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { CharacterCard } from "../components/CharacterCard";

export function LocationScreen({
  db,
  store,
  registry,
  onOpenMap,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  onOpenMap: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations[state.playerLocation];
  if (!location) {
    // Loader guarantees startingLocation exists; this is the render-side backstop.
    return <p className="screen-error">未知地点：{state.playerLocation}</p>;
  }
  const present = getPresentAt(db, state, location.id);
  const background = registry.background(location.backgroundKey);

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

import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import { getPresentAt } from "../../engine/characters/presence";
import { resolveDisplayName, effectiveOrder } from "../../engine/characters/standing";
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
  onOpenSave,
  onStartEvent,
  onManage,
  onBedchamber,
  onFlipTablet,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  onOpenMap: () => void;
  onOpenSave: () => void;
  onStartEvent: (eventId: string) => void;
  onManage?: (charId: string) => void;
  onBedchamber?: (charId: string) => void;
  onFlipTablet?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations[state.playerLocation];
  if (!location) {
    // Loader guarantees startingLocation exists; this is the render-side backstop.
    return <p className="screen-error">未知地点：{state.playerLocation}</p>;
  }
  const present = getPresentAt(db, state, location.id);
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const eligible = getEligibleEvents(db, state, "location_enter");
  const canBedchamber = state.calendar.ap >= 1;

  return (
    <main className="location-screen">
      <header className="hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatShichen(state.calendar)}
        </span>
        {state.resources.bloodline.gestation?.carrier === "sovereign" && (
          <span className="hud__pregnancy">怀胎</span>
        )}
        <span className="hud__group">
          <button type="button" className="hud__button" onClick={onOpenSave}>
            存档
          </button>
          <button type="button" className="hud__button" onClick={onOpenMap}>
            宫城图
          </button>
        </span>
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
              title={affordable ? event.title : "行动点不足"}
              onClick={() => onStartEvent(event.id)}
            >
              {event.title}
              {affordable ? "" : "（行动点不足）"}
            </button>
          ))}
        </section>
      )}

      {location.id === "yushufang" && (
        <section className="location-screen__roster">
          <h2>
            后宫名册
            {onFlipTablet && (
              <button
                type="button"
                className="location-screen__flip"
                disabled={!canBedchamber}
                title={canBedchamber ? "翻牌子" : "行动点不足"}
                onClick={onFlipTablet}
              >
                翻牌子{canBedchamber ? "" : "（行动点不足）"}
              </button>
            )}
          </h2>
          {Object.values(db.characters)
            .filter((c) => c.kind === "consort" && c.id !== "feng_hou")
            .sort((a, b) => {
              const ra = state.standing[a.id], rb = state.standing[b.id];
              if (!ra || !rb) return 0; // consort without standing (e.g. added post-save) sorts neutrally
              return effectiveOrder(db.ranks[rb.rank]!, rb.title !== undefined) -
                     effectiveOrder(db.ranks[ra.rank]!, ra.title !== undefined);
            })
            .map((c) => {
              const st = state.standing[c.id]!;
              return (
                <div key={c.id} className="roster-row">
                  <span>{resolveDisplayName(c, st, db.ranks[st.rank])}</span>
                  <span className="roster-row__rank">{db.ranks[st.rank]?.name}{st.title ? `·封号「${st.title}」` : ""}</span>
                  {onManage && <button type="button" onClick={() => onManage(c.id)}>管理</button>}
                </div>
              );
            })}
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
              onManage={onManage ? () => onManage(character.id) : undefined}
              onBedchamber={
                onBedchamber && character.kind === "consort" && canBedchamber
                  ? () => onBedchamber(character.id)
                  : undefined
              }
            />
          ))
        )}
      </section>
    </main>
  );
}

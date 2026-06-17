import { useEffect, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import { getPresentAt } from "../../engine/characters/presence";
import { resolveDisplayName, effectiveOrder } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import { getEligibleEvents } from "../../engine/events/engine";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { canSummon } from "../../store/bedchamber";
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
  onSummonZongzheng,
  onSummonPhysician,
  onOpenHeirs,
  onAddCandidate,
  onRemoveCandidate,
  onReviewMemorials,
  onRestAlone,
  onConverse,
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
  onSummonZongzheng?: () => void;
  onSummonPhysician?: () => void;
  onOpenHeirs?: () => void;
  onAddCandidate?: (charId: string) => void;
  onRemoveCandidate?: (charId: string) => void;
  onReviewMemorials?: () => void;
  onRestAlone?: () => void;
  onConverse?: (charId: string) => void;
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
  // 候选承嗣注释管理：仅在帝王自身有孕（pending/carrying）时可用。
  const sovereignPregnant = state.resources.bloodline.pregnancy.status !== "none";

  // 事件对话以阻断式覆盖层呈现；「稍后再说」可临时收起。换地图即重置，
  // 当前地图的事件不带到下一张地图（eligible 按地点重算）。
  const [eventsDismissed, setEventsDismissed] = useState(false);
  useEffect(() => {
    setEventsDismissed(false);
  }, [state.playerLocation]);

  return (
    <main className="location-screen">
      <header className="hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatShichen(state.calendar)}
        </span>
        {state.resources.bloodline.gestations.some((g) => g.carrier === "sovereign") && (
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


      {location.id === "yushufang" && (onReviewMemorials || onRestAlone) && (
        <section className="yushufang-menu">
          <h2>行动</h2>
          <div className="yushufang-actions">
            {onReviewMemorials && (
              <button type="button" disabled={state.calendar.ap < 2} onClick={onReviewMemorials}>
                批阅奏折
              </button>
            )}
            {onRestAlone && (
              <button type="button" title="弃当旬剩余行动点，直接进入次旬" onClick={onRestAlone}>
                独自休息
              </button>
            )}
          </div>
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
                onClick={onFlipTablet}
              >
                翻牌子
              </button>
            )}
          </h2>
          <div className="yushufang-actions">
            {onSummonPhysician && (
              <button type="button" onClick={onSummonPhysician}>召见太医</button>
            )}
            {onSummonZongzheng && (
              <button type="button" onClick={onSummonZongzheng}>召见宗正寺</button>
            )}
            {onOpenHeirs && (
              <button type="button" onClick={onOpenHeirs}>子嗣</button>
            )}
          </div>
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
              const lc = st.lifecycle;
              const lcLabel =
                lc === "carrying" ? "·承嗣君·怀胎" :
                lc === "delivered" ? "·育嗣君" :
                lc === "candidate" ? "·候选承嗣" :
                lc === "deceased" ? "·已故" : "";
              return (
                <div key={c.id} className="roster-row">
                  <span>{resolveDisplayName(c, st, db.ranks[st.rank])}</span>
                  <span className="roster-row__rank">
                    {db.ranks[st.rank]?.name}
                    {st.title ? `·封号「${st.title}」` : ""}
                    {lcLabel}
                  </span>
                  {sovereignPregnant && st.lifecycle === "candidate" && onRemoveCandidate && (
                    <button type="button" onClick={() => onRemoveCandidate(c.id)}>取消候选</button>
                  )}
                  {sovereignPregnant &&
                    (st.lifecycle === undefined || st.lifecycle === "normal") &&
                    onAddCandidate && (
                      <button type="button" onClick={() => onAddCandidate(c.id)}>设为候选承嗣</button>
                    )}
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
                onBedchamber && character.kind === "consort" && canBedchamber && canSummon(state, character.id)
                  ? () => onBedchamber(character.id)
                  : undefined
              }
              onConverse={
                onConverse && character.kind === "consort" && canBedchamber && canSummon(state, character.id)
                  ? () => onConverse(character.id)
                  : undefined
              }
            />
          ))
        )}
      </section>

      {eligible.length > 0 && !eventsDismissed && (
        <div className="modal-backdrop">
          <div className="event-overlay" onClick={(e) => e.stopPropagation()}>
            <h2 className="event-overlay__title">{location.name}　有事相询</h2>
            <p className="event-overlay__hint">此处有要事待陛下处置：</p>
            <div className="event-overlay__choices">
              {eligible.map(({ event, affordable }) => (
                <button
                  key={event.id}
                  type="button"
                  disabled={!affordable}
                  onClick={() => onStartEvent(event.id)}
                >
                  {event.title}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="event-overlay__later"
              onClick={() => setEventsDismissed(true)}
            >
              稍后再说
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

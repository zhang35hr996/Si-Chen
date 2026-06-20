import { useEffect, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import { getPresentAt } from "../../engine/characters/presence";
import type { ContentDB } from "../../engine/content/loader";
import { getEligibleEvents } from "../../engine/events/engine";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { canSummon } from "../../store/bedchamber";
import { hasChambers } from "../../engine/characters/chambers";
import { CharacterCard } from "../components/CharacterCard";
import { GameShell } from "../components/GameShell";
import { breadcrumbFor } from "../components/breadcrumb";
import { CharacterScene } from "./CharacterScene";

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
  onOpenConsorts,
  onReviewMemorials,
  onRestAlone,
  onConverse,
  onOpenResources,
  onViewProfile,
  summonedConsortId,
  onDismissSummon,
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
  onOpenConsorts?: () => void;
  onReviewMemorials?: () => void;
  onRestAlone?: () => void;
  onConverse?: (charId: string) => void;
  onOpenResources?: () => void;
  onViewProfile?: (charId: string) => void;
  summonedConsortId?: string | null;
  onDismissSummon?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations[state.playerLocation];

  // 事件对话以阻断式覆盖层呈现；「稍后再说」可临时收起。换地图即重置。
  const [eventsDismissed, setEventsDismissed] = useState(false);
  useEffect(() => {
    setEventsDismissed(false);
  }, [state.playerLocation]);

  if (!location) {
    // Loader guarantees startingLocation exists; this is the render-side backstop.
    return <p className="screen-error">未知地点：{state.playerLocation}</p>;
  }
  const present = getPresentAt(db, state, location.id);
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const eligible = getEligibleEvents(db, state, "location_enter");
  const canBedchamber = state.calendar.ap >= 1;
  // 召见到御书房：把被召见的侍君并入在场（仅御书房）。
  const summoned =
    location.id === "zichendian" && summonedConsortId ? db.characters[summonedConsortId] : undefined;

  // 居所宫殿（后宫）有住客侍君 → 视觉小说场景；设宫室的居所即便空置也进场景（显示 5 宫室槽）。
  const sceneConsorts = location.zone === "hougong" ? present.filter((c) => c.kind === "consort") : [];
  const showScene = sceneConsorts.length > 0 || hasChambers(location.id);

  const crumbs = breadcrumbFor(db, location.id);
  const pregnant = state.resources.bloodline.gestations.some((g) => g.carrier === "sovereign");

  return (
    <GameShell
      calendar={state.calendar}
      crumbs={crumbs}
      pregnant={pregnant}
      onBack={onOpenMap}
      onOpenResources={onOpenResources}
      onOpenSave={onOpenSave}
      className="location-shell"
    >
      {showScene && onViewProfile ? (
        <CharacterScene
          key={location.id}
          db={db}
          state={state}
          registry={registry}
          location={location}
          consorts={sceneConsorts}
          onConverse={onConverse}
          onBedchamber={onBedchamber}
          onViewProfile={onViewProfile}
          onManage={onManage}
        />
      ) : (
        <main className="location-screen">
          <section
            className="location-screen__stage"
            style={{ backgroundImage: `url("${background.url}")` }}
            data-fallback={background.isFallback || undefined}
          >
            <h1 className="location-screen__name">{location.name}</h1>
            <p className="location-screen__desc">{location.description}</p>
            <p className="location-screen__ambience">{location.ambience.join(" · ")}</p>
          </section>

          {location.id === "zichendian" && (
            <section className="yushufang-menu">
              <div className="yushufang-actions">
                {onReviewMemorials && (
                  <button type="button" disabled={state.calendar.ap < 2} onClick={onReviewMemorials}>
                    奏折
                  </button>
                )}
                {onRestAlone && (
                  <button type="button" title="弃当旬剩余行动点，直接进入次旬" onClick={onRestAlone}>
                    休息
                  </button>
                )}
                {onOpenHeirs && (
                  <button type="button" onClick={onOpenHeirs}>
                    查看子嗣
                  </button>
                )}
                {onOpenConsorts && (
                  <button type="button" onClick={onOpenConsorts}>
                    查看侍君
                  </button>
                )}
                {onFlipTablet && (
                  <button type="button" disabled={!canBedchamber} onClick={onFlipTablet}>
                    翻牌子
                  </button>
                )}
              </div>
              {(onSummonPhysician || onSummonZongzheng) && (
                <div className="yushufang-actions yushufang-actions--minor">
                  {onSummonPhysician && (
                    <button type="button" onClick={onSummonPhysician}>
                      召见太医
                    </button>
                  )}
                  {onSummonZongzheng && (
                    <button type="button" onClick={onSummonZongzheng}>
                      召见宗正寺
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          <section className="location-screen__present">
            {summoned && (
              <div className="summoned-consort">
                <CharacterCard
                  db={db}
                  state={state}
                  registry={registry}
                  character={summoned}
                  onManage={onManage ? () => onManage(summoned.id) : undefined}
                  onBedchamber={
                    onBedchamber && canBedchamber && canSummon(state, summoned.id)
                      ? () => onBedchamber(summoned.id)
                      : undefined
                  }
                  onConverse={
                    onConverse && canBedchamber && canSummon(state, summoned.id)
                      ? () => onConverse(summoned.id)
                      : undefined
                  }
                  onViewProfile={onViewProfile ? () => onViewProfile(summoned.id) : undefined}
                />
                {onDismissSummon && (
                  <button type="button" className="summoned-consort__dismiss" onClick={onDismissSummon}>
                    退下
                  </button>
                )}
              </div>
            )}
            {present.length === 0 && !summoned ? (
              <p className="location-screen__empty">此处无人。</p>
            ) : (
              present
                .filter((character) => character.id !== summoned?.id)
                .map((character) => (
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
                    onViewProfile={onViewProfile ? () => onViewProfile(character.id) : undefined}
                  />
                ))
            )}
          </section>
        </main>
      )}

      {eligible.length > 0 && !eventsDismissed && (
        <div className="modal-backdrop">
          <div className="event-overlay" onClick={(e) => e.stopPropagation()}>
            <h2 className="event-overlay__title">{location.name}　有事相询</h2>
            <p className="event-overlay__hint">此处有要事待陛下处置：</p>
            <div className="event-overlay__choices">
              {eligible.map(({ event, affordable }) => (
                <button key={event.id} type="button" disabled={!affordable} onClick={() => onStartEvent(event.id)}>
                  {event.title}
                </button>
              ))}
            </div>
            <button type="button" className="event-overlay__later" onClick={() => setEventsDismissed(true)}>
              稍后再说
            </button>
          </div>
        </div>
      )}
    </GameShell>
  );
}

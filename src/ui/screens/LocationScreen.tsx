import { useEffect, useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay, isGreetingSlot } from "../../engine/calendar/time";
import { getPresentAt, absentAt } from "../../engine/characters/presence";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { hasChambers } from "../../engine/characters/chambers";
import { GameShell } from "../components/GameShell";
import { SceneCharacterBar } from "../components/SceneCharacterBar";
import { SceneFocusedCharacter } from "../components/SceneFocusedCharacter";
import { presentBarItems, focusedCharacterView, reconcileSelection } from "../sceneView";
import { breadcrumbFor } from "../components/breadcrumb";
import { sovereignGestationDisplay } from "../format/gestationDisplay";
import { CharacterScene } from "./CharacterScene";

export function LocationScreen({
  db,
  store,
  registry,
  onOpenMap,
  onOpenSettings,
  onManage,
  onRelocate,
  onBedchamber,
  onConverse,
  onOpenResources,
  onOpenStorehouse,
  onViewProfile,
  focusConsortId,
  greetingAttendeeCount,
  onEnterGreeting,
  onExitGreeting,
  onLeavePalace,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  onOpenMap: () => void;
  onOpenSettings: () => void;
  onManage?: (charId: string) => void;
  onRelocate?: (charId: string) => void;
  onBedchamber?: (charId: string) => void;
  onConverse?: (charId: string) => void;
  onOpenResources?: () => void;
  onOpenStorehouse?: () => void;
  onViewProfile?: (charId: string) => void;
  focusConsortId?: string | null;
  greetingAttendeeCount?: number;
  onEnterGreeting?: () => void;
  onExitGreeting?: () => void;
  onLeavePalace?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations[state.playerLocation];

  // 场景人物条选中态（仅普通地点的聚焦立绘用）。换地点清空。
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedId(null);
  }, [state.playerLocation]);

  if (!location) {
    // Loader guarantees startingLocation exists; this is the render-side backstop.
    return <p className="screen-error">未知地点：{state.playerLocation}</p>;
  }
  const roster = getPresentAt(db, state, location.id); // 住处花名册（谁住这）
  const absence = absentAt(db, state, location.id); // charId → 去向 locationId
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const greetingHere =
    location.id === "kunninggong" &&
    isGreetingSlot(state.calendar) &&
    (greetingAttendeeCount ?? 0) > 0;

  // 普通地点场景人物条（单一权威：presentAt 物理在场，绝不用住处花名册填充在场）。
  const presentItems = presentBarItems(db, state, location.id);
  const presentIds = presentItems.map((i) => i.id);
  // 选中态调和：曾选中者离开 → 取下一个真实在场人物；无人 → 空。初始未选 → 不强选。
  const effectiveSelectedId = selectedId == null ? null : reconcileSelection(presentIds, selectedId);
  const focused = effectiveSelectedId ? focusedCharacterView(db, state, registry, effectiveSelectedId) : undefined;

  // 居所宫殿（后宫）有住客侍君 → 视觉小说场景；设宫室的居所即便空置也进场景（显示 5 宫室槽）。
  const sceneConsorts = location.zone === "hougong" ? roster.filter((c) => c.kind === "consort") : [];
  const showScene = sceneConsorts.length > 0 || hasChambers(location.id);

  const crumbs = breadcrumbFor(db, location.id);

  return (
    <GameShell
      calendar={state.calendar}
      crumbs={crumbs}
      pregnancyMonth={sovereignGestationDisplay(state)?.month ?? undefined}
      onBack={onLeavePalace ?? onOpenMap}
      onOpenResources={onOpenResources}
      onOpenStorehouse={onOpenStorehouse}
      onOpenSettings={onOpenSettings}
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
          absence={absence}
          focusConsortId={focusConsortId}
          onConverse={onConverse}
          onBedchamber={onBedchamber}
          onViewProfile={onViewProfile}
          onManage={onManage}
          onRelocate={onRelocate}
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

          {focused && onViewProfile && (
            <SceneFocusedCharacter
              view={focused}
              onConverse={onConverse}
              onBedchamber={onBedchamber}
              onViewProfile={onViewProfile}
              onManage={onManage}
              onRelocate={onRelocate}
            />
          )}

          <section className="location-screen__bar">
            <SceneCharacterBar
              characters={presentItems}
              selectedId={effectiveSelectedId}
              onFocus={setSelectedId}
            />
          </section>
        </main>
      )}

      {greetingHere && onEnterGreeting && onExitGreeting && (
        <div className="modal-backdrop">
          <div className="event-overlay" onClick={(e) => e.stopPropagation()}>
            <h2 className="event-overlay__title">坤宁宫　晨省</h2>
            <p className="event-overlay__hint">乘风躬身：「众侍君正给皇后请安，陛下是否去看看？」</p>
            <div className="event-overlay__choices">
              <button type="button" onClick={onEnterGreeting}>
                进入主殿（耗一个行动点）
              </button>
            </div>
            <button type="button" className="event-overlay__later" onClick={onExitGreeting}>
              退出坤宁宫
            </button>
          </div>
        </div>
      )}
    </GameShell>
  );
}

/** 毓庆宫：未成年皇嗣居所（皇子≥5、皇郎≥7 迁居于此）。列出在居皇嗣，可「召见」（heir_summon）。1 AP。 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import { heirAge, listHeirsBySex, residesInYuqing } from "../../engine/characters/heirs";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { GameShell } from "../components/GameShell";
import { breadcrumbFor } from "../components/breadcrumb";

export function YuqingGongScreen({
  db, store, registry, onOpenMap, onOpenSettings, onSummon, onOpenResources,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSettings: () => void;
  onSummon: (heirId: string) => void; onOpenResources?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations["yuqing_gong"]!;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const resident = [
    ...listHeirsBySex(state.resources.bloodline.heirs, "daughter"),
    ...listHeirsBySex(state.resources.bloodline.heirs, "son"),
  ].filter((r) => residesInYuqing(r.heir, state.calendar));
  const canAct = state.calendar.ap >= 1;

  return (
    <GameShell
      calendar={state.calendar}
      crumbs={breadcrumbFor(db, location.id)}
      onBack={onOpenMap}
      onOpenResources={onOpenResources}
      onOpenSettings={onOpenSettings}
    >
      <main className="location-screen">
        <section className="location-screen__stage" style={{ backgroundImage: `url("${background.url}")` }} data-fallback={background.isFallback || undefined}>
          <h1 className="location-screen__name">{location.name}</h1>
          <p className="location-screen__desc">{location.description}</p>
          <p className="location-screen__ambience">{location.ambience.join(" · ")}</p>
        </section>
        <section className="location-screen__roster">
          <h2>在居皇嗣</h2>
          {resident.length === 0 ? (
            <p className="location-screen__empty">尚无皇嗣迁居于此。</p>
          ) : (
            resident.map(({ heir, name }) => (
              <div key={heir.id} className="roster-row">
                <span>{name}{heir.givenName ? `·${heir.givenName}` : ""}　{heirAge(heir, state.calendar)}岁</span>
                <button type="button" disabled={!canAct} onClick={() => onSummon(heir.id)}>召见</button>
              </div>
            ))
          )}
        </section>
      </main>
    </GameShell>
  );
}

/** 上书房：列开蒙皇嗣，可「问功课」（heir_educate）或「问先生」（汇报）。均 1 AP。 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import { isEnrolled, listHeirsBySex } from "../../engine/characters/heirs";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { sovereignGestationDisplay } from "../format/gestationDisplay";
import { GameShell } from "../components/GameShell";
import { breadcrumbFor } from "../components/breadcrumb";

export function ShangshufangScreen({
  db, store, registry, onOpenMap, onOpenSettings, onLesson, onTutorReport,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSettings: () => void;
  onLesson: (heirId: string) => void; onTutorReport: (heirId: string) => void;
}) {
  const state = useGameState(store);
  const location = db.locations["wenzhaodian"]!;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const enrolled = [...listHeirsBySex(state.resources.bloodline.heirs, "daughter"), ...listHeirsBySex(state.resources.bloodline.heirs, "son")]
    .filter((r) => isEnrolled(r.heir, state.calendar));
  const canAct = state.calendar.ap >= 1;

  return (
    <GameShell
      calendar={state.calendar}
      crumbs={breadcrumbFor(db, location.id)}
      pregnancyMonth={sovereignGestationDisplay(state)?.month ?? undefined}
      onBack={onOpenMap}
      onOpenSettings={onOpenSettings}
    >
      <main className="location-screen">
        <section className="location-screen__stage" style={{ backgroundImage: `url("${background.url}")` }} data-fallback={background.isFallback || undefined}>
          <h1 className="location-screen__name">{location.name}</h1>
          <p className="location-screen__desc">{location.description}</p>
        </section>
        <section className="location-screen__roster">
          <h2>开蒙皇嗣</h2>
          {enrolled.length === 0 ? (
            <p className="location-screen__empty">尚无皇嗣开蒙。</p>
          ) : (
            enrolled.map(({ heir, name }) => (
              <div key={heir.id} className="roster-row">
                <span>{name}{heir.givenName ? `·${heir.givenName}` : ""}</span>
                <button type="button" disabled={!canAct} onClick={() => onLesson(heir.id)}>问功课</button>
                <button type="button" disabled={!canAct} onClick={() => onTutorReport(heir.id)}>问先生</button>
              </div>
            ))
          )}
        </section>
      </main>
    </GameShell>
  );
}

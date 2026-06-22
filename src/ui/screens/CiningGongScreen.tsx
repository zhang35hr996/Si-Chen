/** 慈宁宫：太后所居。可「与太后叙话」（ev_taihou_converse）。1 AP。 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { GameShell } from "../components/GameShell";
import { breadcrumbFor } from "../components/breadcrumb";

export function CiningGongScreen({
  db, store, registry, onOpenMap, onOpenSettings, onConverse, onOpenResources, onOpenStorehouse,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSettings: () => void; onConverse: () => void; onOpenResources?: () => void; onOpenStorehouse?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations["cining_gong"]!;
  const taihou = db.characters["taihou"]!;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const portrait = registry.portrait(taihou.portraitSet, "neutral");
  const canAct = state.calendar.ap >= 1;
  const ill = state.taihou.healthStatus !== "healthy";

  return (
    <GameShell
      calendar={state.calendar}
      crumbs={breadcrumbFor(db, location.id)}
      onBack={onOpenMap}
      onOpenResources={onOpenResources}
      onOpenStorehouse={onOpenStorehouse}
      onOpenSettings={onOpenSettings}
    >
      <main className="location-screen">
        <section className="location-screen__stage" style={{ backgroundImage: `url("${background.url}")` }} data-fallback={background.isFallback || undefined}>
          <h1 className="location-screen__name">{location.name}</h1>
          <p className="location-screen__desc">{location.description}</p>
          <p className="location-screen__ambience">{location.ambience.join(" · ")}</p>
        </section>
        <section className="location-screen__present">
          <article className="char-card">
            <img className="char-card__portrait" src={portrait.url} alt={taihou.profile.name} data-fallback={portrait.isFallback || undefined} />
            <header className="char-card__header">
              <strong className="char-card__name">{taihou.profile.name}</strong>
              <span className="char-card__kind">尊长</span>
            </header>
            <p className="char-card__role">{taihou.profile.role}</p>
            {ill && <p className="char-card__lifecycle" data-lifecycle="ill">凤体违和</p>}
            <button type="button" className="char-card__converse" disabled={!canAct} onClick={onConverse}>与太后叙话</button>
          </article>
        </section>
      </main>
    </GameShell>
  );
}

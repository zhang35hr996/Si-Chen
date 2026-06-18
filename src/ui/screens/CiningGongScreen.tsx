/** 慈宁宫：太后所居。可「与太后叙话」（ev_taihou_converse）。1 AP。 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function CiningGongScreen({
  db, store, registry, onOpenMap, onOpenSave, onConverse, onOpenResources,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSave: () => void; onConverse: () => void; onOpenResources?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations["cining_gong"]!;
  const taihou = db.characters["taihou"]!;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const portrait = registry.portrait(taihou.portraitSet, "neutral");
  const canAct = state.calendar.ap >= 1;

  return (
    <main className="location-screen">
      <header className="hud">
        <span className="hud__time">{formatGameTime(state.calendar)} · {formatShichen(state.calendar)}</span>
        <span className="hud__group">
          {onOpenResources && (<button type="button" className="hud__button" onClick={onOpenResources}>国情</button>)}
          <button type="button" className="hud__button" onClick={onOpenSave}>存档</button>
          <button type="button" className="hud__button" onClick={onOpenMap}>宫城图</button>
        </span>
      </header>
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
          {/* 凤体违和提示在后续任务接入 */}
          <button type="button" className="char-card__converse" disabled={!canAct} onClick={onConverse}>与太后叙话（1行动点）</button>
        </article>
      </section>
    </main>
  );
}

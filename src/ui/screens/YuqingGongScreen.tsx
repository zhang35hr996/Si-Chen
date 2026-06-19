/** 毓庆宫：未成年皇嗣居所（皇子≥5、皇郎≥7 迁居于此）。列出在居皇嗣，可「召见」（heir_summon）。1 AP。 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import { heirAge, listHeirsBySex, residesInYuqing } from "../../engine/characters/heirs";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";

export function YuqingGongScreen({
  db, store, registry, onOpenMap, onOpenSave, onSummon, onOpenResources,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSave: () => void;
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
  );
}

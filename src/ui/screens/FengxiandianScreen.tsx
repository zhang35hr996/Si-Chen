/** 奉先殿：择一皇嗣 → 择一养父（在宫侍君+凤后），告于宗庙。1 AP。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import { listHeirsBySex } from "../../engine/characters/heirs";
import { resolveIdentityLabel } from "../../engine/characters/standing";
import { eligibleAdoptiveFathers } from "../../store/adoption";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { GameShell } from "../components/GameShell";
import { breadcrumbFor } from "../components/breadcrumb";

export function FengxiandianScreen({
  db, store, registry, onOpenMap, onOpenSettings, onAdopt,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSettings: () => void;
  onAdopt: (heirId: string, fatherId: string) => void;
}) {
  const state = useGameState(store);
  const location = db.locations["fengxiandian"]!;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const heirs = [...listHeirsBySex(state.resources.bloodline.heirs, "daughter"), ...listHeirsBySex(state.resources.bloodline.heirs, "son")];
  const fathers = eligibleAdoptiveFathers(db, state);
  const [picked, setPicked] = useState<string | null>(null);
  const canAct = state.calendar.ap >= 1;

  const fatherName = (charId: string): string => {
    const st = state.standing[charId];
    return resolveIdentityLabel(db.characters[charId]!, st, st ? db.ranks[st.rank] : undefined);
  };

  return (
    <GameShell
      calendar={state.calendar}
      crumbs={breadcrumbFor(db, location.id)}
      onBack={onOpenMap}
      onOpenSettings={onOpenSettings}
    >
      <main className="location-screen">
        <section className="location-screen__stage" style={{ backgroundImage: `url("${background.url}")` }} data-fallback={background.isFallback || undefined}>
          <h1 className="location-screen__name">{location.name}</h1>
          <p className="location-screen__desc">{location.description}</p>
        </section>
        <section className="location-screen__roster">
          <h2>为皇嗣择养父</h2>
          {heirs.length === 0 ? (
            <p className="location-screen__empty">尚无皇嗣。</p>
          ) : (
            heirs.map(({ heir, name }) => (
              <div key={heir.id} className="roster-row">
                <span>{name}{heir.givenName ? `·${heir.givenName}` : ""}
                  {heir.adoptiveFatherId ? `（养父：${fatherName(heir.adoptiveFatherId)}）` : ""}
                </span>
                <button type="button" disabled={!canAct} onClick={() => setPicked(heir.id)}>择养父</button>
              </div>
            ))
          )}
        </section>
      </main>

      {picked && (
        <div className="modal-backdrop" onClick={() => setPicked(null)}>
          <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
            <h2>择养父</h2>
            {fathers.map((c) => (
              <button key={c.id} type="button" onClick={() => { onAdopt(picked, c.id); setPicked(null); }}>
                {fatherName(c.id)}
              </button>
            ))}
            <button type="button" onClick={() => setPicked(null)}>取消</button>
          </div>
        </div>
      )}
    </GameShell>
  );
}

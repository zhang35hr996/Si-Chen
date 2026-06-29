/** 奉先殿：为皇嗣指定或更改抚养人。1 AP。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import { listHeirsBySex } from "../../engine/characters/heirs";
import { resolveIdentityLabel } from "../../engine/characters/standing";
import { eligibleCustodiansForHeir } from "../../store/heirCustody";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import type { Heir } from "../../engine/state/types";
import { useGameState } from "../../store/useGameState";
import { sovereignGestationDisplay } from "../format/gestationDisplay";
import { GameShell } from "../components/GameShell";
import { breadcrumbFor } from "../components/breadcrumb";

export function FengxiandianScreen({
  db, store, registry, onOpenMap, onOpenSettings, onTransferCustody,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSettings: () => void;
  onTransferCustody: (heirId: string, custodianId: string) => void;
}) {
  const state = useGameState(store);
  const location = db.locations["fengxiandian"]!;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");
  const heirs = [...listHeirsBySex(state.resources.bloodline.heirs, "daughter"), ...listHeirsBySex(state.resources.bloodline.heirs, "son")];
  const [pickedHeirId, setPickedHeirId] = useState<string | null>(null);
  const canAct = state.calendar.ap >= 1;

  const custodianLabel = (charId: string): string => {
    const c = db.characters[charId] ?? state.generatedConsorts[charId];
    if (!c) return charId;
    if (c.kind === "elder") return c.profile.name;
    const st = state.standing[charId];
    return resolveIdentityLabel(c, st, st ? db.ranks[st.rank] : undefined);
  };

  const pickedHeir: Heir | undefined = pickedHeirId
    ? state.resources.bloodline.heirs.find((h) => h.id === pickedHeirId)
    : undefined;

  const candidates = pickedHeir ? eligibleCustodiansForHeir(db, state, pickedHeir) : [];

  const renderHeirRow = ({ heir, name }: { heir: Heir; name: string }) => {
    const isLegitimate = heir.legitimate;
    const custodianId = heir.custodianId;
    // 嫡出且无显式抚养人=由皇后（或天子本人）亲育；非嫡且无抚养人才是"尚无抚养人"。
    const custodianText = custodianId
      ? `当前抚养人：${custodianLabel(custodianId)}`
      : isLegitimate
        ? "嫡出，由皇后亲育"
        : "尚无抚养人";
    const legitimacyText = isLegitimate ? "嫡出" : "非嫡";

    let buttonLabel: string | null = null;
    let buttonDisabled = false;

    if (isLegitimate) {
      buttonLabel = "抚养归属已定";
      buttonDisabled = true;
    } else if (custodianId) {
      buttonLabel = "更改抚养权";
      buttonDisabled = !canAct;
    } else {
      buttonLabel = "指定抚养人";
      buttonDisabled = !canAct;
    }

    return (
      <div key={heir.id} className="roster-row">
        <span>
          {name}{heir.givenName ? `·${heir.givenName}` : ""}
          　{legitimacyText}　{custodianText}
        </span>
        {buttonLabel && (
          <button
            type="button"
            disabled={buttonDisabled}
            onClick={() => !buttonDisabled && !isLegitimate && setPickedHeirId(heir.id)}
          >
            {buttonLabel}
          </button>
        )}
      </div>
    );
  };

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
          <h2>皇嗣抚养</h2>
          {heirs.length === 0 ? (
            <p className="location-screen__empty">尚无皇嗣。</p>
          ) : (
            heirs.map(renderHeirRow)
          )}
        </section>
      </main>

      {pickedHeirId && pickedHeir && (
        <div className="modal-backdrop" onClick={() => setPickedHeirId(null)}>
          <div className="rank-modal" onClick={(e) => e.stopPropagation()}>
            <h2>指定抚养人</h2>
            {candidates.length === 0 ? (
              <p>当前无合适的抚养人选。</p>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onTransferCustody(pickedHeirId, c.id); setPickedHeirId(null); }}
                >
                  {c.displayName}
                  {c.kind === "elder" ? "　尊长" : c.rankId ? `　${db.ranks[c.rankId]?.name ?? c.rankId}` : ""}
                  {c.becomesLegitimate ? "（交由皇后抚养后，该皇嗣将列为嫡出）" : ""}
                </button>
              ))
            )}
            <button type="button" onClick={() => setPickedHeirId(null)}>取消</button>
          </div>
        </div>
      )}
    </GameShell>
  );
}

/** 毓庆宫：未成年皇嗣居所（皇子≥5、皇郎≥7 迁居于此）。夜间可探视——左名册、右近况与夜访操作；非夜间提示皇嗣不在。 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import { heirAge, heirPortraitSet, listHeirsBySex, residesInYuqing } from "../../engine/characters/heirs";
import type { ContentDB } from "../../engine/content/loader";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import {
  custodianDisplayName,
  describeCustodianRelation,
  describeHeirNeglect,
  type NightVisitAction,
} from "../../store/heirNightVisit";
import { sovereignGestationDisplay } from "../format/gestationDisplay";
import { GameShell } from "../components/GameShell";
import { breadcrumbFor } from "../components/breadcrumb";

export function YuqingGongScreen({
  db, store, registry, onOpenMap, onOpenSettings, onNightVisit, onOpenResources, onOpenStorehouse,
}: {
  db: ContentDB; store: GameStore; registry: AssetRegistry;
  onOpenMap: () => void; onOpenSettings: () => void;
  onNightVisit: (heirId: string, action: NightVisitAction) => void;
  onOpenResources?: () => void; onOpenStorehouse?: () => void;
}) {
  const state = useGameState(store);
  const location = db.locations["yuqing_gong"]!;
  const tod = timeOfDay(state.calendar);
  const background = registry.resolveVariant(location.backgroundKey, tod, "background");
  const isNight = tod === "night";
  const canAct = state.calendar.ap >= 1;

  const resident = [
    ...listHeirsBySex(state.resources.bloodline.heirs, "daughter"),
    ...listHeirsBySex(state.resources.bloodline.heirs, "son"),
  ].filter((r) => residesInYuqing(r.heir, state.calendar));

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = resident.find((r) => r.heir.id === selectedId);

  const visit = (action: NightVisitAction) => {
    if (!selected) return;
    onNightVisit(selected.heir.id, action);
    setSelectedId(null);
  };

  return (
    <GameShell
      calendar={state.calendar}
      crumbs={breadcrumbFor(db, location.id)}
      pregnancyMonth={sovereignGestationDisplay(state)?.month ?? undefined}
      onBack={onOpenMap}
      onOpenResources={onOpenResources}
      onOpenStorehouse={onOpenStorehouse}
      onOpenSettings={onOpenSettings}
    >
      <main className="location-screen yuqing-screen">
        <section
          className="location-screen__stage"
          style={{ backgroundImage: `url("${background.url}")` }}
          data-fallback={background.isFallback || undefined}
        >
          <h1 className="location-screen__name">{location.name}</h1>
          <p className="location-screen__desc">{location.description}</p>
        </section>
        {!isNight ? (
          <section className="location-screen__roster">
            <p className="location-screen__empty">此时皇嗣尚未归宫，宜夜间前来探视。</p>
          </section>
        ) : (
          <div className="yuqing-screen__body">
            <section className="yuqing-screen__roster">
              <h2>在居皇嗣</h2>
              {resident.length === 0 ? (
                <p className="location-screen__empty">尚无皇嗣迁居于此。</p>
              ) : (
                resident.map(({ heir, name }) => (
                  <div
                    key={heir.id}
                    className={`roster-row${selectedId === heir.id ? " roster-row--selected" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(heir.id)}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedId(heir.id)}
                  >
                    <span>{name}{heir.givenName ? `·${heir.givenName}` : ""}　{heirAge(heir, state.calendar)}岁</span>
                  </div>
                ))
              )}
            </section>
            {selected ? (
              <section className="yuqing-screen__detail">
                <div
                  className="yuqing-screen__portrait"
                  style={{ backgroundImage: `url("${registry.portrait(heirPortraitSet(selected.heir, state.calendar), "neutral").url}")` }}
                />
                <h2>{selected.name}{selected.heir.givenName ? `·${selected.heir.givenName}` : ""}　{heirAge(selected.heir, state.calendar)}岁</h2>
                <dl className="yuqing-screen__status">
                  <div>
                    <dt>抚养人</dt>
                    <dd>{custodianDisplayName(db, state, selected.heir) ?? "暂无"}</dd>
                  </div>
                  <div>
                    <dt>近况</dt>
                    <dd>{describeHeirNeglect(selected.heir.neglect)}</dd>
                  </div>
                  <div>
                    <dt>养父之情</dt>
                    <dd>{describeCustodianRelation(db, state, selected.heir)}</dd>
                  </div>
                </dl>
                <div className="yuqing-screen__actions">
                  <button type="button" disabled={!canAct} onClick={() => visit("heart_to_heart")}>
                    与其谈心
                  </button>
                  <button type="button" disabled={!canAct} onClick={() => visit("quiet_company")}>
                    陪其坐一会儿
                  </button>
                </div>
              </section>
            ) : (
              <section className="yuqing-screen__detail yuqing-screen__detail--placeholder">
                <p>选择左侧皇嗣可于夜间探视。</p>
              </section>
            )}
          </div>
        )}
      </main>
    </GameShell>
  );
}

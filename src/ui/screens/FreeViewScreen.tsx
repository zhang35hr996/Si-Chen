/**
 * Free-view screen (art pass): a location you enter without spending AP or
 * relocating — 冷宫 (look only) and 朝会 (look + 上朝). An optional
 * `actionEventId` surfaces one AP-costing action; its cost/affordability come
 * from the event itself, and starting it runs through the normal scene path.
 */
import type { AssetRegistry } from "../../engine/assets/registry";
import { formatGameTime, formatShichen, timeOfDay } from "../../engine/calendar/time";
import { getPresentAt } from "../../engine/characters/presence";
import { isColdPalaceEffectActiveAt } from "../../engine/characters/coldPalace";
import { resolveIdentityLabel } from "../../engine/characters/standing";
import type { ContentDB } from "../../engine/content/loader";
import type { ColdPalaceEffect } from "../../engine/state/types";
import type { GameStore } from "../../store/gameStore";
import { useGameState } from "../../store/useGameState";
import { canHoldCourt } from "../../store/gating";

export function FreeViewScreen({
  db,
  store,
  registry,
  locationId,
  onStartEvent,
  onClose,
  onOfferIncense,
  onDrawFortune,
  onViewProfile,
  onRestoreFromColdPalace,
}: {
  db: ContentDB;
  store: GameStore;
  registry: AssetRegistry;
  locationId: string;
  onStartEvent: (eventId: string) => void;
  onClose: () => void;
  onOfferIncense?: () => void;
  onDrawFortune?: () => void;
  onViewProfile?: (charId: string) => void;
  onRestoreFromColdPalace?: (charId: string) => void;
}) {
  const state = useGameState(store);
  const location = db.locations[locationId];
  if (!location) {
    return <p className="screen-error">未知地点：{locationId}</p>;
  }
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background");

  // 长门宫：居民以活跃冷宫效果为权威，同时支持生成式侍君。
  const isColdPalaceLocation = locationId === "changmengong";
  const coldPalaceResidents = isColdPalaceLocation
    ? state.statusEffects
        .filter((e): e is ColdPalaceEffect =>
          e.kind === "cold_palace" && isColdPalaceEffectActiveAt(e as ColdPalaceEffect, state.calendar.dayIndex),
        )
        .map((effect) => {
          const char = db.characters[effect.characterId] ?? state.generatedConsorts[effect.characterId];
          if (!char) return null;
          const st = state.standing[effect.characterId];
          return { char, effect, st, rk: st ? db.ranks[st.rank] : undefined };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
    : [];

  // 其他居所 free-view：列出住客侍君（按位分降序），可点开详情。
  const residents = isColdPalaceLocation ? [] : getPresentAt(db, state, location.id).filter((c) => c.kind === "consort");
  const action = location.actionEventId ? db.events[location.actionEventId] : undefined;
  const affordable = action ? state.calendar.ap >= action.apCost : false;
  // actionFirstSlotOnly：仅每日首个行动点（卯时早朝，ap===apMax）可行动。
  const slotBlocked = location.actionFirstSlotOnly === true && state.calendar.ap !== state.calendar.apMax;
  // 上朝 gating（重病 + 服丧）：仅 ev_chaohui 入口受约束。
  const courtGate = location.actionEventId === "ev_chaohui" ? canHoldCourt(store.getState()) : { ok: true as const };

  return (
    <main className="location-screen">
      <header className="hud">
        <span className="hud__time">
          {formatGameTime(state.calendar)} · {formatShichen(state.calendar)}
        </span>
        <button type="button" className="hud__button" onClick={onClose}>
          返回
        </button>
      </header>

      <section
        className="location-screen__stage"
        style={{ backgroundImage: `url("${background.url}")` }}
        data-fallback={background.isFallback || undefined}
      >
        <h1 className="location-screen__name">{location.name}</h1>
        <p className="location-screen__desc">{location.description}</p>
        <p className="location-screen__ambience">{location.ambience.join(" · ")}</p>
      </section>

      {isColdPalaceLocation ? (
        <section className="location-screen__present">
          {coldPalaceResidents.length === 0 ? (
            <p className="location-screen__empty">长门宫中目前无人幽居。</p>
          ) : (
            coldPalaceResidents.map(({ char, effect, st, rk }) => (
              <div key={char.id} className="coldpalace-resident coldpalace-resident--managed">
                <span className="coldpalace-resident__name">
                  {resolveIdentityLabel(char, st, rk)}
                </span>
                {effect.startedAt && (
                  <span className="coldpalace-resident__since">
                    自{formatGameTime({ ...effect.startedAt, eraName: state.calendar.eraName })}起幽居
                  </span>
                )}
                <div className="coldpalace-resident__actions">
                  {onViewProfile && (
                    <button
                      type="button"
                      className="punish-btn"
                      onClick={() => onViewProfile(char.id)}
                    >
                      查看详情
                    </button>
                  )}
                  {onRestoreFromColdPalace && (
                    <button
                      type="button"
                      className="punish-btn punish-btn--lift"
                      onClick={() => onRestoreFromColdPalace(char.id)}
                    >
                      召回
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </section>
      ) : (
        residents.length > 0 && (
          <section className="location-screen__present">
            {residents.map((c) => {
              const st = state.standing[c.id];
              const portrait = registry.portrait(c.portraitSet, "neutral");
              return (
                <button
                  key={c.id}
                  type="button"
                  className="coldpalace-resident"
                  onClick={onViewProfile ? () => onViewProfile(c.id) : undefined}
                >
                  <img
                    className="coldpalace-resident__portrait"
                    src={portrait.url}
                    alt={c.profile.name}
                    data-fallback={portrait.isFallback || undefined}
                  />
                  <span className="coldpalace-resident__name">
                    {resolveIdentityLabel(c, st, st ? db.ranks[st.rank] : undefined)}
                  </span>
                </button>
              );
            })}
          </section>
        )
      )}

      <section className="location-screen__events">
        {location.id === "simiao" ? (
          <div className="temple-menu">
            <button type="button" disabled={state.calendar.ap < 1} onClick={onOfferIncense}>上香</button>
            <button type="button" disabled={state.calendar.ap < 1} onClick={onDrawFortune}>求签</button>
          </div>
        ) : action ? (
          <>
            <button
              type="button"
              className="location-screen__event"
              disabled={!affordable || slotBlocked || !courtGate.ok}
              onClick={() => onStartEvent(action.id)}
            >
              {action.title}
            </button>
            {slotBlocked && (
              <p className="location-screen__empty">朝时已过，请明日卯时早朝。</p>
            )}
            {!slotBlocked && !courtGate.ok && (
              <p className="location-screen__empty">{courtGate.reason}</p>
            )}
          </>
        ) : (
          <p className="location-screen__empty">此处无人，亦无可为之事。</p>
        )}
      </section>
    </main>
  );
}

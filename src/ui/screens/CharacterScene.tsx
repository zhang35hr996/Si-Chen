/**
 * 人物视觉小说场景（§五/§七）。进入后宫居所宫殿时取代商品卡：立绘居中大尺寸、底部裁切，
 * 背景用对应宫殿。设宫室的 7 座居所顶部排 5 个宫室槽（主殿/东侧殿/西侧殿/东偏殿/西偏殿），
 * 已住→进入该侍君场景，空置→显示「空置宫室」。坤宁宫/冷宫等单居所沿用侍君切换。
 * 问候为 UI 氛围文案（恪守礼数），非 gameplay 台词。
 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import { timeOfDay } from "../../engine/calendar/time";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent, LocationContent } from "../../engine/content/schemas";
import type { ChamberId, GameState } from "../../engine/state/types";
import { CHAMBERS, chamberOf, hasChambers } from "../../engine/characters/chambers";
import { canSummon } from "../../store/bedchamber";
import { activeConfinement } from "../../engine/characters/confinement";
import { describeActiveConfinement } from "../format/confinement";
import { activeColdPalaceEffectFor } from "../../engine/characters/coldPalace";
import { formatGameTime } from "../../engine/calendar/time";
import { resolveDisplayName } from "../../engine/characters/standing";
import { reportingAttendant } from "../../engine/characters/gongli";
import { getGreetingLocation } from "../../engine/characters/haremAdministration";

/** 恪守礼数的问候集；按 charId 确定性选取，避免僭越或失礼。 */
const GREETINGS = ["恭迎陛下圣驾。", "陛下万福金安。", "臣侍恭候陛下多时了。", "见过陛下，陛下圣安。"];
function greetingFor(charId: string): string {
  let h = 0;
  for (const ch of charId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return GREETINGS[h % GREETINGS.length]!;
}

export function CharacterScene({
  db,
  state,
  registry,
  location,
  consorts,
  absence,
  focusConsortId,
  onConverse,
  onBedchamber,
  onViewProfile,
  onManage,
  onPunish,
  onRelocate,
  onHaremAdminManage,
  onSummonPhysician,
  onRestoreFromColdPalace,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  location: LocationContent;
  /** 该宫住客侍君（按位分降序）；首位为默认主角，>1 时提供切换。 */
  consorts: CharacterContent[];
  absence?: Record<string, string | undefined>;
  focusConsortId?: string | null;
  onConverse?: (charId: string) => void;
  onBedchamber?: (charId: string) => void;
  onViewProfile: (charId: string) => void;
  onManage?: (charId: string) => void;
  onPunish?: (charId: string) => void;
  onRelocate?: (charId: string) => void;
  /** 协理六宫：当前场景侍君是协理者时，开放位分管理权限入口。 */
  onHaremAdminManage?: (actorId: string) => void;
  /** 禁足宫门专用：奉旨传太医入内诊治。 */
  onSummonPhysician?: () => void;
  /** 冷宫专用：召回幽居侍君。 */
  onRestoreFromColdPalace?: (charId: string) => void;
}) {
  const chambered = hasChambers(location.id);
  const occupantOf = (id: ChamberId): CharacterContent | undefined =>
    consorts.find((c) => chamberOf(state.standing[c.id]) === id);

  // 分宫室殿按 chamber 选中；单居所按 consort id 选中。
  const focus = focusConsortId ? consorts.find((c) => c.id === focusConsortId) : undefined;
  const [activeChamber, setActiveChamber] = useState<ChamberId>(
    focus ? chamberOf(state.standing[focus.id]) : consorts[0] ? chamberOf(state.standing[consorts[0].id]) : "main",
  );
  const [activeId, setActiveId] = useState<string | null>(focus?.id ?? consorts[0]?.id ?? null);
  const [moreOpen, setMoreOpen] = useState(false);

  const character = chambered
    ? occupantOf(activeChamber)
    : consorts.find((c) => c.id === activeId) ?? consorts[0];

  const standing = character ? state.standing[character.id] : undefined;
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const background = registry.resolveVariant(location.backgroundKey, timeOfDay(state.calendar), "background").url;
  // 对话/侍寝 与卡片同一门槛：有行动点且本旬可侍寝。
  const actionable = !!character && state.calendar.ap >= 1 && canSummon(state, character.id);
  // 禁足：宫门闭锁，普通往来不可，仅留管理/解除与奉旨传太医（后者经紫宸殿）。
  const confinement = character ? activeConfinement(state, character.id) : undefined;
  // 冷宫：幽居长门宫，不可召见/侍寝/搬迁，仅留查看详情与召回操作。
  const coldPalace = character ? activeColdPalaceEffectFor(state, character.id) : undefined;
  // 协理六宫：若当前场景侍君是协理者，显示标识。
  const admin = state.haremAdministration;
  const isActingAdmin = character && (
    (admin.mode === "acting_consort" && admin.charId === character.id) ||
    (admin.mode === "empress" && state.standing[character.id]?.rank === "fenghou")
  );

  const awayTo = character ? absence?.[character.id] : undefined;
  const awayName = character && standing ? resolveDisplayName(character, standing, rank) : "";
  // 缺席时由该侍君贴身宫隶（当日确定）口吻禀告。
  const servant = awayTo && character ? reportingAttendant(state.rngSeed, character.id, state.calendar.dayIndex) : null;
  const greetingLoc = getGreetingLocation(db, state);
  const whereLine =
    greetingLoc && awayTo === greetingLoc
      ? admin.mode === "acting_consort"
        ? `${awayName}往协理者处请安去了。`
        : `${awayName}往坤宁宫向皇后请安去了。`
      : awayTo === "yuhuayuan"
        ? `${awayName}往御花园散心去了。`
        : awayTo
          ? `${awayName}此刻不在宫中。`
          : null;
  const awayLine = servant && whereLine ? `${servant.name}垂手禀道：「${whereLine}」` : whereLine;

  return (
    <section className="char-scene" aria-label={`${location.name} · ${character?.profile.name ?? "空置"}`}>
      {chambered ? (
        <div className="char-scene__switch char-scene__switch--chambers">
          {CHAMBERS.map((ch) => {
            const occ = occupantOf(ch.id);
            // 住客此刻是否在别处（御花园/坤宁宫请安…）：宫室槽显示姓名 + 「外出」状态，
            // 不把外出住客当作在场可交互人物（其立绘/互动在主体区由缺席禀报取代）。
            const occAway = occ ? absence?.[occ.id] !== undefined : false;
            return (
              <button
                key={ch.id}
                type="button"
                className={`char-scene__chip char-scene__chip--chamber${ch.id === activeChamber ? " is-active" : ""}${occ ? "" : " is-empty"}${occAway ? " is-away" : ""}`}
                onClick={() => {
                  setActiveChamber(ch.id);
                  setMoreOpen(false);
                }}
              >
                <span className="char-scene__chip-room">{ch.name}</span>
                <span className="char-scene__chip-occupant">
                  {occ ? occ.profile.name : "空置"}
                  {occAway && <span className="char-scene__chip-away"> · 外出</span>}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        consorts.length > 1 && (
          <div className="char-scene__switch">
            {consorts.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`char-scene__chip${c.id === activeId ? " is-active" : ""}`}
                onClick={() => {
                  setActiveId(c.id);
                  setMoreOpen(false);
                }}
              >
                {c.profile.name}
              </button>
            ))}
          </div>
        )
      )}

      <div className="char-scene__sprite-wrap" style={{ backgroundImage: `url("${background}")` }}>
        {character && !confinement && !coldPalace ? (
          <img
            className="char-scene__sprite"
            src={registry.portrait(servant ? servant.portraitSet : character.portraitSet, "neutral").url}
            alt={servant ? servant.name : character.profile.name}
            data-fallback={registry.portrait(servant ? servant.portraitSet : character.portraitSet, "neutral").isFallback || undefined}
          />
        ) : (
          <div className="char-scene__empty" aria-hidden="true">
            {confinement ? "此宫宫门闭锁" : coldPalace ? "幽居长门宫" : "此宫室空置"}
          </div>
        )}
      </div>

      <div className="char-scene__dialogue">
        {character ? (
          <>
            <div className="char-scene__nameplate">
              <span className="char-scene__name">{servant ? servant.name : character.profile.name}</span>
              {isActingAdmin && (
                <span className="char-scene__admin-badge" title="奉旨协理六宫">
                  协理六宫
                </span>
              )}
              {coldPalace && (
                <span className="char-scene__admin-badge char-scene__admin-badge--cold" title="幽居冷宫">
                  幽居冷宫
                </span>
              )}
              <span className="char-scene__sub">
                {servant ? `${character.profile.name}的宫人 · ` : rank ? `${rank.name} · ` : ""}
                {location.name}
              </span>
            </div>
            {coldPalace ? (
              // 冷宫幽居：仅显示状态 + 召回操作，禁用对话/侍寝/搬迁。
              <>
                <p className="char-scene__line char-scene__line--confined">
                  {character.profile.name}幽居长门宫，未经圣旨不得出。
                  {coldPalace.startedAt && (
                    <>
                      <br />
                      入宫时间：{formatGameTime({ ...coldPalace.startedAt, eraName: state.calendar.eraName })}。
                    </>
                  )}
                </p>
                <div className="action-dock">
                  <div className="action-dock__primary">
                    <button type="button" className="action-btn" onClick={() => onViewProfile(character.id)}>
                      查看详情
                    </button>
                    {onRestoreFromColdPalace && (
                      <button
                        type="button"
                        className="action-btn action-btn--key"
                        onClick={() => onRestoreFromColdPalace(character.id)}
                      >
                        召回
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : confinement ? (
              // 禁足宫门：仅显示状态 + 解除 + 传太医，不显示立绘/对话/侍寝等普通操作。
              <>
                <p className="char-scene__line char-scene__line--confined">
                  此宫正在禁足，宫门闭锁，未经诏令不得出入。
                  <br />
                  {describeActiveConfinement(confinement, state.calendar.eraName)}
                </p>
                <div className="action-dock">
                  <div className="action-dock__primary">
                    {onPunish && (
                      <button
                        type="button"
                        className="action-btn"
                        onClick={() => onPunish(character.id)}
                      >
                        解除禁足
                      </button>
                    )}
                    {onSummonPhysician && (
                      <button type="button" className="action-btn" onClick={onSummonPhysician}>
                        奉旨传太医
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : awayLine ? (
              <p className="char-scene__line char-scene__line--absent">{awayLine}</p>
            ) : (
              <>
                <p className="char-scene__line">{greetingFor(character.id)}</p>

                <div className="action-dock">
                  <div className="action-dock__primary">
                    {onConverse && actionable && (
                      <button type="button" className="action-btn" onClick={() => onConverse(character.id)}>
                        对话
                      </button>
                    )}
                    <button type="button" className="action-btn" onClick={() => onViewProfile(character.id)}>
                      查看详情
                    </button>
                    {(onManage || onRelocate || onPunish || (isActingAdmin && onHaremAdminManage)) && (
                      <div className="action-more">
                        <button
                          type="button"
                          className="action-btn"
                          aria-expanded={moreOpen}
                          onClick={() => setMoreOpen((v) => !v)}
                        >
                          更多 ▾
                        </button>
                        {moreOpen && (
                          <div className="action-more__menu">
                            {isActingAdmin && onHaremAdminManage && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMoreOpen(false);
                                  onHaremAdminManage(character.id);
                                }}
                              >
                                管理低位侍君
                              </button>
                            )}
                            {onManage && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMoreOpen(false);
                                  onManage(character.id);
                                }}
                              >
                                管理位分 / 封号
                              </button>
                            )}
                            {onRelocate && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMoreOpen(false);
                                  onRelocate(character.id);
                                }}
                              >
                                搬迁
                              </button>
                            )}
                            {onPunish && (
                              <button
                                type="button"
                                onClick={() => {
                                  setMoreOpen(false);
                                  onPunish(character.id);
                                }}
                              >
                                惩罚
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="action-dock__highlight">
                    {onBedchamber && actionable && (
                      <button type="button" className="action-btn action-btn--key" onClick={() => onBedchamber(character.id)}>
                        侍寝
                      </button>
                    )}
                  </div>
                </div>
              </>
            )}
          </>
        ) : (
          <div className="char-scene__nameplate">
            <span className="char-scene__name">空置宫室</span>
            <span className="char-scene__sub">{location.name}</span>
          </div>
        )}
      </div>
    </section>
  );
}

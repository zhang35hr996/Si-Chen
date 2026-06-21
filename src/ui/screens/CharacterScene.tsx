/**
 * 人物视觉小说场景（§五/§七）。进入后宫居所宫殿时取代商品卡：立绘居中大尺寸、底部裁切，
 * 背景用对应宫殿。设宫室的 7 座居所顶部排 5 个宫室槽（主殿/东侧殿/西侧殿/东偏殿/西偏殿），
 * 已住→进入该侍君场景，空置→显示「空置宫室」。坤宁宫/冷宫等单居所沿用侍君切换。
 * 问候为 UI 氛围文案（恪守礼数），非 gameplay 台词。
 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent, LocationContent } from "../../engine/content/schemas";
import type { ChamberId, GameState } from "../../engine/state/types";
import { CHAMBERS, chamberOf, hasChambers } from "../../engine/characters/chambers";
import { canSummon } from "../../store/bedchamber";

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
  focusConsortId,
  onConverse,
  onBedchamber,
  onViewProfile,
  onManage,
  onRelocate,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  location: LocationContent;
  /** 该宫住客侍君（按位分降序）；首位为默认主角，>1 时提供切换。 */
  consorts: CharacterContent[];
  focusConsortId?: string | null;
  onConverse?: (charId: string) => void;
  onBedchamber?: (charId: string) => void;
  onViewProfile: (charId: string) => void;
  onManage?: (charId: string) => void;
  onRelocate?: (charId: string) => void;
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
  const background = registry.resolveVariant(location.backgroundKey, "day", "background").url;
  // 对话/侍寝 与卡片同一门槛：有行动点且本旬可侍寝。
  const actionable = !!character && state.calendar.ap >= 1 && canSummon(state, character.id);

  return (
    <section className="char-scene" aria-label={`${location.name} · ${character?.profile.name ?? "空置"}`}>
      {chambered ? (
        <div className="char-scene__switch char-scene__switch--chambers">
          {CHAMBERS.map((ch) => {
            const occ = occupantOf(ch.id);
            return (
              <button
                key={ch.id}
                type="button"
                className={`char-scene__chip char-scene__chip--chamber${ch.id === activeChamber ? " is-active" : ""}${occ ? "" : " is-empty"}`}
                onClick={() => {
                  setActiveChamber(ch.id);
                  setMoreOpen(false);
                }}
              >
                <span className="char-scene__chip-room">{ch.name}</span>
                <span className="char-scene__chip-occupant">{occ ? occ.profile.name : "空置"}</span>
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
        {character ? (
          <img
            className="char-scene__sprite"
            src={registry.portrait(character.portraitSet, "neutral").url}
            alt={character.profile.name}
            data-fallback={registry.portrait(character.portraitSet, "neutral").isFallback || undefined}
          />
        ) : (
          <div className="char-scene__empty" aria-hidden="true">
            此宫室空置
          </div>
        )}
      </div>

      <div className="char-scene__dialogue">
        {character ? (
          <>
            <div className="char-scene__nameplate">
              <span className="char-scene__name">{character.profile.name}</span>
              <span className="char-scene__sub">
                {rank ? `${rank.name} · ` : ""}
                {location.name}
              </span>
            </div>
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
                {(onManage || onRelocate) && character.id !== "shen_zhibai" && (
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

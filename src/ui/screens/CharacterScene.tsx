/**
 * 人物视觉小说场景（§五）。进入有住客侍君的居所宫殿时取代商品卡：
 * 立绘居中大尺寸、底部裁切，背景用对应宫殿；下方对话框显示姓名 + 一句问候，
 * 底部 ActionDock 按优先级排布行为。问候为 UI 氛围文案（恪守礼数），非 gameplay 台词。
 */
import { useState } from "react";
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent, LocationContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";
import { resolveDisplayName } from "../../engine/characters/standing";
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
  onConverse,
  onBedchamber,
  onViewProfile,
  onManage,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  location: LocationContent;
  /** 该宫住客侍君（按位分降序）；首位为默认主角，>1 时提供切换。 */
  consorts: CharacterContent[];
  onConverse?: (charId: string) => void;
  onBedchamber?: (charId: string) => void;
  onViewProfile: (charId: string) => void;
  onManage?: (charId: string) => void;
}) {
  const [activeId, setActiveId] = useState(consorts[0]!.id);
  const [moreOpen, setMoreOpen] = useState(false);
  const character = consorts.find((c) => c.id === activeId) ?? consorts[0]!;
  const standing = state.standing[character.id];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const displayName = resolveDisplayName(character, standing, rank);
  const portrait = registry.portrait(character.portraitSet, "neutral");
  // 对话/侍寝 与卡片同一门槛：有行动点且本旬可侍寝。
  const actionable = state.calendar.ap >= 1 && canSummon(state, character.id);

  return (
    <section className="char-scene" aria-label={`${location.name} · ${displayName}`}>
      {consorts.length > 1 && (
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
      )}

      <div
        className="char-scene__sprite-wrap"
        style={{ backgroundImage: `url("${registry.resolveVariant(location.backgroundKey, "day", "background").url}")` }}
      >
        <img
          className="char-scene__sprite"
          src={portrait.url}
          alt={character.profile.name}
          data-fallback={portrait.isFallback || undefined}
        />
      </div>

      <div className="char-scene__dialogue">
        <div className="char-scene__nameplate">
          <span className="char-scene__name">{displayName}</span>
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
            {onManage && character.id !== "shen_zhibai" && (
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
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        onManage(character.id);
                      }}
                    >
                      管理位分 / 封号
                    </button>
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
      </div>
    </section>
  );
}

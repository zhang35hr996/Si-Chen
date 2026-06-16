/**
 * Character card. kind drives the label: consorts show 位分, officials show 官职.
 * The card is the player-facing summary, so it omits engine-only detail
 * (自称/品级括注) and the runtime relationship numbers (恩宠/圣眷/信任/亲和):
 * just 位分/官职, role, and the 侍君 attribute block.
 */
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { ConsortAttributes, CharacterContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";
import { resolveDisplayName } from "../../engine/characters/standing";
import { computeFavorStats, FAVOR_TIER_LABEL } from "../../engine/characters/favorTier";
import { bedchamberConfig } from "../../store/bedchamber";
import { toGameTime } from "../../engine/calendar/time";

/** 侍君明面属性 — label order follows background §四.4.1. */
const ATTRIBUTE_LABELS: Array<[keyof ConsortAttributes, string]> = [
  ["appearance", "容貌"],
  ["talent", "才情"],
  ["family", "家世"],
  ["health", "健康"],
  ["nurture", "承养"],
];

export function CharacterCard({
  db,
  state,
  registry,
  character,
  onManage,
  onBedchamber,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  character: CharacterContent;
  onManage?: () => void;
  onBedchamber?: () => void;
}) {
  const standing = state.standing[character.id];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const isConsort = character.kind === "consort";
  const displayName = resolveDisplayName(character, standing, rank);
  const canManage = isConsort && character.id !== "feng_hou" && onManage;
  const portrait = registry.portrait(character.portraitSet, "neutral");
  const favor =
    isConsort
      ? computeFavorStats(state.bedchamber[character.id], toGameTime(state.calendar), bedchamberConfig(db).tiers)
      : null;

  return (
    <article className="char-card">
      <img
        className="char-card__portrait"
        src={portrait.url}
        alt={character.profile.name}
        data-fallback={portrait.isFallback || undefined}
      />
      <header className="char-card__header">
        <strong className="char-card__name">{displayName}</strong>
        <span className="char-card__kind">{isConsort ? "侍君" : "官员"}</span>
      </header>
      {rank && (
        <p className="char-card__rank">
          {isConsort ? "位分" : "官职"}：{rank.name}
          {standing?.title ? <span className="char-card__title">　封号：{standing.title}</span> : null}
        </p>
      )}
      <p className="char-card__role">{character.profile.role}</p>
      {favor && (
        <div className="char-card__favor">
          <span className="char-card__favor-tier" data-tier={favor.tier}>
            {FAVOR_TIER_LABEL[favor.tier]}
          </span>
          <span className="char-card__favor-counts">
            侍寝　月{favor.lastMonth}·季{favor.lastThreeMonths}·年{favor.lastYear}
          </span>
        </div>
      )}
      {canManage && (
        <button type="button" className="char-card__manage" onClick={onManage}>
          管理位分 / 封号
        </button>
      )}
      {isConsort && onBedchamber && (
        <button type="button" className="char-card__bedchamber" onClick={onBedchamber}>
          侍寝
        </button>
      )}
      {character.attributes && (
        <dl className="char-card__attrs">
          {ATTRIBUTE_LABELS.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{character.attributes![key]}</dd>
            </div>
          ))}
        </dl>
      )}
    </article>
  );
}

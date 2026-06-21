/**
 * Character card. kind drives the label: consorts show 位分, officials show 官职.
 * The card is the player-facing summary, so it omits engine-only detail
 * (自称/品级括注): just 位分/官职, role, and the 侍君 attribute block.
 */
import type { AssetRegistry } from "../../engine/assets/registry";
import type { ContentDB } from "../../engine/content/loader";
import type { ConsortAttributes, CharacterContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";
import { computeFavorStats, FAVOR_TIER_LABEL } from "../../engine/characters/favorTier";
import { bedchamberConfig } from "../../store/bedchamber";
import { toGameTime } from "../../engine/calendar/time";
import { describe } from "../format/descriptors";
import type { ScaleId } from "../format/descriptors";
import { HealthStatusChip } from "./HealthStatusChip";

/** 侍君明面数值属性 — 特长/喜好是标签，单独渲染。 */
export const ATTRIBUTE_LABELS: Array<[keyof ConsortAttributes & ("appearance" | "health"), string]> = [
  ["appearance", "容貌"],
  ["health", "健康"],
];

export function CharacterCard({
  db,
  state,
  registry,
  character,
  onManage,
  onBedchamber,
  onConverse,
  onViewProfile,
}: {
  db: ContentDB;
  state: GameState;
  registry: AssetRegistry;
  character: CharacterContent;
  onManage?: () => void;
  onBedchamber?: () => void;
  onConverse?: () => void;
  onViewProfile?: () => void;
}) {
  const standing = state.standing[character.id];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const isConsort = character.kind === "consort";
  const displayName = character.profile.name; // 界面标识用本名；位分由下方 char-card__rank 并列展示
  const canManage = isConsort && character.id !== "shen_zhibai" && onManage;
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
        <span className="char-card__kind">{character.kind === "consort" ? "侍君" : character.kind === "elder" ? "尊长" : "官员"}</span>
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
      {isConsort && standing && (
        <p className="char-card__health">
          <HealthStatusChip
            status={standing.healthStatus ?? "healthy"}
            health={standing.health ?? 100}
          />
        </p>
      )}
      {isConsort && standing?.lifecycle && standing.lifecycle !== "normal" && (
        <p className="char-card__lifecycle" data-lifecycle={standing.lifecycle}>
          {standing.lifecycle === "carrying"
            ? "承嗣君·怀胎"
            : standing.lifecycle === "delivered"
              ? "育嗣君"
              : standing.lifecycle === "candidate"
                ? "候选承嗣"
                : "已故"}
        </p>
      )}
      {onViewProfile && (
        <button type="button" className="char-card__profile" onClick={onViewProfile}>
          查看详情
        </button>
      )}
      {canManage && (
        <button type="button" className="char-card__manage" onClick={onManage}>
          管理位分 / 封号
        </button>
      )}
      {isConsort && onConverse && (
        <button type="button" className="char-card__converse" onClick={onConverse}>
          对话
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
              <dd>{describe(key as ScaleId, character.attributes![key]!)}</dd>
            </div>
          ))}
          <div>
            <dt>特长</dt>
            <dd>{character.attributes.specialty}</dd>
          </div>
          <div>
            <dt>喜好</dt>
            <dd>{character.attributes.likes.join("、")}</dd>
          </div>
        </dl>
      )}
    </article>
  );
}

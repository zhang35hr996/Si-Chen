/**
 * Character card. kind drives what standing means (skeleton-plan review §15.3):
 * consorts show 位分 + 恩宠; officials show 官职 + 圣眷 (the rank's favorTerm)
 * and are never rendered as an empty/fake consort standing.
 */
import type { ContentDB } from "../../engine/content/loader";
import type { CharacterContent } from "../../engine/content/schemas";
import type { GameState } from "../../engine/state/types";

export function CharacterCard({
  db,
  state,
  character,
}: {
  db: ContentDB;
  state: GameState;
  character: CharacterContent;
}) {
  const standing = state.standing[character.id];
  const relationship = state.relationships[character.id];
  const rank = standing ? db.ranks[standing.rank] : undefined;
  const isConsort = character.kind === "consort";

  return (
    <article className="char-card">
      <header className="char-card__header">
        <strong className="char-card__name">{character.profile.name}</strong>
        <span className="char-card__kind">{isConsort ? "侍君" : "女官"}</span>
      </header>
      {rank && (
        <p className="char-card__rank">
          {isConsort ? "位分" : "官职"}：{rank.name}（{rank.grade}）
          <span className="char-card__selfref">自称「{rank.selfRefs.toPlayer.join("」「")}」</span>
        </p>
      )}
      <p className="char-card__role">{character.profile.role}</p>
      {standing && rank && relationship && (
        <dl className="char-card__stats">
          <div>
            <dt>{rank.favorTerm}</dt>
            <dd>{standing.favor}</dd>
          </div>
          <div>
            <dt>信任</dt>
            <dd>{relationship.trust}</dd>
          </div>
          <div>
            <dt>亲和</dt>
            <dd>{relationship.affinity}</dd>
          </div>
        </dl>
      )}
    </article>
  );
}

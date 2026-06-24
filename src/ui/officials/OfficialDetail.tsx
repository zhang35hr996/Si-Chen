/**
 * 官员详情（只读）：所属家族（门第影响/圣眷）、核心家族成员、宫中侍君亲属、当前状态。
 * 全部经 selector 解析，UI 不直接遍历底层数组做业务推断。
 */
import type { ContentDB } from "../../engine/content/loader";
import type { GameState } from "../../engine/state/types";
import {
  getFamilyMembers,
  getPalaceRelativesOfOfficial,
  resolvePerson,
} from "../../engine/officials/selectors";
import { officialPostView } from "./postDisplay";
import { MEMBER_ROLE_LABEL, OFFICIAL_STATUS_LABEL } from "./labels";

export interface OfficialDetailProps {
  db: ContentDB;
  state: GameState;
  officialId: string;
  onBack: () => void;
}

export function OfficialDetail({ db, state, officialId, onBack }: OfficialDetailProps) {
  const official = state.officials[officialId];
  if (!official) {
    return (
      <div className="official-detail">
        <button type="button" className="official-detail__back" onClick={onBack}>← 返回名册</button>
        <p>未找到该官员。</p>
      </div>
    );
  }

  const postLabel = officialPostView(db, state, official).label; // 当前职 / 无职待任 / 原任某职
  const family = state.officialFamilies[official.familyId];
  const members = getFamilyMembers(state, official.familyId);
  const palaceKin = getPalaceRelativesOfOfficial(state, officialId);

  return (
    <div className="official-detail">
      <button type="button" className="official-detail__back" onClick={onBack}>← 返回名册</button>

      <h3 className="official-detail__name">{official.surname}{official.givenName}</h3>
      <p className="official-detail__line">
        {postLabel} · 年{official.age} · 忠心 {official.loyalty} ·{" "}
        状态 {OFFICIAL_STATUS_LABEL[official.status]}
      </p>

      <section className="official-detail__section">
        <h4>所属家族</h4>
        {family ? (
          <p className="official-detail__line">
            {family.surname}氏 · 门第影响 {family.influence} · 圣眷 {family.imperialFavor}
          </p>
        ) : (
          <p className="official-detail__empty">（无家族记录）</p>
        )}
      </section>

      <section className="official-detail__section">
        <h4>核心家族成员</h4>
        {members.length === 0 ? (
          <p className="official-detail__empty">（暂无在录成员）</p>
        ) : (
          <ul className="official-detail__list">
            {members.map((m) => (
              <li key={m.id}>
                <span className="official-detail__role">{MEMBER_ROLE_LABEL[m.role]}</span>
                <span className="official-detail__member-name">{m.name}</span>
                <span className="official-detail__member-meta">年{m.age}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="official-detail__section">
        <h4>宫中侍君亲属</h4>
        {palaceKin.length === 0 ? (
          <p className="official-detail__empty">族中无人入宫为侍。</p>
        ) : (
          <ul className="official-detail__list">
            {palaceKin.map((id) => {
              const person = resolvePerson(state, db, id);
              const standing = state.standing[id];
              const rank = standing ? db.ranks[standing.rank]?.name ?? standing.rank : "";
              return (
                <li key={id}>
                  <span className="official-detail__member-name">{person?.name ?? id}</span>
                  {rank && <span className="official-detail__member-meta">{rank}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * 官员名册（只读）。按部门分组的列表；每行显示姓名/官职/品级/年龄/忠心/家族/宫中亲属标记。
 * UI 不承担业务计算——只读 state 与 selector。点击某官员回调 onSelect（移动端友好的整行按钮）。
 */
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, OfficialDepartment } from "../../engine/state/types";
import { getPalaceRelativesOfOfficial } from "../../engine/officials/selectors";
import { DEPARTMENT_LABEL } from "./labels";

export interface OfficialRosterProps {
  db: ContentDB;
  state: GameState;
  onSelect: (officialId: string) => void;
}

export function OfficialRoster({ db, state, onSelect }: OfficialRosterProps) {
  const officials = Object.values(state.officials);
  if (officials.length === 0) {
    return <p className="official-roster__empty">朝中暂无在册官员。</p>;
  }

  // 按部门分组（官职决定部门；无职归「无属」）。
  const groups = new Map<OfficialDepartment, typeof officials>();
  for (const o of officials) {
    const dept = (o.postId ? db.officialPosts[o.postId]?.department : undefined) ?? "none";
    const list = groups.get(dept) ?? [];
    list.push(o);
    groups.set(dept, list);
  }
  // 部门内按品级降序，便于一眼看清主从。
  const orderInDept = (id: string | null): number => (id ? db.officialPosts[id]?.gradeOrder ?? -1 : -1);
  const sortedDepts = [...groups.keys()].sort((a, b) => (DEPARTMENT_LABEL[a] < DEPARTMENT_LABEL[b] ? -1 : 1));

  return (
    <div className="official-roster">
      <h3 className="official-roster__title">官员名册（{officials.length} 人）</h3>
      {sortedDepts.map((dept) => {
        const list = [...groups.get(dept)!].sort((a, b) => orderInDept(b.postId) - orderInDept(a.postId));
        return (
          <section key={dept} className="official-roster__group">
            <h4 className="official-roster__group-title">{DEPARTMENT_LABEL[dept]}</h4>
            <ul className="official-roster__list">
              {list.map((o) => {
                const post = o.postId ? db.officialPosts[o.postId] : undefined;
                const family = state.officialFamilies[o.familyId];
                const palaceKin = getPalaceRelativesOfOfficial(state, o.id);
                return (
                  <li key={o.id}>
                    <button type="button" className="official-roster__row" onClick={() => onSelect(o.id)}>
                      <span className="official-roster__name">{o.surname}{o.givenName}</span>
                      <span className="official-roster__post">{post ? `${post.grade}·${post.name}` : "（空缺）"}</span>
                      <span className="official-roster__meta">年{o.age} · 忠{o.loyalty} · {family ? `${family.surname}氏` : "—"}</span>
                      {palaceKin.length > 0 && <span className="official-roster__kin-badge">宫中亲 {palaceKin.length}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

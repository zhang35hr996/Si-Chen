/**
 * 官员「官职/部门」只读展示派生（UI 专用）。区分 active 在任/无职待任、非在任的「原任官职」，
 * 使名册分组与品级排序对非 active 官员仍能体现其原属部门与官职——postId 已按生命周期不变量
 * 置 null，故非 active 的部门/官职取 officialHistory 的最近一次 vacatedPostId。
 */
import type { ContentDB } from "../../engine/content/loader";
import type { GameState, Official, OfficialDepartment } from "../../engine/state/types";
import { getLastHeldPostId } from "../../engine/officials/selectors";

export interface OfficialPostView {
  /** 名册分组所属部门。 */
  dept: OfficialDepartment;
  /** 行内官职文案（当前职 / 无职待任 / 原任某职 / 无职）。 */
  label: string;
  /** 排序用品级（当前或原任官职品级；无则 -1）。 */
  gradeOrder: number;
}

export function officialPostView(db: ContentDB, state: GameState, official: Official): OfficialPostView {
  if (official.status === "active") {
    if (official.postId) {
      const p = db.officialPosts[official.postId];
      return p
        ? { dept: p.department, label: `${p.grade}·${p.name}`, gradeOrder: p.gradeOrder }
        : { dept: "none", label: "（无职）", gradeOrder: -1 };
    }
    return { dept: "none", label: "无职待任", gradeOrder: -1 }; // 在任但去职/未授，待补任
  }
  // 非在任：按最近一次离任的官职归部门，展示「原任 …」。
  const lastId = getLastHeldPostId(state, official.id);
  const p = lastId ? db.officialPosts[lastId] : undefined;
  return p
    ? { dept: p.department, label: `原任 ${p.grade}·${p.name}`, gradeOrder: p.gradeOrder }
    : { dept: "none", label: "无职", gradeOrder: -1 };
}

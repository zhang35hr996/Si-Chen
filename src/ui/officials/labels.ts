/** 官员系统显示文案（UI 专用；引擎不依赖）。 */
import type { FamilyMemberRole, OfficialDepartment, OfficialStatus } from "../../engine/state/types";

export const DEPARTMENT_LABEL: Record<OfficialDepartment, string> = {
  chancellery: "政事堂",
  personnel: "吏部",
  revenue: "户部",
  rites: "礼部",
  military: "军务",
  justice: "刑名",
  works: "工部",
  censorate: "御史台",
  academy: "寺监学",
  provincial: "地方",
  none: "无属",
};

export const OFFICIAL_STATUS_LABEL: Record<OfficialStatus, string> = {
  active: "在任",
  retired: "致仕",
  imprisoned: "系狱",
  exiled: "流放",
  dead: "已故",
};

export const MEMBER_ROLE_LABEL: Record<FamilyMemberRole, string> = {
  matriarch: "母家长",
  consort_in: "内卿",
  daughter: "女",
  son: "男郎",
  sister: "姐妹",
};

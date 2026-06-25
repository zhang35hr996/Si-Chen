/** 官员系统显示文案（UI 专用；引擎不依赖）。 */
import type { CandidateStatus, FamilyMemberRole, OfficialDepartment, OfficialStatus } from "../../engine/state/types";

/** 候补状态文案（PR3B）。 */
export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  eligible: "候补",
  appointed: "已授官",
  expired: "逾期",
  withdrawn: "退出",
};

/** 候补四维能力文案（PR3B）。 */
export const APTITUDE_LABEL: Record<"governance" | "scholarship" | "military" | "integrity", string> = {
  governance: "政略",
  scholarship: "才学",
  military: "军事",
  integrity: "清正",
};

/** 吏部考课人事变动文案（PR3C-2）。 */
export const PERSONNEL_CHANGE_LABEL: Record<"promotion" | "demotion" | "fill" | "appointment", string> = {
  promotion: "升迁",
  demotion: "降级",
  fill: "补缺",
  appointment: "授官",
};

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

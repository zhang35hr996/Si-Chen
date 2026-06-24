/**
 * 候补—官职适配评分（Phase 3 PR3B）：纯函数、确定性、0–100，仅供 UI 推荐/排序——**不作授官硬门槛**
 * （玩家可任性用人，后果留政绩系统）。权重集中于此，不散落 UI。
 */
import type { OfficialPost } from "../content/schemas";
import type { CandidateAptitude, OfficialDepartment } from "../state/types";

/** 四维权重（和为 1）。 */
interface FitWeights {
  governance: number;
  scholarship: number;
  military: number;
  integrity: number;
}

const GOVERNANCE_LED: FitWeights = { governance: 0.6, scholarship: 0.2, military: 0, integrity: 0.2 };
const SCHOLARSHIP_LED: FitWeights = { governance: 0.2, scholarship: 0.6, military: 0, integrity: 0.2 };
const MILITARY_LED: FitWeights = { governance: 0.2, scholarship: 0, military: 0.6, integrity: 0.2 };
const INTEGRITY_LED: FitWeights = { governance: 0.2, scholarship: 0.2, military: 0, integrity: 0.6 };
const BALANCED: FitWeights = { governance: 0.25, scholarship: 0.25, military: 0.25, integrity: 0.25 };

/** 部门 → 主属性权重画像（集中定义）。 */
export const DEPARTMENT_FIT_WEIGHTS: Record<OfficialDepartment, FitWeights> = {
  chancellery: GOVERNANCE_LED, // 政事堂/三公：治理为主
  personnel: GOVERNANCE_LED, // 吏部
  revenue: GOVERNANCE_LED, // 户部
  works: GOVERNANCE_LED, // 工部
  provincial: GOVERNANCE_LED, // 地方
  rites: SCHOLARSHIP_LED, // 礼部：才学为主
  academy: SCHOLARSHIP_LED, // 寺监学
  military: MILITARY_LED, // 军务：军事为主
  censorate: INTEGRITY_LED, // 御史台：清正为主
  justice: INTEGRITY_LED, // 刑名
  none: BALANCED, // 无部门：四维均衡
};

/** 适配度 0–100（确定性，不消耗随机数；不修改 state）。 */
export function candidatePostFit(candidate: { aptitude: CandidateAptitude }, post: Pick<OfficialPost, "department">): number {
  const w = DEPARTMENT_FIT_WEIGHTS[post.department] ?? BALANCED;
  const a = candidate.aptitude;
  const raw = a.governance * w.governance + a.scholarship * w.scholarship + a.military * w.military + a.integrity * w.integrity;
  return Math.max(0, Math.min(100, Math.round(raw)));
}

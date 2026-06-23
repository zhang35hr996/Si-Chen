/** 说话人对某当事人的关系（spec：数值 + stance 枚举 + reasons）。结构化驱动，确定性，无 NLP。 */
import type { RelationStance } from "../content/schemas";

export type { RelationStance };

export interface RelationVector {
  affection: number; trust: number; hostility: number; envy: number; fear: number; respect: number;
}
export interface SubjectRelation extends RelationVector {
  charId: string;
  stance: RelationStance;
  reasons: string[];
}

export const STANCE_DEFAULTS: Record<RelationStance, RelationVector> = {
  devoted:      { affection: 75, trust: 80, hostility: 0,  envy: 5,  fear: 10, respect: 80 },
  friendly:     { affection: 45, trust: 55, hostility: 5,  envy: 10, fear: 5,  respect: 45 },
  neutral:      { affection: 0,  trust: 20, hostility: 5,  envy: 5,  fear: 5,  respect: 20 },
  competitive:  { affection: -10, trust: 15, hostility: 25, envy: 55, fear: 10, respect: 30 },
  contemptuous: { affection: -30, trust: 10, hostility: 25, envy: 5,  fear: 0,  respect: 0 },
  hostile:      { affection: -65, trust: 0,  hostility: 80, envy: 25, fear: 15, respect: 5 },
};

const clampPct = (n: number): number => Math.min(100, Math.max(0, n));
const clampSigned = (n: number): number => Math.min(100, Math.max(-100, n));

/**
 * Derive the speaker's relation to a subject from the authored structured `stance`
 * (machine field; defaults to "neutral" when unstated). The narrative `attitude`
 * string is intentionally NOT parsed — content carries the canonical stance.
 */
export function deriveSubjectRelation(input: {
  charId: string;
  authoredStance?: RelationStance;
  standingAffection?: number;  // −100..100 运行时 affection
  favorThreat?: number;        // 0–100 对方恩宠上升威胁度
}): { relation: SubjectRelation } {
  const stance: RelationStance = input.authoredStance ?? "neutral";
  const reasons: string[] = [];
  if (input.authoredStance !== undefined) reasons.push(`授定态度「${stance}」`);
  const base = STANCE_DEFAULTS[stance];
  // 动态 affection 微调（不翻转 stance）：60% 基线 + 40% 运行时
  const affection = input.standingAffection !== undefined
    ? clampSigned(base.affection * 0.6 + input.standingAffection * 0.4)
    : base.affection;
  const positiveBonus = Math.max(0, affection); // 仅正向 affection 缓和
  const favorThreat = input.favorThreat ?? 0;
  if (favorThreat > 0) reasons.push("对方恩宠上升");
  const relation: SubjectRelation = {
    charId: input.charId,
    stance,
    affection,
    trust: clampPct(base.trust + positiveBonus * 0.5 / 100 * 30),
    hostility: clampPct(base.hostility - positiveBonus / 100 * 20),
    envy: clampPct(base.envy + favorThreat / 100 * 30),
    fear: base.fear,
    respect: base.respect,
    reasons,
  };
  return { relation };
}

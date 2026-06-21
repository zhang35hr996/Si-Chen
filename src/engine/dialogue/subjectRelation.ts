/** 说话人对某当事人的关系（spec：数值 + stance 枚举 + reasons）。词表驱动，确定性，无 NLP。 */
export type RelationStance =
  | "devoted" | "friendly" | "neutral" | "competitive" | "contemptuous" | "hostile";

export interface RelationVector {
  affection: number; trust: number; hostility: number; envy: number; fear: number; respect: number;
}
export interface SubjectRelation extends RelationVector {
  charId: string;
  stance: RelationStance;
  reasons: string[];
}

/** 限定别名词表（不做字符串相似度）。`防备` 归 neutral，用低 trust/高 suspicion 表达，不当 hostile。 */
export const ATTITUDE_ALIASES: Record<string, RelationStance> = {
  亲近: "friendly", 交好: "friendly", 友善: "friendly",
  忠心: "devoted", 敬爱: "devoted",
  平淡: "neutral", 不熟: "neutral", 疏远: "neutral", 防备: "neutral",
  争宠: "competitive", 竞争: "competitive", 嫉妒: "competitive",
  轻视: "contemptuous", 鄙夷: "contemptuous",
  交恶: "hostile", 敌视: "hostile", 仇恨: "hostile",
};

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

export interface RelationDiagnostic { code: "unknown_authored_attitude"; value: string }

export function deriveSubjectRelation(input: {
  charId: string;
  authoredAttitude?: string;
  standingAffection?: number;  // −100..100 运行时 affection
  favorThreat?: number;        // 0–100 对方恩宠上升威胁度
}): { relation: SubjectRelation; diagnostics: RelationDiagnostic[] } {
  const diagnostics: RelationDiagnostic[] = [];
  let stance: RelationStance = "neutral";
  const reasons: string[] = [];
  if (input.authoredAttitude !== undefined) {
    const mapped = ATTITUDE_ALIASES[input.authoredAttitude];
    if (mapped) {
      stance = mapped;
      reasons.push(`授定态度「${input.authoredAttitude}」`);
    } else {
      diagnostics.push({ code: "unknown_authored_attitude", value: input.authoredAttitude });
    }
  }
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
  return { relation, diagnostics };
}

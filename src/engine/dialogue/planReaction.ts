import type {
  AudienceContext, EventReactionContext, ReactionPlan, ReactionPrimary, ReactionUndertone,
} from "./reactionTypes";
import type { SocialDisposition } from "./disposition";
import type { SubjectRelation } from "./subjectRelation";

const HOSTILE = (r: SubjectRelation) => r.stance === "hostile" || r.stance === "contemptuous";
const ALLY = (r: SubjectRelation) => r.stance === "friendly" || r.stance === "devoted";

interface Inclination {
  primary: ReactionPrimary;
  undertone?: ReactionUndertone;
  emotion: number;          // 0–100 内在情绪强度
  negativeOutward: boolean; // 外显是否「对他人不利」（gloat/criticize 之类，需受礼制/场合约束）
}

function baseInclination(event: EventReactionContext, r: SubjectRelation): Inclination {
  switch (event.eventType) {
    case "rank_changed":
      if (event.direction !== "demote" && event.direction !== "promote") {
        return { primary: "remain_reserved", emotion: 0, negativeOutward: false };
      }
      if (event.direction === "demote") {
        if (ALLY(r)) {
          const devoted = r.stance === "devoted";
          return devoted
            ? { primary: "defend", emotion: 70, negativeOutward: false }
            : { primary: "petition", emotion: 60, negativeOutward: false };
        }
        if (HOSTILE(r)) return { primary: "gloat", undertone: "contempt", emotion: r.hostility, negativeOutward: true };
        return { primary: "remain_reserved", emotion: 20, negativeOutward: false };
      }
      // promote
      if (r.envy >= 45) return { primary: "congratulate", undertone: "envy", emotion: r.envy, negativeOutward: false };
      if (ALLY(r)) return { primary: "congratulate", emotion: 45, negativeOutward: false };
      return { primary: "agree", emotion: 20, negativeOutward: false };
    case "heir_born":
      if (r.envy >= 45) return { primary: "congratulate", undertone: "envy", emotion: r.envy, negativeOutward: false };
      if (HOSTILE(r)) return { primary: "congratulate", undertone: "resentment", emotion: r.hostility, negativeOutward: false };
      if (ALLY(r)) return { primary: "congratulate", emotion: 55, negativeOutward: false };
      return { primary: "congratulate", emotion: 30, negativeOutward: false };
    case "heir_died":
      if (ALLY(r)) return { primary: "comfort", undertone: "grief", emotion: 70, negativeOutward: false };
      if (HOSTILE(r)) return { primary: "remain_reserved", undertone: "contempt", emotion: r.hostility, negativeOutward: false };
      return { primary: "comfort", emotion: 35, negativeOutward: false };
    case "residence_changed":
      if (ALLY(r)) return { primary: "agree", emotion: 25, negativeOutward: false };
      return { primary: "remain_reserved", emotion: 15, negativeOutward: false };
    default: {
      const _exhaustive: never = event.eventType;
      void _exhaustive;
      return { primary: "remain_reserved", emotion: 0, negativeOutward: false };
    }
  }
}

export function planReaction(params: {
  relation: SubjectRelation;
  disposition: SocialDisposition;
  audience: AudienceContext;
  event: EventReactionContext;
}): ReactionPlan {
  const { relation: r, disposition: d, audience: a, event } = params;
  const inc = baseInclination(event, r);
  const rationale: string[] = [`${event.eventType}:${r.stance}`];

  // 礼制/场合/性格闸：把「对他人不利的外显」在不当场合压住，转入 undertone（高 concealment）
  const formal = a.targetRole === "sovereign" || a.privacy !== "private";
  const suppress =
    (inc.negativeOutward && a.targetRole === "sovereign") ||              // 当着陛下不僭越
    (inc.negativeOutward && a.privacy !== "private" && d.discretion >= 70); // 人多+谨慎者收敛
  let primary = inc.primary;
  let undertoneType = inc.undertone;
  if (suppress) {
    primary = "remain_reserved";
    undertoneType = undertoneType ?? (HOSTILE(r) ? "contempt" : undefined);
    rationale.push(a.targetRole === "sovereign" ? "etiquette:no_gloat_to_sovereign" : "discretion:suppress_in_public");
  }

  const concealment = undertoneType ? Math.min(95, (formal ? 50 : 20) + d.discretion * 0.4) : 0;
  const undertone = undertoneType
    ? { type: undertoneType, intensity: Math.round(inc.emotion), concealment: Math.round(concealment) }
    : undefined;

  return {
    subjectIds: [event.subjectId],
    primary,
    ...(undertone ? { undertone } : {}),
    intensity: Math.round(Math.min(100, inc.emotion * (a.privacy === "private" ? 1 : 0.7))),
    openness: Math.round(Math.max(0, 100 - d.discretion - (formal ? 20 : 0))),
    claimNeeds: [{ about: "subject_event", subjectId: event.subjectId }],
    rationaleCodes: rationale,
  };
}

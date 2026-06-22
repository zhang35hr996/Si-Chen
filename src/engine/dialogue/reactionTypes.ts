export type ReactionPrimary =
  | "congratulate" | "praise" | "comfort" | "petition" | "defend"
  | "criticize" | "agree" | "probe" | "warn" | "reassure"
  | "confide" | "gloat" | "avoid_topic" | "change_subject" | "remain_reserved";

export type ReactionUndertone =
  | "envy" | "resentment" | "contempt" | "fear" | "grief" | "guilt"
  | "affection" | "admiration" | "suspicion" | "calculation" | "reluctance";

export interface ClaimNeed {
  /** 抽象表达需求（不含具体 claim id；由 assembleClaims 装配真实 claim）。 */
  about: "subject_event" | "self_feeling" | "relationship";
  subjectId?: string;
}

export interface ReactionPlan {
  subjectIds: string[];
  primary: ReactionPrimary;
  undertone?: { type: ReactionUndertone; intensity: number; concealment: number };
  intensity: number;        // 0–100 外显强度
  openness: number;         // 0–100 坦率/收敛
  claimNeeds: ClaimNeed[];
  rationaleCodes: string[]; // 调试：为何这样规划
}

export type AudienceRole = "sovereign" | "consort" | "heir" | "official" | "servant";

export interface AudienceContext {
  targetRole: AudienceRole;
  privacy: "public" | "semi_private" | "private";
  presentCharacterIds: string[];
}

export interface EventReactionContext {
  eventType: "heir_born" | "heir_died" | "rank_changed" | "residence_changed";
  subjectId: string;                 // 事件主角（被降位者/生育者/夭折之亲等）
  direction?: "demote" | "promote";  // 仅 rank_changed
}

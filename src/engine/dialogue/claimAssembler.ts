/**
 * Claim 装配（spec §结构化 claim / 数据流 PR5）：由 reactionPlan.claimNeeds + 召回上下文
 * + believedState 派生候选 allowed claims，并【自动】派生「旧结论 vs 当前 TemporalFact 相反」
 * 的 forbidden claims（如旧同住记忆 vs 现住处不同）。自然语言提示只是这些 claim 的渲染，
 * 非事实来源。纯函数确定性。
 *
 * speakerId = 当前发言者（belief 可见性的 viewer）；forbidden 派生读当前 standing.residence
 * 地面真相（belief 无 currently_same_residence 谓词）。
 */
import type { BeliefProjection } from "../chronicle/belief";
import type { GameState } from "../state/types";
import type { DialogueAudienceContext } from "./audience";
import type { DialogueClaim } from "./claims";
import type { DialogueMemoryContext } from "./memoryContext";
import type { ReactionPlan } from "./reactionTypes";

export interface AssembledClaims {
  allowed: DialogueClaim[];
  forbidden: DialogueClaim[];
}

const byPredicateThenSubject = (a: DialogueClaim, b: DialogueClaim): number =>
  a.predicate < b.predicate ? -1 : a.predicate > b.predicate ? 1
  : a.subjectId < b.subjectId ? -1 : a.subjectId > b.subjectId ? 1 : 0;

export function assembleClaims(args: {
  speakerId: string;
  reactionPlan: ReactionPlan;
  memoryContext: DialogueMemoryContext;
  beliefs: BeliefProjection;
  state: GameState;
  audience: DialogueAudienceContext;
}): AssembledClaims {
  const { speakerId, reactionPlan, memoryContext, beliefs, state } = args;
  const allowed: DialogueClaim[] = [];
  const forbidden: DialogueClaim[] = [];

  // 1) 自动事实冲突 forbidden：旧「同住」结论现已不成立。
  //    读当前 state.standing[*].residence（地面真相 TemporalFact）——
  //    belief 无 currently_same_residence 谓词，不可经 belief 派生。
  for (const mem of memoryContext.activatedMemories) {
    if (!mem.triggerTags.includes("residence")) continue;
    const ownerResidence = state.standing[mem.ownerId]?.residence;
    for (const subj of mem.subjectIds) {
      if (subj === mem.ownerId) continue;
      const subjResidence = state.standing[subj]?.residence;
      const noLongerCoResident =
        ownerResidence !== undefined &&
        subjResidence !== undefined &&
        ownerResidence !== subjResidence;
      if (noLongerCoResident) {
        forbidden.push({
          id: `forbid_same_res_${subj}`,
          predicate: "currently_same_residence",
          subjectId: subj,
          object: false,
          modality: "assert",
        });
      }
    }
  }

  // 2) 候选 allowed：对 subject_event claimNeed，用 speakerId 作为 belief viewer
  //    查 holds_rank / resides_at / alive；fact 可见则产生 assert claim。
  for (const need of reactionPlan.claimNeeds) {
    if (need.about !== "subject_event" || !need.subjectId) continue;
    for (const predicate of ["holds_rank", "resides_at", "alive"] as const) {
      const fact = beliefs.getFact(speakerId, { predicate, subjectId: need.subjectId });
      if (!fact) continue;
      allowed.push({
        id: `allow_${predicate}_${need.subjectId}`,
        predicate,
        subjectId: need.subjectId,
        object: fact.value,
        modality: "assert",
        certaintyCeiling: fact.certainty,
      });
    }
  }

  // 3) dedupe by id（稳定，先来先胜），再按 predicate → subjectId 升序排列
  const dedupe = (cs: DialogueClaim[]): DialogueClaim[] => {
    const seen = new Set<string>();
    return cs
      .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
      .sort(byPredicateThenSubject);
  };

  return { allowed: dedupe(allowed), forbidden: dedupe(forbidden) };
}

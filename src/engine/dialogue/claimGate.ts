/**
 * Claim 语义 gate（spec §信念投影 / gate 违规类型）：校验 provider 声明的 proposedClaims
 * 是否符合 speaker 的【可投影认知】、来源合法性、身份与礼制。只依赖 BeliefProjection，
 * 绝不直读 ground truth——接入 rumor/错误信念后只换 projection 实现，gate 不变。
 * 策略：任一 claim 违规 → 整行否决（acceptedClaims 为空）。
 */
import type { BeliefProjection } from "../chronicle/belief";
import { claimToFactKey, type ProposedClaim } from "./claims";
import type { DialogueAudienceContext } from "./audience";

export type ClaimViolationCode =
  | "contradicts_speaker_belief" | "reveals_unknown_fact" | "claims_excessive_certainty"
  | "violates_etiquette" | "identity_mismatch" | "unknown_source_context";

export interface ClaimGateFinding { code: ClaimViolationCode; claimId: string; message: string; }

export interface ClaimGateContext {
  speakerId: string;
  audience: DialogueAudienceContext;
  beliefs: BeliefProjection;
  offeredContextIds: ReadonlySet<string>;
  proposedClaims: readonly ProposedClaim[];
}

export interface ClaimGateResult { ok: boolean; acceptedClaims: ProposedClaim[]; findings: ClaimGateFinding[]; }

const STRONG_ASSERT = 80;
const LOW_CERTAINTY = 50;

function findingsFor(pc: ProposedClaim, ctx: ClaimGateContext): ClaimGateFinding[] {
  const out: ClaimGateFinding[] = [];
  const { claim } = pc;
  const id = claim.id;

  // 来源合法性
  if (pc.sourceContextIds.some((sid) => !ctx.offeredContextIds.has(sid))) {
    out.push({ code: "unknown_source_context", claimId: id, message: "claim 引用了本次未提供的来源" });
  }
  // 身份：侍君不得以帝身份断言帝室行为
  if (claim.subjectId === "player" && ctx.speakerId !== "player" &&
      (claim.predicate === "caused_event" || claim.predicate === "holds_rank") && claim.modality === "assert") {
    out.push({ code: "identity_mismatch", claimId: id, message: "侍君不得以帝身份断言帝室行为" });
  }
  // belief 投影
  const key = claimToFactKey(claim);
  if (key) {
    const believed = ctx.beliefs.getFact(ctx.speakerId, key);
    if (!believed) {
      if (claim.modality === "assert") {
        out.push({ code: "reveals_unknown_fact", claimId: id, message: "断言了自己无权知道的事实" });
      }
    } else if (claim.object !== undefined && believed.value !== claim.object && claim.modality !== "deny") {
      out.push({ code: "contradicts_speaker_belief", claimId: id, message: "claim 与角色相信的事实相反" });
    } else if (believed.certainty < LOW_CERTAINTY && claim.modality === "assert" && pc.certainty >= STRONG_ASSERT) {
      out.push({ code: "claims_excessive_certainty", claimId: id, message: "低置信信息被过强断言" });
    }
  }
  // 礼制：当众（非私下）对在场侍君断言降位等贬抑，对帝失礼
  if (ctx.audience.targetRole === "sovereign" && ctx.audience.privacy !== "private" &&
      claim.predicate === "holds_rank" && claim.modality === "assert" &&
      ctx.audience.presentCharacterIds.includes(claim.subjectId) && claim.subjectId !== ctx.speakerId) {
    out.push({ code: "violates_etiquette", claimId: id, message: "当众议论在场者位分，于帝前失礼" });
  }
  return out;
}

export function validateDialogueClaims(ctx: ClaimGateContext): ClaimGateResult {
  const findings = ctx.proposedClaims.flatMap((pc) => findingsFor(pc, ctx));
  if (findings.length > 0) return { ok: false, acceptedClaims: [], findings };
  return { ok: true, acceptedClaims: [...ctx.proposedClaims], findings: [] };
}

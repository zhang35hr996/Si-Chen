/**
 * Claim 语义 gate（spec §信念投影 / gate 违规类型）：校验 provider 声明的 proposedClaims
 * 是否符合 speaker 的【可投影认知】、来源合法性、身份与礼制。只依赖 BeliefProjection，
 * 绝不直读 ground truth——接入 rumor/错误信念后只换 projection 实现，gate 不变。
 * 策略：任一 claim 违规 → 整行否决（acceptedClaims 为空）。
 *
 * Gate 执行顺序（§3）：
 *   1. sourceRefs.length === 0 → "source_not_authorized"
 *   2. forbiddenClaims covered → "claim_explicitly_forbidden"
 *   3. if allowedClaims non-undefined/non-empty:
 *      a. find matchingAuthorized (isCoveredByAllowedClaim)
 *      b. no match → "claim_not_allowed"
 *      c. has match → check sourceRef intersection → "source_not_authorized"
 *      d. match + source ok → eventAuthorized = true
 *   4. if eventAuthorized: skip reveals_unknown_fact, still check contradicts_speaker_belief
 *   5. if not eventAuthorized: normal reveals_unknown_fact + contradicts_speaker_belief
 */
import type { BeliefProjection } from "../chronicle/belief";
import { claimToFactKey, type ProposedClaim } from "./claims";
import type { DialogueClaim } from "./claims";
import type { DialogueAudienceContext } from "./audience";
import type { AuthorizedClaim } from "./types";
import { claimPolarity, claimFactKey, contextRefKey, MODALITY_STRENGTH } from "./types";

export type ClaimViolationCode =
  | "contradicts_speaker_belief" | "reveals_unknown_fact" | "claims_excessive_certainty"
  | "violates_etiquette" | "identity_mismatch" | "unknown_source_context"
  | "claim_not_allowed" | "claim_explicitly_forbidden" | "source_not_authorized";

export interface ClaimGateFinding { code: ClaimViolationCode; claimId: string; message: string; }

export interface ClaimGateContext {
  speakerId: string;
  audience: DialogueAudienceContext;
  beliefs: BeliefProjection;
  /** Keys produced by `contextRefKey()` for every ref actually sent to the LLM. */
  offeredRefKeys: ReadonlySet<string>;
  proposedClaims: readonly ProposedClaim[];
  /** If defined (even as []), claims must match at least one authorized claim. Undefined = backward-compat open mode. */
  allowedClaims?: readonly AuthorizedClaim[];
  /** Claims the speaker must not make. Checked by fact+polarity only, no source check. */
  forbiddenClaims?: readonly DialogueClaim[];
}

export interface ClaimGateResult { ok: boolean; acceptedClaims: ProposedClaim[]; findings: ClaimGateFinding[]; }

const STRONG_ASSERT = 80;
const LOW_CERTAINTY = 50;

// ── New exported predicates ────────────────────────────────────────────────────

/**
 * Returns true when the given `believed` value contradicts the claim's assertion.
 *
 * For binary predicates (alive — no object field):
 *   - affirm polarity: contradicted when believed === false
 *   - deny polarity:   contradicted when believed === true
 *
 * For object predicates (holds_rank, resides_at):
 *   - affirm: contradicted when believed !== claim.object
 *   - deny:   contradicted when believed === claim.object
 */
export function isContradictedByBelief(claim: DialogueClaim, believed: string | boolean): boolean {
  const polarity = claimPolarity(claim.modality);
  if (claim.object === undefined) {
    // Binary / no-object predicate (alive)
    return polarity === "affirm" ? believed === false : believed === true;
  }
  // Object predicate
  return polarity === "affirm" ? believed !== claim.object : believed === claim.object;
}

/**
 * Returns true when `proposed` is covered by `authorized`:
 *   - same fact key (predicate + subjectId + object)
 *   - same polarity (claimPolarity(modality))
 *   - proposed modality strength ≤ authorized modality strength
 *   - proposed.certainty ≤ authorized.claim.certaintyCeiling (0–100, if set)
 *   - ALL proposed sourceRefs are in both authorized.sourceRefs AND offeredRefKeys
 */
export function isCoveredByAllowedClaim(
  proposed: ProposedClaim,
  authorized: AuthorizedClaim,
  offeredRefKeys: ReadonlySet<string>,
): boolean {
  const p = proposed.claim;
  const a = authorized.claim;

  // Fact key match: predicate + subjectId + object
  if (p.predicate !== a.predicate) return false;
  if (p.subjectId !== a.subjectId) return false;
  if (p.object !== a.object) return false;

  // Polarity match
  if (claimPolarity(p.modality) !== claimPolarity(a.modality)) return false;

  // Modality strength: proposed must not exceed authorized modality
  const proposedStrength = MODALITY_STRENGTH[p.modality];
  const authorizedStrength = MODALITY_STRENGTH[a.modality];
  if (
    proposedStrength !== undefined &&
    authorizedStrength !== undefined &&
    proposedStrength > authorizedStrength
  ) {
    return false;
  }

  // Certainty ceiling: proposed.certainty (0–100) must not exceed authorized ceiling
  if (a.certaintyCeiling !== undefined && proposed.certainty > a.certaintyCeiling) {
    return false;
  }

  // Source intersection: ALL proposed sourceRefs must be in authorized.sourceRefs ∩ offeredRefKeys
  const authorizedKeys = new Set(authorized.sourceRefs.map(contextRefKey));
  return proposed.sourceRefs.every((ref) => {
    const key = contextRefKey(ref);
    return authorizedKeys.has(key) && offeredRefKeys.has(key);
  });
}

/**
 * Returns true when `proposed` matches `authorized` on fact key + polarity ONLY.
 * Does NOT check modality ceiling or source intersection.
 * Use this as Phase 1 of the allowedClaims check (§3a).
 */
export function matchesFactAndPolarity(
  proposed: ProposedClaim,
  authorized: AuthorizedClaim,
): boolean {
  return (
    claimFactKey(proposed.claim) === claimFactKey(authorized.claim) &&
    claimPolarity(proposed.claim.modality) === claimPolarity(authorized.claim.modality)
  );
}

/**
 * Returns true when `proposed` is covered by a forbidden claim.
 * Only checks fact key + polarity — NO source check.
 */
export function isCoveredByForbiddenClaim(
  proposed: ProposedClaim,
  forbidden: DialogueClaim,
): boolean {
  const p = proposed.claim;

  if (p.predicate !== forbidden.predicate) return false;
  if (p.subjectId !== forbidden.subjectId) return false;
  if (p.object !== forbidden.object) return false;
  if (claimPolarity(p.modality) !== claimPolarity(forbidden.modality)) return false;

  return true;
}

// ── Internal gate helpers ─────────────────────────────────────────────────────

function findingsFor(pc: ProposedClaim, ctx: ClaimGateContext): ClaimGateFinding[] {
  const out: ClaimGateFinding[] = [];
  const { claim } = pc;
  const id = claim.id;

  // ── §3 Step 1: sourceRefs.length === 0 → source_not_authorized ──────────────
  if (pc.sourceRefs.length === 0) {
    out.push({ code: "source_not_authorized", claimId: id, message: "claim 没有任何来源引用" });
    return out;
  }

  // ── §3 Step 2: forbiddenClaims covered → claim_explicitly_forbidden ──────────
  for (const forbidden of ctx.forbiddenClaims ?? []) {
    if (isCoveredByForbiddenClaim(pc, forbidden)) {
      out.push({ code: "claim_explicitly_forbidden", claimId: id, message: "claim 在明确禁止列表中" });
      return out;
    }
  }

  // ── §3 Step 3: allowedClaims check ──────────────────────────────────────────
  let eventAuthorized = false;
  const allowedClaims = ctx.allowedClaims;

  if (allowedClaims !== undefined) {
    // Phase 1 (§3a/3b): Is there ANY allowed claim for this fact+polarity?
    const factPolarityMatch = allowedClaims.find((auth) => matchesFactAndPolarity(pc, auth));

    if (!factPolarityMatch) {
      // 3b: no fact+polarity match at all → claim_not_allowed
      out.push({ code: "claim_not_allowed", claimId: id, message: "claim 不在本轮授权列表中" });
      return out;
    }

    // Phase 2 (§3c/3d): Full check — modality strength + certainty ceiling + source intersection
    if (!isCoveredByAllowedClaim(pc, factPolarityMatch, ctx.offeredRefKeys)) {
      // 3c: fact+polarity matched but modality/certainty/source fails → source_not_authorized
      out.push({ code: "source_not_authorized", claimId: id, message: "claim 来源不在授权来源交集中" });
      return out;
    }

    // 3d: match + source ok → eventAuthorized = true
    eventAuthorized = true;
  }

  // ── §3 Step 4/5: belief gate ──────────────────────────────────────────────────
  if (!eventAuthorized) {
    // Legacy source check (backward-compat when allowedClaims is undefined)
    if (pc.sourceRefs.some((ref) => !ctx.offeredRefKeys.has(contextRefKey(ref)))) {
      out.push({ code: "unknown_source_context", claimId: id, message: "claim 引用了本次未提供的来源" });
    }
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
      // Step 4: if eventAuthorized, skip reveals_unknown_fact
      if (!eventAuthorized && claim.modality === "assert") {
        out.push({ code: "reveals_unknown_fact", claimId: id, message: "断言了自己无权知道的事实" });
      }
    } else {
      // Step 4/5: contradicts_speaker_belief fires for event-authorized and non-authorized
      // Use isContradictedByBelief for the check
      if (isContradictedByBelief(claim, believed.value)) {
        out.push({ code: "contradicts_speaker_belief", claimId: id, message: "claim 与角色相信的事实相反" });
      }
      if (believed.certainty < LOW_CERTAINTY && claim.modality === "assert" && pc.certainty >= STRONG_ASSERT) {
        out.push({ code: "claims_excessive_certainty", claimId: id, message: "低置信信息被过强断言" });
      }
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

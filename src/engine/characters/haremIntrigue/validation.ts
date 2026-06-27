import type { GameTime } from "../../calendar/time";
import { compareGameTime } from "../../calendar/time";
import type {
  HaremIntriguePlan,
  HaremIntrigueOutcome,
  HaremIntrigueValidationFinding,
  HaremIntrigueValidationCode,
  HaremIntrigueKind,
  HaremIntrigueMotive,
  HaremIntrigueRationaleCode,
  IntrigueParticipantSnapshot,
} from "./types";
import { RATIONALE_CANONICAL_ORDER } from "./types";
import { buildIntrigueConsequences } from "./consequences";

const VALID_KINDS = new Set<HaremIntrigueKind>([
  "slander", "false_accusation", "steal_credit", "faction_pressure", "servant_subversion",
]);

const VALID_MOTIVES = new Set<HaremIntrigueMotive>([
  "jealousy", "ambition", "resentment", "fear", "faction",
]);

const VALID_RATIONALE = new Set<HaremIntrigueRationaleCode>(RATIONALE_CANONICAL_ORDER);

const VALID_PERIODS = new Set(["early", "mid", "late"]);

function finding(
  code: HaremIntrigueValidationCode,
  message: string,
): HaremIntrigueValidationFinding {
  return { code, message };
}

function isIntegerInRange(v: unknown, lo: number, hi: number): boolean {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * Validate a GameTime object for structural correctness.
 * year >= 1, month 1-12, period in {early,mid,late}, dayIndex >= 0.
 */
export function validateIntrigueGameTime(
  time: GameTime,
  label: string,
): HaremIntrigueValidationFinding[] {
  const results: HaremIntrigueValidationFinding[] = [];
  if (!Number.isInteger(time.year) || time.year < 1) {
    results.push(finding("INTRIGUE_BAD_TIME", `${label}.year=${time.year} must be integer >= 1`));
  }
  if (!Number.isInteger(time.month) || time.month < 1 || time.month > 12) {
    results.push(finding("INTRIGUE_BAD_TIME", `${label}.month=${time.month} must be integer 1-12`));
  }
  if (!VALID_PERIODS.has(time.period)) {
    results.push(finding("INTRIGUE_BAD_TIME", `${label}.period="${time.period}" must be early|mid|late`));
  }
  if (!Number.isInteger(time.dayIndex) || time.dayIndex < 0) {
    results.push(finding("INTRIGUE_BAD_TIME", `${label}.dayIndex=${time.dayIndex} must be integer >= 0`));
  }
  return results;
}

/**
 * Validate a participant snapshot for structural completeness.
 * Used for both actor and target snapshots.
 */
export function validateParticipantSnapshot(
  label: "actor" | "target",
  snap: IntrigueParticipantSnapshot,
  expectedId: string,
): HaremIntrigueValidationFinding[] {
  const results: HaremIntrigueValidationFinding[] = [];
  const prefix = `${label}Snapshot`;

  // characterId
  if (!snap.characterId) {
    results.push(finding("INTRIGUE_SNAPSHOT_ID_MISMATCH", `${prefix}.characterId is empty`));
  } else if (snap.characterId !== expectedId) {
    results.push(finding("INTRIGUE_SNAPSHOT_ID_MISMATCH", `${prefix}.characterId="${snap.characterId}" !== "${expectedId}"`));
  }

  // rankId non-empty
  if (!snap.rankId || typeof snap.rankId !== "string") {
    results.push(finding("INTRIGUE_BAD_SNAPSHOT_VALUE", `${prefix}.rankId is empty or missing`));
  }

  // rankOrder: finite integer >= 0
  if (!Number.isFinite(snap.rankOrder) || !Number.isInteger(snap.rankOrder) || snap.rankOrder < 0) {
    results.push(finding("INTRIGUE_BAD_SNAPSHOT_VALUE", `${prefix}.rankOrder=${snap.rankOrder} must be finite integer >= 0`));
  }

  // Numeric fields 0-100
  const numericFields: [string, unknown][] = [
    ["favor", snap.favor], ["peakFavor", snap.peakFavor], ["affection", snap.affection],
    ["fear", snap.fear], ["ambition", snap.ambition], ["loyalty", snap.loyalty],
    ["scheming", snap.personality.scheming], ["sociability", snap.personality.sociability],
    ["compassion", snap.personality.compassion], ["courage", snap.personality.courage],
    ["jealousy", snap.personality.jealousy], ["emotionalStability", snap.personality.emotionalStability],
    ["pride", snap.personality.pride], ["intelligence", snap.personality.intelligence],
    ["servantOpinion", snap.household.servantOpinion], ["livingStandard", snap.household.livingStandard],
    ["privateWealthLevel", snap.household.privateWealthLevel],
  ];
  for (const [name, val] of numericFields) {
    if (!isIntegerInRange(val, 0, 100)) {
      results.push(finding("INTRIGUE_BAD_SNAPSHOT_VALUE", `${prefix}.${name}=${val} must be integer 0-100`));
    }
  }

  // peakFavor >= favor
  if (isIntegerInRange(snap.peakFavor, 0, 100) && isIntegerInRange(snap.favor, 0, 100)) {
    if (snap.peakFavor < snap.favor) {
      results.push(finding("INTRIGUE_BAD_SNAPSHOT_VALUE", `${prefix}.peakFavor < favor`));
    }
  }

  // factionId: if present, must be non-empty string
  if (snap.factionId !== undefined && (typeof snap.factionId !== "string" || !snap.factionId)) {
    results.push(finding("INTRIGUE_BAD_SNAPSHOT_VALUE", `${prefix}.factionId must be non-empty string if present`));
  }

  return results;
}

/**
 * Validate a HaremIntriguePlan for structural invariants.
 * Returns array of findings (empty = valid).
 */
export function validateHaremIntriguePlan(
  plan: HaremIntriguePlan,
): HaremIntrigueValidationFinding[] {
  const findings: HaremIntrigueValidationFinding[] = [];

  // 1. sourceKey canonical format
  const sourceKeyRegex = /^harem_intrigue:\d+:\d{2}$/;
  if (!sourceKeyRegex.test(plan.sourceKey)) {
    findings.push(finding("INTRIGUE_BAD_SOURCE_KEY", `Invalid sourceKey: "${plan.sourceKey}"`));
  } else {
    // 2. year/month match sourceKey
    const parts = plan.sourceKey.split(":");
    const keyYear = parseInt(parts[1]!, 10);
    const keyMonth = parseInt(parts[2]!, 10);
    if (keyYear !== plan.year || keyMonth !== plan.month) {
      findings.push(finding("INTRIGUE_BAD_TIME", `sourceKey year/month mismatch: key=${plan.sourceKey} plan=${plan.year}:${plan.month}`));
    }
    // 3. plannedAt matches
    if (plan.plannedAt.year !== plan.year || plan.plannedAt.month !== plan.month) {
      findings.push(finding("INTRIGUE_BAD_TIME", `plannedAt year/month mismatch`));
    }
  }

  // 3b. GameTime structural validation for plannedAt
  findings.push(...validateIntrigueGameTime(plan.plannedAt, "plannedAt"));

  // 4. actor !== target
  if (!plan.actorId || !plan.targetId) {
    findings.push(finding("INTRIGUE_BAD_SCORE", "actorId or targetId is empty"));
  } else if (plan.actorId === plan.targetId) {
    findings.push(finding("INTRIGUE_SELF_TARGET", "actorId equals targetId"));
  }

  // 5. Participant snapshots — unified validator
  if (plan.actorSnapshot) {
    findings.push(...validateParticipantSnapshot("actor", plan.actorSnapshot, plan.actorId));
  } else {
    findings.push(finding("INTRIGUE_SNAPSHOT_ID_MISMATCH", "actorSnapshot missing"));
  }
  if (plan.targetSnapshot) {
    findings.push(...validateParticipantSnapshot("target", plan.targetSnapshot, plan.targetId));
  } else {
    findings.push(finding("INTRIGUE_SNAPSHOT_ID_MISMATCH", "targetSnapshot missing"));
  }

  // 6. kind valid
  if (!VALID_KINDS.has(plan.kind)) {
    findings.push(finding("INTRIGUE_UNKNOWN_KIND", `Unknown kind: "${plan.kind}"`));
  }

  // 7. motive valid
  if (!VALID_MOTIVES.has(plan.motive)) {
    findings.push(finding("INTRIGUE_UNKNOWN_MOTIVE", `Unknown motive: "${plan.motive}"`));
  }

  // 8. Scores 0-100 integer
  for (const [name, val] of [
    ["actorPropensity", plan.actorPropensity],
    ["targetThreat", plan.targetThreat],
    ["priority", plan.priority],
  ] as [string, number][]) {
    if (!isIntegerInRange(val, 0, 100)) {
      findings.push(finding("INTRIGUE_BAD_SCORE", `${name}=${val} is not integer 0-100`));
    }
  }

  // 9. grievance 0-100
  if (!isIntegerInRange(plan.grievanceStrength, 0, 100)) {
    findings.push(finding("INTRIGUE_BAD_GRIEVANCE", `grievanceStrength=${plan.grievanceStrength}`));
  }

  // 10. potency 10-90
  if (!isIntegerInRange(plan.potency, 10, 90)) {
    findings.push(finding("INTRIGUE_BAD_POTENCY", `potency=${plan.potency}`));
  }

  // 11. secrecy 10-90
  if (!isIntegerInRange(plan.secrecy, 10, 90)) {
    findings.push(finding("INTRIGUE_BAD_SECRECY", `secrecy=${plan.secrecy}`));
  }

  // 13. Rationale
  if (plan.rationale) {
    // No duplicates
    const seen = new Set<string>();
    for (const code of plan.rationale) {
      if (seen.has(code)) {
        findings.push(finding("INTRIGUE_DUP_RATIONALE", `Duplicate rationale code: "${code}"`));
        break;
      }
      seen.add(code);
      if (!VALID_RATIONALE.has(code as HaremIntrigueRationaleCode)) {
        findings.push(finding("INTRIGUE_BAD_RATIONALE", `Unknown rationale: "${code}"`));
      }
    }

    // Check canonical order
    const indices = plan.rationale.map((code) => RATIONALE_CANONICAL_ORDER.indexOf(code as HaremIntrigueRationaleCode));
    for (let i = 1; i < indices.length; i++) {
      if (indices[i]! <= indices[i - 1]!) {
        findings.push(finding("INTRIGUE_BAD_RATIONALE", "Rationale not in canonical order"));
        break;
      }
    }
  }

  // 14. Kind-motive consistency
  if (VALID_KINDS.has(plan.kind) && VALID_MOTIVES.has(plan.motive)) {
    if (plan.kind === "false_accusation" && plan.motive !== "resentment") {
      findings.push(finding("INTRIGUE_KIND_MOTIVE_MISMATCH", "false_accusation must have motive=resentment"));
    }
    if (plan.kind === "faction_pressure" && plan.motive !== "faction") {
      findings.push(finding("INTRIGUE_KIND_MOTIVE_MISMATCH", "faction_pressure must have motive=faction"));
    }
    if (plan.kind === "steal_credit" && plan.motive !== "ambition") {
      findings.push(finding("INTRIGUE_KIND_MOTIVE_MISMATCH", "steal_credit must have motive=ambition"));
    }
  }

  return findings;
}

/**
 * Validate a HaremIntrigueOutcome against its plan.
 */
export function validateHaremIntrigueOutcome(
  plan: HaremIntriguePlan,
  outcome: HaremIntrigueOutcome,
): HaremIntrigueValidationFinding[] {
  const findings: HaremIntrigueValidationFinding[] = [];

  // Validate resolvedAt GameTime
  findings.push(...validateIntrigueGameTime(outcome.resolvedAt, "resolvedAt"));

  // resolvedAt >= plannedAt
  if (findings.length === 0 && compareGameTime(outcome.resolvedAt, plan.plannedAt) < 0) {
    findings.push(finding("INTRIGUE_BAD_TIME", "resolvedAt is before plannedAt"));
  }

  if (outcome.status === "cancelled") {
    const validReasons = new Set(["actor_unavailable", "target_unavailable", "actor_target_same", "plan_invalid"]);
    if (!validReasons.has(outcome.reason)) {
      findings.push(finding("INTRIGUE_BAD_SCORE", `Invalid cancellation reason: "${outcome.reason}"`));
    }
    if (outcome.knowledge.targetKnowsInstigator !== false) {
      findings.push(finding("INTRIGUE_BAD_SCORE", "Cancelled outcome must have targetKnowsInstigator=false"));
    }
    if (outcome.knowledge.palacePublic !== false) {
      findings.push(finding("INTRIGUE_BAD_SCORE", "Cancelled outcome must have palacePublic=false"));
    }
    if (outcome.consequences.standing.length > 0) {
      findings.push(finding("INTRIGUE_BAD_SCORE", "Cancelled outcome must have no standing deltas"));
    }
    if (outcome.consequences.household.length > 0) {
      findings.push(finding("INTRIGUE_BAD_SCORE", "Cancelled outcome must have no household deltas"));
    }
    return findings;
  }

  // Resolved outcome
  const r = outcome;

  // Rolls 0-99
  if (!isIntegerInRange(r.successRoll, 0, 99)) {
    findings.push(finding("INTRIGUE_BAD_SCORE", `successRoll=${r.successRoll} not in 0-99`));
  }
  if (!isIntegerInRange(r.discoveryRoll, 0, 99)) {
    findings.push(finding("INTRIGUE_BAD_SCORE", `discoveryRoll=${r.discoveryRoll} not in 0-99`));
  }

  // Thresholds
  if (!isIntegerInRange(r.successThreshold, 10, 90)) {
    findings.push(finding("INTRIGUE_BAD_SCORE", `successThreshold=${r.successThreshold} not in 10-90`));
  }
  if (!isIntegerInRange(r.discoveryThreshold, 5, 90)) {
    findings.push(finding("INTRIGUE_BAD_SCORE", `discoveryThreshold=${r.discoveryThreshold} not in 5-90`));
  }

  // Consistency: success matches roll < threshold
  const expectedSuccess = r.successRoll < r.successThreshold;
  if (r.success !== expectedSuccess) {
    findings.push(finding("INTRIGUE_BAD_SCORE", `success=${r.success} but roll=${r.successRoll} threshold=${r.successThreshold}`));
  }

  const expectedDiscovered = r.discoveryRoll < r.discoveryThreshold;
  if (r.discovered !== expectedDiscovered) {
    findings.push(finding("INTRIGUE_BAD_SCORE", `discovered=${r.discovered} but roll=${r.discoveryRoll} threshold=${r.discoveryThreshold}`));
  }

  // Knowledge
  if (!r.knowledge.actorKnowsOwnAction) {
    findings.push(finding("INTRIGUE_BAD_SCORE", "actorKnowsOwnAction must be true"));
  }
  if (r.knowledge.targetKnowsInstigator !== r.discovered) {
    findings.push(finding("INTRIGUE_BAD_SCORE", "targetKnowsInstigator must equal discovered"));
  }
  if (r.knowledge.palacePublic !== r.discovered) {
    findings.push(finding("INTRIGUE_BAD_SCORE", "palacePublic must equal discovered"));
  }

  // Consequences
  const allowedCharIds = new Set([plan.actorId, plan.targetId]);

  for (const d of r.consequences.standing) {
    if (!allowedCharIds.has(d.characterId)) {
      findings.push(finding("INTRIGUE_BAD_SCORE", `standing delta for unexpected character: ${d.characterId}`));
    }
    for (const [field, val] of Object.entries(d)) {
      if (field === "characterId") continue;
      if (typeof val !== "number" || !Number.isInteger(val) || val === 0) {
        findings.push(finding("INTRIGUE_BAD_SCORE", `standing delta ${field}=${val} is zero or non-integer`));
      }
      if (typeof val === "number" && (val < -10 || val > 10)) {
        findings.push(finding("INTRIGUE_BAD_SCORE", `standing delta ${field}=${val} exceeds [-10,10]`));
      }
      const forbiddenFields = ["health", "gestation", "rank", "title", "death"];
      if (forbiddenFields.some((f) => field.toLowerCase().includes(f))) {
        findings.push(finding("INTRIGUE_BAD_SCORE", `Forbidden field in standing delta: ${field}`));
      }
    }
  }

  // Check no duplicate character in standing
  const standingCharIds = r.consequences.standing.map((d) => d.characterId);
  if (new Set(standingCharIds).size !== standingCharIds.length) {
    findings.push(finding("INTRIGUE_BAD_SCORE", "Duplicate characterId in standing deltas"));
  }

  const householdCharIds = r.consequences.household.map((d) => d.characterId);
  if (new Set(householdCharIds).size !== householdCharIds.length) {
    findings.push(finding("INTRIGUE_BAD_SCORE", "Duplicate characterId in household deltas"));
  }

  // Compare consequences against canonical builder
  const canonical = buildIntrigueConsequences(plan, r.success, r.discovered);
  const canonicalJson = JSON.stringify(canonical);
  const outcomeJson = JSON.stringify(r.consequences);
  if (canonicalJson !== outcomeJson) {
    findings.push(finding("INTRIGUE_BAD_SCORE", "consequences do not match canonical buildIntrigueConsequences output"));
  }

  return findings;
}

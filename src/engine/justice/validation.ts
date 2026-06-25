/**
 * PUNISH-3B1: Full invariant validation for JusticeState.
 * Pure function — does not mutate state.
 * Used by applyJusticeMutations (post-apply) and save schema superRefine.
 */
import { gameError, type GameError } from "../infra/errors";
import type { JusticeState, CaseRecord, PunishmentRecord } from "./types";
import { seqFromId, isCaseId, isPunishmentId, isChargeId, isEvidenceId, isConfessionId, isVerdictId } from "./ids";

function justiceErr(msg: string): GameError {
  return gameError("state", "BAD_JUSTICE_MUTATION", msg);
}

/**
 * Full structural and referential invariant check on a JusticeState.
 * Does not depend on ContentDB — only checks state-internal consistency.
 */
export function validateJusticeState(justice: JusticeState): GameError[] {
  const errors: GameError[] = [];

  // ── Sub-record ID sets (global uniqueness) ────────────────────────────────
  const allChargeIds = new Set<string>();
  const allEvidenceIds = new Set<string>();
  const allConfessionIds = new Set<string>();
  const allVerdictIds = new Set<string>();

  let maxCaseSeq = 0;
  let maxPunSeq = 0;
  let maxChargeSeq = 0;
  let maxEvidenceSeq = 0;
  let maxConfessionSeq = 0;
  let maxVerdictSeq = 0;

  // ── Case map validation ───────────────────────────────────────────────────
  for (const [key, kase] of Object.entries(justice.cases)) {
    // Key format
    if (!isCaseId(key)) {
      errors.push(justiceErr(`case map key "${key}" is not a valid case ID format`));
    }
    // Key == record.id
    if (key !== kase.id) {
      errors.push(justiceErr(`case map key "${key}" does not match record.id "${kase.id}"`));
    }

    const caseSeq = seqFromId(kase.id);
    if (caseSeq !== undefined && caseSeq > maxCaseSeq) maxCaseSeq = caseSeq;

    // Status invariants
    if (kase.status === "open" && kase.closedAt !== undefined) {
      errors.push(justiceErr(`case ${kase.id} status=open but has closedAt`));
    }
    if (kase.status === "decided") {
      if (!kase.verdict) errors.push(justiceErr(`case ${kase.id} status=decided but has no verdict`));
      if (kase.closedAt !== undefined) errors.push(justiceErr(`case ${kase.id} status=decided but has closedAt`));
    }
    if (kase.status === "closed" && kase.closedAt === undefined) {
      errors.push(justiceErr(`case ${kase.id} status=closed but missing closedAt`));
    }

    // Verdict invariants
    if (kase.verdict) {
      const chargeIdSet = new Set(kase.charges.map((c) => c.id));
      const seenFindingChargeIds = new Set<string>();
      for (const f of kase.verdict.findings) {
        if (!chargeIdSet.has(f.chargeId)) {
          errors.push(justiceErr(`case ${kase.id} verdict references charge ${f.chargeId} not in case`));
        }
        if (seenFindingChargeIds.has(f.chargeId)) {
          errors.push(justiceErr(`case ${kase.id} verdict has duplicate finding chargeId ${f.chargeId}`));
        }
        seenFindingChargeIds.add(f.chargeId);
      }
    }

    // punishmentIds: no duplicates
    const seenPunIds = new Set<string>();
    for (const punId of kase.punishmentIds) {
      if (seenPunIds.has(punId)) {
        errors.push(justiceErr(`case ${kase.id} has duplicate punishmentId ${punId}`));
      }
      seenPunIds.add(punId);
      // Existence check deferred to cross-link section
    }

    // Sub-record IDs
    for (const charge of kase.charges) {
      if (!isChargeId(charge.id)) {
        errors.push(justiceErr(`case ${kase.id} charge "${charge.id}" is not a valid charge ID format`));
      }
      if (allChargeIds.has(charge.id)) {
        errors.push(justiceErr(`duplicate charge ID ${charge.id} across cases`));
      }
      allChargeIds.add(charge.id);
      const s = seqFromId(charge.id);
      if (s !== undefined && s > maxChargeSeq) maxChargeSeq = s;
    }

    for (const ev of kase.evidence) {
      if (!isEvidenceId(ev.id)) {
        errors.push(justiceErr(`case ${kase.id} evidence "${ev.id}" is not a valid evidence ID format`));
      }
      if (allEvidenceIds.has(ev.id)) {
        errors.push(justiceErr(`duplicate evidence ID ${ev.id} across cases`));
      }
      allEvidenceIds.add(ev.id);
      const s = seqFromId(ev.id);
      if (s !== undefined && s > maxEvidenceSeq) maxEvidenceSeq = s;
    }

    for (const cf of kase.confessions) {
      if (!isConfessionId(cf.id)) {
        errors.push(justiceErr(`case ${kase.id} confession "${cf.id}" is not a valid confession ID format`));
      }
      if (allConfessionIds.has(cf.id)) {
        errors.push(justiceErr(`duplicate confession ID ${cf.id} across cases`));
      }
      allConfessionIds.add(cf.id);
      const s = seqFromId(cf.id);
      if (s !== undefined && s > maxConfessionSeq) maxConfessionSeq = s;
    }

    if (kase.verdict) {
      if (!isVerdictId(kase.verdict.id)) {
        errors.push(justiceErr(`case ${kase.id} verdict "${kase.verdict.id}" is not a valid verdict ID format`));
      }
      if (allVerdictIds.has(kase.verdict.id)) {
        errors.push(justiceErr(`duplicate verdict ID ${kase.verdict.id} across cases`));
      }
      allVerdictIds.add(kase.verdict.id);
      const s = seqFromId(kase.verdict.id);
      if (s !== undefined && s > maxVerdictSeq) maxVerdictSeq = s;
    }
  }

  // ── Punishment map validation ─────────────────────────────────────────────
  for (const [key, pun] of Object.entries(justice.punishments)) {
    if (!isPunishmentId(key)) {
      errors.push(justiceErr(`punishment map key "${key}" is not a valid punishment ID format`));
    }
    if (key !== pun.id) {
      errors.push(justiceErr(`punishment map key "${key}" does not match record.id "${pun.id}"`));
    }

    const punSeq = seqFromId(pun.id);
    if (punSeq !== undefined && punSeq > maxPunSeq) maxPunSeq = punSeq;

    // caseId referential integrity
    if (pun.caseId) {
      if (!justice.cases[pun.caseId]) {
        errors.push(justiceErr(`punishment ${pun.id} references non-existent case ${pun.caseId}`));
      } else {
        // Reverse linkage: case must list this punishment
        const kase = justice.cases[pun.caseId]!;
        if (!kase.punishmentIds.includes(pun.id)) {
          errors.push(justiceErr(`punishment ${pun.id} has caseId=${pun.caseId} but case does not list it in punishmentIds`));
        }
      }
    }

    // lifecycle consistency
    if (pun.lifecycle.status === "active") {
      // active has no extra fields — discriminated union already enforces this
    }

    // kind/details structural consistency
    errors.push(...validatePunishmentDetails(pun));
  }

  // ── Case punishmentIds → punishment reverse link ──────────────────────────
  for (const kase of Object.values(justice.cases) as CaseRecord[]) {
    for (const punId of kase.punishmentIds) {
      const pun = justice.punishments[punId];
      if (!pun) {
        errors.push(justiceErr(`case ${kase.id} lists punishment ${punId} but it does not exist`));
      } else if (pun.caseId !== kase.id) {
        errors.push(justiceErr(`case ${kase.id} lists punishment ${punId} but punishment.caseId="${pun.caseId}"`));
      }
    }
  }

  // ── nextSeq invariants ────────────────────────────────────────────────────
  if (justice.nextSeq.case <= maxCaseSeq) {
    errors.push(justiceErr(`nextSeq.case (${justice.nextSeq.case}) must be > max persisted case seq (${maxCaseSeq})`));
  }
  if (justice.nextSeq.punishment <= maxPunSeq) {
    errors.push(justiceErr(`nextSeq.punishment (${justice.nextSeq.punishment}) must be > max persisted punishment seq (${maxPunSeq})`));
  }
  if (justice.nextSeq.charge <= maxChargeSeq) {
    errors.push(justiceErr(`nextSeq.charge (${justice.nextSeq.charge}) must be > max persisted charge seq (${maxChargeSeq})`));
  }
  if (justice.nextSeq.evidence <= maxEvidenceSeq) {
    errors.push(justiceErr(`nextSeq.evidence (${justice.nextSeq.evidence}) must be > max persisted evidence seq (${maxEvidenceSeq})`));
  }
  if (justice.nextSeq.confession <= maxConfessionSeq) {
    errors.push(justiceErr(`nextSeq.confession (${justice.nextSeq.confession}) must be > max persisted confession seq (${maxConfessionSeq})`));
  }
  if (justice.nextSeq.verdict <= maxVerdictSeq) {
    errors.push(justiceErr(`nextSeq.verdict (${justice.nextSeq.verdict}) must be > max persisted verdict seq (${maxVerdictSeq})`));
  }

  return errors;
}

function validatePunishmentDetails(pun: PunishmentRecord): GameError[] {
  const errors: GameError[] = [];
  switch (pun.kind) {
    case "rank_demotion":
      if (pun.details.fromRankId === pun.details.toRankId) {
        errors.push(justiceErr(`punishment ${pun.id}: rank_demotion fromRankId and toRankId must differ`));
      }
      break;
    case "strip_title":
      if (!pun.details.removedTitle) {
        errors.push(justiceErr(`punishment ${pun.id}: strip_title removedTitle must be non-empty`));
      }
      break;
    case "finite_confinement":
      if (pun.details.endTurnExclusive < 0) {
        errors.push(justiceErr(`punishment ${pun.id}: finite_confinement endTurnExclusive must be >= 0`));
      }
      break;
    case "cold_palace":
      if (pun.details.previousResidenceId === pun.details.coldPalaceResidenceId) {
        errors.push(justiceErr(`punishment ${pun.id}: cold_palace previousResidenceId and coldPalaceResidenceId must differ`));
      }
      break;
    case "strip_harem_authority":
      if (pun.details.initialTarget.mode === "acting_consort" && !pun.details.initialTarget.charId) {
        errors.push(justiceErr(`punishment ${pun.id}: strip_harem_authority acting_consort charId must be non-empty`));
      }
      break;
    case "official_demotion":
      if (!pun.details.fromPostId || pun.details.fromPostId === pun.details.toPostId) {
        errors.push(justiceErr(`punishment ${pun.id}: official_demotion fromPostId must be non-empty and differ from toPostId`));
      }
      break;
    case "official_dismissal":
      if (!pun.details.fromPostId) {
        errors.push(justiceErr(`punishment ${pun.id}: official_dismissal fromPostId must be non-empty`));
      }
      break;
  }
  return errors;
}

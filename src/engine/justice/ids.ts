/**
 * PUNISH-3B1: Stable ID generation for justice records.
 *
 * All functions are pure — they return new IDs without mutating state.
 * The caller is responsible for advancing nextSeq only on commit success.
 */
import type { JusticeState, JusticeNextSeq } from "./types";
import type { CaseId, PunishmentId, ChargeId, EvidenceId, ConfessionId, VerdictId } from "./types";
import { CASE_ID_REGEX, PUNISHMENT_ID_REGEX, CHARGE_ID_REGEX, EVIDENCE_ID_REGEX, CONFESSION_ID_REGEX, VERDICT_ID_REGEX } from "./types";

function pad(n: number): string {
  return String(n).padStart(6, "0");
}

export function formatCaseId(seq: number): CaseId {
  return `case_${pad(seq)}` as CaseId;
}
export function formatPunishmentId(seq: number): PunishmentId {
  return `pun_${pad(seq)}` as PunishmentId;
}
export function formatChargeId(seq: number): ChargeId {
  return `chg_${pad(seq)}` as ChargeId;
}
export function formatEvidenceId(seq: number): EvidenceId {
  return `evi_${pad(seq)}` as EvidenceId;
}
export function formatConfessionId(seq: number): ConfessionId {
  return `cnf_${pad(seq)}` as ConfessionId;
}
export function formatVerdictId(seq: number): VerdictId {
  return `vdt_${pad(seq)}` as VerdictId;
}

/** Returns the next CaseId without advancing state. */
export function nextCaseId(justice: JusticeState): CaseId {
  return formatCaseId(justice.nextSeq.case);
}

/** Returns the next PunishmentId without advancing state. */
export function nextPunishmentId(justice: JusticeState): PunishmentId {
  return formatPunishmentId(justice.nextSeq.punishment);
}

export function nextChargeId(justice: JusticeState): ChargeId {
  return formatChargeId(justice.nextSeq.charge);
}

export function nextEvidenceId(justice: JusticeState): EvidenceId {
  return formatEvidenceId(justice.nextSeq.evidence);
}

export function nextConfessionId(justice: JusticeState): ConfessionId {
  return formatConfessionId(justice.nextSeq.confession);
}

export function nextVerdictId(justice: JusticeState): VerdictId {
  return formatVerdictId(justice.nextSeq.verdict);
}

export interface JusticeIdAllocation {
  /** Advanced nextSeq reflecting all allocated IDs. Apply to candidate state only on commit. */
  nextSeq: JusticeNextSeq;
  cases: CaseId[];
  punishments: PunishmentId[];
  charges: ChargeId[];
  evidence: EvidenceId[];
  confessions: ConfessionId[];
  verdicts: VerdictId[];
}

/**
 * Pre-allocate multiple IDs in one call.
 * Returns the new nextSeq alongside all IDs — caller applies nextSeq only on transaction commit.
 */
export function allocateJusticeIds(
  justice: JusticeState,
  counts: {
    cases?: number;
    punishments?: number;
    charges?: number;
    evidence?: number;
    confessions?: number;
    verdicts?: number;
  },
): JusticeIdAllocation {
  let { case: c, punishment: p, charge: ch, evidence: e, confession: cnf, verdict: v } = justice.nextSeq;

  const cases: CaseId[] = [];
  for (let i = 0; i < (counts.cases ?? 0); i++) cases.push(formatCaseId(c++));

  const punishments: PunishmentId[] = [];
  for (let i = 0; i < (counts.punishments ?? 0); i++) punishments.push(formatPunishmentId(p++));

  const charges: ChargeId[] = [];
  for (let i = 0; i < (counts.charges ?? 0); i++) charges.push(formatChargeId(ch++));

  const evidence: EvidenceId[] = [];
  for (let i = 0; i < (counts.evidence ?? 0); i++) evidence.push(formatEvidenceId(e++));

  const confessions: ConfessionId[] = [];
  for (let i = 0; i < (counts.confessions ?? 0); i++) confessions.push(formatConfessionId(cnf++));

  const verdicts: VerdictId[] = [];
  for (let i = 0; i < (counts.verdicts ?? 0); i++) verdicts.push(formatVerdictId(v++));

  return {
    nextSeq: { case: c, punishment: p, charge: ch, evidence: e, confession: cnf, verdict: v },
    cases,
    punishments,
    charges,
    evidence,
    confessions,
    verdicts,
  };
}

// ── Validation helpers ────────────────────────────────────────────────────────

export function isCaseId(s: string): s is CaseId {
  return CASE_ID_REGEX.test(s);
}
export function isPunishmentId(s: string): s is PunishmentId {
  return PUNISHMENT_ID_REGEX.test(s);
}
export function isChargeId(s: string): s is ChargeId {
  return CHARGE_ID_REGEX.test(s);
}
export function isEvidenceId(s: string): s is EvidenceId {
  return EVIDENCE_ID_REGEX.test(s);
}
export function isConfessionId(s: string): s is ConfessionId {
  return CONFESSION_ID_REGEX.test(s);
}
export function isVerdictId(s: string): s is VerdictId {
  return VERDICT_ID_REGEX.test(s);
}

/** Extract numeric sequence from an ID string (any format). Returns undefined if not parseable. */
export function seqFromId(id: string): number | undefined {
  const m = id.match(/_(\d{6})$/);
  if (!m) return undefined;
  return parseInt(m[1]!, 10);
}

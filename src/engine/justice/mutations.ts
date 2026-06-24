/**
 * PUNISH-3B1: Pure justice mutations.
 *
 * applyJusticeMutations() is a pure function — never mutates state.
 * Invariant violations return err([...]); callers must not partially apply.
 */
import { err, ok, type Result } from "../infra/result";
import { gameError, type GameError } from "../infra/errors";
import type { GameState } from "../state/types";
import type { GameTime } from "../calendar/time";
import type { CaseId, PunishmentId, CaseRecord, ChargeRecord, EvidenceRecord, ConfessionRecord, VerdictRecord, PunishmentRecord, PunishmentLifecycle } from "./types";
import { seqFromId } from "./ids";

// ── Mutation union ────────────────────────────────────────────────────────────

export type JusticeMutation =
  | { type: "create_case"; record: CaseRecord }
  | { type: "append_charge"; caseId: CaseId; charge: ChargeRecord }
  | { type: "append_evidence"; caseId: CaseId; evidence: EvidenceRecord }
  | { type: "append_confession"; caseId: CaseId; confession: ConfessionRecord }
  | { type: "record_verdict"; caseId: CaseId; verdict: VerdictRecord }
  | { type: "close_case"; caseId: CaseId; closedAt: GameTime }
  | { type: "create_punishment"; record: PunishmentRecord }
  | { type: "resolve_punishment"; punishmentId: PunishmentId; lifecycle: Exclude<PunishmentLifecycle, { status: "active" }> };

// ── Validation helpers ────────────────────────────────────────────────────────

function justiceErr(msg: string): GameError {
  return gameError("state", "BAD_JUSTICE_MUTATION", msg);
}

function checkNextSeqConsistency(justice: { cases: Record<string, unknown>; punishments: Record<string, unknown>; nextSeq: { case: number; punishment: number } }): string | null {
  // nextSeq must be strictly greater than all existing IDs of that type.
  for (const id of Object.keys(justice.cases)) {
    const seq = seqFromId(id);
    if (seq !== undefined && seq >= justice.nextSeq.case) {
      return `justice.nextSeq.case (${justice.nextSeq.case}) must be > existing case ID seq ${seq} (${id})`;
    }
  }
  for (const id of Object.keys(justice.punishments)) {
    const seq = seqFromId(id);
    if (seq !== undefined && seq >= justice.nextSeq.punishment) {
      return `justice.nextSeq.punishment (${justice.nextSeq.punishment}) must be > existing punishment ID seq ${seq} (${id})`;
    }
  }
  return null;
}

// ── Apply mutations ───────────────────────────────────────────────────────────

/**
 * Apply a batch of JusticeMutations to state.justice atomically.
 * All mutations are validated first; if any fails, state is unchanged.
 * Callers must ensure nextSeq was pre-advanced in the candidate state before calling this.
 */
export function applyJusticeMutations(
  state: GameState,
  mutations: JusticeMutation[],
): Result<GameState, GameError[]> {
  if (mutations.length === 0) return ok(state);

  // Work on a shallow-cloned justice (deep-clone cases/punishments for safety).
  let cases = { ...state.justice.cases };
  let punishments = { ...state.justice.punishments };
  const nextSeq = { ...state.justice.nextSeq };

  // Validate nextSeq consistency before applying.
  const seqErr = checkNextSeqConsistency({ cases, punishments, nextSeq });
  if (seqErr) return err([justiceErr(seqErr)]);

  const errors: GameError[] = [];

  // Validate all mutations before applying any.
  for (const mut of mutations) {
    switch (mut.type) {
      case "create_case": {
        if (cases[mut.record.id]) {
          errors.push(justiceErr(`duplicate case ID ${mut.record.id}`));
        }
        break;
      }
      case "create_punishment": {
        if (punishments[mut.record.id]) {
          errors.push(justiceErr(`duplicate punishment ID ${mut.record.id}`));
        }
        if (mut.record.caseId) {
          // caseId must be an existing case OR a case being created in this batch.
          const existingOrBatch = cases[mut.record.caseId] ??
            mutations.find((m) => m.type === "create_case" && m.record.id === mut.record.caseId) != null;
          if (!existingOrBatch) {
            errors.push(justiceErr(`punishment ${mut.record.id} references unknown caseId ${mut.record.caseId}`));
          }
        }
        break;
      }
      case "append_charge":
      case "append_evidence":
      case "append_confession": {
        const kase = cases[mut.caseId] ??
          (mutations.find((m) => m.type === "create_case" && m.record.id === mut.caseId) as { record: CaseRecord } | undefined)?.record;
        if (!kase) {
          errors.push(justiceErr(`case ${mut.caseId} not found`));
        } else if (kase.status === "closed") {
          errors.push(justiceErr(`cannot append to closed case ${mut.caseId}`));
        }
        break;
      }
      case "record_verdict": {
        const kase = cases[mut.caseId] ??
          (mutations.find((m) => m.type === "create_case" && m.record.id === mut.caseId) as { record: CaseRecord } | undefined)?.record;
        if (!kase) {
          errors.push(justiceErr(`case ${mut.caseId} not found for verdict`));
        } else if (kase.status === "closed") {
          errors.push(justiceErr(`cannot record verdict on closed case ${mut.caseId}`));
        } else if (kase.verdict) {
          errors.push(justiceErr(`case ${mut.caseId} already has a verdict`));
        } else {
          // Verify all finding chargeIds belong to this case.
          const chargeIds = new Set(kase.charges.map((c) => c.id));
          for (const f of mut.verdict.findings) {
            if (!chargeIds.has(f.chargeId)) {
              errors.push(justiceErr(`verdict finding references charge ${f.chargeId} not in case ${mut.caseId}`));
            }
          }
        }
        break;
      }
      case "close_case": {
        const kase = cases[mut.caseId] ??
          (mutations.find((m) => m.type === "create_case" && m.record.id === mut.caseId) as { record: CaseRecord } | undefined)?.record;
        if (!kase) {
          errors.push(justiceErr(`case ${mut.caseId} not found for close`));
        } else if (kase.status === "closed") {
          errors.push(justiceErr(`case ${mut.caseId} is already closed`));
        }
        break;
      }
      case "resolve_punishment": {
        const p = punishments[mut.punishmentId] ??
          (mutations.find((m) => m.type === "create_punishment" && m.record.id === mut.punishmentId) as { record: PunishmentRecord } | undefined)?.record;
        if (!p) {
          errors.push(justiceErr(`punishment ${mut.punishmentId} not found`));
        } else if (p.lifecycle.status !== "active") {
          errors.push(justiceErr(`punishment ${mut.punishmentId} is not active (status=${p.lifecycle.status})`));
        }
        break;
      }
    }
  }

  if (errors.length > 0) return err(errors);

  // Apply all mutations.
  for (const mut of mutations) {
    switch (mut.type) {
      case "create_case": {
        cases = { ...cases, [mut.record.id]: mut.record };
        break;
      }
      case "create_punishment": {
        punishments = { ...punishments, [mut.record.id]: mut.record };
        // Maintain bidirectional case→punishments linkage automatically.
        if (mut.record.caseId) {
          const kase = cases[mut.record.caseId];
          if (kase) {
            cases = {
              ...cases,
              [mut.record.caseId]: {
                ...kase,
                punishmentIds: [...kase.punishmentIds, mut.record.id],
              },
            };
          }
        }
        break;
      }
      case "append_charge": {
        const kase = cases[mut.caseId]!;
        cases = { ...cases, [mut.caseId]: { ...kase, charges: [...kase.charges, mut.charge] } };
        break;
      }
      case "append_evidence": {
        const kase = cases[mut.caseId]!;
        cases = { ...cases, [mut.caseId]: { ...kase, evidence: [...kase.evidence, mut.evidence] } };
        break;
      }
      case "append_confession": {
        const kase = cases[mut.caseId]!;
        cases = { ...cases, [mut.caseId]: { ...kase, confessions: [...kase.confessions, mut.confession] } };
        break;
      }
      case "record_verdict": {
        const kase = cases[mut.caseId]!;
        cases = { ...cases, [mut.caseId]: { ...kase, verdict: mut.verdict, status: "decided" } };
        break;
      }
      case "close_case": {
        const kase = cases[mut.caseId]!;
        cases = { ...cases, [mut.caseId]: { ...kase, status: "closed", closedAt: mut.closedAt } };
        break;
      }
      case "resolve_punishment": {
        const p = punishments[mut.punishmentId]!;
        punishments = { ...punishments, [mut.punishmentId]: { ...p, lifecycle: mut.lifecycle } };
        break;
      }
    }
  }

  return ok({
    ...state,
    justice: { ...state.justice, cases, punishments, nextSeq },
  });
}

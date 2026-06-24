/**
 * PUNISH-3B1: Pure justice mutations.
 *
 * applyJusticeMutations() is a pure function — never mutates state.
 * Uses single-pass draft application: each mutation is validated and applied
 * against the current draft in order. Any failure discards the entire draft.
 *
 * JusticePlan carries both mutations AND the target nextSeq, ensuring that
 * sequence allocation and record creation are committed atomically.
 */
import { err, ok, type Result } from "../infra/result";
import { gameError, type GameError } from "../infra/errors";
import type { GameState } from "../state/types";
import type { GameTime } from "../calendar/time";
import type {
  CaseId, PunishmentId, CaseRecord, ChargeRecord, EvidenceRecord,
  ConfessionRecord, VerdictRecord, PunishmentRecord, PunishmentLifecycle,
  JusticeState, JusticeNextSeq,
} from "./types";
import { validateJusticeState } from "./validation";

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

/**
 * Atomic justice transaction object.
 * mutations: the record operations to apply.
 * nextSeq: the advanced sequence counters after all IDs in mutations are consumed.
 *   Must be exactly allocateJusticeIds(state.justice, { ... }).nextSeq.
 */
export interface JusticePlan {
  mutations: JusticeMutation[];
  nextSeq: JusticeNextSeq;
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function justiceErr(msg: string): GameError {
  return gameError("state", "BAD_JUSTICE_MUTATION", msg);
}

// ── Sequence consumption verification ─────────────────────────────────────────

type SeqDomain = "case" | "punishment" | "charge" | "evidence" | "confession" | "verdict";

function parseSeq(id: string): number {
  return parseInt(id.slice(-6), 10);
}

function collectCreatedSeqs(mutations: JusticeMutation[]): Record<SeqDomain, Set<number>> {
  const sets: Record<SeqDomain, Set<number>> = {
    case: new Set(), punishment: new Set(), charge: new Set(),
    evidence: new Set(), confession: new Set(), verdict: new Set(),
  };
  for (const mut of mutations) {
    switch (mut.type) {
      case "create_case":
        sets.case.add(parseSeq(mut.record.id));
        for (const c of mut.record.charges) sets.charge.add(parseSeq(c.id));
        for (const e of mut.record.evidence) sets.evidence.add(parseSeq(e.id));
        for (const c of mut.record.confessions) sets.confession.add(parseSeq(c.id));
        if (mut.record.verdict) sets.verdict.add(parseSeq(mut.record.verdict.id));
        break;
      case "create_punishment":
        sets.punishment.add(parseSeq(mut.record.id));
        break;
      case "append_charge":
        sets.charge.add(parseSeq(mut.charge.id));
        break;
      case "append_evidence":
        sets.evidence.add(parseSeq(mut.evidence.id));
        break;
      case "append_confession":
        sets.confession.add(parseSeq(mut.confession.id));
        break;
      case "record_verdict":
        sets.verdict.add(parseSeq(mut.verdict.id));
        break;
    }
  }
  return sets;
}

function verifySeqConsumption(
  before: JusticeNextSeq,
  planNextSeq: JusticeNextSeq,
  mutations: JusticeMutation[],
): GameError[] {
  const errors: GameError[] = [];
  const created = collectCreatedSeqs(mutations);
  const domains: SeqDomain[] = ["case", "punishment", "charge", "evidence", "confession", "verdict"];

  for (const domain of domains) {
    const oldSeq = before[domain];
    const newSeq = planNextSeq[domain];
    if (newSeq < oldSeq) {
      errors.push(justiceErr(`nextSeq.${domain}: may not decrease (${oldSeq} → ${newSeq})`));
      continue;
    }
    const count = newSeq - oldSeq;
    const createdSet = created[domain];
    if (createdSet.size !== count) {
      errors.push(justiceErr(
        `nextSeq.${domain}: plan claims ${count} new IDs (${oldSeq}→${newSeq}) but mutations create ${createdSet.size}`,
      ));
      continue;
    }
    for (let seq = oldSeq; seq < newSeq; seq++) {
      if (!createdSet.has(seq)) {
        errors.push(justiceErr(`nextSeq.${domain}: expected seq ${seq} to be created but was not`));
      }
    }
  }
  return errors;
}

// ── Single-mutation applicator ────────────────────────────────────────────────

function applyOneMutation(
  justice: JusticeState,
  mut: JusticeMutation,
): Result<JusticeState, GameError> {
  switch (mut.type) {
    case "create_case": {
      if (justice.cases[mut.record.id]) {
        return err(justiceErr(`duplicate case ID ${mut.record.id}`));
      }
      return ok({ ...justice, cases: { ...justice.cases, [mut.record.id]: mut.record } });
    }

    case "create_punishment": {
      if (justice.punishments[mut.record.id]) {
        return err(justiceErr(`duplicate punishment ID ${mut.record.id}`));
      }
      if (mut.record.caseId) {
        const kase = justice.cases[mut.record.caseId];
        if (!kase) {
          return err(justiceErr(`punishment ${mut.record.id} references unknown case ${mut.record.caseId}`));
        }
        if (kase.status === "closed") {
          return err(justiceErr(`punishment ${mut.record.id} references closed case ${mut.record.caseId}`));
        }
        if (!kase.subjectIds.includes(mut.record.targetId)) {
          return err(justiceErr(`punishment ${mut.record.id}: targetId ${mut.record.targetId} is not a subject of case ${mut.record.caseId}`));
        }
      }
      let cases = justice.cases;
      if (mut.record.caseId) {
        const kase = justice.cases[mut.record.caseId]!;
        cases = { ...cases, [mut.record.caseId]: { ...kase, punishmentIds: [...kase.punishmentIds, mut.record.id] } };
      }
      return ok({ ...justice, cases, punishments: { ...justice.punishments, [mut.record.id]: mut.record } });
    }

    case "append_charge": {
      const kase = justice.cases[mut.caseId];
      if (!kase) return err(justiceErr(`case ${mut.caseId} not found`));
      if (kase.status === "closed") return err(justiceErr(`cannot append to closed case ${mut.caseId}`));
      return ok({ ...justice, cases: { ...justice.cases, [mut.caseId]: { ...kase, charges: [...kase.charges, mut.charge] } } });
    }

    case "append_evidence": {
      const kase = justice.cases[mut.caseId];
      if (!kase) return err(justiceErr(`case ${mut.caseId} not found`));
      if (kase.status === "closed") return err(justiceErr(`cannot append to closed case ${mut.caseId}`));
      return ok({ ...justice, cases: { ...justice.cases, [mut.caseId]: { ...kase, evidence: [...kase.evidence, mut.evidence] } } });
    }

    case "append_confession": {
      const kase = justice.cases[mut.caseId];
      if (!kase) return err(justiceErr(`case ${mut.caseId} not found`));
      if (kase.status === "closed") return err(justiceErr(`cannot append to closed case ${mut.caseId}`));
      return ok({ ...justice, cases: { ...justice.cases, [mut.caseId]: { ...kase, confessions: [...kase.confessions, mut.confession] } } });
    }

    case "record_verdict": {
      const kase = justice.cases[mut.caseId];
      if (!kase) return err(justiceErr(`case ${mut.caseId} not found for verdict`));
      if (kase.status === "closed") return err(justiceErr(`cannot record verdict on closed case ${mut.caseId}`));
      if (kase.verdict) return err(justiceErr(`case ${mut.caseId} already has a verdict`));
      const chargeIds = new Set(kase.charges.map((c) => c.id));
      for (const f of mut.verdict.findings) {
        if (!chargeIds.has(f.chargeId)) {
          return err(justiceErr(`verdict finding references charge ${f.chargeId} not in case ${mut.caseId}`));
        }
      }
      return ok({ ...justice, cases: { ...justice.cases, [mut.caseId]: { ...kase, verdict: mut.verdict, status: "decided" as const } } });
    }

    case "close_case": {
      const kase = justice.cases[mut.caseId];
      if (!kase) return err(justiceErr(`case ${mut.caseId} not found for close`));
      if (kase.status === "closed") return err(justiceErr(`case ${mut.caseId} is already closed`));
      return ok({ ...justice, cases: { ...justice.cases, [mut.caseId]: { ...kase, status: "closed" as const, closedAt: mut.closedAt } } });
    }

    case "resolve_punishment": {
      const p = justice.punishments[mut.punishmentId];
      if (!p) return err(justiceErr(`punishment ${mut.punishmentId} not found`));
      if (p.lifecycle.status !== "active") {
        return err(justiceErr(`punishment ${mut.punishmentId} is not active (status=${p.lifecycle.status})`));
      }
      return ok({ ...justice, punishments: { ...justice.punishments, [mut.punishmentId]: { ...p, lifecycle: mut.lifecycle } } });
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply a JusticePlan atomically to state.
 *
 * Applies plan.nextSeq first (the pre-allocated sequence target), then
 * applies each mutation in order against an evolving draft. If any step
 * fails, the entire draft is discarded and the original state is returned.
 *
 * Post-apply: runs full validateJusticeState to enforce invariants.
 *
 * Callers must obtain plan.nextSeq from allocateJusticeIds() and must not
 * manually advance state.justice.nextSeq before calling this.
 */
export function applyJusticePlan(
  state: GameState,
  plan: JusticePlan,
): Result<GameState, GameError[]> {
  // Verify IDs created by mutations exactly cover [old nextSeq, plan.nextSeq).
  const seqErrors = verifySeqConsumption(state.justice.nextSeq, plan.nextSeq, plan.mutations);
  if (seqErrors.length > 0) return err(seqErrors);

  if (plan.mutations.length === 0) {
    // Still apply nextSeq update even with no mutations (idempotent allocations).
    const newJustice = { ...state.justice, nextSeq: plan.nextSeq };
    const errs = validateJusticeState(newJustice);
    if (errs.length > 0) return err(errs);
    return ok({ ...state, justice: newJustice });
  }

  // Start draft with the target nextSeq already applied.
  let draft: JusticeState = { ...state.justice, nextSeq: plan.nextSeq };

  for (const mut of plan.mutations) {
    const result = applyOneMutation(draft, mut);
    if (!result.ok) return err([result.error]);
    draft = result.value;
  }

  // Full post-apply invariant check.
  const validationErrors = validateJusticeState(draft);
  if (validationErrors.length > 0) return err(validationErrors);

  return ok({ ...state, justice: draft });
}

/**
 * Low-level: apply mutations with caller-managed nextSeq.
 * The state passed must already have the correct nextSeq set.
 * Prefer applyJusticePlan() for production paths.
 *
 * Returns same state reference (not a new object) if mutations is empty.
 */
export function applyJusticeMutations(
  state: GameState,
  mutations: JusticeMutation[],
): Result<GameState, GameError[]> {
  if (mutations.length === 0) return ok(state);

  let draft: JusticeState = state.justice;

  for (const mut of mutations) {
    const result = applyOneMutation(draft, mut);
    if (!result.ok) return err([result.error]);
    draft = result.value;
  }

  const validationErrors = validateJusticeState(draft);
  if (validationErrors.length > 0) return err(validationErrors);

  return ok({ ...state, justice: draft });
}

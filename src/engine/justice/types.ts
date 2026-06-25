/**
 * PUNISH-3B1: Justice state — 司法记录持久层核心类型。
 *
 * 所有 ID 使用持久 sequence（pun_000001 / case_000001 等），
 * 永不复用，事务失败不推进 nextSeq。
 */
import type { GameTime } from "../calendar/time";
import type { PunishmentKind, PunishmentSeverity } from "../punishments/types";

// ── ID type aliases (validated at runtime by regex) ───────────────────────────

export type CaseId = string;
export type PunishmentId = string;
export type ChargeId = string;
export type EvidenceId = string;
export type ConfessionId = string;
export type VerdictId = string;

export const CASE_ID_REGEX = /^case_\d{6}$/;
export const PUNISHMENT_ID_REGEX = /^pun_\d{6}$/;
export const CHARGE_ID_REGEX = /^chg_\d{6}$/;
export const EVIDENCE_ID_REGEX = /^evi_\d{6}$/;
export const CONFESSION_ID_REGEX = /^cnf_\d{6}$/;
export const VERDICT_ID_REGEX = /^vdt_\d{6}$/;

// ── Sequence counters ─────────────────────────────────────────────────────────

export interface JusticeNextSeq {
  case: number;
  punishment: number;
  charge: number;
  evidence: number;
  confession: number;
  verdict: number;
}

// ── Sub-records ───────────────────────────────────────────────────────────────

export interface ChargeRecord {
  id: ChargeId;
  summary: string;
  allegedAt: GameTime;
  allegedBy: string;
  status: "alleged" | "proven" | "dismissed";
}

export interface EvidenceRecord {
  id: EvidenceId;
  kind: "testimony" | "document" | "physical" | "medical" | "observation" | "intelligence";
  summary: string;
  discoveredAt: GameTime;
  discoveredBy: string;
  sourceIds: string[];
  /** 0–100；系统判断值，不代表角色知晓。 */
  reliability: number;
}

export interface ConfessionRecord {
  id: ConfessionId;
  byId: string;
  recordedAt: GameTime;
  summary: string;
  voluntary: boolean;
  retractedAt?: GameTime;
}

export interface VerdictRecord {
  id: VerdictId;
  decidedAt: GameTime;
  decidedBy: string;
  findings: Array<{
    chargeId: ChargeId;
    result: "proven" | "not_proven" | "dismissed";
  }>;
  summary?: string;
}

// ── CaseRecord ────────────────────────────────────────────────────────────────

export interface CaseRecord {
  id: CaseId;
  status: "open" | "decided" | "closed";

  subjectIds: string[];
  openedAt: GameTime;
  openedBy: string;

  source:
    | { kind: "imperial" }
    | { kind: "investigation"; investigationId?: string }
    | { kind: "scripted"; sourceId: string };

  publicity: "secret" | "palace" | "public";

  charges: ChargeRecord[];
  evidence: EvidenceRecord[];
  confessions: ConfessionRecord[];

  verdict?: VerdictRecord;
  punishmentIds: PunishmentId[];

  closedAt?: GameTime;
}

// ── PunishmentRecord ──────────────────────────────────────────────────────────

export type PunishmentLifecycle =
  | { status: "active" }
  | { status: "completed"; resolvedAt: GameTime; resolution: "immediate" | "expired" | "target_deceased" }
  | { status: "lifted"; resolvedAt: GameTime; resolution: "lifted_by_decree" | "authority_restored" | "pardoned" };

export interface PunishmentBase {
  id: PunishmentId;
  caseId?: CaseId;
  targetId: string;
  actorId: string;
  kind: PunishmentKind;
  severity: PunishmentSeverity;
  imposedAt: GameTime;
  sourceLocation?: string;
  publicity: "secret" | "palace" | "public";
  lifecycle: PunishmentLifecycle;
}

export type PunishmentRecord =
  | (PunishmentBase & { kind: "rank_demotion"; details: { fromRankId: string; toRankId: string } })
  | (PunishmentBase & { kind: "strip_title"; details: { removedTitle: string } })
  | (PunishmentBase & { kind: "finite_confinement"; details: { statusEffectId: string; endTurnExclusive: number } })
  | (PunishmentBase & { kind: "indefinite_confinement"; details: { statusEffectId: string } })
  | (PunishmentBase & { kind: "cold_palace"; details: { previousResidenceId: string; coldPalaceResidenceId: string } })
  | (PunishmentBase & { kind: "execution"; details: { deathCause: "imperial_execution" } })
  | (PunishmentBase & {
      kind: "strip_harem_authority";
      details: {
        fromMode: "empress";
        initialTarget: { mode: "acting_consort"; charId: string } | { mode: "neiwu_proxy" };
      };
    });

// ── JusticeState ──────────────────────────────────────────────────────────────

export interface JusticeState {
  cases: Record<string, CaseRecord>;
  punishments: Record<string, PunishmentRecord>;
  nextSeq: JusticeNextSeq;
}

export function createEmptyJusticeState(): JusticeState {
  return {
    cases: {},
    punishments: {},
    nextSeq: { case: 1, punishment: 1, charge: 1, evidence: 1, confession: 1, verdict: 1 },
  };
}

// ── Justice chronicle links (typed provenance) ────────────────────────────────

export interface JusticeLinks {
  caseId?: CaseId;
  punishmentId?: PunishmentId;
  /** 解除/到期/宫权恢复时：指向原处罚记录。 */
  sourcePunishmentId?: PunishmentId;
}

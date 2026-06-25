/**
 * PUNISH-3B1: Pure selectors for justice state.
 * UI and other systems must use these rather than traversing state.justice directly.
 */
import type { GameState } from "../state/types";
import type { CaseId, PunishmentId, CaseRecord, PunishmentRecord } from "./types";
import type { PunishmentKind } from "../punishments/types";

export function getCase(state: GameState, caseId: CaseId): CaseRecord | undefined {
  return state.justice.cases[caseId];
}

export function getPunishment(state: GameState, punishmentId: PunishmentId): PunishmentRecord | undefined {
  return state.justice.punishments[punishmentId];
}

export function punishmentsForCase(state: GameState, caseId: CaseId): PunishmentRecord[] {
  const kase = state.justice.cases[caseId];
  if (!kase) return [];
  return kase.punishmentIds
    .map((id) => state.justice.punishments[id])
    .filter((p): p is PunishmentRecord => p !== undefined);
}

export function activePunishmentsForTarget(state: GameState, targetId: string): PunishmentRecord[] {
  return Object.values(state.justice.punishments).filter(
    (p) => p !== undefined && p.targetId === targetId && p.lifecycle.status === "active",
  ) as PunishmentRecord[];
}

export function activePunishmentByKind(
  state: GameState,
  targetId: string,
  kind: PunishmentKind,
): PunishmentRecord | undefined {
  return activePunishmentsForTarget(state, targetId).find((p) => p.kind === kind);
}

export function caseForPunishment(state: GameState, punishmentId: PunishmentId): CaseRecord | undefined {
  const p = state.justice.punishments[punishmentId];
  if (!p?.caseId) return undefined;
  return state.justice.cases[p.caseId];
}

export function isPunishmentActive(state: GameState, punishmentId: PunishmentId): boolean {
  const p = state.justice.punishments[punishmentId];
  return p?.lifecycle.status === "active";
}

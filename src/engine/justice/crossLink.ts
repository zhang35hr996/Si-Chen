/**
 * PUNISH-3B2: Cross-link validator for GameState justice consistency.
 *
 * Validates bidirectional links between ConfinementEffect.sourcePunishmentId
 * and PunishmentRecord.details.statusEffectId to catch state corruption early.
 */
import { gameError, type GameError } from "../infra/errors";
import type { GameState } from "../state/types";

function crossLinkErr(msg: string): GameError {
  return gameError("state", "BAD_JUSTICE_CROSSLINK", msg);
}

/**
 * Validate cross-links between active ConfinementEffects and PunishmentRecords.
 * Returns a list of errors (empty = valid).
 */
export function validateJusticeLinks(state: GameState): GameError[] {
  const errors: GameError[] = [];
  const { justice, statusEffects } = state;

  // ── ConfinementEffect → PunishmentRecord checks ───────────────────────────
  for (const effect of statusEffects) {
    if (effect.kind !== "confinement") continue;
    if (effect.liftedTurn !== undefined) continue; // not active

    const { sourcePunishmentId } = effect;
    if (!sourcePunishmentId) continue; // no link to validate

    const pun = justice.punishments[sourcePunishmentId];
    if (!pun) {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} has sourcePunishmentId=${sourcePunishmentId} but punishment not found`,
      ));
      continue;
    }

    if (pun.kind !== "finite_confinement" && pun.kind !== "indefinite_confinement") {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} links to punishment ${pun.id} of kind ${pun.kind} (expected finite_confinement or indefinite_confinement)`,
      ));
    }

    if (pun.targetId !== effect.characterId) {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} characterId=${effect.characterId} but punishment ${pun.id} targetId=${pun.targetId}`,
      ));
    }

    const details = pun.details as { statusEffectId?: string; endTurnExclusive?: number };
    if (details.statusEffectId !== effect.id) {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} links to punishment ${pun.id} but punishment.details.statusEffectId=${details.statusEffectId}`,
      ));
    }

    if (pun.kind === "finite_confinement") {
      if (details.endTurnExclusive !== effect.endTurnExclusive) {
        errors.push(crossLinkErr(
          `ConfinementEffect ${effect.id} endTurnExclusive=${effect.endTurnExclusive} but punishment ${pun.id} details.endTurnExclusive=${details.endTurnExclusive}`,
        ));
      }
    }

    if (pun.lifecycle.status !== "active") {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} is active but linked punishment ${pun.id} has lifecycle.status=${pun.lifecycle.status}`,
      ));
    }
  }

  // ── PunishmentRecord → ConfinementEffect checks ───────────────────────────
  for (const pun of Object.values(justice.punishments)) {
    if (pun.kind !== "finite_confinement" && pun.kind !== "indefinite_confinement") continue;
    if (pun.lifecycle.status !== "active") continue;

    const details = pun.details as { statusEffectId: string };
    const statusEffectId = details.statusEffectId;

    const effect = statusEffects.find((e) => e.id === statusEffectId);
    if (!effect) {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} (active, ${pun.kind}) references statusEffectId=${statusEffectId} but no matching ConfinementEffect found`,
      ));
      continue;
    }

    if (effect.sourcePunishmentId !== pun.id) {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} references statusEffectId=${statusEffectId} but ConfinementEffect.sourcePunishmentId=${effect.sourcePunishmentId}`,
      ));
    }
  }

  return errors;
}

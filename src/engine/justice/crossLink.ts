/**
 * PUNISH-3B2 / PUNISH-4A: Cross-link validator for GameState justice consistency.
 *
 * Validates bidirectional links between:
 * - ConfinementEffect.sourcePunishmentId and PunishmentRecord.details.statusEffectId
 * - ColdPalaceEffect.sourcePunishmentId and PunishmentRecord.details.statusEffectId
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

  // ── Historical: lifted ConfinementEffect → punishment must not be active ──────
  for (const effect of statusEffects) {
    if (effect.kind !== "confinement") continue;
    if (effect.liftedTurn === undefined) continue; // only historical (lifted)
    if (!effect.sourcePunishmentId) continue;

    const pun = justice.punishments[effect.sourcePunishmentId];
    if (!pun) {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} (lifted) has sourcePunishmentId=${effect.sourcePunishmentId} but punishment not found`,
      ));
      continue;
    }

    if (pun.kind !== "finite_confinement" && pun.kind !== "indefinite_confinement") {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} (lifted) links to punishment ${pun.id} of kind ${pun.kind} (expected finite_confinement or indefinite_confinement)`,
      ));
      continue;
    }

    if (pun.targetId !== effect.characterId) {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} (lifted) characterId=${effect.characterId} but punishment ${pun.id} targetId=${pun.targetId}`,
      ));
    }

    const histDetails = pun.details as { statusEffectId?: string; endTurnExclusive?: number };
    if (histDetails.statusEffectId !== effect.id) {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} (lifted) links to punishment ${pun.id} but punishment.details.statusEffectId=${histDetails.statusEffectId}`,
      ));
    }

    if (pun.kind === "finite_confinement") {
      if (histDetails.endTurnExclusive !== effect.endTurnExclusive) {
        errors.push(crossLinkErr(
          `ConfinementEffect ${effect.id} (lifted) endTurnExclusive=${effect.endTurnExclusive} but punishment ${pun.id} details.endTurnExclusive=${histDetails.endTurnExclusive}`,
        ));
      }
    }

    if (pun.lifecycle.status === "active") {
      errors.push(crossLinkErr(
        `ConfinementEffect ${effect.id} is lifted (liftedTurn=${effect.liftedTurn}) but linked punishment ${pun.id} is still active`,
      ));
    }
  }

  // ── PunishmentRecord → ConfinementEffect checks ───────────────────────────
  for (const pun of Object.values(justice.punishments)) {
    if (pun.kind !== "finite_confinement" && pun.kind !== "indefinite_confinement") continue;

    const details = pun.details as { statusEffectId: string };
    const statusEffectId = details.statusEffectId;

    const effect = statusEffects.find((e) => e.id === statusEffectId);

    if (pun.lifecycle.status === "active") {
      if (!effect) {
        errors.push(crossLinkErr(
          `PunishmentRecord ${pun.id} (active, ${pun.kind}) references statusEffectId=${statusEffectId} but no matching ConfinementEffect found`,
        ));
        continue;
      }
      if ((effect as { liftedTurn?: number }).liftedTurn !== undefined) {
        errors.push(crossLinkErr(
          `PunishmentRecord ${pun.id} is active but linked ConfinementEffect ${statusEffectId} is lifted (liftedTurn=${(effect as { liftedTurn?: number }).liftedTurn})`,
        ));
      }
      if ((effect as { sourcePunishmentId?: string }).sourcePunishmentId !== pun.id) {
        errors.push(crossLinkErr(
          `PunishmentRecord ${pun.id} references statusEffectId=${statusEffectId} but ConfinementEffect.sourcePunishmentId=${(effect as { sourcePunishmentId?: string }).sourcePunishmentId}`,
        ));
      }
    } else {
      // Resolved/completed punishment → linked ConfinementEffect must exist and be lifted.
      if (!effect) {
        errors.push(crossLinkErr(
          `PunishmentRecord ${pun.id} (${pun.lifecycle.status}, ${pun.kind}) references statusEffectId=${statusEffectId} but no matching ConfinementEffect found`,
        ));
        continue;
      }
      if ((effect as { sourcePunishmentId?: string }).sourcePunishmentId !== pun.id) {
        errors.push(crossLinkErr(
          `PunishmentRecord ${pun.id} references statusEffectId=${statusEffectId} but ConfinementEffect.sourcePunishmentId=${(effect as { sourcePunishmentId?: string }).sourcePunishmentId}`,
        ));
      }
      if ((effect as { characterId?: string }).characterId !== pun.targetId) {
        errors.push(crossLinkErr(
          `PunishmentRecord ${pun.id} targetId=${pun.targetId} but linked ConfinementEffect ${statusEffectId} characterId=${(effect as { characterId?: string }).characterId}`,
        ));
      }
      if ((effect as { liftedTurn?: number }).liftedTurn === undefined) {
        errors.push(crossLinkErr(
          `PunishmentRecord ${pun.id} is ${pun.lifecycle.status} but linked ConfinementEffect ${statusEffectId} is still active (no liftedTurn)`,
        ));
      }
    }
  }

  // ── ColdPalaceEffect → PunishmentRecord checks ───────────────────────────
  const activeColdPalaceByChar = new Map<string, string>(); // charId → effectId

  for (const effect of statusEffects) {
    if (effect.kind !== "cold_palace") continue;
    if (effect.liftedTurn !== undefined) continue; // not active

    const { sourcePunishmentId, characterId } = effect;

    // Check for duplicate active cold palace effects for same character.
    if (activeColdPalaceByChar.has(characterId)) {
      errors.push(crossLinkErr(
        `Character ${characterId} has multiple active ColdPalaceEffects: ${activeColdPalaceByChar.get(characterId)} and ${effect.id}`,
      ));
    } else {
      activeColdPalaceByChar.set(characterId, effect.id);
    }

    const pun = justice.punishments[sourcePunishmentId];
    if (!pun) {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} has sourcePunishmentId=${sourcePunishmentId} but punishment not found`,
      ));
      continue;
    }

    if (pun.kind !== "cold_palace") {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} links to punishment ${pun.id} of kind ${pun.kind} (expected cold_palace)`,
      ));
    }

    if (pun.targetId !== characterId) {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} characterId=${characterId} but punishment ${pun.id} targetId=${pun.targetId}`,
      ));
    }

    const details = pun.details as { statusEffectId?: string };
    if (details.statusEffectId !== effect.id) {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} links to punishment ${pun.id} but punishment.details.statusEffectId=${details.statusEffectId}`,
      ));
    }

    if (pun.lifecycle.status !== "active") {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} is active but linked punishment ${pun.id} has lifecycle.status=${pun.lifecycle.status}`,
      ));
    }

    // Active effect: character's current residence must match the cold palace location.
    const charResidence = state.standing[characterId]?.residence;
    if (charResidence !== effect.coldPalaceResidenceId) {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} is active but ${characterId} residence="${charResidence}" != coldPalaceResidenceId="${effect.coldPalaceResidenceId}"`,
      ));
    }
  }

  // ── Historical: lifted ColdPalaceEffect → punishment must not be active ────────
  for (const effect of statusEffects) {
    if (effect.kind !== "cold_palace") continue;
    if (effect.liftedTurn === undefined) continue; // only lifted/historical

    const pun = justice.punishments[effect.sourcePunishmentId];
    if (!pun) {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} (lifted) has sourcePunishmentId=${effect.sourcePunishmentId} but punishment not found`,
      ));
      continue;
    }

    if (pun.lifecycle.status === "active") {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} is lifted (liftedTurn=${effect.liftedTurn}) but linked punishment ${pun.id} is still active`,
      ));
    }

    if (pun.kind !== "cold_palace") {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} (lifted) links to punishment ${pun.id} of kind ${pun.kind} (expected cold_palace)`,
      ));
      continue;
    }

    if (pun.targetId !== effect.characterId) {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} (lifted) characterId=${effect.characterId} but punishment ${pun.id} targetId=${pun.targetId}`,
      ));
    }

    const histDetails = pun.details as { statusEffectId?: string; previousResidenceId?: string; coldPalaceResidenceId?: string; previousChamber?: string };
    if (histDetails.statusEffectId !== effect.id) {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} (lifted) links to punishment ${pun.id} but punishment.details.statusEffectId=${histDetails.statusEffectId}`,
      ));
    }

    if (histDetails.previousResidenceId !== effect.previousResidenceId) {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} (lifted) previousResidenceId=${effect.previousResidenceId} but punishment details.previousResidenceId=${histDetails.previousResidenceId}`,
      ));
    }

    if (histDetails.coldPalaceResidenceId !== effect.coldPalaceResidenceId) {
      errors.push(crossLinkErr(
        `ColdPalaceEffect ${effect.id} (lifted) coldPalaceResidenceId=${effect.coldPalaceResidenceId} but punishment details.coldPalaceResidenceId=${histDetails.coldPalaceResidenceId}`,
      ));
    }

    if (effect.previousChamber !== undefined || histDetails.previousChamber !== undefined) {
      if (effect.previousChamber !== histDetails.previousChamber) {
        errors.push(crossLinkErr(
          `ColdPalaceEffect ${effect.id} (lifted) previousChamber=${effect.previousChamber} but punishment details.previousChamber=${histDetails.previousChamber}`,
        ));
      }
    }
  }

  // ── PunishmentRecord → ColdPalaceEffect checks ────────────────────────────
  for (const pun of Object.values(justice.punishments)) {
    if (pun.kind !== "cold_palace") continue;

    const details = pun.details as { statusEffectId: string };
    const statusEffectId = details.statusEffectId;

    const effect = statusEffects.find((e) => e.id === statusEffectId);
    if (!effect) {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} (cold_palace, ${pun.lifecycle.status}) references statusEffectId=${statusEffectId} but no matching ColdPalaceEffect found`,
      ));
      continue;
    }

    if (effect.kind !== "cold_palace") {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} references statusEffectId=${statusEffectId} but effect.kind=${effect.kind} (expected cold_palace)`,
      ));
      continue;
    }

    if (effect.sourcePunishmentId !== pun.id) {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} references statusEffectId=${statusEffectId} but ColdPalaceEffect.sourcePunishmentId=${effect.sourcePunishmentId}`,
      ));
    }

    if (pun.targetId !== effect.characterId) {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} targetId=${pun.targetId} but ColdPalaceEffect.characterId=${effect.characterId}`,
      ));
    }

    const punDetails = pun.details as { statusEffectId?: string; previousResidenceId?: string; coldPalaceResidenceId?: string; previousChamber?: string };

    if (punDetails.statusEffectId !== effect.id) {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} details.statusEffectId=${punDetails.statusEffectId} but ColdPalaceEffect.id=${effect.id}`,
      ));
    }

    if (punDetails.previousResidenceId !== effect.previousResidenceId) {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} details.previousResidenceId=${punDetails.previousResidenceId} != ColdPalaceEffect.previousResidenceId=${effect.previousResidenceId}`,
      ));
    }

    if (punDetails.coldPalaceResidenceId !== effect.coldPalaceResidenceId) {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} details.coldPalaceResidenceId=${punDetails.coldPalaceResidenceId} != ColdPalaceEffect.coldPalaceResidenceId=${effect.coldPalaceResidenceId}`,
      ));
    }

    if ((punDetails.previousChamber ?? undefined) !== (effect.previousChamber ?? undefined)) {
      errors.push(crossLinkErr(
        `PunishmentRecord ${pun.id} details.previousChamber=${punDetails.previousChamber} != ColdPalaceEffect.previousChamber=${effect.previousChamber}`,
      ));
    }

    if (pun.lifecycle.status === "active") {
      // Active punishment → effect must not be lifted.
      if (effect.liftedTurn !== undefined) {
        errors.push(crossLinkErr(
          `PunishmentRecord ${pun.id} is active but linked ColdPalaceEffect ${statusEffectId} is lifted (liftedTurn=${effect.liftedTurn})`,
        ));
      }
    } else {
      // Resolved/completed punishment → effect should be lifted.
      if (effect.liftedTurn === undefined) {
        errors.push(crossLinkErr(
          `PunishmentRecord ${pun.id} is ${pun.lifecycle.status} but linked ColdPalaceEffect ${statusEffectId} is still active (no liftedTurn)`,
        ));
      }
    }
  }

  // ── Conflict: no character should have BOTH active confinement AND active cold palace ──
  for (const [charId, coldPalaceEffectId] of activeColdPalaceByChar) {
    const hasActiveConfinement = statusEffects.some(
      (e) => e.kind === "confinement" && e.characterId === charId && e.liftedTurn === undefined,
    );
    if (hasActiveConfinement) {
      errors.push(crossLinkErr(
        `Character ${charId} has both an active confinement and an active cold palace effect (${coldPalaceEffectId}) — conflict`,
      ));
    }
  }

  return errors;
}

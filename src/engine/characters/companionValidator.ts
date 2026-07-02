/**
 * 伴读跨集合完整性校验。伴读会被后续婚配/情愫/派系系统引用，因此不能只靠 Zod 形状校验：
 * map key 必须 = assignment.heirId；引用须指向真实人物；同性别；同一人物不能 active 跟随两名皇嗣；
 * ended 须有 endedAt/endReason；active 不应有结束字段；royalRelatives record key 须 = 对象 id。
 */
import type { GameState, HeirCompanionAssignment, PersonSex } from "../state/types";
import type { GameError } from "../infra/errors";
import { stateError } from "../infra/errors";

function expectedCompanionSex(heirSex: "daughter" | "son"): PersonSex {
  return heirSex === "daughter" ? "female" : "male";
}

function companionAssignmentSequence(id: string): number | null {
  const match = /^companion_assignment_.+_(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

export function validateCompanionWorld(state: GameState): GameError[] {
  const errors: GameError[] = [];

  for (const [key, rel] of Object.entries(state.royalRelatives)) {
    if (rel.id !== key) {
      errors.push(stateError("COMPANION_ROYAL_KEY_MISMATCH", `royalRelatives["${key}"].id="${rel.id}" mismatch`));
    }
  }

  const activePersonIds = new Map<string, string>();
  for (const [key, a] of Object.entries(state.heirCompanions)) {
    if (a.heirId !== key) {
      errors.push(stateError("COMPANION_KEY_MISMATCH", `heirCompanions["${key}"].heirId="${a.heirId}" mismatch`));
    }

    const heir = state.resources.bloodline.heirs.find((h) => h.id === a.heirId);
    if (!heir) {
      errors.push(stateError("COMPANION_DANGLING_HEIR", `companion references unknown heir "${a.heirId}"`));
    }

    const personId = a.companion.personId;
    const personSex = resolvePersonSex(state, a);
    if (personSex === null) {
      errors.push(stateError("COMPANION_DANGLING_PERSON", `companion "${personId}" (heir ${a.heirId}) not found`));
    }

    if (heir) {
      const want = expectedCompanionSex(heir.sex);
      if (a.profile.sex !== want) {
        errors.push(stateError("COMPANION_SEX_MISMATCH", `heir "${a.heirId}" (${heir.sex}) companion profile.sex="${a.profile.sex}" expected "${want}"`));
      }
      if (personSex !== null && personSex !== want) {
        errors.push(stateError("COMPANION_SEX_MISMATCH", `heir "${a.heirId}" (${heir.sex}) companion person sex="${personSex}" expected "${want}"`));
      }
    }

    if (a.status !== "active") {
      errors.push(stateError("COMPANION_ACTIVE_MAP_NOT_ACTIVE", `heirCompanions["${key}"] has status="${a.status}" (active map is active-only)`));
    } else {
      const prior = activePersonIds.get(personId);
      if (prior) {
        errors.push(stateError("COMPANION_DOUBLE_BOOKED", `person "${personId}" active for both heir "${prior}" and "${a.heirId}"`));
      } else {
        activePersonIds.set(personId, a.heirId);
      }
      if (a.endedAt !== undefined || a.endReason !== undefined) {
        errors.push(stateError("COMPANION_ACTIVE_HAS_END", `active companion for heir "${a.heirId}" has end fields`));
      }
    }
  }

  for (const a of state.endedCompanionAssignments) {
    if (a.status !== "ended") {
      errors.push(stateError("COMPANION_HISTORY_NOT_ENDED", `history assignment "${a.id}" has status="${a.status}"`));
    }
    if (a.endedAt === undefined || a.endReason === undefined) {
      errors.push(stateError("COMPANION_ENDED_MISSING_FIELDS", `history assignment "${a.id}" (heir ${a.heirId}) missing endedAt/endReason`));
    }

    const heir = state.resources.bloodline.heirs.find((h) => h.id === a.heirId);
    if (!heir) {
      errors.push(stateError("COMPANION_DANGLING_HEIR", `history assignment "${a.id}" references unknown heir "${a.heirId}"`));
    }

    const personId = a.companion.personId;
    const personSex = resolvePersonSex(state, a);
    if (personSex === null) {
      errors.push(stateError("COMPANION_DANGLING_PERSON", `history assignment "${a.id}" companion "${personId}" not found`));
    }

    if (heir) {
      const want = expectedCompanionSex(heir.sex);
      if (a.profile.sex !== want) {
        errors.push(stateError("COMPANION_SEX_MISMATCH", `history assignment "${a.id}" profile.sex="${a.profile.sex}" expected "${want}"`));
      }
      if (personSex !== null && personSex !== want) {
        errors.push(stateError("COMPANION_SEX_MISMATCH", `history assignment "${a.id}" person sex="${personSex}" expected "${want}"`));
      }
    }
  }

  const seenIds = new Set<string>();
  const allAssignments = [...Object.values(state.heirCompanions), ...state.endedCompanionAssignments];
  let maxNumericSequence = -1;
  for (const a of allAssignments) {
    if (seenIds.has(a.id)) {
      errors.push(stateError("COMPANION_DUPLICATE_ID", `duplicate companion assignment id "${a.id}"`));
    } else {
      seenIds.add(a.id);
    }
    const seq = companionAssignmentSequence(a.id);
    if (seq !== null) maxNumericSequence = Math.max(maxNumericSequence, seq);
  }

  const hasNumericActiveAssignment = Object.values(state.heirCompanions).some(
    (assignment) => companionAssignmentSequence(assignment.id) !== null,
  );
  if (hasNumericActiveAssignment && state.nextCompanionAssignmentSeq <= maxNumericSequence) {
    errors.push(
      stateError(
        "COMPANION_SEQUENCE_NOT_AHEAD",
        `nextCompanionAssignmentSeq=${state.nextCompanionAssignmentSeq} must be greater than existing max sequence ${maxNumericSequence}`,
      ),
    );
  }

  return errors;
}

function resolvePersonSex(state: GameState, a: HeirCompanionAssignment): PersonSex | null {
  if (a.companion.kind === "family_member") {
    return state.familyMembers[a.companion.personId]?.sex ?? null;
  }
  return state.royalRelatives[a.companion.personId]?.sex ?? null;
}

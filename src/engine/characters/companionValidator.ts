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

export function validateCompanionWorld(state: GameState): GameError[] {
  const errors: GameError[] = [];

  // royalRelatives：record key 须 = 对象 id。
  for (const [key, rel] of Object.entries(state.royalRelatives)) {
    if (rel.id !== key) {
      errors.push(stateError("COMPANION_ROYAL_KEY_MISMATCH", `royalRelatives["${key}"].id="${rel.id}" mismatch`));
    }
  }

  const activePersonIds = new Map<string, string>(); // personId → heirId（active 唯一性）

  for (const [key, a] of Object.entries(state.heirCompanions)) {
    // key = heirId
    if (a.heirId !== key) {
      errors.push(stateError("COMPANION_KEY_MISMATCH", `heirCompanions["${key}"].heirId="${a.heirId}" mismatch`));
    }

    // heirId 指向真实皇嗣
    const heir = state.resources.bloodline.heirs.find((h) => h.id === a.heirId);
    if (!heir) {
      errors.push(stateError("COMPANION_DANGLING_HEIR", `companion references unknown heir "${a.heirId}"`));
    }

    // companionPersonId 指向真实人物
    const personId = a.companion.personId;
    const personSex = resolvePersonSex(state, a);
    if (personSex === null) {
      errors.push(stateError("COMPANION_DANGLING_PERSON", `companion "${personId}" (heir ${a.heirId}) not found`));
    }

    // 性别：皇子→女、皇郎→男（须与快照及 live 人物一致）
    if (heir && personSex !== null) {
      const want = expectedCompanionSex(heir.sex);
      if (a.profile.sex !== want) {
        errors.push(stateError("COMPANION_SEX_MISMATCH", `heir "${a.heirId}" (${heir.sex}) companion profile.sex="${a.profile.sex}" expected "${want}"`));
      }
      if (personSex !== want) {
        errors.push(stateError("COMPANION_SEX_MISMATCH", `heir "${a.heirId}" (${heir.sex}) companion person sex="${personSex}" expected "${want}"`));
      }
    }

    // active map 内只允许 active；唯一占用；不应有结束字段
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

  // ── 历史（endedCompanionAssignments）：append-only，人物可已死 ──
  for (const a of state.endedCompanionAssignments) {
    if (a.status !== "ended") {
      errors.push(stateError("COMPANION_HISTORY_NOT_ENDED", `history assignment "${a.id}" has status="${a.status}"`));
    }
    if (a.endedAt === undefined || a.endReason === undefined) {
      errors.push(stateError("COMPANION_ENDED_MISSING_FIELDS", `history assignment "${a.id}" (heir ${a.heirId}) missing endedAt/endReason`));
    }
    // 历史人物**允许**已死/缺失；若来源仍存在，性别仍须与皇嗣相符（命名空间正确性的代理）。
    const heir = state.resources.bloodline.heirs.find((h) => h.id === a.heirId);
    const personSex = resolvePersonSex(state, a);
    if (heir && personSex !== null) {
      const want = expectedCompanionSex(heir.sex);
      if (personSex !== want) {
        errors.push(stateError("COMPANION_SEX_MISMATCH", `history assignment "${a.id}" person sex="${personSex}" expected "${want}"`));
      }
    }
  }

  // ── 全局 id 唯一性：跨 active + history 不重复 ──
  const seenIds = new Set<string>();
  const allAssignments = [...Object.values(state.heirCompanions), ...state.endedCompanionAssignments];
  for (const a of allAssignments) {
    if (seenIds.has(a.id)) {
      errors.push(stateError("COMPANION_DUPLICATE_ID", `duplicate companion assignment id "${a.id}"`));
    } else {
      seenIds.add(a.id);
    }
  }

  return errors;
}

function resolvePersonSex(state: GameState, a: HeirCompanionAssignment): PersonSex | null {
  if (a.companion.kind === "family_member") {
    return state.familyMembers[a.companion.personId]?.sex ?? null;
  }
  return state.royalRelatives[a.companion.personId]?.sex ?? null;
}

/**
 * 亲缘 cross-link 校验（宗亲 Slice A 约束 8）。
 * gameStateSchema 只校验结构；本模块校验跨字段不变量，载入存档时由 validateSave 调用。
 */
import type { GameState, PersonId } from "../state/types";
import { SOVEREIGN_PERSON_ID } from "../state/types";
import { stateError, type GameError } from "../infra/errors";

/**
 * 独立三色 DFS——**不**复用带 visited 防环的 selector：那些 selector 永远不把起点放进结果，
 * 故 `ancestors(x).includes(x)` 恒为 false，无法识别环。这里用 visiting/done 标记真正检测环。
 */
function hasCycle(state: GameState, link: "biological" | "legal"): boolean {
  const mark = new Map<PersonId, "visiting" | "done">();
  const visit = (id: PersonId): boolean => {
    if (mark.get(id) === "visiting") return true;
    if (mark.get(id) === "done") return false;
    mark.set(id, "visiting");
    const p = state.parentage[id];
    if (p) {
      const parents = link === "biological"
        ? [p.biologicalMotherId, p.biologicalFatherId]
        : [p.legalMotherId, p.legalFatherId];
      for (const parentId of parents) {
        if (parentId !== null && state.parentage[parentId] && visit(parentId)) return true;
      }
    }
    mark.set(id, "done");
    return false;
  };
  return Object.keys(state.parentage).some(visit);
}

export function validateParentage(state: GameState, db: { characters: Record<string, unknown> }): GameError[] {
  const errs: GameError[] = [];
  const heirs = state.resources.bloodline.heirs;
  const known = new Set<PersonId>([
    SOVEREIGN_PERSON_ID,
    ...heirs.map((h) => h.id),
    ...Object.keys(state.standing),
    ...Object.keys(state.generatedConsorts),
    ...Object.keys(db.characters),
  ]);

  // 1. 每个 heir 必有 parentage + 镜像精确一致
  for (const h of heirs) {
    const p = state.parentage[h.id];
    if (!p) { errs.push(stateError("PARENTAGE_MISSING_FOR_HEIR", `heir ${h.id} lacks parentage`, { context: { char: h.id } })); continue; }
    if (h.fatherId !== p.biologicalFatherId) {   // 精确镜像：null===null，undefined≠null
      errs.push(stateError("PARENTAGE_MIRROR_MISMATCH", `heir ${h.id} fatherId != biologicalFatherId`, { context: { char: h.id } }));
    }
  }

  // 2. map key 本身须对应已知人物 + 自指 + 引用合法
  for (const [childId, p] of Object.entries(state.parentage)) {
    if (!known.has(childId)) {
      errs.push(stateError("PARENTAGE_UNKNOWN_CHILD", `parentage entry references unknown child ${childId}`, { context: { char: childId } }));
    }
    for (const ref of [p.biologicalMotherId, p.biologicalFatherId, p.legalMotherId, p.legalFatherId]) {
      if (ref == null) continue;
      if (ref === childId) errs.push(stateError("PARENTAGE_SELF_REFERENCE", `${childId} references self`, { context: { char: childId } }));
      else if (!known.has(ref)) errs.push(stateError("PARENTAGE_UNKNOWN_PERSON", `${childId} references unknown ${ref}`, { context: { char: childId } }));
    }
  }

  // 3. 无环（bio + legal）：独立三色 DFS
  if (hasCycle(state, "biological")) errs.push(stateError("PARENTAGE_BIO_CYCLE", "biological parentage cycle"));
  if (hasCycle(state, "legal")) errs.push(stateError("PARENTAGE_LEGAL_CYCLE", "legal parentage cycle"));

  // 4. AdoptionRecord 双向不变量
  for (const [k, r] of Object.entries(state.adoptionRecords)) {
    if (r.id !== k) errs.push(stateError("ADOPTION_KEY_MISMATCH", `key ${k} != id ${r.id}`, { context: { key: k } }));
    if (r.status !== "active") continue;
    const p = state.parentage[r.childId];
    if (!p || p.activeAdoptionRecordId !== r.id
        || p.legalMotherId !== r.newLegalMotherId || p.legalFatherId !== r.newLegalFatherId) {
      errs.push(stateError("ADOPTION_RECORD_UNREFERENCED", `active record ${r.id} not back-referenced`, { context: { char: r.childId } }));
    }
  }
  // parentage → record 正向（悬空 / 错 child / 指向非 active）
  for (const [childId, p] of Object.entries(state.parentage)) {
    if (!p.activeAdoptionRecordId) continue;
    const r = state.adoptionRecords[p.activeAdoptionRecordId];
    if (!r || r.childId !== childId || r.status !== "active") {
      errs.push(stateError("ADOPTION_POINTER_INVALID", `${childId} activeAdoptionRecordId dangling`, { context: { char: childId } }));
    }
  }

  // 5. residence map key 自洽
  for (const [k, r] of Object.entries(state.royalResidences)) {
    if (r.id !== k) errs.push(stateError("RESIDENCE_KEY_MISMATCH", `key ${k} != id ${r.id}`, { context: { key: k } }));
  }
  return errs;
}

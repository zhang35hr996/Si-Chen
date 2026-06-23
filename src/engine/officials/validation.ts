/**
 * 官员/家族/亲缘的集中完整性校验（spec §14）。收集式（不首错即停），每条诊断带足够上下文。
 * 纯函数；供测试、开局自检与（后续）存档加载校验复用。
 */
import type { ContentDB } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import type { GameState } from "../state/types";
import { isValidParentChildAge } from "./constraints";
import { getPalaceRelativesOfOfficial } from "./selectors";

/** 解析 personId 的年龄（官员/家族成员/侍君），未知返回 undefined。 */
function ageOf(state: GameState, db: ContentDB, personId: string): number | undefined {
  return (
    state.officials[personId]?.age ??
    state.familyMembers[personId]?.age ??
    (db.characters[personId] ?? state.generatedConsorts[personId])?.profile.age
  );
}

function personExists(state: GameState, db: ContentDB, personId: string): boolean {
  return (
    state.officials[personId] !== undefined ||
    state.familyMembers[personId] !== undefined ||
    db.characters[personId] !== undefined ||
    state.generatedConsorts[personId] !== undefined
  );
}

export function validateOfficialWorld(state: GameState, db: ContentDB): GameError[] {
  const errors: GameError[] = [];
  const e = (code: string, message: string, context?: Record<string, unknown>) =>
    errors.push(stateError(code, message, context ? { context } : undefined));

  const seenIds = new Set<string>();
  const noteId = (id: string, kind: string) => {
    if (seenIds.has(id)) e("OFFICIAL_DUP_ID", `重复人物 id「${id}」(${kind})`, { id, kind });
    seenIds.add(id);
  };

  // 席位占用计数（用于 1席/多席不变量）。
  const seatUse: Record<string, number> = {};

  for (const o of Object.values(state.officials)) {
    noteId(o.id, "official");
    // 1) 官职引用存在
    if (o.postId !== null) {
      const post = db.officialPosts[o.postId];
      if (!post) {
        e("OFFICIAL_BAD_POST", `官员「${o.id}」引用了不存在的官职「${o.postId}」`, { officialId: o.id, postId: o.postId });
      } else {
        seatUse[o.postId] = (seatUse[o.postId] ?? 0) + 1;
      }
    }
    // 2) 家族引用存在
    if (!state.officialFamilies[o.familyId]) {
      e("OFFICIAL_BAD_FAMILY", `官员「${o.id}」引用了不存在的家族「${o.familyId}」`, { officialId: o.id, familyId: o.familyId });
    }
    // 8) 在任官员不能为死亡状态
    if (o.status === "dead" && o.postId !== null) {
      e("OFFICIAL_DEAD_SEATED", `已故官员「${o.id}」仍占官职「${o.postId}」`, { officialId: o.id });
    }
    // 年龄合规
    if (o.age < 1) e("OFFICIAL_BAD_AGE", `官员「${o.id}」年龄非法（${o.age}）`, { officialId: o.id });
  }

  // 7) 官职占用不超过席位数
  for (const [postId, used] of Object.entries(seatUse)) {
    const cap = db.officialPosts[postId]?.seatCount ?? 1;
    if (used > cap) e("OFFICIAL_SEAT_OVERFLOW", `官职「${postId}」在任 ${used} 人，超出席位 ${cap}`, { postId, used, cap });
  }

  // 家族成员引用 + 5) 男性无官职
  for (const m of Object.values(state.familyMembers)) {
    noteId(m.id, "member");
    if (!state.officialFamilies[m.familyId]) {
      e("MEMBER_BAD_FAMILY", `家族成员「${m.id}」引用了不存在的家族「${m.familyId}」`, { memberId: m.id, familyId: m.familyId });
    }
    // 家族成员绝不为官员（5：男性无官职——家族成员里男性更不可能；此处统一禁止成员占职）
    if (state.officials[m.id]) {
      e("MEMBER_IS_OFFICIAL", `家族成员「${m.id}」同时是官员（身份互斥）`, { memberId: m.id });
    }
  }

  // 3) 家族 memberIds 指向有效人物；9) 一人不属于两个母系家族
  const familyOfPerson = new Map<string, string>();
  for (const fam of Object.values(state.officialFamilies)) {
    noteId(fam.id, "family");
    for (const pid of fam.memberIds) {
      if (!personExists(state, db, pid)) {
        e("FAMILY_BAD_MEMBER", `家族「${fam.id}」成员「${pid}」不是有效人物`, { familyId: fam.id, personId: pid });
        continue;
      }
      const prev = familyOfPerson.get(pid);
      if (prev !== undefined && prev !== fam.id) {
        e("PERSON_MULTI_FAMILY", `人物「${pid}」同属两个家族（${prev} / ${fam.id}）`, { personId: pid });
      }
      familyOfPerson.set(pid, fam.id);
    }
  }

  // 4) 亲缘两端存在；6) 重复关系；不矛盾生母；13) 母女年龄
  const seenEdges = new Set<string>();
  const motherOf = new Map<string, string>();
  for (const k of state.kinship) {
    if (!personExists(state, db, k.fromPersonId)) {
      e("KIN_BAD_FROM", `亲缘边起点「${k.fromPersonId}」不是有效人物`, { edge: k });
    }
    if (!personExists(state, db, k.toPersonId)) {
      e("KIN_BAD_TO", `亲缘边终点「${k.toPersonId}」不是有效人物`, { edge: k });
    }
    const key = `${k.fromPersonId}|${k.toPersonId}|${k.type}`;
    if (seenEdges.has(key)) e("KIN_DUP_EDGE", `重复亲缘边 ${key}`, { edge: k });
    seenEdges.add(key);
    if (k.type === "mother") {
      const prev = motherOf.get(k.fromPersonId);
      if (prev !== undefined && prev !== k.toPersonId) {
        e("KIN_MULTI_MOTHER", `人物「${k.fromPersonId}」有两个生母（${prev} / ${k.toPersonId}）`, { personId: k.fromPersonId });
      }
      motherOf.set(k.fromPersonId, k.toPersonId);
      // 13) 母女年龄合理性
      const childAge = ageOf(state, db, k.fromPersonId);
      const motherAge = ageOf(state, db, k.toPersonId);
      if (childAge !== undefined && motherAge !== undefined && !isValidParentChildAge(motherAge, childAge)) {
        e("KIN_BAD_AGE", `母「${k.toPersonId}」(${motherAge}) 与子女「${k.fromPersonId}」(${childAge}) 年龄关系不合理`, { edge: k });
      }
    }
  }

  // 10) 侍君 birthFamilyId 指向有效家族
  for (const [charId, s] of Object.entries(state.standing)) {
    if (s.birthFamilyId !== undefined && !state.officialFamilies[s.birthFamilyId]) {
      e("CONSORT_BAD_FAMILY", `侍君「${charId}」birthFamilyId「${s.birthFamilyId}」无对应家族`, { charId, familyId: s.birthFamilyId });
    }
  }

  // 11) 官员↔宫中亲属反向一致：官员的宫中亲属，其母族必含该官员
  for (const o of Object.values(state.officials)) {
    for (const consortId of getPalaceRelativesOfOfficial(state, o.id)) {
      if (state.standing[consortId]?.birthFamilyId !== o.familyId) {
        e("KIN_ASYMMETRIC", `官员「${o.id}」与宫中亲属「${consortId}」家族归属不一致`, { officialId: o.id, consortId });
      }
    }
  }

  return errors;
}

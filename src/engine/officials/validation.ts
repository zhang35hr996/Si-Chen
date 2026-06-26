/**
 * 官员/家族/亲缘的集中完整性校验（spec §14 + review F3/F4）。收集式（不首错即停），每条诊断
 * 带足够上下文。纯函数；供测试、开局自检（createNewGameState fail-fast）与存档加载（readSlot）复用。
 * Zod 只管形状，跨集合不变量一律在此处。
 */
import type { ContentDB } from "../content/loader";
import { stateError, type GameError } from "../infra/errors";
import type { FamilyMemberRole, GameState, PersonSex } from "../state/types";
import { compareGameTime } from "../calendar/time";
import { isValidParentChildAge, isValidSpouseAge } from "./constraints";
import { hanmenFamilyId } from "./appointment";
import { legalResolutionsFor } from "./personnelDecisions";

/** 角色（FamilyMember.role）应有的性别。 */
const ROLE_SEX: Record<FamilyMemberRole, PersonSex> = {
  matriarch: "female",
  daughter: "female",
  sister: "female",
  consort_in: "male",
  son: "male",
};

function consortContent(state: GameState, db: ContentDB, id: string) {
  const c = db.characters[id] ?? state.generatedConsorts[id];
  return c && c.kind === "consort" ? c : undefined;
}

function ageOf(state: GameState, db: ContentDB, personId: string): number | undefined {
  return (
    state.officials[personId]?.age ??
    state.familyMembers[personId]?.age ??
    (db.characters[personId] ?? state.generatedConsorts[personId])?.profile.age
  );
}

/** 人物性别：官员=女；家族成员看 sex；侍君=男（女尊男侍）。未知返回 undefined。 */
function sexOf(state: GameState, db: ContentDB, personId: string): PersonSex | undefined {
  if (state.officials[personId]) return "female";
  const m = state.familyMembers[personId];
  if (m) return m.sex;
  if (consortContent(state, db, personId)) return "male";
  return undefined;
}

/** 人物的 canonical 家族归属（唯一真相）：官员/成员看 familyId；侍君看 standing.birthFamilyId。 */
function canonicalFamilyOf(state: GameState, db: ContentDB, personId: string): string | undefined {
  if (state.officials[personId]) return state.officials[personId]!.familyId;
  if (state.familyMembers[personId]) return state.familyMembers[personId]!.familyId;
  if (consortContent(state, db, personId)) return state.standing[personId]?.birthFamilyId;
  return undefined;
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

  // ── 全局人物 id 唯一：authored characters / generatedConsorts / officials / familyMembers ──
  const namespaces: Array<[string, Iterable<string>]> = [
    ["character", Object.keys(db.characters)],
    ["generatedConsort", Object.keys(state.generatedConsorts)],
    ["official", Object.keys(state.officials)],
    ["familyMember", Object.keys(state.familyMembers)],
    ["candidate", Object.keys(state.officialCandidates)],
  ];
  const idOwner = new Map<string, string>();
  for (const [ns, ids] of namespaces) {
    for (const id of ids) {
      const prev = idOwner.get(id);
      if (prev !== undefined) e("PERSON_DUP_ID", `人物 id「${id}」在 ${prev} 与 ${ns} 重复`, { id });
      else idOwner.set(id, ns);
    }
  }

  // ── record key 与对象内部 id 必须一致 ──
  for (const [key, o] of Object.entries(state.officials)) {
    if (o.id !== key) e("OFFICIAL_KEY_MISMATCH", `officials["${key}"].id = "${o.id}"（键不一致）`, { key, id: o.id });
  }
  for (const [key, f] of Object.entries(state.officialFamilies)) {
    if (f.id !== key) e("FAMILY_KEY_MISMATCH", `officialFamilies["${key}"].id = "${f.id}"（键不一致）`, { key, id: f.id });
  }
  for (const [key, m] of Object.entries(state.familyMembers)) {
    if (m.id !== key) e("MEMBER_KEY_MISMATCH", `familyMembers["${key}"].id = "${m.id}"（键不一致）`, { key, id: m.id });
  }

  // ── 官员 ──
  const seatUse: Record<string, number> = {};
  for (const o of Object.values(state.officials)) {
    if (o.postId !== null) {
      if (!db.officialPosts[o.postId]) {
        e("OFFICIAL_BAD_POST", `官员「${o.id}」引用了不存在的官职「${o.postId}」`, { officialId: o.id, postId: o.postId });
      } else {
        seatUse[o.postId] = (seatUse[o.postId] ?? 0) + 1;
      }
    }
    if (!state.officialFamilies[o.familyId]) {
      e("OFFICIAL_BAD_FAMILY", `官员「${o.id}」引用了不存在的家族「${o.familyId}」`, { officialId: o.id, familyId: o.familyId });
    }
    // 只有 active 官员可占职（postId 非空）；其余状态占职即错（生命周期前置不变量）。
    if (o.status !== "active" && o.postId !== null) {
      e("OFFICIAL_INACTIVE_SEATED", `非在任官员「${o.id}」(${o.status}) 仍占官职「${o.postId}」`, { officialId: o.id, status: o.status });
    }
    // 运行期年龄只做合理性区间（入仕年龄上限仅约束「生成」，官员会逐年增龄，可超 62）。
    if (!(o.age >= 1 && o.age <= 120)) {
      e("OFFICIAL_BAD_AGE", `官员「${o.id}」年龄不合理（${o.age}）`, { officialId: o.id, age: o.age });
    }
    // 能力四维 0–100；履历 merit 0–100、连续不合格年数 ≥0（PR3C-1）。
    const ap = o.aptitude;
    if (![ap.governance, ap.scholarship, ap.military, ap.integrity].every((v) => v >= 0 && v <= 100)) {
      e("OFFICIAL_BAD_APTITUDE", `官员「${o.id}」能力越界`, { officialId: o.id });
    }
    if (!(o.reviewState.merit >= 0 && o.reviewState.merit <= 100) || o.reviewState.underperformanceYears < 0) {
      e("OFFICIAL_BAD_REVIEW_STATE", `官员「${o.id}」履历越界`, { officialId: o.id });
    }
    // 状态↔原因/时刻一致性。
    if (o.status === "active") {
      if (o.statusReason !== undefined) e("OFFICIAL_ACTIVE_WITH_REASON", `在任官员「${o.id}」不应带 statusReason`, { officialId: o.id });
      if (o.deathAt !== undefined) e("OFFICIAL_ACTIVE_WITH_DEATHAT", `在任官员「${o.id}」不应带 deathAt`, { officialId: o.id });
    } else {
      if (o.statusReason === undefined) e("OFFICIAL_STATUS_REASON_MISSING", `非在任官员「${o.id}」(${o.status}) 缺 statusReason`, { officialId: o.id });
      if (o.statusChangedAt === undefined) e("OFFICIAL_STATUS_TIME_MISSING", `非在任官员「${o.id}」(${o.status}) 缺 statusChangedAt`, { officialId: o.id });
    }
    if (o.status === "dead" && o.deathAt === undefined) {
      e("OFFICIAL_DEAD_NO_TIME", `已故官员「${o.id}」缺 deathAt`, { officialId: o.id });
    }
    if (o.status !== "dead" && o.deathAt !== undefined) {
      e("OFFICIAL_LIVE_WITH_DEATHAT", `未死官员「${o.id}」(${o.status}) 带 deathAt`, { officialId: o.id });
    }
  }

  // 待决告老：官员须存在且 active；不得重复。
  const seenPending = new Set<string>();
  for (const p of state.pendingRetirements) {
    const o = state.officials[p.officialId];
    if (!o) e("PENDING_RETIRE_BAD_OFFICIAL", `告老请求指向无效官员「${p.officialId}」`, { officialId: p.officialId });
    else if (o.status !== "active") e("PENDING_RETIRE_NOT_ACTIVE", `告老请求对应官员「${p.officialId}」非在任（${o.status}）`, { officialId: p.officialId });
    if (seenPending.has(p.officialId)) e("PENDING_RETIRE_DUP", `官员「${p.officialId}」存在重复告老请求`, { officialId: p.officialId });
    seenPending.add(p.officialId);
  }

  // 官员历史：官员须存在；id 唯一。
  const seenHist = new Set<string>();
  for (const h of state.officialHistory) {
    if (!state.officials[h.officialId]) e("OFFICIAL_HISTORY_BAD_REF", `历史条目指向无效官员「${h.officialId}」`, { id: h.id });
    if (seenHist.has(h.id)) e("OFFICIAL_HISTORY_DUP_ID", `重复历史条目 id「${h.id}」`, { id: h.id });
    seenHist.add(h.id);
  }

  // ── 候补官员池 + 科举榜单（Phase 3 PR3A） ────────────────────────────────
  // 有效期判定基于「年度结算标记」而非历年：每年科举结果生成前已跑候补 tick，故最新榜单年份即
  // 最近一次已结算的年份。届满年正月（本年二月结算尚未跑）合法；结算已跑仍 eligible 才非法。
  const latestSettledExamYear = state.examinationResults.reduce((m, r) => Math.max(m, r.year), 0);
  const ranksByYear = new Map<number, Set<number>>();
  for (const [key, c] of Object.entries(state.officialCandidates)) {
    if (c.id !== key) e("CANDIDATE_KEY_MISMATCH", `officialCandidates["${key}"].id = "${c.id}"（键不一致）`, { key, id: c.id });
    if (state.officials[c.id]) e("CANDIDATE_IS_OFFICIAL", `候补者「${c.id}」与官员 id 冲突（不得占官位/复用 id）`, { id: c.id });
    if (!(c.age >= 1 && c.age <= 120)) e("CANDIDATE_BAD_AGE", `候补者「${c.id}」年龄不合理（${c.age}）`, { id: c.id, age: c.age });
    if (c.familyId !== null && !state.officialFamilies[c.familyId]) {
      e("CANDIDATE_BAD_FAMILY", `候补者「${c.id}」familyId「${c.familyId}」无对应家族`, { id: c.id });
    }
    if (c.examinationRank < 1) e("CANDIDATE_BAD_RANK", `候补者「${c.id}」榜次非法（${c.examinationRank}）`, { id: c.id });
    const set = ranksByYear.get(c.examinationYear) ?? new Set<number>();
    if (set.has(c.examinationRank)) e("CANDIDATE_DUP_RANK", `${c.examinationYear} 年榜次「${c.examinationRank}」重复`, { id: c.id });
    set.add(c.examinationRank);
    ranksByYear.set(c.examinationYear, set);
    // appointed 须可追溯到正式官员。
    if (c.status === "appointed") {
      if (!c.appointedOfficialId || !state.officials[c.appointedOfficialId]) {
        e("CANDIDATE_APPOINTED_NO_OFFICIAL", `已授官候补「${c.id}」缺有效 appointedOfficialId`, { id: c.id });
      }
    }
    // eligible 不得已过有效期（以最近结算年份为准，而非历年）。
    if (c.status === "eligible" && latestSettledExamYear >= c.expiresAtYear) {
      e("CANDIDATE_EXPIRED_STILL_ELIGIBLE", `候补「${c.id}」已过有效期（${c.expiresAtYear}，最近结算 ${latestSettledExamYear}）却仍 eligible`, { id: c.id });
    }
  }
  // 同年榜次须 1..N 连续。
  for (const [year, set] of ranksByYear) {
    const n = set.size;
    for (let r = 1; r <= n; r++) {
      if (!set.has(r)) { e("CANDIDATE_RANK_GAP", `${year} 年榜次不连续（缺第 ${r}）`, { year }); break; }
    }
  }
  // 科举结果：每年至多一份；generatedAt 年份须一致；candidateIds 必须 canonical——即该年全部
  // origin=examination 候补按 examinationRank 升序的精确 id 序列（无重复、不遗漏、顺序正确、不混荐举）。
  const seenExamYears = new Set<number>();
  for (const res of state.examinationResults) {
    if (seenExamYears.has(res.year)) e("EXAM_DUP_YEAR", `${res.year} 年存在多份科举结果`, { year: res.year });
    seenExamYears.add(res.year);
    if (res.generatedAt.year !== res.year) {
      e("EXAM_GENERATED_YEAR_MISMATCH", `${res.year} 年榜单 generatedAt.year(${res.generatedAt.year}) 不符`, { year: res.year });
    }
    const expected = Object.values(state.officialCandidates)
      .filter((c) => c.examinationYear === res.year && c.origin === "examination")
      .sort((a, b) => a.examinationRank - b.examinationRank)
      .map((c) => c.id);
    if (res.candidateIds.length !== expected.length || res.candidateIds.some((id, i) => id !== expected[i])) {
      e("EXAM_CANDIDATE_LIST_MISMATCH", `${res.year} 年榜单 candidateIds 与该年科举候补（按榜次）不一致`, {
        year: res.year, got: res.candidateIds, expected,
      });
    }
  }
  // 候补授官转正一致性（PR3B）。先按候补归集授官 provenance 条目（每 appointed 候补须恰一条）。
  const provByCandidate = new Map<string, typeof state.officialHistory>();
  for (const h of state.officialHistory) {
    if (!h.appointment) continue;
    const arr = provByCandidate.get(h.appointment.candidateId) ?? [];
    arr.push(h);
    provByCandidate.set(h.appointment.candidateId, arr);
  }
  const claimedOfficials = new Map<string, string>(); // appointedOfficialId → candidateId
  for (const c of Object.values(state.officialCandidates)) {
    if (c.status !== "appointed" || !c.appointedOfficialId) continue;
    const off = state.officials[c.appointedOfficialId];
    if (!off) continue; // 缺失由 CANDIDATE_APPOINTED_NO_OFFICIAL 捕获
    const prev = claimedOfficials.get(c.appointedOfficialId);
    if (prev) e("CANDIDATE_OFFICIAL_DOUBLE_CLAIM", `官员「${c.appointedOfficialId}」被候补「${prev}」「${c.id}」同时指认`, { id: c.id });
    claimedOfficials.set(c.appointedOfficialId, c.id);
    // 继承：姓名永久一致；当前年龄不得低于授官时年龄（lifecycle 只增不减）。
    if (off.surname !== c.surname || off.givenName !== c.givenName) {
      e("CANDIDATE_OFFICIAL_INHERIT_MISMATCH", `候补「${c.id}」与转正官员姓名不一致`, { id: c.id });
    }
    if (off.age < c.age) {
      e("CANDIDATE_OFFICIAL_AGE_BELOW_APPOINTMENT", `转正官员「${off.id}」当前年龄(${off.age}) 低于授官时(${c.age})`, { id: c.id });
    }
    const expectFamily = c.familyId !== null ? c.familyId : hanmenFamilyId(c.id);
    if (off.familyId !== expectFamily) {
      e("CANDIDATE_OFFICIAL_FAMILY_MISMATCH", `候补「${c.id}」转正官员 familyId「${off.familyId}」应为「${expectFamily}」`, { id: c.id });
    }
    // 授官 provenance 必须存在且恰一条、并与候补/官员各项一致。
    const prov = provByCandidate.get(c.id) ?? [];
    if (prov.length !== 1) {
      e("CANDIDATE_APPOINTMENT_PROVENANCE_MISSING", `appointed 候补「${c.id}」应恰有一条授官史（实有 ${prov.length}）`, { id: c.id });
    } else {
      const h = prov[0]!;
      const ap = h.appointment!;
      const post = db.officialPosts[ap.postId];
      // h.at 是「首次进入正式官员体系」的历史快照；official.appointedAt 是「最近一次任职/调任」时刻，
      // 调任/重新授官会更新后者。故只要求 appointedAt 不早于首次授官，绝不要求二者相等。
      const okEntry =
        h.officialId === c.appointedOfficialId &&
        h.status === "active" &&
        !!off.appointedAt && off.appointedAt.dayIndex >= h.at.dayIndex &&
        ap.examinationYear === c.examinationYear &&
        ap.examinationRank === c.examinationRank &&
        ap.ageAtAppointment === c.age &&
        !!post && post.gradeOrder > 0;
      if (!okEntry) e("HISTORY_APPOINTMENT_INCONSISTENT", `授官史条目「${h.id}」与候补/官员不一致`, { id: c.id });
    }
  }
  // 反向：每条 provenance 都须指向一名 appointed 候补且 officialId 对应。
  for (const h of state.officialHistory) {
    if (!h.appointment) continue;
    const c = state.officialCandidates[h.appointment.candidateId];
    if (!c) { e("HISTORY_APPOINTMENT_BAD_CANDIDATE", `授官史条目「${h.id}」指向不存在候补`, { id: h.id }); continue; }
    if (c.status !== "appointed" || c.appointedOfficialId !== h.officialId) {
      e("HISTORY_APPOINTMENT_INCONSISTENT", `授官史条目「${h.id}」与候补状态/appointedOfficialId 不符`, { id: h.id });
    }
  }
  // 年度吏部考课简报（PR3C-2）：每年至多一条；at.year 一致；变动方向/字段语义自洽。
  const seenReviewYears = new Set<number>();
  const gradedPost = (pid: string | null) => pid !== null && (db.officialPosts[pid]?.gradeOrder ?? 0) > 0;
  const gradeOrderOf = (pid: string | null) => (pid ? (db.officialPosts[pid]?.gradeOrder ?? 0) : 0);
  for (const rec of state.annualReviews) {
    if (seenReviewYears.has(rec.year)) e("REVIEW_DUP_YEAR", `${rec.year} 年存在多份考课简报`, { year: rec.year });
    seenReviewYears.add(rec.year);
    if (rec.at.year !== rec.year) e("REVIEW_AT_YEAR_MISMATCH", `考课简报 ${rec.year} 的 at.year(${rec.at.year}) 不符`, { year: rec.year });
    for (const c of rec.changes) {
      if (c.fromPostId !== null && !gradedPost(c.fromPostId)) e("REVIEW_BAD_POST", `${rec.year} 考课 fromPostId「${c.fromPostId}」非有效官职`, { year: rec.year });
      if (c.toPostId !== null && !gradedPost(c.toPostId)) e("REVIEW_BAD_POST", `${rec.year} 考课 toPostId「${c.toPostId}」非有效官职`, { year: rec.year });
      if (c.kind === "appointment") {
        if (!c.candidateId) e("REVIEW_BAD_CHANGE", `${rec.year} 授官变动缺 candidateId`, { year: rec.year, id: c.officialId });
        if (c.fromPostId !== null || c.toPostId === null) e("REVIEW_BAD_CHANGE", `${rec.year} 授官变动 from/to 非法`, { year: rec.year, id: c.officialId });
      } else {
        if (c.candidateId !== undefined) e("REVIEW_BAD_CHANGE", `${rec.year} 非授官变动不应带 candidateId`, { year: rec.year, id: c.officialId });
      }
      if (c.kind === "promotion" && !(c.fromPostId !== null && c.toPostId !== null && gradeOrderOf(c.toPostId) > gradeOrderOf(c.fromPostId))) {
        e("REVIEW_BAD_DIRECTION", `${rec.year} 升迁方向非法`, { year: rec.year, id: c.officialId });
      }
      if (c.kind === "demotion" && !(c.fromPostId !== null && (c.toPostId === null || gradeOrderOf(c.toPostId) < gradeOrderOf(c.fromPostId)))) {
        e("REVIEW_BAD_DIRECTION", `${rec.year} 降级方向非法`, { year: rec.year, id: c.officialId });
      }
      if (c.kind === "fill" && !(c.fromPostId === null && c.toPostId !== null)) {
        e("REVIEW_BAD_DIRECTION", `${rec.year} 补缺 from/to 非法`, { year: rec.year, id: c.officialId });
      }
    }
  }
  // 官员惩戒完整闭环（PR3C-3a）：每条 official PunishmentRecord ↔ 恰一条 history ↔ 恰一条 punished CourtEvent。
  const punishments = state.justice.punishments;
  // history 按 punishmentId 归集（不得复用）。
  const histByPun = new Map<string, typeof state.officialHistory>();
  for (const h of state.officialHistory) {
    if (h.punishmentId === undefined) continue;
    const pun = punishments[h.punishmentId];
    if (!pun || pun.targetKind !== "official" || pun.targetId !== h.officialId) {
      e("OFFICIAL_HISTORY_BAD_PUNISHMENT", `历史条目「${h.id}」punishmentId 与官员 PunishmentRecord 不一致`, { id: h.id });
    }
    const arr = histByPun.get(h.punishmentId) ?? [];
    arr.push(h);
    histByPun.set(h.punishmentId, arr);
  }
  // punished CourtEvent 按 punishmentId 归集（保留事件以校验内容）。
  const evtByPun = new Map<string, typeof state.chronicle>();
  for (const evt of state.chronicle) {
    if (evt.type !== "punished") continue;
    const pid = evt.payload?.punishmentId;
    if (typeof pid === "string") { const arr = evtByPun.get(pid) ?? []; arr.push(evt); evtByPun.set(pid, arr); }
  }
  for (const pun of Object.values(punishments)) {
    if (pun.targetKind !== "official") continue;
    const off = state.officials[pun.targetId];
    if (!off) { e("PUNISHMENT_BAD_OFFICIAL_TARGET", `官员惩戒「${pun.id}」目标「${pun.targetId}」不存在`, { id: pun.id }); continue; }
    // lifecycle 必须 completed/immediate 且 resolvedAt===imposedAt。
    if (!(pun.lifecycle.status === "completed" && pun.lifecycle.resolution === "immediate" && JSON.stringify(pun.lifecycle.resolvedAt) === JSON.stringify(pun.imposedAt))) {
      e("PUNISHMENT_OFFICIAL_BAD_LIFECYCLE", `官员惩戒「${pun.id}」lifecycle 须即时完成且 resolvedAt===imposedAt`, { id: pun.id });
    }
    // details 官职有效/方向。
    const fromPostId = pun.details.fromPostId;
    const expectedToPostId: string | null = pun.kind === "official_demotion" ? pun.details.toPostId : null;
    if (!gradedPost(fromPostId)) e("PUNISHMENT_OFFICIAL_BAD_POST", `官员惩戒「${pun.id}」fromPostId 非有效官职`, { id: pun.id });
    if (pun.kind === "official_demotion") {
      if (!gradedPost(expectedToPostId) || gradeOrderOf(expectedToPostId) >= gradeOrderOf(fromPostId)) {
        e("PUNISHMENT_OFFICIAL_BAD_POST", `官员惩戒「${pun.id}」降职 toPostId 须为更低品级有效官职`, { id: pun.id });
      }
    }
    // 恰一条 history，且各项一致（含 reason 方向：免官须 dismissal，降职须非 dismissal）。
    const hs = histByPun.get(pun.id) ?? [];
    if (hs.length !== 1) {
      e("PUNISHMENT_OFFICIAL_HISTORY_COUNT", `官员惩戒「${pun.id}」应恰有一条 history（实有 ${hs.length}）`, { id: pun.id });
    } else {
      const h = hs[0]!;
      const reasonOk = pun.kind === "official_dismissal" ? h.reason === "dismissal" : h.reason !== "dismissal";
      const okHist = h.officialId === pun.targetId && h.vacatedPostId === fromPostId && JSON.stringify(h.at) === JSON.stringify(pun.imposedAt) && reasonOk;
      if (!okHist) e("PUNISHMENT_OFFICIAL_HISTORY_INCONSISTENT", `官员惩戒「${pun.id}」history 与记录不一致`, { id: pun.id });
    }
    // 恰一条 punished CourtEvent，且内容（target/role/time/kind/from-to/publicity）与记录一致。
    const evs = evtByPun.get(pun.id) ?? [];
    if (evs.length !== 1) {
      e("PUNISHMENT_OFFICIAL_EVENT_COUNT", `官员惩戒「${pun.id}」应恰有一条 punished CourtEvent`, { id: pun.id });
    } else {
      const ev = evs[0]!;
      const role = pun.kind === "official_demotion" ? "demoted" : "dismissed";
      const part = ev.participants.find((p) => p.charId === pun.targetId);
      const pub = ev.publicity;
      const pubOk =
        pun.publicity === "secret" ? pub.scope === "circle" && pub.circleIds.includes(pun.targetId)
        : pun.publicity === "public" ? pub.scope === "realm" && pub.persistence === "institutional"
        : pub.scope === "palace" && pub.persistence === "institutional";
      const okEvent =
        JSON.stringify(ev.occurredAt) === JSON.stringify(pun.imposedAt) &&
        !!part && part.role === role &&
        ev.payload.kind === pun.kind &&
        ev.payload.fromPostId === fromPostId &&
        ((ev.payload.toPostId ?? null) === expectedToPostId) &&
        pubOk;
      if (!okEvent) e("PUNISHMENT_OFFICIAL_EVENT_INCONSISTENT", `官员惩戒「${pun.id}」CourtEvent 内容与记录不一致`, { id: pun.id });
    }
  }
  for (const [postId, used] of Object.entries(seatUse)) {
    const cap = db.officialPosts[postId]?.seatCount ?? 1;
    if (used > cap) e("OFFICIAL_SEAT_OVERFLOW", `官职「${postId}」在任 ${used} 人，超出席位 ${cap}`, { postId, used, cap });
  }

  // ── 家族成员 ──
  for (const m of Object.values(state.familyMembers)) {
    if (!state.officialFamilies[m.familyId]) {
      e("MEMBER_BAD_FAMILY", `家族成员「${m.id}」引用了不存在的家族「${m.familyId}」`, { memberId: m.id, familyId: m.familyId });
    }
    if (ROLE_SEX[m.role] !== m.sex) {
      e("MEMBER_SEX_ROLE", `家族成员「${m.id}」身份「${m.role}」与性别「${m.sex}」不一致`, { memberId: m.id, role: m.role, sex: m.sex });
    }
    // 运行期年龄合理性（与官员同一 1–120 规则，避免两套漂移）。
    if (!(m.age >= 1 && m.age <= 120)) {
      e("MEMBER_BAD_AGE", `家族成员「${m.id}」年龄不合理（${m.age}）`, { memberId: m.id, age: m.age });
    }
  }

  // ── 家族 surname 一致：本族官员 + 非内卿母系成员同姓（内卿可异姓赘入） ──
  for (const fam of Object.values(state.officialFamilies)) {
    for (const o of Object.values(state.officials)) {
      if (o.familyId === fam.id && o.surname !== fam.surname) {
        e("FAMILY_SURNAME_MISMATCH", `家族「${fam.id}」官员「${o.id}」姓「${o.surname}」≠ 族姓「${fam.surname}」`, { familyId: fam.id, officialId: o.id });
      }
    }
    for (const m of Object.values(state.familyMembers)) {
      if (m.familyId === fam.id && m.role !== "consort_in" && m.surname !== fam.surname) {
        e("FAMILY_SURNAME_MISMATCH", `家族「${fam.id}」成员「${m.id}」姓「${m.surname}」≠ 族姓「${fam.surname}」`, { familyId: fam.id, memberId: m.id });
      }
    }
  }

  // ── 侍君 birthFamilyId / maternalClan 一致 ──
  for (const [charId, s] of Object.entries(state.standing)) {
    if (s.birthFamilyId !== undefined && !state.officialFamilies[s.birthFamilyId]) {
      e("CONSORT_BAD_FAMILY", `侍君「${charId}」birthFamilyId「${s.birthFamilyId}」无对应家族`, { charId, familyId: s.birthFamilyId });
    }
    const content = consortContent(state, db, charId);
    const clan = content?.maternalClan;
    if (clan) {
      if (clan.familyId !== s.birthFamilyId) {
        e("CONSORT_CLAN_FAMILY", `侍君「${charId}」maternalClan.familyId「${clan.familyId}」≠ birthFamilyId「${s.birthFamilyId ?? "无"}」`, { charId });
      }
      // 必须存在与关系模型一致的母亲边：consort → 某官员(mother)，且该官员属 clan.familyId。
      const motherEdge = state.kinship.find((k) => k.fromPersonId === charId && k.type === "mother");
      const motherFam = motherEdge ? state.officials[motherEdge.toPersonId]?.familyId : undefined;
      if (!motherEdge || motherFam !== clan.familyId) {
        e("CONSORT_NO_MOTHER_EDGE", `侍君「${charId}」缺少指向母族「${clan.familyId}」官员的 mother 边`, { charId, familyId: clan.familyId });
      }
    }
  }

  // ── 亲缘边 ──
  const edgeKey = (from: string, to: string, type: string) => `${from}|${to}|${type}`;
  const present = new Set<string>();
  for (const k of state.kinship) present.add(edgeKey(k.fromPersonId, k.toPersonId, k.type));
  const has = (from: string, to: string, type: string) => present.has(edgeKey(from, to, type));

  const seenEdges = new Set<string>();
  const motherOf = new Map<string, string>();
  for (const k of state.kinship) {
    if (!personExists(state, db, k.fromPersonId)) e("KIN_BAD_FROM", `亲缘边起点「${k.fromPersonId}」不是有效人物`, { edge: k });
    if (!personExists(state, db, k.toPersonId)) e("KIN_BAD_TO", `亲缘边终点「${k.toPersonId}」不是有效人物`, { edge: k });

    const key = edgeKey(k.fromPersonId, k.toPersonId, k.type);
    if (seenEdges.has(key)) e("KIN_DUP_EDGE", `重复亲缘边 ${key}`, { edge: k });
    seenEdges.add(key);

    if (k.type === "mother") {
      const child = k.fromPersonId;
      const mom = k.toPersonId;
      const prev = motherOf.get(child);
      if (prev !== undefined && prev !== mom) {
        e("KIN_MULTI_MOTHER", `人物「${child}」有两个生母（${prev} / ${mom}）`, { personId: child });
      }
      motherOf.set(child, mom);

      // 生母必须为女性：男性家族成员/男性侍君不得作 mother。
      const momSex = sexOf(state, db, mom);
      if (momSex !== undefined && momSex !== "female") {
        e("KIN_MOTHER_NOT_FEMALE", `mother 边终点「${mom}」(${momSex}) 不是女性`, { edge: k });
      }

      // 反向边类型须与 child 实际性别严格匹配：male→son、female→daughter。
      const childSex = sexOf(state, db, child);
      if (childSex === "male" && !has(mom, child, "son")) {
        e("KIN_NO_REVERSE", `male child「${child}」缺正确反向 son 边（${mom}→${child}）`, { edge: k });
      }
      if (childSex === "female" && !has(mom, child, "daughter")) {
        e("KIN_NO_REVERSE", `female child「${child}」缺正确反向 daughter 边（${mom}→${child}）`, { edge: k });
      }

      // 家族归属一致：child 与 mother 的 canonical familyId 若均定义，必须相等。
      const cfChild = canonicalFamilyOf(state, db, child);
      const cfMom = canonicalFamilyOf(state, db, mom);
      if (cfChild !== undefined && cfMom !== undefined && cfChild !== cfMom) {
        e("KIN_FAMILY_MISMATCH", `母子家族不一致：「${child}」(${cfChild}) vs 母「${mom}」(${cfMom})`, { edge: k });
      }
      // 注：母女/配偶的「数值年龄差」属生成期合理性，不是持久不变量——官员逐年增龄、
      // 侍君用独立静态年龄系统、死者冻结年龄，运行中差值会合法漂移，故只在生成期校验
      // （见 validateGeneratedAges），绝不在 load/persist 路径上判定，以免误隔离合法老档。
    }
    if (k.type === "daughter" || k.type === "son") {
      // {from: parent, to: child}：child 性别须与边类型匹配，且有反向 mother 边。
      const childSex = sexOf(state, db, k.toPersonId);
      if (k.type === "daughter" && childSex === "male") {
        e("KIN_REVERSE_SEX", `daughter 边指向男性「${k.toPersonId}」`, { edge: k });
      }
      if (k.type === "son" && childSex === "female") {
        e("KIN_REVERSE_SEX", `son 边指向女性「${k.toPersonId}」`, { edge: k });
      }
      if (!has(k.toPersonId, k.fromPersonId, "mother")) {
        e("KIN_NO_REVERSE", `${k.type} 边缺反向 mother（${k.toPersonId} → ${k.fromPersonId}）`, { edge: k });
      }
    }
    if (k.type === "sibling" || k.type === "spouse") {
      if (!has(k.toPersonId, k.fromPersonId, k.type)) {
        e("KIN_NOT_SYMMETRIC", `${k.type} 边不对称（缺 ${k.toPersonId} → ${k.fromPersonId}）`, { edge: k });
      }
    }
  }

  // ── 人事决策（PR3C-3b）：record key=id、sourceId 去重、引用存在性、官族匹配、状态/裁断一致性 ──
  const seenDecisionSource = new Set<string>();
  for (const [key, d] of Object.entries(state.personnelDecisions)) {
    if (d.id !== key) e("PDEC_KEY_MISMATCH", `personnelDecisions["${key}"].id = "${d.id}"（键不一致）`, { key, id: d.id });
    if (seenDecisionSource.has(d.sourceId)) e("PDEC_DUP_SOURCE", `人事决策来源「${d.sourceId}」重复`, { id: d.id, sourceId: d.sourceId });
    seenDecisionSource.add(d.sourceId);

    const off = state.officials[d.officialId];
    if (!off) e("PDEC_BAD_OFFICIAL", `人事决策「${d.id}」指向无效官员「${d.officialId}」`, { id: d.id, officialId: d.officialId });

    // consortId（若有）须为在宫侍君（在 standing 且非 official）。
    if (d.consortId !== undefined && (!state.standing[d.consortId] || state.officials[d.consortId])) {
      e("PDEC_BAD_CONSORT", `人事决策「${d.id}」consortId「${d.consortId}」不是有效侍君`, { id: d.id, consortId: d.consortId });
    }
    if (d.familyId !== undefined && !state.officialFamilies[d.familyId]) {
      e("PDEC_BAD_FAMILY", `人事决策「${d.id}」familyId「${d.familyId}」无对应家族`, { id: d.id, familyId: d.familyId });
    }
    if (off && d.familyId !== undefined && off.familyId !== d.familyId) {
      e("PDEC_FAMILY_MISMATCH", `人事决策「${d.id}」官员家族「${off.familyId}」≠ decision.familyId「${d.familyId}」`, { id: d.id });
    }
    if (d.fromPostId !== undefined && !gradedPost(d.fromPostId)) e("PDEC_BAD_POST", `人事决策「${d.id}」fromPostId「${d.fromPostId}」非有效官职`, { id: d.id });
    if (d.recommendedPostId !== undefined && !gradedPost(d.recommendedPostId)) e("PDEC_BAD_POST", `人事决策「${d.id}」recommendedPostId「${d.recommendedPostId}」非有效官职`, { id: d.id });

    // sourcePunishmentId：family_implication 必须有，且须指向真实**侍君**目标记录。
    if (d.sourcePunishmentId !== undefined) {
      const sp = punishments[d.sourcePunishmentId];
      if (!sp) e("PDEC_BAD_SOURCE_PUNISHMENT", `人事决策「${d.id}」sourcePunishmentId「${d.sourcePunishmentId}」不存在`, { id: d.id });
      else if (d.kind === "family_implication" && sp.targetKind !== "consort") {
        e("PDEC_SOURCE_NOT_CONSORT", `牵连决策「${d.id}」来源 punishment 非侍君目标`, { id: d.id });
      }
    }
    if (d.kind === "family_implication" && d.sourcePunishmentId === undefined) {
      e("PDEC_IMPLICATION_NO_SOURCE", `牵连决策「${d.id}」缺 sourcePunishmentId`, { id: d.id });
    }
    if (d.caseId !== undefined && !state.justice.cases[d.caseId]) e("PDEC_BAD_CASE", `人事决策「${d.id}」caseId「${d.caseId}」不存在`, { id: d.id });

    // ── kind-specific 关联不变量（杜绝「各 ID 单独存在但语义错配」的损坏决策） ──
    const consortFamily = d.consortId !== undefined ? state.standing[d.consortId]?.birthFamilyId : undefined;
    if (d.kind === "consort_petition_promotion") {
      if (d.consortId === undefined) e("PDEC_MISSING_FIELD", `请托决策「${d.id}」缺 consortId`, { id: d.id });
      if (d.familyId === undefined) e("PDEC_MISSING_FIELD", `请托决策「${d.id}」缺 familyId`, { id: d.id });
      if (d.recommendedPostId === undefined) e("PDEC_MISSING_FIELD", `请托决策「${d.id}」缺 recommendedPostId`, { id: d.id });
      if (d.consortId !== undefined && consortFamily !== d.familyId) {
        e("PDEC_CONSORT_FAMILY_MISMATCH", `请托决策「${d.id}」侍君母族「${consortFamily ?? "无"}」≠ familyId「${d.familyId ?? "无"}」`, { id: d.id });
      }
    }
    if (d.kind === "family_implication") {
      if (d.consortId === undefined) e("PDEC_MISSING_FIELD", `牵连决策「${d.id}」缺 consortId`, { id: d.id });
      if (d.familyId === undefined) e("PDEC_MISSING_FIELD", `牵连决策「${d.id}」缺 familyId`, { id: d.id });
      if (d.fromPostId === undefined) e("PDEC_MISSING_FIELD", `牵连决策「${d.id}」缺 fromPostId`, { id: d.id });
      if (d.consortId !== undefined && consortFamily !== d.familyId) {
        e("PDEC_CONSORT_FAMILY_MISMATCH", `牵连决策「${d.id}」侍君母族「${consortFamily ?? "无"}」≠ familyId「${d.familyId ?? "无"}」`, { id: d.id });
      }
      const sp = d.sourcePunishmentId !== undefined ? punishments[d.sourcePunishmentId] : undefined;
      if (sp) {
        if (sp.targetId !== d.consortId) e("PDEC_SOURCE_TARGET_MISMATCH", `牵连决策「${d.id}」来源 punishment 目标「${sp.targetId}」≠ consortId「${d.consortId ?? "无"}」`, { id: d.id });
        if (sp.severity !== "severe" && sp.severity !== "terminal") e("PDEC_SOURCE_NOT_SEVERE", `牵连决策「${d.id}」来源 punishment 严重度「${sp.severity}」不足（须 severe/terminal）`, { id: d.id });
      }
    }
    if ((d.kind === "memorial_promotion" || d.kind === "memorial_demotion") && d.recommendedPostId === undefined) {
      e("PDEC_MISSING_FIELD", `奏折「${d.id}」(${d.kind}) 缺 recommendedPostId`, { id: d.id });
    }
    if (d.kind === "memorial_dismissal" && d.recommendedPostId !== undefined) {
      e("PDEC_DISMISSAL_WITH_TARGET", `请免奏折「${d.id}」不应带 recommendedPostId`, { id: d.id });
    }

    // pending/resolved 字段一致性 + 裁断合法 + resolvedAt ≥ createdAt。
    if (d.status === "pending") {
      if (d.resolvedAt !== undefined || d.resolution !== undefined) e("PDEC_PENDING_WITH_RESOLUTION", `待裁人事决策「${d.id}」不应带 resolvedAt/resolution`, { id: d.id });
    } else {
      if (d.resolvedAt === undefined || d.resolution === undefined) {
        e("PDEC_RESOLVED_MISSING_FIELDS", `已裁人事决策「${d.id}」缺 resolvedAt/resolution`, { id: d.id });
      } else {
        if (!legalResolutionsFor(d.kind).includes(d.resolution)) e("PDEC_BAD_RESOLUTION", `人事决策「${d.id}」裁断「${d.resolution}」对「${d.kind}」非法`, { id: d.id });
        if (compareGameTime(d.resolvedAt, d.createdAt) < 0) e("PDEC_RESOLVED_BEFORE_CREATED", `人事决策「${d.id}」resolvedAt 早于 createdAt`, { id: d.id });
      }
    }
  }

  return errors;
}

/**
 * 生成期年龄合理性（KIN_BAD_AGE / KIN_BAD_SPOUSE_AGE）。仅用于「开局生成」断言，不进入
 * load/persist 路径——运行中官员增龄、侍君静态年龄、死者冻结会令差值合法漂移。
 */
export function validateGeneratedAges(state: GameState, db: ContentDB): GameError[] {
  const errors: GameError[] = [];
  const e = (code: string, message: string, context?: Record<string, unknown>) =>
    errors.push(stateError(code, message, context ? { context } : undefined));
  for (const k of state.kinship) {
    if (k.type === "mother") {
      const childAge = ageOf(state, db, k.fromPersonId);
      const motherAge = ageOf(state, db, k.toPersonId);
      if (childAge !== undefined && motherAge !== undefined && !isValidParentChildAge(motherAge, childAge)) {
        e("KIN_BAD_AGE", `母「${k.toPersonId}」(${motherAge}) 与子女「${k.fromPersonId}」(${childAge}) 年龄关系不合理`, { edge: k });
      }
    }
    if (k.type === "spouse") {
      const a = ageOf(state, db, k.fromPersonId);
      const b = ageOf(state, db, k.toPersonId);
      if (a !== undefined && b !== undefined && !isValidSpouseAge(a, b)) {
        e("KIN_BAD_SPOUSE_AGE", `配偶「${k.fromPersonId}」(${a}) 与「${k.toPersonId}」(${b}) 年龄差不合理`, { edge: k });
      }
    }
  }
  return errors;
}

/**
 * 开局建档的完整性断言 = 持久不变量（validateOfficialWorld）+ 生成期年龄合理性
 * （validateGeneratedAges）。createNewGameState 的**唯一**自检入口（fail-fast）；load/import
 * 路径只跑 validateOfficialWorld，绝不把母子/配偶年龄差放回读档校验。
 */
export function assertGeneratedOfficialWorld(state: GameState, db: ContentDB): GameError[] {
  return [...validateOfficialWorld(state, db), ...validateGeneratedAges(state, db)];
}

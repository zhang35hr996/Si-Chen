/** 人事决策原子裁断（Phase 3 PR3C-3b）：行政升迁/PUNISH 边界、关系/记忆后果、原子失败、validator。 */
import { describe, expect, it } from "vitest";
import {
  generateConsortPetition,
  generateFamilyImplication,
  generateMemorial,
} from "../../src/engine/officials/personnelDecisions";
import { resolvePersonnelDecision } from "../../src/engine/officials/personnelDecisionResolve";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { toGameTime } from "../../src/engine/calendar/time";
import type { GameState, Official } from "../../src/engine/state/types";
import type { PunishmentRecord } from "../../src/engine/justice/types";
import type { PunishmentSeverity } from "../../src/engine/punishments/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
// 决策裁断必经正式 API（punishOfficial 会写 CourtEvent，occurredAt 须 ≤ now）；用开局真实时刻作裁断/生成时刻，
// 保证 occurredAt===now 且 resolvedAt===createdAt（不早于）。
const NOW = toGameTime(createNewGameState(db, 1).calendar);
const at = (_y: number) => NOW;
const punCount = (s: GameState) => Object.keys(s.justice.punishments).length;

const LU_CONSORT = "lu_huaijin";
const LU_OFFICIAL = "official_fam_lu_main";
const WEN_OFFICIAL = "official_fam_wen_main";

function withConsortPunishment(s: GameState, consortId: string, severity: PunishmentSeverity, id = "pun_000001"): GameState {
  const rec: PunishmentRecord = {
    id, targetId: consortId, targetKind: "consort", actorId: "player", kind: "rank_demotion",
    severity, imposedAt: at(2), publicity: "palace", lifecycle: { status: "active" },
    details: { fromRankId: "rank_a", toRankId: "rank_b" },
  };
  return { ...s, justice: { ...s.justice, punishments: { ...s.justice.punishments, [id]: rec }, nextSeq: { ...s.justice.nextSeq, punishment: Number(id.slice(4)) + 1 } } };
}
function tune(s: GameState, officialId: string, patch: Partial<Official["reviewState"]>): GameState {
  const o = s.officials[officialId]!;
  return { ...s, officials: { ...s.officials, [officialId]: { ...o, reviewState: { ...o.reviewState, ...patch } } } };
}

describe("petition resolution — administrative promotion (no PUNISH)", () => {
  it("approve promotes via administrative API: no PunishmentRecord, no punishmentId on history, consort gains", () => {
    const g = generateConsortPetition(createNewGameState(db, 1), db, LU_CONSORT, at(3))!;
    const before = g.state;
    const favorBefore = before.standing[LU_CONSORT]!.favor;
    const r = resolvePersonnelDecision(before, db, g.decision.id, "approve", at(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = r.value.state;
    expect(r.value.punishmentId).toBeUndefined();
    expect(punCount(st)).toBe(0); // 绝不创建 PunishmentRecord
    expect(st.officials[LU_OFFICIAL]!.postId).toBe(g.decision.recommendedPostId);
    // 升迁 history 无 punishmentId。
    const hist = st.officialHistory.filter((h) => h.officialId === LU_OFFICIAL);
    expect(hist.every((h) => h.punishmentId === undefined)).toBe(true);
    expect(st.standing[LU_CONSORT]!.favor).toBeGreaterThan(favorBefore); // 适度正面
    expect(st.personnelDecisions[g.decision.id]!.status).toBe("resolved");
    expect(st.personnelDecisions[g.decision.id]!.resolution).toBe("approve");
    expect(validateOfficialWorld(st, db)).toEqual([]);
  });

  it("reject leaves the post unchanged, creates no PunishmentRecord, costs the consort", () => {
    const g = generateConsortPetition(createNewGameState(db, 1), db, LU_CONSORT, at(3))!;
    const favorBefore = g.state.standing[LU_CONSORT]!.favor;
    const r = resolvePersonnelDecision(g.state, db, g.decision.id, "reject", at(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = r.value.state;
    expect(st.officials[LU_OFFICIAL]!.postId).toBe(g.state.officials[LU_OFFICIAL]!.postId); // 不变
    expect(punCount(st)).toBe(0);
    expect(st.standing[LU_CONSORT]!.favor).toBeLessThan(favorBefore);
    expect(st.personnelDecisions[g.decision.id]!.resolution).toBe("reject");
    expect(validateOfficialWorld(st, db)).toEqual([]);
  });

  it("writes a private memory to the petitioning consort (not broadcast)", () => {
    const g = generateConsortPetition(createNewGameState(db, 1), db, LU_CONSORT, at(3))!;
    const memBefore = g.state.memories[LU_CONSORT]!.entries.length;
    const r = resolvePersonnelDecision(g.state, db, g.decision.id, "reject", at(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.memories[LU_CONSORT]!.entries.length).toBe(memBefore + 1);
  });
});

describe("family implication resolution — PUNISH branch", () => {
  it("spare leaves the official untouched and creates no PunishmentRecord", () => {
    const s = withConsortPunishment(createNewGameState(db, 1), LU_CONSORT, "severe");
    const g = generateFamilyImplication(s, db, "pun_000001", at(3))!;
    const r = resolvePersonnelDecision(g.state, db, g.decision.id, "spare", at(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.officials[LU_OFFICIAL]!.postId).toBe(s.officials[LU_OFFICIAL]!.postId);
    expect(punCount(r.value.state)).toBe(1); // 只有原侍君记录，无新增
    expect(r.value.punishmentId).toBeUndefined();
    expect(validateOfficialWorld(r.value.state, db)).toEqual([]);
  });

  it("demote routes through punishOfficial: a new official PunishmentRecord + history punishmentId", () => {
    const s = withConsortPunishment(createNewGameState(db, 1), LU_CONSORT, "severe");
    const g = generateFamilyImplication(s, db, "pun_000001", at(3))!;
    const r = resolvePersonnelDecision(g.state, db, g.decision.id, "demote", at(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = r.value.state;
    expect(punCount(st)).toBe(2);
    const pun = st.justice.punishments[r.value.punishmentId!]!;
    expect(pun.targetKind).toBe("official");
    expect(pun.kind).toBe("official_demotion");
    expect(pun.targetId).toBe(LU_OFFICIAL);
    expect(st.officials[LU_OFFICIAL]!.postId).toBe(g.decision.recommendedPostId);
    expect(st.officialHistory.some((h) => h.officialId === LU_OFFICIAL && h.punishmentId === r.value.punishmentId)).toBe(true);
    expect(validateOfficialWorld(st, db)).toEqual([]);
  });

  it("dismiss routes through punishOfficial (official_dismissal); not auto-reinstated next review", () => {
    const s = withConsortPunishment(createNewGameState(db, 1), LU_CONSORT, "terminal");
    const g = generateFamilyImplication(s, db, "pun_000001", at(3))!;
    const r = resolvePersonnelDecision(g.state, db, g.decision.id, "dismiss", at(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const st = r.value.state;
    expect(st.justice.punishments[r.value.punishmentId!]!.kind).toBe("official_dismissal");
    expect(st.officials[LU_OFFICIAL]!.postId).toBeNull();
    expect(st.officials[LU_OFFICIAL]!.status).toBe("active");
    expect(validateOfficialWorld(st, db)).toEqual([]);
  });

  it("regression: a source punishment carrying a caseId still lets demote AND dismiss succeed", () => {
    // 来源侍君案件 subjectIds 只含侍君，不含其族官员。decision 继承 caseId 作叙事溯源，但 resolver
    // 绝不把它传给 punishOfficial（否则 justice 因 subject 不匹配拒绝）。
    const caseRec = {
      id: "case_000001", status: "open" as const, subjectIds: [LU_CONSORT], openedAt: NOW, openedBy: "player",
      source: { kind: "imperial" as const }, publicity: "palace" as const, charges: [], evidence: [], confessions: [], punishmentIds: ["pun_000001"],
    };
    const seed = withConsortPunishment(createNewGameState(db, 1), LU_CONSORT, "severe");
    const punWithCase: PunishmentRecord = { ...seed.justice.punishments.pun_000001!, caseId: "case_000001" };
    const withCase = { ...seed, justice: { ...seed.justice, cases: { case_000001: caseRec }, punishments: { pun_000001: punWithCase }, nextSeq: { ...seed.justice.nextSeq, case: 2 } } };
    const g = generateFamilyImplication(withCase, db, "pun_000001", NOW)!;
    expect(g.decision.caseId).toBe("case_000001"); // 决策保留溯源

    for (const resolution of ["demote", "dismiss"] as const) {
      const r = resolvePersonnelDecision(g.state, db, g.decision.id, resolution, NOW);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const newPun = r.value.state.justice.punishments[r.value.punishmentId!]!;
      expect(newPun.caseId).toBeUndefined(); // 官员惩戒不绑定侍君案件
      expect(validateOfficialWorld(r.value.state, db)).toEqual([]);
    }
  });

  it("punished consort forms a private trauma memory linked to the new punishment", () => {
    const s = withConsortPunishment(createNewGameState(db, 1), LU_CONSORT, "severe");
    const g = generateFamilyImplication(s, db, "pun_000001", at(3))!;
    const r = resolvePersonnelDecision(g.state, db, g.decision.id, "dismiss", at(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const mems = r.value.state.memories[LU_CONSORT]!.entries;
    const newest = mems[mems.length - 1]!;
    expect(newest.kind).toBe("trauma");
    expect(newest.sourcePunishmentId).toBe(r.value.punishmentId);
  });
});

describe("memorial resolution — administrative vs PUNISH boundary", () => {
  it("memorial_promotion approve is administrative (no PunishmentRecord)", () => {
    let s = tune(createNewGameState(db, 1), WEN_OFFICIAL, { merit: 95 });
    s = { ...s, officials: { ...s.officials, [WEN_OFFICIAL]: { ...s.officials[WEN_OFFICIAL]!, loyalty: 95, aptitude: { governance: 95, scholarship: 95, military: 95, integrity: 95 } } } };
    const g = generateMemorial(s, db, WEN_OFFICIAL, "memorial_promotion", at(3))!;
    const r = resolvePersonnelDecision(g.state, db, g.decision.id, "approve", at(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(punCount(r.value.state)).toBe(0);
    expect(r.value.state.officials[WEN_OFFICIAL]!.postId).toBe(g.decision.recommendedPostId);
    expect(validateOfficialWorld(r.value.state, db)).toEqual([]);
  });

  it("memorial_demotion approve routes through PUNISH; reject changes nothing", () => {
    const s = tune(createNewGameState(db, 1), WEN_OFFICIAL, { merit: 20 });
    const g = generateMemorial(s, db, WEN_OFFICIAL, "memorial_demotion", at(3))!;
    const ok = resolvePersonnelDecision(g.state, db, g.decision.id, "approve", at(3));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.value.state.justice.punishments[ok.value.punishmentId!]!.kind).toBe("official_demotion");
    expect(validateOfficialWorld(ok.value.state, db)).toEqual([]);

    const g2 = generateMemorial(tune(createNewGameState(db, 1), WEN_OFFICIAL, { merit: 20 }), db, WEN_OFFICIAL, "memorial_demotion", at(3))!;
    const rej = resolvePersonnelDecision(g2.state, db, g2.decision.id, "reject", at(3));
    expect(rej.ok).toBe(true);
    if (!rej.ok) return;
    expect(punCount(rej.value.state)).toBe(0);
    expect(rej.value.state.officials[WEN_OFFICIAL]!.postId).toBe(g2.state.officials[WEN_OFFICIAL]!.postId);
  });

  it("memorial_dismissal approve routes through PUNISH (official_dismissal)", () => {
    const s = tune(createNewGameState(db, 1), WEN_OFFICIAL, { underperformanceYears: 2 });
    const g = generateMemorial(s, db, WEN_OFFICIAL, "memorial_dismissal", at(3))!;
    const r = resolvePersonnelDecision(g.state, db, g.decision.id, "approve", at(3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.justice.punishments[r.value.punishmentId!]!.kind).toBe("official_dismissal");
  });
});

describe("atomic failure & lifecycle", () => {
  it("rejects an unknown decision id without mutating state", () => {
    const s = createNewGameState(db, 1);
    const snap = JSON.stringify(s);
    expect(resolvePersonnelDecision(s, db, "pdec_999999", "approve", at(3)).ok).toBe(false);
    expect(JSON.stringify(s)).toBe(snap);
  });

  it("rejects an illegal resolution for the kind (state byte-identical)", () => {
    const g = generateConsortPetition(createNewGameState(db, 1), db, LU_CONSORT, at(3))!;
    const snap = JSON.stringify(g.state);
    expect(resolvePersonnelDecision(g.state, db, g.decision.id, "demote", at(3)).ok).toBe(false); // demote 非 petition 合法裁断
    expect(JSON.stringify(g.state)).toBe(snap);
  });

  it("cannot resolve a decision twice", () => {
    const g = generateConsortPetition(createNewGameState(db, 1), db, LU_CONSORT, at(3))!;
    const first = resolvePersonnelDecision(g.state, db, g.decision.id, "approve", at(3));
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = resolvePersonnelDecision(first.value.state, db, g.decision.id, "approve", at(3));
    expect(again.ok).toBe(false);
  });

  it("promotion approve fails atomically when the recommended seat is no longer vacant", () => {
    const g = generateConsortPetition(createNewGameState(db, 1), db, LU_CONSORT, at(3))!;
    // 把建议席位塞满（seatCount=1 的 g15 官职）→ 升迁 API 失败 → 整体不变。
    const target = g.decision.recommendedPostId!;
    const blocked = { ...g.state, officials: { ...g.state.officials, [WEN_OFFICIAL]: { ...g.state.officials[WEN_OFFICIAL]!, postId: target } } };
    const snap = JSON.stringify(blocked);
    const r = resolvePersonnelDecision(blocked, db, g.decision.id, "approve", at(3));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(blocked)).toBe(snap); // decision 保持 pending，无后果
  });

  it("survives a save/load round-trip and remains resolvable while pending", () => {
    const g = generateConsortPetition(createNewGameState(db, 1), db, LU_CONSORT, at(3))!;
    const roundTripped = JSON.parse(JSON.stringify(g.state)) as GameState;
    expect(roundTripped.personnelDecisions[g.decision.id]!.status).toBe("pending");
    const r = resolvePersonnelDecision(roundTripped, db, g.decision.id, "approve", at(3));
    expect(r.ok).toBe(true);
  });
});

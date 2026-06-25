/** 人事决策生成器（Phase 3 PR3C-3b）：资格门、确定性目标选择、去重。 */
import { describe, expect, it } from "vitest";
import {
  generateConsortPetition,
  generateFamilyImplication,
  generateMemorial,
  getPendingPersonnelDecisions,
  selectHigherVacantPost,
  selectLowerVacantPost,
} from "../../src/engine/officials/personnelDecisions";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, Official } from "../../src/engine/state/types";
import type { PunishmentRecord } from "../../src/engine/justice/types";
import type { PunishmentSeverity } from "../../src/engine/punishments/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 5, period: "early" as const, dayIndex: y * 100 });
const gradeOf = (pid: string | null) => (pid ? db.officialPosts[pid]!.gradeOrder : 0);

// 开局确定性事实（见 worldgen）：
//   lu_huaijin   ↔ fam_lu_main   ↔ official_fam_lu_main   @ guozijian_jijiu (g14)  [mother 边]
//   wenya        ↔ fam_wen_main  ↔ official_fam_wen_main   @ zhifu (g11)
//   shen_zhibai  ↔ fam_shen_main ↔ official_fam_shen_main  @ chengxiang (g18, 顶)
//   xu_qinghuan  ↔ fam_xu_main   ↔ official_fam_xu_main    @ bingbu_shangshu (g15)
const LU_CONSORT = "lu_huaijin";
const LU_OFFICIAL = "official_fam_lu_main";
const SHEN_CONSORT = "shen_zhibai";
const WEN_OFFICIAL = "official_fam_wen_main";

/** 注入一条侍君 PunishmentRecord（牵连来源），并推进 nextSeq。 */
function withConsortPunishment(s: GameState, consortId: string, severity: PunishmentSeverity, id = "pun_000001"): GameState {
  const rec: PunishmentRecord = {
    id, targetId: consortId, targetKind: "consort", actorId: "player", kind: "rank_demotion",
    severity, imposedAt: at(2), publicity: "palace", lifecycle: { status: "active" },
    details: { fromRankId: "rank_a", toRankId: "rank_b" },
  };
  const seqNum = Number(id.slice(4)) + 1;
  return {
    ...s,
    justice: { ...s.justice, punishments: { ...s.justice.punishments, [id]: rec }, nextSeq: { ...s.justice.nextSeq, punishment: seqNum } },
  };
}

describe("selection helpers — deterministic & bounded", () => {
  it("higher target is within (from, from+2] and vacant; top-grade official has none", () => {
    const s = createNewGameState(db, 1);
    const lu = s.officials[LU_OFFICIAL]!;
    const target = selectHigherVacantPost(s, db, lu)!;
    expect(target).not.toBeNull();
    expect(gradeOf(target)).toBeGreaterThan(gradeOf(lu.postId));
    expect(gradeOf(target)).toBeLessThanOrEqual(gradeOf(lu.postId) + 2);
    const shen = s.officials["official_fam_shen_main"]!; // 顶级 g18
    expect(selectHigherVacantPost(s, db, shen)).toBeNull();
  });

  it("lower target is within [from-2, from-1] and vacant", () => {
    const s = createNewGameState(db, 1);
    const lu = s.officials[LU_OFFICIAL]!;
    const target = selectLowerVacantPost(s, db, lu)!;
    expect(gradeOf(target)).toBeLessThan(gradeOf(lu.postId));
    expect(gradeOf(target)).toBeGreaterThanOrEqual(gradeOf(lu.postId) - 2);
  });

  it("selection is deterministic across repeated calls", () => {
    const s = createNewGameState(db, 1);
    const lu = s.officials[LU_OFFICIAL]!;
    expect(selectHigherVacantPost(s, db, lu)).toBe(selectHigherVacantPost(s, db, lu));
    expect(selectLowerVacantPost(s, db, lu)).toBe(selectLowerVacantPost(s, db, lu));
  });
});

describe("generateConsortPetition", () => {
  it("creates a pending administrative-promotion decision targeting a kin official", () => {
    const s = createNewGameState(db, 1);
    const r = generateConsortPetition(s, db, LU_CONSORT, at(3))!;
    expect(r).not.toBeNull();
    const d = r.decision;
    expect(d.kind).toBe("consort_petition_promotion");
    expect(d.status).toBe("pending");
    expect(d.consortId).toBe(LU_CONSORT);
    expect(d.officialId).toBe(LU_OFFICIAL);
    expect(d.familyId).toBe("fam_lu_main");
    expect(gradeOf(d.recommendedPostId!)).toBeGreaterThan(gradeOf(d.fromPostId!));
    expect(d.sourcePunishmentId).toBeUndefined();
    expect(validateOfficialWorld(r.state, db)).toEqual([]);
  });

  it("does not generate for a consort without birthFamily", () => {
    const s = createNewGameState(db, 1);
    const plain = Object.entries(s.standing).find(([id, st]) => !st.birthFamilyId && !s.officials[id])![0];
    expect(generateConsortPetition(s, db, plain, at(3))).toBeNull();
  });

  it("does not generate for a deceased consort", () => {
    const s = createNewGameState(db, 1);
    const dead = { ...s, standing: { ...s.standing, [LU_CONSORT]: { ...s.standing[LU_CONSORT]!, lifecycle: "deceased" as const } } };
    expect(generateConsortPetition(dead, db, LU_CONSORT, at(3))).toBeNull();
  });

  it("does not generate when no higher vacant post exists for any kin official", () => {
    const s = createNewGameState(db, 1);
    // shen 的官员已是顶级，无更高空缺。
    expect(generateConsortPetition(s, db, SHEN_CONSORT, at(3))).toBeNull();
  });

  it("dedups by source (same consort+official+year) and by pending petition per consort", () => {
    const s = createNewGameState(db, 1);
    const first = generateConsortPetition(s, db, LU_CONSORT, at(3))!;
    expect(generateConsortPetition(first.state, db, LU_CONSORT, at(3))).toBeNull(); // pending exists
    // 即使换年，pending 未决 → 仍不重复。
    expect(generateConsortPetition(first.state, db, LU_CONSORT, at(4))).toBeNull();
  });
});

describe("generateFamilyImplication", () => {
  it("requires a severe consort punishment as source and targets the highest-grade kin official", () => {
    const s = withConsortPunishment(createNewGameState(db, 1), LU_CONSORT, "severe");
    const r = generateFamilyImplication(s, db, "pun_000001", at(3))!;
    expect(r).not.toBeNull();
    const d = r.decision;
    expect(d.kind).toBe("family_implication");
    expect(d.officialId).toBe(LU_OFFICIAL);
    expect(d.consortId).toBe(LU_CONSORT);
    expect(d.sourcePunishmentId).toBe("pun_000001");
    expect(gradeOf(d.recommendedPostId!)).toBeLessThan(gradeOf(d.fromPostId!)); // 有低品空缺
    expect(validateOfficialWorld(r.state, db)).toEqual([]);
  });

  it("does not generate when the source punishment is not severe enough", () => {
    const s = withConsortPunishment(createNewGameState(db, 1), LU_CONSORT, "moderate");
    expect(generateFamilyImplication(s, db, "pun_000001", at(3))).toBeNull();
  });

  it("does not generate when the source punishment does not exist", () => {
    const s = createNewGameState(db, 1);
    expect(generateFamilyImplication(s, db, "pun_999999", at(3))).toBeNull();
  });

  it("dedups by sourcePunishmentId", () => {
    const s = withConsortPunishment(createNewGameState(db, 1), LU_CONSORT, "terminal");
    const first = generateFamilyImplication(s, db, "pun_000001", at(3))!;
    expect(generateFamilyImplication(first.state, db, "pun_000001", at(4))).toBeNull();
  });
});

describe("generateMemorial", () => {
  /** 把某官员调到指定 merit / underperformance，用于触发各类奏折。 */
  function tune(s: GameState, officialId: string, patch: Partial<Official["reviewState"]>): GameState {
    const o = s.officials[officialId]!;
    return { ...s, officials: { ...s.officials, [officialId]: { ...o, reviewState: { ...o.reviewState, ...patch } } } };
  }

  it("memorial_promotion needs merit + score + higher vacancy", () => {
    const s = tune(createNewGameState(db, 1), WEN_OFFICIAL, { merit: 95 });
    const tuned = { ...s, officials: { ...s.officials, [WEN_OFFICIAL]: { ...s.officials[WEN_OFFICIAL]!, loyalty: 95, aptitude: { governance: 95, scholarship: 95, military: 95, integrity: 95 } } } };
    const r = generateMemorial(tuned, db, WEN_OFFICIAL, "memorial_promotion", at(3));
    expect(r).not.toBeNull();
    expect(r!.decision.kind).toBe("memorial_promotion");
    expect(gradeOf(r!.decision.recommendedPostId!)).toBeGreaterThan(gradeOf(r!.decision.fromPostId!));
    expect(validateOfficialWorld(r!.state, db)).toEqual([]);
  });

  it("memorial_demotion needs low merit + lower vacancy", () => {
    const s = tune(createNewGameState(db, 1), WEN_OFFICIAL, { merit: 20 });
    const r = generateMemorial(s, db, WEN_OFFICIAL, "memorial_demotion", at(3));
    expect(r).not.toBeNull();
    expect(gradeOf(r!.decision.recommendedPostId!)).toBeLessThan(gradeOf(r!.decision.fromPostId!));
  });

  it("memorial_dismissal needs sustained underperformance", () => {
    const s = tune(createNewGameState(db, 1), WEN_OFFICIAL, { underperformanceYears: 2 });
    const r = generateMemorial(s, db, WEN_OFFICIAL, "memorial_dismissal", at(3));
    expect(r).not.toBeNull();
    expect(r!.decision.recommendedPostId).toBeUndefined();
    // 政绩尚可（默认）且无连续不合格 → 不生成。
    expect(generateMemorial(createNewGameState(db, 1), db, WEN_OFFICIAL, "memorial_dismissal", at(3))).toBeNull();
  });

  it("does not generate for a non-seated official", () => {
    const s = createNewGameState(db, 1);
    const noPost = { ...s, officials: { ...s.officials, [WEN_OFFICIAL]: { ...s.officials[WEN_OFFICIAL]!, postId: null } } };
    expect(generateMemorial(noPost, db, WEN_OFFICIAL, "memorial_promotion", at(3))).toBeNull();
  });

  it("dedups same kind+official+year", () => {
    const s = tune(createNewGameState(db, 1), WEN_OFFICIAL, { merit: 20 });
    const first = generateMemorial(s, db, WEN_OFFICIAL, "memorial_demotion", at(3))!;
    expect(generateMemorial(first.state, db, WEN_OFFICIAL, "memorial_demotion", at(3))).toBeNull();
  });

  it("getPendingPersonnelDecisions returns pending sorted by id", () => {
    let s = createNewGameState(db, 1);
    s = generateConsortPetition(s, db, LU_CONSORT, at(3))!.state;
    s = tune(s, WEN_OFFICIAL, { merit: 20 });
    s = generateMemorial(s, db, WEN_OFFICIAL, "memorial_demotion", at(3))!.state;
    const pending = getPendingPersonnelDecisions(s);
    expect(pending.length).toBe(2);
    expect(pending.map((d) => d.id)).toEqual([...pending.map((d) => d.id)].sort());
  });
});

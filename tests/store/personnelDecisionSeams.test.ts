/**
 * 人事决策的**生产触发 seam**（Phase 3 PR3C-3b）：
 *  - 年度结算（吏部考课后）确定性生成人事奏折 + 侍君请托；
 *  - 侍君获罪（冷宫/幽禁/赐死）即时生成「获罪牵连家族」待裁决策；
 *  - 牵连降/免经 punishOfficial 成功（**不**继承侍君案件 caseId，避免 justice subject 不匹配）。
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { getPendingPersonnelDecisions } from "../../src/engine/officials/personnelDecisions";
import { settleAnnualExamination } from "../../src/engine/officials/examination";
import { hasReviewedYear } from "../../src/engine/officials/annualReview";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { allocateJusticeIds } from "../../src/engine/justice/ids";
import { applyJusticePlan } from "../../src/engine/justice/mutations";
import { createNewGameState } from "../../src/engine/state/newGame";
import { dayIndexOf, toGameTime } from "../../src/engine/calendar/time";
import type { CaseRecord } from "../../src/engine/justice/types";
import { loadRealContent } from "../helpers/contentFixture";
import { withConsort } from "../helpers/consortFixture";

const db = loadRealContent();
const LU_CONSORT = "lu_huaijin"; // 有母族 fam_lu_main + 在任官员 official_fam_lu_main(g14)
const LU_OFFICIAL = "official_fam_lu_main";
const punCount = (s: ReturnType<GameStore["getState"]>) => Object.keys(s.justice.punishments).length;

describe("annual settlement seam — 人事奏折 + 侍君请托", () => {
  it("crossing into 十一月 generates pending personnel decisions, resolvable, world valid", () => {
    const s = settleAnnualExamination(withConsort(createNewGameState(db, 7), db, "lu_huaijin"), db, 1, { year: 1, month: 2, period: "early", dayIndex: 0 });
    const store = new GameStore();
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 10, period: "late", dayIndex: dayIndexOf(1, 10, "late"), ap: 1 } });
    expect(getPendingPersonnelDecisions(store.getState())).toHaveLength(0);

    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    expect(store.getState().calendar.month).toBe(11);
    expect(hasReviewedYear(store.getState(), 1)).toBe(true);

    const pending = getPendingPersonnelDecisions(store.getState());
    expect(pending.length).toBeGreaterThan(0); // seam 真实可达：玩家无需手动构造
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);

    // 决策可经 store 命令裁断。
    const d = pending[0]!;
    const legal = d.kind === "family_implication" ? "spare" : "reject"; // 中性裁断，必合法
    const res = store.resolvePersonnelDecision(db, d.id, legal);
    expect(res.ok).toBe(true);
    expect(store.getState().personnelDecisions[d.id]!.status).toBe("resolved");
  });

  it("a sustained underperformer yields a memorial_dismissal in production (not zeroed away)", () => {
    // 关键回归：考课自动降级会清零 underperformanceYears；请免须据简报 dismissalCandidateIds 生成，
    // 而非读清零后的计数。tune WEN 连年不合格 + 低政绩（保持不合格，避免被 updateMerit 复位）。
    const s = settleAnnualExamination(createNewGameState(db, 7), db, 1, { year: 1, month: 2, period: "early", dayIndex: 0 });
    const WEN = "official_fam_wen_main";
    const tuned = { ...s, officials: { ...s.officials, [WEN]: { ...s.officials[WEN]!, reviewState: { merit: 15, underperformanceYears: 2 } } } };
    const store = new GameStore();
    store.loadState({ ...tuned, calendar: { ...tuned.calendar, year: 1, month: 10, period: "late", dayIndex: dayIndexOf(1, 10, "late"), ap: 1 } });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });

    const review = store.getState().annualReviews.find((r) => r.year === 1)!;
    expect(review.dismissalCandidateIds ?? []).toContain(WEN); // 简报记录了严重失职信号
    const decisions = Object.values(store.getState().personnelDecisions);
    const dismissal = decisions.find((d) => d.kind === "memorial_dismissal" && d.officialId === WEN);
    expect(dismissal).toBeDefined(); // 请免奏折在真实生产路径可达
    expect(dismissal!.recommendedPostId).toBeUndefined();
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);
  });

  it("is idempotent within the year (no duplicate generation on a second advance)", () => {
    const s = settleAnnualExamination(createNewGameState(db, 7), db, 1, { year: 1, month: 2, period: "early", dayIndex: 0 });
    const store = new GameStore();
    store.loadState({ ...s, calendar: { ...s.calendar, year: 1, month: 10, period: "late", dayIndex: dayIndexOf(1, 10, "late"), ap: 1 } });
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    const countAfterFirst = Object.keys(store.getState().personnelDecisions).length;
    store.advanceTime(db, { type: "SKIP_REMAINDER" }); // 同年再推进
    expect(Object.keys(store.getState().personnelDecisions).length).toBe(countAfterFirst);
  });
});

describe("family-implication seam — 侍君获罪即时生成", () => {
  it("sending a consort to the cold palace spawns a family-implication decision (single transaction)", () => {
    const store = new GameStore();
    store.loadState(withConsort(createNewGameState(db), db, "lu_huaijin"));
    let emits = 0;
    store.subscribe(() => { emits += 1; });
    const r = store.sendConsortToColdPalace(db, LU_CONSORT, {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(emits).toBe(1); // 折进同一提交，单次 emit

    const decisions = Object.values(store.getState().personnelDecisions);
    const impl = decisions.find((d) => d.kind === "family_implication" && d.consortId === LU_CONSORT);
    expect(impl).toBeDefined();
    expect(impl!.officialId).toBe(LU_OFFICIAL);
    expect(impl!.sourcePunishmentId).toBe(r.value.punishmentId);
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);
  });

  it("does not spawn for a non-qualifying (moderate) punishment", () => {
    const store = new GameStore();
    store.loadState(withConsort(createNewGameState(db), db, "lu_huaijin"));
    // 禁足（finite_confinement, moderate）不应触发牵连。
    const r = store.applyImperialPunishmentWithConsequences(db, { type: "impose_confinement", targetId: LU_CONSORT, durationTurns: 6 }, {});
    expect(r.ok).toBe(true);
    expect(Object.values(store.getState().personnelDecisions).some((d) => d.kind === "family_implication")).toBe(false);
  });

  it("execution spawns implication; resolving it does NOT add memory/relationship to the dead consort", () => {
    const store = new GameStore();
    store.loadState(withConsort(createNewGameState(db), db, "lu_huaijin"));
    const r = store.applyImperialCommand(db, { type: "execute", targetId: LU_CONSORT });
    expect(r.ok).toBe(true);
    expect(store.getState().standing[LU_CONSORT]!.lifecycle).toBe("deceased");
    const impl = Object.values(store.getState().personnelDecisions).find((d) => d.kind === "family_implication" && d.consortId === LU_CONSORT);
    expect(impl).toBeDefined();

    const memBefore = store.getState().memories[LU_CONSORT]!.entries.length;
    const standingBefore = JSON.stringify(store.getState().standing[LU_CONSORT]);
    const res = store.resolvePersonnelDecision(db, impl!.id, "dismiss");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // 官员仍被免（PUNISH 生效），但死者关系/记忆冻结。
    expect(store.getState().justice.punishments[res.value.punishmentId!]!.kind).toBe("official_dismissal");
    expect(store.getState().memories[LU_CONSORT]!.entries.length).toBe(memBefore); // 无新增记忆
    expect(JSON.stringify(store.getState().standing[LU_CONSORT])).toBe(standingBefore); // favor/affection/loyalty 不变
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);
  });
});

describe("family-implication regression — caseId not propagated to official punishment", () => {
  it("a cold-palace punishment WITH a caseId still lets demote/dismiss succeed", () => {
    const store = new GameStore();
    const base = withConsort(createNewGameState(db), db, "lu_huaijin");
    const now = toGameTime(base.calendar);
    const caseRecord: CaseRecord = {
      id: "case_000001", status: "open", subjectIds: [LU_CONSORT], openedAt: now, openedBy: "player",
      source: { kind: "imperial" }, publicity: "palace", charges: [], evidence: [], confessions: [], punishmentIds: [],
    };
    const alloc = allocateJusticeIds(base.justice, { cases: 1 });
    const withCase = applyJusticePlan(base, { mutations: [{ type: "create_case", record: caseRecord }], nextSeq: alloc.nextSeq });
    expect(withCase.ok).toBe(true);
    if (!withCase.ok) return;
    store.loadState(withCase.value);

    const punish = store.sendConsortToColdPalace(db, LU_CONSORT, { caseId: "case_000001" });
    expect(punish.ok).toBe(true);
    const impl = Object.values(store.getState().personnelDecisions).find((d) => d.kind === "family_implication")!;
    expect(impl).toBeDefined();

    const before = punCount(store.getState());
    // 降职：punishOfficial 不应继承侍君案件 caseId（否则 justice 因 subject 不匹配拒绝）。
    const res = store.resolvePersonnelDecision(db, impl.id, "demote");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.punishmentId).toBeDefined();
    const newPun = store.getState().justice.punishments[res.value.punishmentId!]!;
    expect(newPun.kind).toBe("official_demotion");
    expect(newPun.caseId).toBeUndefined(); // 官员惩戒不绑定该侍君案件
    expect(punCount(store.getState())).toBe(before + 1);
    expect(validateOfficialWorld(store.getState(), db)).toEqual([]);
  });
});

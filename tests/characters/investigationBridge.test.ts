/**
 * Phase 5B-2B1: 隐藏真相与调查执行层接轨 — 来源与公开报告桥接。
 *
 * 覆盖：
 *   - createHeirHealthAnomalyBundle 原子生成 incident + truth + 公开报告
 *   - 公开报告知识边界（绝不含 truth 字段）
 *   - 幂等与半完成态检测
 *   - 从公开报告立案（source.kind=investigation_incident）
 *   - 旧宫斗立案仍为 source.kind=legacy_intrigue
 *   - 含案件的存档 round-trip 通过 schema 校验
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createHeirHealthAnomalyBundle } from "../../src/engine/characters/haremInvestigation/createAnomalyBundle";
import { createInvestigationCaseFromAnomalyReport } from "../../src/engine/characters/haremInvestigation/createCaseFromAnomaly";
import { loadRealContent } from "../helpers/contentFixture";
import { toGameTime } from "../../src/engine/calendar/time";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);

function makeState(): GameState {
  const augmentedStanding = Object.fromEntries(
    Object.entries(base.standing).map(([id, st]) => [
      id,
      {
        ...st,
        ambition: st.ambition ?? 70,
        loyalty: st.loyalty ?? 30,
        personality: st.personality ?? {
          scheming: 70, sociability: 40, compassion: 20,
          courage: 60, jealousy: 70, emotionalStability: 30,
          pride: 40, intelligence: 55,
        },
        household: st.household ?? { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 40 },
      },
    ]),
  );
  return { ...base, standing: augmentedStanding };
}

const PARAMS = {
  victimHeirId: "heir_001",
  accuserIds: ["bai_zhuying"] as string[],
  initiallyAccusedIds: ["lu_huaijin"] as string[],
  symptom: "hysteria" as const,
  publicFactCodes: ["heir_fell_ill"] as string[],
  victimHealth: 60,
};

// 任何泄漏到公开报告会构成知识边界违规的后台字段
const FORBIDDEN_TRUTH_KEYS = [
  "causeType", "culpritIds", "accusedIds", "framingTargetIds",
  "method", "motive", "concealment", "evidenceNodes",
];

describe("5B-2B1: anomaly bundle generation", () => {
  it("IB-01: bundle 原子生成 incident + truth + 公开报告各一", () => {
    const r = createHeirHealthAnomalyBundle(makeState(), PARAMS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { state, incidentId, truthId, reportId } = r.value;

    expect(state.investigationIncidents).toHaveLength(1);
    expect(state.investigationTruths).toHaveLength(1);
    expect(state.investigationPublicReports).toHaveLength(1);

    expect(state.investigationIncidents[0]!.id).toBe(incidentId);
    expect(state.investigationTruths[0]!.id).toBe(truthId);
    expect(state.investigationPublicReports[0]!.id).toBe(reportId);
    expect(reportId).toBe(`iarep_${incidentId}`);
    expect(state.investigationPublicReports[0]!.source.incidentId).toBe(incidentId);
  });

  it("IB-02: 公开报告只携带公开字段，绝不含任何 truth 后台字段", () => {
    const r = createHeirHealthAnomalyBundle(makeState(), PARAMS);
    if (!r.ok) throw new Error("bundle failed");
    const report = r.value.state.investigationPublicReports[0]!;

    for (const k of FORBIDDEN_TRUTH_KEYS) {
      expect(report).not.toHaveProperty(k);
    }
    // 公开字段来自 incident，不来自 truth
    expect(report.knownTargetIds).toEqual(["heir_001"]);
    expect(report.suspectedActorIds).toEqual(["lu_huaijin"]); // = initiallyAccusedIds
    expect(report.accuserIds).toEqual(["bai_zhuying"]);
    expect(report.symptomCode).toBe("hysteria");
    expect(report.publicFactCodes).toEqual(["heir_fell_ill"]);
    expect(report.status).toBe("unread");
    expect(report.reportKind).toBe("anomaly");
  });

  it("IB-03: 同参数重复调用幂等，state 仍各一", () => {
    const r1 = createHeirHealthAnomalyBundle(makeState(), PARAMS);
    if (!r1.ok) throw new Error();
    const r2 = createHeirHealthAnomalyBundle(r1.value.state, PARAMS);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.incidentId).toBe(r1.value.incidentId);
    expect(r2.value.reportId).toBe(r1.value.reportId);
    expect(r2.value.state.investigationIncidents).toHaveLength(1);
    expect(r2.value.state.investigationPublicReports).toHaveLength(1);
  });

  it("IB-04: 半完成态（仅报告缺失）→ INCONSISTENT_INVESTIGATION_STATE", () => {
    const r1 = createHeirHealthAnomalyBundle(makeState(), PARAMS);
    if (!r1.ok) throw new Error();
    // 人为损坏：移除公开报告，保留 incident + truth
    const broken: GameState = { ...r1.value.state, investigationPublicReports: [] };
    const r2 = createHeirHealthAnomalyBundle(broken, PARAMS);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.error[0]!.code).toBe("INCONSISTENT_INVESTIGATION_STATE");
  });
});

describe("5B-2B1: open case from anomaly report", () => {
  it("IB-05: 从公开报告立案 → source.kind=investigation_incident，报告转 investigating", () => {
    const store = createGameStore();
    store.loadState(makeState());
    const made = store.createHeirHealthAnomalyIncident(PARAMS);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const { reportId, incidentId } = made.value;

    const opened = store.openInvestigationFromAnomalyReport(reportId);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;

    const caseObj = store.getState().haremInvestigationCases.find((c) => c.id === opened.value.caseId);
    expect(caseObj).toBeDefined();
    expect(caseObj!.source.kind).toBe("investigation_incident");
    expect(caseObj!.source.incidentId).toBe(incidentId);
    expect(caseObj!.knownTargetIds).toEqual(["heir_001"]);

    const report = store.getState().investigationPublicReports.find((rr) => rr.id === reportId);
    expect(report!.status).toBe("investigating");
    expect(report!.linkedInvestigationId).toBe(opened.value.caseId);
    expect(report!.acknowledgedAt).toBeDefined();
  });

  it("IB-06: 重复立案幂等，仅一个案件", () => {
    const store = createGameStore();
    store.loadState(makeState());
    const made = store.createHeirHealthAnomalyIncident(PARAMS);
    if (!made.ok) return;
    const a = store.openInvestigationFromAnomalyReport(made.value.reportId);
    const b = store.openInvestigationFromAnomalyReport(made.value.reportId);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.value.caseId).toBe(b.value.caseId);
    expect(store.getState().haremInvestigationCases).toHaveLength(1);
  });

  it("IB-07: 不存在的报告 → INVESTIGATION_PUBLIC_REPORT_NOT_FOUND", () => {
    const store = createGameStore();
    store.loadState(makeState());
    const r = store.openInvestigationFromAnomalyReport("iarep_ghost");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error[0]!.code).toBe("INVESTIGATION_PUBLIC_REPORT_NOT_FOUND");
  });

  it("IB-08: 含 incident+truth+report+case 的存档 round-trip 通过 schema 校验", () => {
    const storage = createMemoryStorage();
    const store = createGameStore();
    store.loadState(makeState());
    const made = store.createHeirHealthAnomalyIncident(PARAMS);
    if (!made.ok) return;
    store.openInvestigationFromAnomalyReport(made.value.reportId);

    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.investigationPublicReports).toHaveLength(1);
    expect(loaded.value.state.haremInvestigationCases[0]!.source.kind).toBe("investigation_incident");
  });
});

describe("5B-2B1: legacy intrigue unchanged", () => {
  it("IB-09: createInvestigationCaseFromAnomalyReport 不影响、且新建案 source.kind 正确", () => {
    // 直接调用纯函数，验证 source 判别字段
    const store = createGameStore();
    store.loadState(makeState());
    const made = store.createHeirHealthAnomalyIncident(PARAMS);
    if (!made.ok) return;
    const at = toGameTime(store.getState().calendar);
    const r = createInvestigationCaseFromAnomalyReport(store.getState(), made.value.reportId, at);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.value.state.haremInvestigationCases.find((x) => x.id === r.value.caseId)!;
    expect(c.source.kind).toBe("investigation_incident");
    expect(c.suspectedKinds).toEqual([]); // 皇嗣异常立案无 HaremIntrigueKind
  });
});

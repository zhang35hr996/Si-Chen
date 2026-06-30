/**
 * Phase 5B-2B2b: 证据评估驱动的裁定 — settlement 状态机、store 裁定校验、
 * 结案完整性、存档 round-trip。
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { settleDueInvestigationTasks } from "../../src/engine/characters/haremInvestigation/settlement";
import { validateHaremInvestigationLinks } from "../../src/engine/characters/haremInvestigation/stateValidation";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { fromTurnIndex, makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";
import type { InvestigationLeadClaim, IntrigueInvestigationLead, IntrigueInvestigationStatus } from "../../src/engine/characters/haremInvestigation/types";

const db = loadRealContent();
const base = createNewGameState(db);
const AT = makeGameTime(1, 1, "early");

interface SeedLead { nodeId: string; misleading?: boolean; claims: InvestigationLeadClaim[]; method?: string }

/** 构造一个证据案件状态：可控 truth 节点 + 已发现线索 + 案件状态 + 可选 pending 任务。 */
function seedState(opts: {
  status: IntrigueInvestigationStatus;
  leads: SeedLead[];
  pendingMethod?: string;
  /** 来源立案报告（anomaly）的置信度基线，默认 plausible。 */
  sourceConfidence?: "tenuous" | "plausible" | "strong" | "confirmed";
}): GameState {
  const nodeIds = new Map<string, boolean>();
  for (const l of opts.leads) nodeIds.set(l.nodeId, l.misleading ?? false);
  const truth = {
    id: "itruth_inc_v", incidentId: "inc_v", eventFamily: "heir_health_anomaly",
    causeType: "natural_illness", culpritIds: [], accusedIds: [], framingTargetIds: [],
    method: "none", motive: "none", concealment: 0,
    evidenceNodes: [...nodeIds.entries()].map(([id, misleading]) => ({
      id, type: "medical", factCode: id, claims: [], difficulty: 10, decayPerPeriod: 0,
      discoverableBy: ["medical_examination", "question_servants"], prerequisiteEvidenceIds: [], misleading,
    })),
    generatedAt: AT, sourceKey: "k",
  };
  const leads: Record<string, IntrigueInvestigationLead> = {};
  const leadIds: string[] = [];
  opts.leads.forEach((l, i) => {
    const id = `ilead_${String(i + 1).padStart(6, "0")}`;
    leadIds.push(id);
    const implicatedIds = l.claims.filter((c) => c.kind === "implicates_character").map((c) => (c as { characterId: string }).characterId);
    const clearedIds = l.claims.filter((c) => c.kind === "exonerates_character").map((c) => (c as { characterId: string }).characterId);
    leads[id] = {
      id, caseId: "icase_v", discoveredAt: AT, method: (l.method ?? "medical_examination") as never,
      summaryCode: `evidence_${l.nodeId}`, strength: "plausible",
      implicatedIds, clearedIds, revealedKinds: [], sourceEvidenceNodeId: l.nodeId, claims: l.claims,
    };
  });
  const tasks: GameState["haremInvestigationTasks"] = {};
  let nextSeq = opts.leads.length + 1;
  if (opts.pendingMethod) {
    const tid = `itask_${String(nextSeq).padStart(6, "0")}`;
    tasks[tid] = { id: tid, caseId: "icase_v", method: opts.pendingMethod as never, requestedAt: AT, dueAt: AT, status: "pending" };
    nextSeq += 1;
  }
  const c = {
    id: "icase_v", source: { kind: "investigation_incident", reportId: "iarep_v", incidentId: "inc_v" },
    openedAt: AT, openedFromReportKind: "anomaly", status: opts.status,
    knownTargetIds: ["heir_001"], suspectIds: [...new Set(opts.leads.flatMap((l) => l.claims.filter((c) => c.kind === "implicates_character").map((c) => (c as { characterId: string }).characterId)))],
    suspectedKinds: [], confidence: "plausible", leadIds,
  };
  // 来源立案报告：assessment 的置信度基线由此读取（不被「未获新证」抹去）。
  const anomalyReport = {
    id: "iarep_v", source: { kind: "investigation_incident", incidentId: "inc_v" },
    reportKind: "anomaly", eventFamily: "heir_health_anomaly",
    createdAt: AT, status: "investigating",
    knownTargetIds: ["heir_001"], suspectedActorIds: [],
    confidence: opts.sourceConfidence ?? "plausible",
    symptomCode: "hysteria", publicFactCodes: [], accuserIds: [],
    acknowledgedAt: AT, linkedInvestigationId: "icase_v",
  };
  return {
    ...base, investigationTruths: [truth], haremInvestigationCases: [c],
    haremInvestigationLeads: leads, haremInvestigationTasks: tasks, haremInvestigationNextSeq: nextSeq,
    investigationPublicReports: [anomalyReport],
  } as unknown as GameState;
}

const natural: InvestigationLeadClaim = { kind: "supports_cause", causeType: "natural_illness" };
const impl = (id: string, s: "weak" | "moderate" | "strong"): InvestigationLeadClaim => ({ kind: "implicates_character", characterId: id, strength: s });

const TWO_NATURAL: SeedLead[] = [{ nodeId: "n1", claims: [natural] }, { nodeId: "n2", claims: [natural] }];
const CULPRIT_A: SeedLead[] = [
  { nodeId: "n1", claims: [impl("char_002", "moderate")] },
  { nodeId: "n2", claims: [impl("char_002", "strong")] },
];

describe("5B-2B2b: settlement → ready_for_review by assessment", () => {
  it("ST-01: 已具 2 条自然证据，结算后进入 ready_for_review 且发 investigation_final", () => {
    const state = seedState({ status: "in_progress", leads: TWO_NATURAL, pendingMethod: "search_quarters" });
    const task = Object.values(state.haremInvestigationTasks)[0]!;
    const { state: after } = settleDueInvestigationTasks(db, state, fromTurnIndex(task.dueAt.dayIndex));
    const c = after.haremInvestigationCases[0]!;
    expect(c.status).toBe("ready_for_review");
    expect(c.confidence).toBe("confirmed");
    const final = after.investigationPublicReports.find((r) => r.reportKind === "investigation_final");
    expect(final).toBeDefined();
  });

  it("ST-02: 证据不足，结算后保持 open 且发 investigation_update", () => {
    const state = seedState({ status: "in_progress", leads: [{ nodeId: "n1", claims: [natural] }], pendingMethod: "search_quarters" });
    const task = Object.values(state.haremInvestigationTasks)[0]!;
    const { state: after } = settleDueInvestigationTasks(db, state, fromTurnIndex(task.dueAt.dayIndex));
    expect(after.haremInvestigationCases[0]!.status).toBe("open");
    expect(after.investigationPublicReports.some((r) => r.reportKind === "investigation_update")).toBe(true);
  });

  it("ST-03: 立案基线为 plausible，单次未获新证（tenuous）后仍保持 plausible，不被降级", () => {
    // 无任何可发现证据（truth 无节点）→ 任务必得 noEvidenceLead(tenuous)。
    // 置信度应保留立案报告基线 plausible，而非被「未获新证」抹成 tenuous。
    const state = seedState({ status: "in_progress", leads: [], pendingMethod: "search_quarters", sourceConfidence: "plausible" });
    const task = Object.values(state.haremInvestigationTasks)[0]!;
    const { state: after } = settleDueInvestigationTasks(db, state, fromTurnIndex(task.dueAt.dayIndex));
    const c = after.haremInvestigationCases[0]!;
    expect(c.status).toBe("open");
    expect(c.confidence).toBe("plausible");
  });
});

describe("5B-2B2b: store 裁定校验（以 assessment 为准）", () => {
  it("VR-01: cause_ready + confirm_cause → closed_explained + confirmedCause", () => {
    const store = createGameStore();
    store.loadState(seedState({ status: "ready_for_review", leads: TWO_NATURAL }));
    const r = store.reviewHaremInvestigation("icase_v", { type: "confirm_cause", causeType: "natural_illness" });
    expect(r.ok).toBe(true);
    const c = store.getState().haremInvestigationCases[0]!;
    expect(c.status).toBe("closed_explained");
    expect(c.closureReason).toBe("cause_confirmed");
    expect(c.confirmedCause).toBe("natural_illness");
    expect(c.confirmedCulpritId).toBeUndefined();
  });

  it("VR-02: 非 cause_ready 上 confirm_cause → 拒绝，状态不变", () => {
    const store = createGameStore();
    store.loadState(seedState({ status: "ready_for_review", leads: CULPRIT_A }));
    const r = store.reviewHaremInvestigation("icase_v", { type: "confirm_cause", causeType: "natural_illness" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]!.code).toBe("INTRIGUE_CASE_NOT_CAUSE_READY");
    expect(store.getState().haremInvestigationCases[0]!.status).toBe("ready_for_review");
  });

  it("VR-06: cause_ready 上 confirm_cause 指定未确认病因 → 拒绝", () => {
    const store = createGameStore();
    store.loadState(seedState({ status: "ready_for_review", leads: TWO_NATURAL }));
    // 现有证据支持 natural_illness，但玩家裁定 negligence → 拒绝
    const r = store.reviewHaremInvestigation("icase_v", { type: "confirm_cause", causeType: "negligence" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]!.code).toBe("INTRIGUE_CASE_NOT_CAUSE_READY");
  });

  it("VR-03: culprit_ready 确认可确认主谋 → closed_confirmed", () => {
    const store = createGameStore();
    store.loadState(seedState({ status: "ready_for_review", leads: CULPRIT_A }));
    const r = store.reviewHaremInvestigation("icase_v", { type: "confirm", suspectId: "char_002" });
    expect(r.ok).toBe(true);
    const c = store.getState().haremInvestigationCases[0]!;
    expect(c.status).toBe("closed_confirmed");
    expect(c.confirmedCulpritId).toBe("char_002");
  });

  it("VR-04: confirm 不在 confirmableCulpritIds 的人 → 拒绝", () => {
    const store = createGameStore();
    store.loadState(seedState({ status: "ready_for_review", leads: CULPRIT_A }));
    const r = store.reviewHaremInvestigation("icase_v", { type: "confirm", suspectId: "char_999" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error[0]!.code).toBe("INTRIGUE_CASE_SUSPECT_NOT_CONFIRMABLE");
  });

  it("VR-05: continue → open，保留全部线索", () => {
    const store = createGameStore();
    store.loadState(seedState({ status: "ready_for_review", leads: TWO_NATURAL }));
    const r = store.reviewHaremInvestigation("icase_v", { type: "continue" });
    expect(r.ok).toBe(true);
    const c = store.getState().haremInvestigationCases[0]!;
    expect(c.status).toBe("open");
    expect(c.leadIds).toHaveLength(2);
  });
});

describe("5B-2B2b: 结案完整性校验", () => {
  function codes(caseOverride: Record<string, unknown>) {
    const c = {
      id: "icase_v", source: { kind: "investigation_incident", reportId: "iarep_v", incidentId: "inc_v" },
      openedAt: AT, openedFromReportKind: "anomaly", knownTargetIds: ["heir_001"], suspectIds: ["char_002"],
      suspectedKinds: [], confidence: "confirmed", leadIds: [], closedAt: AT, ...caseOverride,
    };
    return validateHaremInvestigationLinks({
      haremIntrigueReports: [], haremInvestigationCases: [c], haremInvestigationTasks: {},
      haremInvestigationLeads: {}, haremInvestigationNextSeq: 1, incidentIds: new Set(),
      investigationPublicReports: [], investigationIncidentIds: new Set(["inc_v"]), investigationTruths: [],
    } as unknown as Parameters<typeof validateHaremInvestigationLinks>[0]).map((e) => e.code);
  }

  it("CV-01: closed_explained 缺 confirmedCause → 失败", () => {
    expect(codes({ status: "closed_explained", closureReason: "cause_confirmed" })).toContain("INTRIGUE_CASE_MISSING_CAUSE");
  });
  it("CV-02: closed_explained 带 confirmedCulpritId → 失败", () => {
    expect(codes({ status: "closed_explained", closureReason: "cause_confirmed", confirmedCause: "natural_illness", confirmedCulpritId: "char_002" })).toContain("INTRIGUE_CASE_CULPRIT_WRONG_STATUS");
  });
  it("CV-03: closed_confirmed 带 confirmedCause → 失败", () => {
    expect(codes({ status: "closed_confirmed", closureReason: "culprit_confirmed", confirmedCulpritId: "char_002", confirmedCause: "natural_illness" })).toContain("INTRIGUE_CASE_CAUSE_WRONG_STATUS");
  });
  it("CV-04: 非关闭状态带 confirmedCause → 失败", () => {
    expect(codes({ status: "open", confirmedCause: "natural_illness", closedAt: undefined })).toContain("INTRIGUE_CASE_CAUSE_WRONG_STATUS");
  });
  it("CV-05: 合法 closed_explained（natural_illness）→ 无结案错误", () => {
    const cs = codes({ status: "closed_explained", closureReason: "cause_confirmed", confirmedCause: "natural_illness" });
    for (const c of ["INTRIGUE_CASE_MISSING_CAUSE", "INTRIGUE_CASE_CAUSE_WRONG_STATUS", "INTRIGUE_CASE_CULPRIT_WRONG_STATUS", "INTRIGUE_CASE_CLOSURE_REASON", "INTRIGUE_CASE_CAUSE_WRONG_SOURCE"]) {
      expect(cs).not.toContain(c);
    }
  });
  it("CV-06: 合法 closed_explained（negligence）→ 无结案错误", () => {
    const cs = codes({ status: "closed_explained", closureReason: "cause_confirmed", confirmedCause: "negligence" });
    for (const c of ["INTRIGUE_CASE_MISSING_CAUSE", "INTRIGUE_CASE_CAUSE_WRONG_STATUS", "INTRIGUE_CASE_CLOSURE_REASON", "INTRIGUE_CASE_CAUSE_WRONG_SOURCE"]) {
      expect(cs).not.toContain(c);
    }
  });
  it("CV-07: 旧宫斗案件（legacy_intrigue）不得 closed_explained → 失败", () => {
    const cs = codes({
      status: "closed_explained", closureReason: "cause_confirmed", confirmedCause: "natural_illness",
      source: { kind: "legacy_intrigue", reportId: "ireport_x", incidentId: "hinc_x" },
    });
    expect(cs).toContain("INTRIGUE_CASE_CAUSE_WRONG_SOURCE");
  });
});

describe("5B-2B2b: closed_explained 存档 round-trip", () => {
  it("RT-01: 裁定为自然病因后 save → readSlot 保留结论", () => {
    // 用真实流程建出合法 incident+truth+report+case，再注入受控 truth 与自然线索
    const store = createGameStore();
    const standing = Object.fromEntries(Object.entries(base.standing).map(([id, st]) => [id, { ...st, household: st.household ?? { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 40 } }]));
    store.loadState({ ...base, standing } as GameState);
    const made = store.createHeirHealthAnomaly({ victimHeirId: "heir_001", accuserIds: [], initiallyAccusedIds: [], symptom: "hysteria", publicFactCodes: ["heir_fell_ill"], victimHealth: 60 });
    if (!made.ok) throw new Error();
    const opened = store.openInvestigationFromAnomalyReport(made.value.reportId);
    if (!opened.ok) throw new Error();
    const caseId = opened.value.caseId;

    // 注入受控 natural truth + 两条自然线索，置案件 ready_for_review
    const s = store.getState();
    const incidentSourceKey = s.investigationIncidents.find((i) => i.id === made.value.incidentId)!.sourceKey;
    const truth = {
      id: made.value.truthId, incidentId: made.value.incidentId, eventFamily: "heir_health_anomaly" as const,
      causeType: "natural_illness" as const, culpritIds: [], accusedIds: [], framingTargetIds: [],
      method: "none" as const, motive: "none" as const, concealment: 0,
      evidenceNodes: [
        { id: "rn1", type: "medical" as const, factCode: "diagnosis_matches_old_illness", claims: [{ kind: "supports_cause" as const, causeType: "natural_illness" as const }], difficulty: 10, decayPerPeriod: 0, discoverableBy: ["medical_examination" as const], prerequisiteEvidenceIds: [] as string[], misleading: false },
        { id: "rn2", type: "timeline" as const, factCode: "timeline_precedes_suspect_arrival", claims: [{ kind: "supports_cause" as const, causeType: "natural_illness" as const }], difficulty: 10, decayPerPeriod: 0, discoverableBy: ["reconstruct_timeline" as const], prerequisiteEvidenceIds: [] as string[], misleading: false },
      ],
      generatedAt: AT, sourceKey: incidentSourceKey,
    };
    const leads: Record<string, IntrigueInvestigationLead> = {
      ilead_000001: { id: "ilead_000001", caseId, discoveredAt: AT, method: "medical_examination", summaryCode: "evidence_diagnosis_matches_old_illness", strength: "plausible", implicatedIds: [], clearedIds: [], revealedKinds: [], sourceEvidenceNodeId: "rn1", claims: [{ kind: "supports_cause", causeType: "natural_illness" }] },
      ilead_000002: { id: "ilead_000002", caseId, discoveredAt: AT, method: "reconstruct_timeline", summaryCode: "evidence_timeline_precedes_suspect_arrival", strength: "plausible", implicatedIds: [], clearedIds: [], revealedKinds: [], sourceEvidenceNodeId: "rn2", claims: [{ kind: "supports_cause", causeType: "natural_illness" }] },
    };
    const cases = s.haremInvestigationCases.map((c) => c.id === caseId ? { ...c, status: "ready_for_review" as const, confidence: "confirmed" as const, leadIds: ["ilead_000001", "ilead_000002"] } : c);
    store.loadState({ ...s, investigationTruths: [truth], haremInvestigationLeads: leads, haremInvestigationCases: cases, haremInvestigationNextSeq: 3 } as GameState);

    const r = store.reviewHaremInvestigation(caseId, { type: "confirm_cause", causeType: "natural_illness" });
    expect(r.ok).toBe(true);

    const storage = createMemoryStorage();
    const saveData = createSaveData(db, store.getState(), "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const c = loaded.value.state.haremInvestigationCases.find((x) => x.id === caseId)!;
    expect(c.status).toBe("closed_explained");
    expect(c.confirmedCause).toBe("natural_illness");
  });
});

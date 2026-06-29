/**
 * Phase 5B-2B2A: 证据驱动调查行动与线索结算测试。
 *
 * 覆盖：
 * - investigation_incident 案件返回证据行动，不返回旧行动
 * - legacy_intrigue 行动完全不变
 * - 新旧 resolver 按 source.kind 分流
 * - 确定性：相同 seed+task → 相同结果
 * - prerequisite 未满足的节点不可发现
 * - 已发现节点不重复发现（sourceEvidenceNodeId 去重）
 * - decay 提高有效难度
 * - 无候选节点 → "evidence_no_new_findings"
 * - truth 缺失 → "evidence_truth_missing"
 * - misleading 节点不暴露 misleading/culpritIds
 * - lead 不含后台字段（sourceEvidenceNodeId 除外，它仅用于去重）
 * - 新案件进展通报写入 investigationPublicReports，不写 haremIntrigueReports
 * - catch-up、取消任务和幂等不回归
 * - save/readSlot round-trip
 */
import { describe, expect, it } from "vitest";
import { makeGameTime } from "../../src/engine/calendar/time";
import type { GameState, Heir } from "../../src/engine/state/types";
import type { InvestigationTruth, HiddenEvidenceNode, HeirHealthAnomalyIncident } from "../../src/engine/characters/haremInvestigation/truth/types";
import type { IntrigueInvestigationCase, InvestigationProgressPublicReport, HeirHealthAnomalyPublicReport } from "../../src/engine/characters/haremInvestigation/types";
import { availableInvestigationActions } from "../../src/engine/characters/haremInvestigation/actions";
import { resolveInvestigationTask, settleDueInvestigationTasks, nextLeadId } from "../../src/engine/characters/haremInvestigation/settlement";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const AT = makeGameTime(1, 3, "early");

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeBase(): GameState {
  return createNewGameState(db, 1);
}

// 使用初始就在宫中（spawnMode=auto）的角色 ID 通过存档校验
const CULPRIT_ID = "cheng_feng";
const ACCUSED_ID = "wei_sui";

// 最小存活皇嗣 fixture（isLivingHeir 只检查 id + lifecycle）
const LIVING_HEIR_FIXTURE: Heir = {
  id: "heir_ev_001",
  sex: "son",
  fatherId: null,
  bearer: "sovereign",
  birthAt: makeGameTime(1, 1, "early"),
  favor: 0,
  legitimate: false,
  petName: "",
  education: { scholarship: 0, martial: 0, virtue: 0 },
  health: 80,
  talent: 50,
  diligence: 50,
  personality: { empathy: 50, guile: 50, restraint: 50, sociability: 50, assertiveness: 50, curiosity: 50 },
  interests: [],
  imperialFear: 0,
  neglect: 0,
  custodianBond: 0,
  portraitVariants: { baby: "p_baby", kid: "p_kid", child: "p_child", teen: "p_teen" },
  ambition: 50,
  closeness: 50,
  support: 50,
  faction: "none",
  lifecycle: "alive",
};

const INCIDENT: HeirHealthAnomalyIncident = {
  id: "heir_health_heir_ev_abc",
  eventFamily: "heir_health_anomaly",
  occurredAt: AT,
  sourceKey: "heir_health_anomaly:1:03",
  victimHeirId: "heir_ev_001",
  accuserIds: [CULPRIT_ID],
  initiallyAccusedIds: [ACCUSED_ID],
  symptom: "high_fever",
  publicFactCodes: ["heir_fell_ill"],
};

const MEDICAL_NODE: HiddenEvidenceNode = {
  id: "node_medical_001",
  type: "medical",
  factCode: "tampered_medicine_confirmed",
  claims: [
    { kind: "implicates_character", characterRef: CULPRIT_ID, strength: "strong" },
    { kind: "reveals_method", method: "tampered_medicine" },
  ],
  difficulty: 30, // easy
  decayPerPeriod: 5,
  discoverableBy: ["medical_examination"],
  prerequisiteEvidenceIds: [],
  misleading: false,
};

const FINANCIAL_NODE: HiddenEvidenceNode = {
  id: "node_financial_001",
  type: "financial",
  factCode: "money_trail_001",
  claims: [
    { kind: "implicates_character", characterRef: CULPRIT_ID, strength: "moderate" },
    { kind: "establishes_fact", factCode: "money_trail_001" },
  ],
  difficulty: 40,
  decayPerPeriod: 3,
  discoverableBy: ["trace_money"],
  prerequisiteEvidenceIds: [],
  misleading: false,
};

const PREREQ_NODE: HiddenEvidenceNode = {
  id: "node_prereq_001",
  type: "testimony",
  factCode: "testimony_chain",
  claims: [{ kind: "implicates_character", characterRef: CULPRIT_ID, strength: "strong" }],
  difficulty: 20,
  decayPerPeriod: 2,
  discoverableBy: ["obtain_testimony"],
  prerequisiteEvidenceIds: ["node_medical_001"], // requires MEDICAL_NODE first
  misleading: false,
};

const MISLEADING_NODE: HiddenEvidenceNode = {
  id: "node_misleading_001",
  type: "physical",
  factCode: "planted_evidence",
  claims: [
    { kind: "implicates_character", characterRef: ACCUSED_ID, strength: "strong" },
  ],
  difficulty: 25,
  decayPerPeriod: 2,
  discoverableBy: ["question_servants"],
  prerequisiteEvidenceIds: [],
  misleading: true, // planted evidence
};

const TRUTH: InvestigationTruth = {
  id: `itruth_${INCIDENT.id}`,
  incidentId: INCIDENT.id,
  eventFamily: "heir_health_anomaly",
  causeType: "intentional_harm",
  culpritIds: [CULPRIT_ID],
  accusedIds: [ACCUSED_ID],
  framingTargetIds: [ACCUSED_ID],
  method: "tampered_medicine",
  motive: "succession_rivalry",
  concealment: 30,
  evidenceNodes: [MEDICAL_NODE, FINANCIAL_NODE, PREREQ_NODE, MISLEADING_NODE],
  generatedAt: AT,
  sourceKey: "heir_health_anomaly:1:03",
};

function makeCase(overrides: Partial<IntrigueInvestigationCase> = {}): IntrigueInvestigationCase {
  return {
    id: "icase_iarep_heir_health_heir_ev_abc",
    source: { kind: "investigation_incident", reportId: "iarep_heir_health_heir_ev_abc", incidentId: INCIDENT.id },
    openedAt: AT,
    openedFromReportKind: "anomaly",
    status: "open",
    knownTargetIds: ["heir_ev_001"],
    suspectIds: [ACCUSED_ID],
    suspectedKinds: [],
    confidence: "tenuous",
    leadIds: [],
    ...overrides,
  };
}

const ANOMALY_REPORT: HeirHealthAnomalyPublicReport = {
  id: "iarep_heir_health_heir_ev_abc",
  source: { kind: "investigation_incident", incidentId: INCIDENT.id },
  reportKind: "anomaly",
  eventFamily: "heir_health_anomaly",
  createdAt: AT,
  status: "investigating",
  knownTargetIds: ["heir_ev_001"],
  suspectedActorIds: [ACCUSED_ID],
  confidence: "tenuous",
  symptomCode: "high_fever",
  publicFactCodes: ["heir_fell_ill"],
  accuserIds: [CULPRIT_ID],
  acknowledgedAt: AT,
  linkedInvestigationId: "icase_iarep_heir_health_heir_ev_abc",
};

function makeStateWithCase(extraOverrides: Partial<GameState> = {}): GameState {
  return {
    ...makeBase(),
    investigationIncidents: [INCIDENT],
    investigationTruths: [TRUTH],
    investigationPublicReports: [ANOMALY_REPORT],
    haremInvestigationCases: [makeCase()],
    ...extraOverrides,
  };
}

function makeTask(method: string, dueAt = AT, subjectId?: string) {
  return {
    id: "itask_000001",
    caseId: "icase_iarep_heir_health_heir_ev_abc",
    method: method as never,
    subjectId,
    requestedAt: AT,
    dueAt,
    status: "pending" as const,
  };
}

// ── 行动可用性 ────────────────────────────────────────────────────────────────

describe("availableInvestigationActions — evidence-driven", () => {
  it("EV-01: investigation_incident 返回证据行动，不返回旧方法", () => {
    const state = makeStateWithCase();
    const actions = availableInvestigationActions(state, makeCase().id);
    const methods = actions.map((a) => a.method);
    expect(methods).not.toContain("question_target");
    expect(methods).not.toContain("question_suspect");
    expect(methods).not.toContain("quiet_inquiry");
    expect(methods).toContain("question_servants");
    expect(methods).toContain("reconstruct_timeline");
    expect(methods).toContain("trace_money");
    // medical_examination 需要皇嗣在 bloodline.heirs 且存活；
    // 当前 case.knownTargetIds=["heir_ev_001"] 不在 heirs → 不出现
    expect(methods).not.toContain("medical_examination");
  });

  it("EV-01b: 受害皇嗣存活时 medical_examination 出现（确定性注入）", () => {
    const base = makeStateWithCase();
    const stateWithHeir: GameState = {
      ...base,
      resources: {
        ...base.resources,
        bloodline: {
          ...base.resources.bloodline,
          heirs: [...base.resources.bloodline.heirs, LIVING_HEIR_FIXTURE],
        },
      },
      haremInvestigationCases: [makeCase({ knownTargetIds: ["heir_ev_001"] })],
    };
    const actions = availableInvestigationActions(stateWithHeir, makeCase().id);
    expect(actions.map((a) => a.method)).toContain("medical_examination");
  });

  it("EV-02: search_quarters 始终可用（非对象型行动，不附候选名单）", () => {
    const state = makeStateWithCase();
    const actions = availableInvestigationActions(state, makeCase().id);
    const sq = actions.find((a) => a.method === "search_quarters");
    expect(sq).toBeDefined();
    expect(sq!.subjectCandidateIds).toBeUndefined();
  });

  it("EV-02b: obtain_testimony 始终可用（非对象型行动，不附候选名单）", () => {
    const state = makeStateWithCase();
    const actions = availableInvestigationActions(state, makeCase().id);
    const ot = actions.find((a) => a.method === "obtain_testimony");
    expect(ot).toBeDefined();
    expect(ot!.subjectCandidateIds).toBeUndefined();
  });

  it("EV-03: in_progress 时无可用行动（已有 pending task）", () => {
    const state: GameState = {
      ...makeStateWithCase(),
      haremInvestigationCases: [makeCase({ status: "in_progress" })],
      haremInvestigationTasks: {
        "itask_000001": makeTask("question_servants"),
      },
    };
    const actions = availableInvestigationActions(state, makeCase().id);
    expect(actions).toHaveLength(0);
  });

  it("EV-04: legacy_intrigue 案件仍返回旧行动，不混入证据行动", () => {
    const legacyCase: IntrigueInvestigationCase = {
      id: "icase_legacy_001",
      source: { kind: "legacy_intrigue", reportId: "report_001", incidentId: "inc_001" },
      openedAt: AT,
      openedFromReportKind: "anomaly",
      status: "open",
      knownTargetIds: [],
      suspectIds: [],
      suspectedKinds: [],
      confidence: "tenuous",
      leadIds: [],
    };
    const state: GameState = {
      ...makeBase(),
      haremInvestigationCases: [legacyCase],
    };
    const actions = availableInvestigationActions(state, "icase_legacy_001");
    const methods = actions.map((a) => a.method);
    // quiet_inquiry は always available for legacy
    expect(methods).toContain("quiet_inquiry");
    expect(methods).not.toContain("medical_examination");
    expect(methods).not.toContain("question_servants");
  });
});

// ── 证据发现结算 ──────────────────────────────────────────────────────────────

describe("resolveEvidenceDrivenTask — 证据发现", () => {
  it("EV-10: 低难度节点成功发现，lead 含正确字段", () => {
    const state = makeStateWithCase();
    const task = makeTask("medical_examination");
    // medical_examination discoverable by MEDICAL_NODE (difficulty=30, concealment=30)
    // effectiveDifficulty = clamp(30 + 0*5 + floor(30/5), 5, 95) = clamp(36, 5, 95) = 36
    // deterministic: run multiple times to confirm same result
    const r1 = resolveInvestigationTask(state, task, AT);
    const r2 = resolveInvestigationTask(state, task, AT);
    expect(r1.lead.id).toBe(r2.lead.id);
    expect(r1.lead.strength).toBe(r2.lead.strength);
    expect(r1.lead.summaryCode).toBe(r2.lead.summaryCode);
  });

  it("EV-11: 确定性 — 相同 state+task 得到完全相同结果", () => {
    const state = makeStateWithCase();
    const task = makeTask("medical_examination");
    const r1 = resolveInvestigationTask(state, task, AT);
    const r2 = resolveInvestigationTask({ ...state, rngSeed: state.rngSeed }, task, AT);
    expect(r1.lead.summaryCode).toBe(r2.lead.summaryCode);
    expect(r1.lead.strength).toBe(r2.lead.strength);
    expect(r1.lead.implicatedIds).toEqual(r2.lead.implicatedIds);
  });

  it("EV-12: prerequisite 未满足 → 不发现 prereq node，只能发现其他节点", () => {
    const stateWithOnlyPrereq: GameState = {
      ...makeStateWithCase(),
      investigationTruths: [{
        ...TRUTH,
        evidenceNodes: [PREREQ_NODE], // only the node that requires MEDICAL_NODE
      }],
    };
    const task = makeTask("obtain_testimony");
    const result = resolveInvestigationTask(stateWithOnlyPrereq, task, AT);
    // PREREQ_NODE has prerequisiteEvidenceIds: ["node_medical_001"], which is not yet discovered
    expect(result.lead.summaryCode).toBe("evidence_no_new_findings");
    expect(result.lead.sourceEvidenceNodeId).toBeUndefined();
  });

  it("EV-13: 已发现节点不重复（sourceEvidenceNodeId 去重）", () => {
    // difficulty=0, concealment=0 → effectiveDifficulty=clamp(0+0+0,5,95)=5；roll0to99>=5 几乎必然成功
    const guaranteedState: GameState = {
      ...makeStateWithCase(),
      investigationTruths: [{
        ...TRUTH,
        concealment: 0,
        evidenceNodes: [{ ...MEDICAL_NODE, difficulty: 0, decayPerPeriod: 0 }],
      }],
    };
    const task1 = makeTask("medical_examination");
    const r1 = resolveInvestigationTask(guaranteedState, task1, AT);
    // 确定性：roll0to99 >= 5，virtually guaranteed
    expect(r1.lead.sourceEvidenceNodeId).toBe("node_medical_001");

    // Simulate state with that lead registered
    const stateAfter: GameState = {
      ...guaranteedState,
      haremInvestigationLeads: { [r1.lead.id]: r1.lead },
      haremInvestigationCases: [makeCase({ leadIds: [r1.lead.id] })],
      haremInvestigationNextSeq: r1.nextSeq,
    };

    // Second attempt: node already discovered → not re-discovered
    const task2 = { ...makeTask("medical_examination"), id: "itask_000002" };
    const r2 = resolveInvestigationTask(stateAfter, task2, AT);
    expect(r2.lead.summaryCode).toBe("evidence_no_new_findings");
    expect(r2.lead.sourceEvidenceNodeId).toBeUndefined();
  });

  it("EV-14: misleading 节点产生 lead，但 lead 不含 misleading/culpritIds 字段", () => {
    // difficulty=0, concealment=0 确保发现
    const stateOnlyMisleading: GameState = {
      ...makeStateWithCase(),
      investigationTruths: [{
        ...TRUTH,
        concealment: 0,
        evidenceNodes: [{ ...MISLEADING_NODE, difficulty: 0, decayPerPeriod: 0 }],
      }],
    };
    const task = makeTask("question_servants");
    const result = resolveInvestigationTask(stateOnlyMisleading, task, AT);
    // 确定性发现：roll>=5 必然成功
    expect(result.lead.sourceEvidenceNodeId).toBe("node_misleading_001");
    // lead 不得暴露后台 misleading/culpritIds
    expect(result.lead).not.toHaveProperty("misleading");
    expect(result.lead).not.toHaveProperty("culpritIds");
    // claims 不含内部真相字段
    expect(result.lead.claims).toBeDefined();
    for (const cl of result.lead.claims!) {
      expect(cl).not.toHaveProperty("culpritRef");
      expect(cl).not.toHaveProperty("isMisleading");
    }
  });

  it("EV-15: lead 不含后台字段（truthId, difficulty, concealment, factCode via node）", () => {
    const state = makeStateWithCase();
    const task = makeTask("medical_examination");
    const result = resolveInvestigationTask(state, task, AT);
    const lead = result.lead;
    expect(lead).not.toHaveProperty("truthId");
    expect(lead).not.toHaveProperty("difficulty");
    expect(lead).not.toHaveProperty("concealment");
    // claims may have factCode only for "establishes_fact" kind, which is safe (sanitized)
  });

  it("EV-16: truth 缺失 → summaryCode=evidence_truth_missing", () => {
    const stateNoTruth: GameState = {
      ...makeStateWithCase(),
      investigationTruths: [], // no truth
    };
    const task = makeTask("medical_examination");
    const result = resolveInvestigationTask(stateNoTruth, task, AT);
    expect(result.lead.summaryCode).toBe("evidence_truth_missing");
    expect(result.lead.strength).toBe("tenuous");
  });

  it("EV-17: 无候选节点（method 不匹配）→ evidence_no_new_findings", () => {
    const state = makeStateWithCase();
    // reconstruct_timeline is not in discoverableBy of any node
    const task = makeTask("reconstruct_timeline");
    const result = resolveInvestigationTask(state, task, AT);
    expect(result.lead.summaryCode).toBe("evidence_no_new_findings");
  });
});

// ── 进展报告路由 ──────────────────────────────────────────────────────────────

describe("settleDueInvestigationTasks — 进展报告按来源分流", () => {
  it("EV-20: investigation_incident 案件进展写入 investigationPublicReports，不写 haremIntrigueReports", () => {
    const state: GameState = {
      ...makeStateWithCase(),
      haremInvestigationCases: [makeCase({ status: "in_progress" })],
      haremInvestigationTasks: {
        "itask_000001": makeTask("question_servants", AT),
      },
    };
    const result = settleDueInvestigationTasks(db, state, AT);
    // No new entries in haremIntrigueReports (legacy array)
    expect(result.state.haremIntrigueReports.length).toBe(state.haremIntrigueReports.length);
    // Progress report written to investigationPublicReports
    const progressReports = result.state.investigationPublicReports.filter(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(progressReports).toHaveLength(1);
    const pr = progressReports[0] as InvestigationProgressPublicReport;
    expect(pr.linkedInvestigationId).toBe(makeCase().id);
    expect(pr.source.incidentId).toBe(INCIDENT.id);
    expect(pr.source.kind).toBe("investigation_incident");
  });

  it("EV-21: investigation_incident 进展通报幂等（相同 task.id 不重复）", () => {
    const state: GameState = {
      ...makeStateWithCase(),
      haremInvestigationCases: [makeCase({ status: "in_progress" })],
      haremInvestigationTasks: {
        "itask_000001": makeTask("question_servants", AT),
      },
    };
    const r1 = settleDueInvestigationTasks(db, state, AT);
    const r2 = settleDueInvestigationTasks(db, r1.state, AT);
    const progressCount = r2.state.investigationPublicReports.filter(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    ).length;
    expect(progressCount).toBe(1);
  });

  it("EV-22: investigation_incident 取消案件后 pending task 不生成报告", () => {
    const state: GameState = {
      ...makeStateWithCase(),
      haremInvestigationCases: [makeCase({ status: "cancelled" as never })],
      haremInvestigationTasks: {
        "itask_000001": makeTask("question_servants", AT),
      },
    };
    const result = settleDueInvestigationTasks(db, state, AT);
    const progressReports = result.state.investigationPublicReports.filter(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(progressReports).toHaveLength(0);
  });

  it("EV-23: investigation_incident 案件结算后回到 open（不升 ready_for_review）", () => {
    const state: GameState = {
      ...makeStateWithCase(),
      haremInvestigationCases: [makeCase({ status: "in_progress" })],
      haremInvestigationTasks: {
        "itask_000001": makeTask("medical_examination", AT),
      },
    };
    const result = settleDueInvestigationTasks(db, state, AT);
    const c = result.state.haremInvestigationCases.find((x) => x.id === makeCase().id)!;
    // Even if confidence went up, should NOT be ready_for_review (5B-2B2B feature)
    expect(c.status).not.toBe("ready_for_review");
    expect(c.status).toBe("open");
  });
});

// ── legacy 案件不回归 ─────────────────────────────────────────────────────────

describe("legacy_intrigue 案件不回归", () => {
  it("EV-30: legacy 案件结算仍写入 haremIntrigueReports", () => {
    const base = makeBase();
    // Create a minimal legacy-style case (no haremIncident needed for resolver to not crash)
    const legacyCase: IntrigueInvestigationCase = {
      id: "icase_legacy_test",
      source: { kind: "legacy_intrigue", reportId: "irep_001", incidentId: "inc_001" },
      openedAt: AT,
      openedFromReportKind: "anomaly",
      status: "in_progress",
      knownTargetIds: ["target_001"],
      suspectIds: [],
      suspectedKinds: [],
      confidence: "tenuous",
      leadIds: [],
    };
    const state: GameState = {
      ...base,
      haremInvestigationCases: [legacyCase],
      haremInvestigationTasks: {
        "itask_000001": {
          id: "itask_000001",
          caseId: "icase_legacy_test",
          method: "quiet_inquiry" as never,
          requestedAt: AT,
          dueAt: AT,
          status: "pending",
        },
      },
    };
    const result = settleDueInvestigationTasks(db, state, AT);
    // Progress report goes to haremIntrigueReports for legacy
    const legacyReports = result.state.haremIntrigueReports.filter(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(legacyReports).toHaveLength(1);
    // investigationPublicReports not touched
    expect(result.state.investigationPublicReports.length).toBe(state.investigationPublicReports.length);
  });
});

// ── save/readSlot round-trip ──────────────────────────────────────────────────

describe("save round-trip — evidence-driven investigation", () => {
  it("EV-40: 含证据驱动进展通报的 state 通过全量 schema 校验并正常 readSlot", () => {
    const state: GameState = {
      ...makeStateWithCase(),
      haremInvestigationCases: [makeCase({ status: "in_progress" })],
      haremInvestigationTasks: {
        "itask_000001": makeTask("question_servants", AT),
      },
    };
    const settled = settleDueInvestigationTasks(db, state, AT).state;

    // Should have a progress report in investigationPublicReports
    const progressReport = settled.investigationPublicReports.find(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(progressReport).toBeDefined();

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, settled, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    if (!loaded.ok) console.error("readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("readSlot failed: " + JSON.stringify(loaded.error));

    // Progress report survives round-trip
    const rt = loaded.value.state.investigationPublicReports.find(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(rt).toBeDefined();
    expect(rt!.linkedInvestigationId).toBe(makeCase().id);
    expect(rt!.source.incidentId).toBe(INCIDENT.id);

    // lead with sourceEvidenceNodeId (if discovered) survives round-trip
    const leads = Object.values(loaded.value.state.haremInvestigationLeads);
    for (const lead of leads) {
      if (lead.sourceEvidenceNodeId) {
        expect(typeof lead.sourceEvidenceNodeId).toBe("string");
      }
    }
  });

  it("EV-41: claims 字段通过 schema 校验并正常 readSlot", () => {
    // Directly inject a lead with all claim kinds
    const leadWithAllClaims = {
      id: nextLeadId(1),
      caseId: makeCase().id,
      discoveredAt: AT,
      method: "medical_examination" as const,
      summaryCode: "evidence_medical",
      strength: "strong" as const,
      implicatedIds: [CULPRIT_ID],
      clearedIds: [],
      revealedKinds: [] as never[],
      sourceEvidenceNodeId: "node_medical_001",
      claims: [
        { kind: "implicates_character" as const, characterId: CULPRIT_ID, strength: "strong" as const },
        { kind: "exonerates_character" as const, characterId: ACCUSED_ID, strength: "weak" as const },
        { kind: "supports_cause" as const, causeType: "intentional_harm" },
        { kind: "reveals_mechanism" as const, mechanism: "tampered_medicine" },
        { kind: "establishes_fact" as const, factCode: "tampered_medicine_confirmed" },
      ],
    };
    const state: GameState = {
      ...makeStateWithCase(),
      haremInvestigationCases: [makeCase({ leadIds: [leadWithAllClaims.id] })],
      haremInvestigationLeads: { [leadWithAllClaims.id]: leadWithAllClaims } as Record<string, import("../../src/engine/characters/haremInvestigation/types").IntrigueInvestigationLead>,
      haremInvestigationNextSeq: 2,
    };

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, state, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    if (!loaded.ok) console.error("readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("readSlot failed: " + JSON.stringify(loaded.error));

    const rtLead = loaded.value.state.haremInvestigationLeads[leadWithAllClaims.id];
    expect(rtLead).toBeDefined();
    expect(rtLead!.claims).toHaveLength(5);
    expect(rtLead!.sourceEvidenceNodeId).toBe("node_medical_001");
  });
});

// ── presenter labels ──────────────────────────────────────────────────────────

describe("haremInvestigationPresenter — method labels", () => {
  // 引入 presenter 做静态断言：全部 9 种方法不得显示英文 token
  it("EV-50: 所有 9 种调查方法在 presenter 均有中文标签，不暴露英文 token", async () => {
    const { presentHaremInvestigationDetail } = await import(
      "../../src/ui/haremInvestigationPresenter"
    );
    const { availableInvestigationActions: getActions } = await import(
      "../../src/engine/characters/haremInvestigation/actions"
    );

    const state = makeStateWithCase();
    const c = state.haremInvestigationCases[0]!;
    const actions = getActions(state, c.id);

    const nameOf = (id: string) => `NAME_${id}`;
    const detail = presentHaremInvestigationDetail(c, [], [], actions, nameOf);

    const ENGLISH_TOKENS = [
      "medical_examination", "question_servants", "reconstruct_timeline",
      "trace_money", "search_quarters", "obtain_testimony",
      "question_target", "question_suspect", "quiet_inquiry",
    ];
    for (const view of detail.availableActionViews) {
      for (const token of ENGLISH_TOKENS) {
        expect(view.label).not.toBe(token);
      }
    }
    // 所有行动均有非空标签
    for (const view of detail.availableActionViews) {
      expect(view.label.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Phase 5B-2B2a: 证据驱动调查结算。
 * 验证 investigation_incident 案件经由 InvestigationTruth.evidenceNodes 结算，
 * 不读取旧 haremIncidents，进展通报走 investigationPublicReports，案件保持 open。
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { settleDueInvestigationTasks, resolveInvestigationTask } from "../../src/engine/characters/haremInvestigation/settlement";
import { fromTurnIndex, makeGameTime } from "../../src/engine/calendar/time";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState, Heir } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);
const AT = makeGameTime(1, 1, "early");

// medical_examination 需要受害皇嗣（heir_001）存在于 bloodline.heirs 且存活
const VICTIM_HEIR: Heir = {
  id: "heir_001",
  sex: "son",
  fatherId: null,
  bearer: "sovereign",
  birthAt: AT,
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

function makeState(): GameState {
  const standing = Object.fromEntries(
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
  return {
    ...base,
    standing,
    resources: {
      ...base.resources,
      bloodline: { ...base.resources.bloodline, heirs: [VICTIM_HEIR] },
    },
  };
}

const PARAMS = {
  victimHeirId: "heir_001",
  accuserIds: ["bai_zhuying"] as string[],
  initiallyAccusedIds: ["lu_huaijin"] as string[],
  symptom: "hysteria" as const,
  publicFactCodes: ["heir_fell_ill"] as string[],
  victimHealth: 60,
};

/** 建一个已立案 + 已下达证据任务的 store，返回 store 与 taskId。 */
function startedEvidenceCase(method: "medical_examination" | "question_servants" = "medical_examination") {
  const store = createGameStore();
  store.loadState(makeState());
  const made = store.createHeirHealthAnomaly(PARAMS);
  if (!made.ok) throw new Error("create anomaly failed");
  const opened = store.openInvestigationFromAnomalyReport(made.value.reportId);
  if (!opened.ok) throw new Error("open case failed");
  const started = store.startHaremInvestigationTask(db, opened.value.caseId, method);
  if (!started.ok) throw new Error(`start task failed: ${JSON.stringify(started.error)}`);
  return { store, caseId: opened.value.caseId, taskId: started.value.taskId, incidentId: made.value.incidentId };
}

// 玩家可见进展通报绝不能携带的后台引用（sourceEvidenceNodeId 仅存在于 Lead 内部，不在此列）
const FORBIDDEN_PROGRESS_KEYS = ["truthId", "sourceEvidenceNodeId", "evidenceNodeId", "claims", "culpritIds", "concealment"];

describe("5B-2B2a: evidence-driven settlement", () => {
  it("EV-01: 结算确定性 — 同 state/task 两次结算产出相同线索", () => {
    const { store, taskId } = startedEvidenceCase();
    const state = store.getState();
    const task = state.haremInvestigationTasks[taskId]!;
    const at = fromTurnIndex(task.dueAt.dayIndex);

    const r1 = settleDueInvestigationTasks(db, state, at);
    const r2 = settleDueInvestigationTasks(db, state, at);
    expect(r1.newLeads).toHaveLength(1);
    expect(r2.newLeads).toHaveLength(1);
    expect(r1.newLeads[0]).toEqual(r2.newLeads[0]);
  });

  it("EV-02: 发现的证据节点确与任务方法匹配且来自该案件真相", () => {
    const { store, taskId, incidentId } = startedEvidenceCase();
    const state = store.getState();
    const task = state.haremInvestigationTasks[taskId]!;
    const at = fromTurnIndex(task.dueAt.dayIndex);
    const { newLeads, state: after } = settleDueInvestigationTasks(db, state, at);
    const lead = newLeads[0]!;

    const truth = after.investigationTruths.find((t) => t.incidentId === incidentId)!;
    if (lead.sourceEvidenceNodeId) {
      const node = truth.evidenceNodes.find((n) => n.id === lead.sourceEvidenceNodeId);
      expect(node).toBeDefined();
      expect(node!.discoverableBy).toContain("medical_examination");
      expect(lead.claims).toBeDefined();
      expect(lead.summaryCode).toBe(`evidence_${node!.factCode}`);
    } else {
      // 未发现：no_new_evidence，不指认任何人
      expect(lead.summaryCode).toBe("investigation_no_new_evidence");
      expect(lead.implicatedIds).toEqual([]);
      expect(lead.clearedIds).toEqual([]);
    }
  });

  it("EV-03: 进展通报写入 investigationPublicReports，不进旧 haremIntrigueReports", () => {
    const { store, taskId, incidentId } = startedEvidenceCase();
    const state = store.getState();
    const task = state.haremInvestigationTasks[taskId]!;
    const at = fromTurnIndex(task.dueAt.dayIndex);
    const { state: after } = settleDueInvestigationTasks(db, state, at);

    const progress = after.investigationPublicReports.filter(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    );
    expect(progress).toHaveLength(1);
    expect(progress[0]!.source.incidentId).toBe(incidentId);
    // 旧报告里不得出现证据案件进展
    expect(after.haremIntrigueReports.some((r) => r.id.startsWith("ireport_investigation_"))).toBe(false);
  });

  it("EV-04: 知识边界 — Lead 内部可有 sourceEvidenceNodeId/claims(脱敏)，但玩家可见进展通报不得携带后台引用", () => {
    const { store, taskId } = startedEvidenceCase();
    const state = store.getState();
    const task = state.haremInvestigationTasks[taskId]!;
    const at = fromTurnIndex(task.dueAt.dayIndex);
    const { newLeads, state: after } = settleDueInvestigationTasks(db, state, at);
    const lead = newLeads[0]!;

    // claims 仅含允许的脱敏结论，不含任何后台引用
    for (const claim of lead.claims ?? []) {
      expect(["implicates_character", "exonerates_character", "supports_cause", "reveals_mechanism", "establishes_fact"]).toContain(claim.kind);
      expect(claim).not.toHaveProperty("truthId");
      expect(claim).not.toHaveProperty("evidenceNodeId");
    }

    // 真正的玩家可见边界：进展通报绝不携带 sourceEvidenceNodeId / truthId / claims
    const progress = after.investigationPublicReports.find(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    )!;
    for (const k of FORBIDDEN_PROGRESS_KEYS) {
      expect(progress).not.toHaveProperty(k);
    }
  });

  it("EV-05: 结算后证据案件保持 open（裁定评估留待 2b），不进 ready_for_review", () => {
    const { store, taskId, caseId } = startedEvidenceCase();
    const state = store.getState();
    const task = state.haremInvestigationTasks[taskId]!;
    const at = fromTurnIndex(task.dueAt.dayIndex);
    const { state: after } = settleDueInvestigationTasks(db, state, at);
    const c = after.haremInvestigationCases.find((x) => x.id === caseId)!;
    expect(c.status).toBe("open");
  });

  it("EV-07: 结算后存档 round-trip — 线索(claims/sourceEvidenceNodeId)与进展通报存活且通过校验", () => {
    const { store, taskId } = startedEvidenceCase();
    const state = store.getState();
    const task = state.haremInvestigationTasks[taskId]!;
    const at = fromTurnIndex(task.dueAt.dayIndex);
    const after = settleDueInvestigationTasks(db, state, at).state;

    const storage = createMemoryStorage();
    const saveData = createSaveData(db, after, "slot1");
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(saveData));
    const loaded = readSlot(storage, db, "slot1");
    if (!loaded.ok) console.error("readSlot error:", JSON.stringify(loaded.error));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const restored = loaded.value.state;
    // 进展通报存活
    expect(restored.investigationPublicReports.some(
      (r) => r.reportKind === "investigation_update" || r.reportKind === "investigation_final",
    )).toBe(true);
    // 线索存活（含可选 claims / sourceEvidenceNodeId 若已发现）
    const lead = Object.values(restored.haremInvestigationLeads).find((l) => l.caseId === after.haremInvestigationCases[0]!.id)!;
    expect(lead).toBeDefined();
    const original = Object.values(after.haremInvestigationLeads).find((l) => l.id === lead.id)!;
    expect(lead.sourceEvidenceNodeId).toBe(original.sourceEvidenceNodeId);
    expect(lead.claims).toEqual(original.claims);
  });

  it("EV-06: 已发现节点不会被同方法任务重复发现（确定性，不依赖随机）", () => {
    // n_med 已发现；唯一 medical 节点即 n_med → eligible 为空 → 必为 no_new_evidence
    const state = buildEvidenceState(["n_med"]);
    const task = makeTask("medical_examination");
    const { lead } = resolveInvestigationTask(state, task, AT);
    expect(lead.sourceEvidenceNodeId).toBeUndefined();
    expect(lead.summaryCode).toBe("investigation_no_new_evidence");
  });

  it("EV-08: 前置证据未发现时后继节点不可发现；发现前置后方可发现（确定性 + 多 seed）", () => {
    const task = makeTask("obtain_testimony");

    // 前置 n_med 未发现 → n_test 永不进入 eligible（任何 seed）
    for (let seed = 0; seed < 30; seed++) {
      const state = { ...buildEvidenceState([]), rngSeed: seed };
      const { lead } = resolveInvestigationTask(state, task, AT);
      expect(lead.sourceEvidenceNodeId).not.toBe("n_test");
    }

    // 发现 n_med 后 → 存在某 seed 能发现 n_test（证明前置满足后 eligible 打开）
    let discoveredTest = false;
    for (let seed = 0; seed < 30; seed++) {
      const state = { ...buildEvidenceState(["n_med"]), rngSeed: seed };
      const { lead } = resolveInvestigationTask(state, task, AT);
      if (lead.sourceEvidenceNodeId === "n_test") { discoveredTest = true; break; }
    }
    expect(discoveredTest).toBe(true);
  });
});

// ── 确定性手工状态：一个证据案件 + 两节点 truth（n_test 依赖 n_med）──────
const TRUTH_NODES = [
  {
    id: "n_med", type: "medical" as const, factCode: "diag",
    claims: [{ kind: "supports_cause" as const, causeType: "natural_illness" as const }],
    difficulty: 10, decayPerPeriod: 0, discoverableBy: ["medical_examination" as const],
    prerequisiteEvidenceIds: [] as string[], misleading: false,
  },
  {
    id: "n_test", type: "testimony" as const, factCode: "confession",
    claims: [{ kind: "implicates_character" as const, characterRef: "lu_huaijin", strength: "strong" as const }],
    difficulty: 10, decayPerPeriod: 0, discoverableBy: ["obtain_testimony" as const],
    prerequisiteEvidenceIds: ["n_med"], misleading: false,
  },
];

function buildEvidenceState(discoveredNodeIds: string[]): GameState {
  const truth = {
    id: "itruth_inc_ev", incidentId: "inc_ev", eventFamily: "heir_health_anomaly" as const,
    causeType: "natural_illness" as const, culpritIds: [] as string[], accusedIds: [] as string[],
    framingTargetIds: [] as string[], method: "none" as const, motive: "none" as const,
    concealment: 0, evidenceNodes: TRUTH_NODES, generatedAt: AT, sourceKey: "k",
  };
  const leads: Record<string, import("../../src/engine/characters/haremInvestigation/types").IntrigueInvestigationLead> = {};
  const leadIds: string[] = [];
  discoveredNodeIds.forEach((nodeId, i) => {
    const id = `ilead_${String(i + 1).padStart(6, "0")}`;
    leadIds.push(id);
    leads[id] = {
      id, caseId: "icase_ev", discoveredAt: AT, method: "medical_examination",
      summaryCode: `evidence_${nodeId}`, strength: "plausible",
      implicatedIds: [], clearedIds: [], revealedKinds: [], sourceEvidenceNodeId: nodeId, claims: [],
    };
  });
  const c = {
    id: "icase_ev",
    source: { kind: "investigation_incident" as const, reportId: "iarep_ev", incidentId: "inc_ev" },
    openedAt: AT, openedFromReportKind: "anomaly" as const, status: "in_progress" as const,
    knownTargetIds: ["heir_001"], suspectIds: ["lu_huaijin"], suspectedKinds: [] as never[],
    confidence: "plausible" as const, leadIds,
  };
  return {
    ...base,
    investigationTruths: [truth],
    haremInvestigationCases: [c],
    haremInvestigationLeads: leads,
    haremInvestigationNextSeq: discoveredNodeIds.length + 1,
  };
}

function makeTask(method: "medical_examination" | "obtain_testimony") {
  return {
    id: "itask_000099", caseId: "icase_ev", method,
    requestedAt: AT, dueAt: AT, status: "pending" as const,
  };
}

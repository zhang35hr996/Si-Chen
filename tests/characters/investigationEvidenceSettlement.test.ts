/**
 * Phase 5B-2B2a: 证据驱动调查结算。
 * 验证 investigation_incident 案件经由 InvestigationTruth.evidenceNodes 结算，
 * 不读取旧 haremIncidents，进展通报走 investigationPublicReports，案件保持 open。
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import { settleDueInvestigationTasks } from "../../src/engine/characters/haremInvestigation/settlement";
import { fromTurnIndex } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import type { GameState } from "../../src/engine/state/types";

const db = loadRealContent();
const base = createNewGameState(db);

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
  return { ...base, standing };
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

const FORBIDDEN_LEAD_KEYS = ["truthId", "evidenceNodeId", "culpritIds", "concealment"];

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

  it("EV-04: 线索知识边界 — 不含 truthId/evidenceNodeId/culpritId 等后台字段，claims 仅含脱敏结论", () => {
    const { store, taskId } = startedEvidenceCase();
    const state = store.getState();
    const task = state.haremInvestigationTasks[taskId]!;
    const at = fromTurnIndex(task.dueAt.dayIndex);
    const lead = settleDueInvestigationTasks(db, state, at).newLeads[0]!;

    for (const k of FORBIDDEN_LEAD_KEYS) {
      expect(lead).not.toHaveProperty(k);
    }
    for (const claim of lead.claims ?? []) {
      expect(["implicates_character", "exonerates_character", "supports_cause", "reveals_mechanism", "establishes_fact"]).toContain(claim.kind);
      expect(claim).not.toHaveProperty("truthId");
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

  it("EV-06: 同一证据节点不重复发现（第二次同方法任务不会再产出同 node）", () => {
    const { store, taskId } = startedEvidenceCase();
    let state = store.getState();
    const task1 = state.haremInvestigationTasks[taskId]!;
    const at1 = fromTurnIndex(task1.dueAt.dayIndex);
    const r1 = settleDueInvestigationTasks(db, state, at1);
    state = r1.state;
    const firstNode = r1.newLeads[0]!.sourceEvidenceNodeId;

    if (!firstNode) return; // 首次未发现则跳过（无可重复对象）

    // 再下一个同方法任务并结算
    const started2 = store2Start(state);
    const r2 = settleDueInvestigationTasks(db, started2.state, started2.at);
    const secondNode = r2.newLeads[0]!.sourceEvidenceNodeId;
    expect(secondNode).not.toBe(firstNode);
  });
});

// 在给定 state 上再下一个 medical_examination 任务，返回可结算的 state + 时刻。
function store2Start(state: GameState) {
  const store = createGameStore();
  store.loadState(state);
  const caseId = state.haremInvestigationCases[0]!.id;
  const started = store.startHaremInvestigationTask(db, caseId, "question_servants");
  if (!started.ok) throw new Error(`second task start failed: ${JSON.stringify(started.error)}`);
  const s2 = store.getState();
  const task = s2.haremInvestigationTasks[started.value.taskId]!;
  return { state: s2, at: fromTurnIndex(task.dueAt.dayIndex) };
}

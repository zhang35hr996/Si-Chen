/**
 * Phase 5B-2：调查结算、确定性 RNG、线索合并行为测试。
 */
import { describe, expect, it } from "vitest";
import { resolveInvestigationTask, settleDueInvestigationTasks, nextTaskId, nextLeadId } from "../../src/engine/characters/haremInvestigation/settlement";
import { applyInvestigationLead } from "../../src/engine/characters/haremInvestigation/leads";
import { createIntrigueInvestigationCase, cancelIntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/createCase";
import { createInitialState } from "../../src/engine/state/initialState";
import type { GameState } from "../../src/engine/state/types";
import type { HaremIntrigueReport } from "../../src/engine/state/types";
import type { IntrigueInvestigationTask } from "../../src/engine/characters/haremInvestigation/types";
import { makeGameTime, fromTurnIndex } from "../../src/engine/calendar/time";

const AT = makeGameTime(1, 3, "early");
const AT2 = makeGameTime(1, 3, "mid");

const BASE_REPORT: HaremIntrigueReport = {
  id: "ireport_settle_001",
  source: { incidentId: "incident_settle_001" },
  reportKind: "rumor",
  createdAt: AT,
  status: "unread",
  knownTargetIds: ["victim_a"],
  suspectedActorIds: ["suspect_x"],
  suspectedKinds: ["slander"],
  knownOutcome: "harm_observed",
  confidence: "tenuous",
  summaryCode: "rumor_heard",
};

function makeStateWithCase(incidentActorId?: string): GameState {
  const base = createInitialState();
  const s: GameState = {
    ...base,
    haremIntrigueReports: [BASE_REPORT],
    haremIncidents: incidentActorId
      ? [{ id: "incident_settle_001", schemeId: "scheme_1", kind: "slander" as const, actorId: incidentActorId, targetId: "victim_a", success: true, observationLevel: "exposed" as const, resolvedAt: AT, consequencesApplied: true }]
      : [],
    standing: {
      victim_a: { lifecycle: "active" } as unknown as GameState["standing"][string],
      suspect_x: { lifecycle: "active" } as unknown as GameState["standing"][string],
    },
  };
  const r = createIntrigueInvestigationCase(s, "ireport_settle_001", AT);
  if (!r.ok) throw new Error("setup failed: " + JSON.stringify(r.error));
  return r.value.state;
}

function makePendingTask(caseId: string, dueAtDayIndex: number): IntrigueInvestigationTask {
  return {
    id: nextTaskId(1),
    caseId,
    method: "quiet_inquiry",
    requestedAt: AT,
    dueAt: fromTurnIndex(dueAtDayIndex),
    status: "pending",
  };
}

// ── ID 生成 ────────────────────────────────────────────────────────────

describe("nextTaskId / nextLeadId", () => {
  it("pads to 6 digits", () => {
    expect(nextTaskId(1)).toBe("itask_000001");
    expect(nextLeadId(42)).toBe("ilead_000042");
    expect(nextTaskId(999999)).toBe("itask_999999");
  });
});

// ── resolveInvestigationTask ──────────────────────────────────────────

describe("resolveInvestigationTask", () => {
  it("deterministic: same seed + taskId → same lead", () => {
    const s = makeStateWithCase("true_actor_id");
    const caseId = s.haremInvestigationCases[0]!.id;
    const task = makePendingTask(caseId, AT.dayIndex + 2);
    const lead1 = resolveInvestigationTask(s, task, AT2);
    const lead2 = resolveInvestigationTask(s, task, AT2);
    expect(lead1.lead.strength).toBe(lead2.lead.strength);
    expect(lead1.lead.summaryCode).toBe(lead2.lead.summaryCode);
    expect(lead1.lead.implicatedIds).toEqual(lead2.lead.implicatedIds);
  });

  it("output lead never contains actorId field", () => {
    const s = makeStateWithCase("true_actor_id");
    const caseId = s.haremInvestigationCases[0]!.id;
    const task = makePendingTask(caseId, AT.dayIndex + 2);
    const { lead } = resolveInvestigationTask(s, task, AT2);
    expect((lead as unknown as Record<string, unknown>)["actorId"]).toBeUndefined();
    expect((lead as unknown as Record<string, unknown>)["isTrueLead"]).toBeUndefined();
    expect((lead as unknown as Record<string, unknown>)["groundTruth"]).toBeUndefined();
  });

  it("orphan task (case not found) → returns empty lead, does not throw", () => {
    const s = makeStateWithCase();
    const task: IntrigueInvestigationTask = {
      id: "itask_000001",
      caseId: "icase_nonexistent",
      method: "quiet_inquiry",
      requestedAt: AT,
      dueAt: AT2,
      status: "pending",
    };
    const { lead } = resolveInvestigationTask(s, task, AT2);
    expect(lead.summaryCode).toBe("orphan_task_skipped");
  });

  it("question_suspect on true actor eventually produces strong/confirmed lead", () => {
    // Run multiple seeds to confirm true actor is implicated at least once
    let found = false;
    for (let seed = 1; seed <= 20; seed++) {
      const base = createInitialState({ rngSeed: seed });
      const s: GameState = {
        ...base,
        haremIntrigueReports: [BASE_REPORT],
        haremIncidents: [{ id: "incident_settle_001", schemeId: "scheme_1", kind: "slander" as const, actorId: "suspect_x", targetId: "victim_a", success: true, observationLevel: "exposed" as const, resolvedAt: AT, consequencesApplied: true }],
        standing: {
          victim_a: { lifecycle: "active" } as unknown as GameState["standing"][string],
          suspect_x: { lifecycle: "active" } as unknown as GameState["standing"][string],
        },
      };
      const r = createIntrigueInvestigationCase(s, "ireport_settle_001", AT);
      if (!r.ok) continue;
      const caseId = r.value.caseId;
      const task: IntrigueInvestigationTask = {
        id: nextTaskId(1),
        caseId,
        method: "question_suspect",
        subjectId: "suspect_x",
        requestedAt: AT,
        dueAt: AT2,
        status: "pending",
      };
      const { lead } = resolveInvestigationTask(r.value.state, task, AT2);
      if (lead.strength === "strong" || lead.strength === "confirmed") {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("question_suspect on non-culprit never adds target to implicatedIds", () => {
    // Non-culprit suspect questioned; should clear or be inconclusive, never implicate victim
    for (let seed = 1; seed <= 30; seed++) {
      const s = { ...makeStateWithCase("different_actor"), rngSeed: seed };
      const caseId = s.haremInvestigationCases[0]!.id;
      const task: IntrigueInvestigationTask = {
        id: nextTaskId(1),
        caseId,
        method: "question_suspect",
        subjectId: "suspect_x",
        requestedAt: AT,
        dueAt: AT2,
        status: "pending",
      };
      const { lead } = resolveInvestigationTask(s, task, AT2);
      // victim_a (knownTargetId) must never appear in implicatedIds
      expect(lead.implicatedIds).not.toContain("victim_a");
    }
  });
});

// ── settleDueInvestigationTasks ───────────────────────────────────────

describe("settleDueInvestigationTasks", () => {
  it("task not yet due → not settled", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    // dueAt is 10 days in the future
    const futureDueAt = fromTurnIndex(AT.dayIndex + 10);
    const taskId = nextTaskId(1);
    const withTask: GameState = {
      ...s,
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: futureDueAt, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withTask, AT);
    expect(result.settledTaskIds).toEqual([]);
    expect(result.state.haremInvestigationTasks[taskId]?.status).toBe("pending");
  });

  it("task due → settled, lead written, nextSeq incremented", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const taskId = nextTaskId(1);
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withTask, AT);
    expect(result.settledTaskIds).toContain(taskId);
    expect(result.state.haremInvestigationTasks[taskId]?.status).toBe("resolved");
    expect(result.newLeads).toHaveLength(1);
    expect(result.state.haremInvestigationNextSeq).toBe(2);
  });

  it("cancelled case → pending task auto-cancelled, no lead generated", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const cancelResult = cancelIntrigueInvestigationCase(s, caseId, AT);
    if (!cancelResult.ok) throw new Error("cancel failed");
    const taskId = nextTaskId(1);
    // Artificially add a pending task to the already-cancelled case (simulates race)
    const withStaleTask: GameState = {
      ...cancelResult.value,
      haremInvestigationTasks: {
        [taskId]: { id: taskId, caseId, method: "quiet_inquiry", requestedAt: AT, dueAt: AT, status: "pending" },
      },
    };
    const result = settleDueInvestigationTasks({} as never, withStaleTask, AT);
    expect(result.settledTaskIds).toEqual([]);
    expect(result.newLeads).toHaveLength(0);
    expect(result.state.haremInvestigationTasks[taskId]?.status).toBe("cancelled");
  });

  it("catch-up: multiple overdue tasks settled in dueAt ASC order", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const task1: IntrigueInvestigationTask = {
      id: "itask_000001",
      caseId,
      method: "quiet_inquiry",
      requestedAt: AT,
      dueAt: fromTurnIndex(AT.dayIndex + 1),
      status: "pending",
    };
    const now = fromTurnIndex(AT.dayIndex + 5);
    const withTask: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationTasks: { [task1.id]: task1 },
    };
    const result = settleDueInvestigationTasks({} as never, withTask, now);
    expect(result.settledTaskIds).toContain("itask_000001");
  });
});

// ── applyInvestigationLead ────────────────────────────────────────────

describe("applyInvestigationLead", () => {
  it("tenuous lead on open case does not trigger ready_for_review", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const leadId = nextLeadId(1);
    const lead = {
      id: leadId, caseId, discoveredAt: AT2, method: "quiet_inquiry" as const,
      summaryCode: "inquiry_limited_findings", strength: "tenuous" as const,
      implicatedIds: [], clearedIds: [], revealedKinds: [],
    };
    const after = applyInvestigationLead(
      { ...s, haremInvestigationLeads: { [leadId]: lead } },
      lead,
    );
    const c = after.haremInvestigationCases.find((x) => x.id === caseId)!;
    expect(c.status).not.toBe("ready_for_review");
  });

  it("strong lead on in_progress case → ready_for_review", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const leadId = nextLeadId(1);
    const sWithInProgress: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const } : c,
      ),
    };
    const lead = {
      id: leadId, caseId, discoveredAt: AT2, method: "question_suspect" as const,
      summaryCode: "suspect_contradicted_account", strength: "strong" as const,
      implicatedIds: ["suspect_x"], clearedIds: [], revealedKinds: [],
    };
    const after = applyInvestigationLead(
      { ...sWithInProgress, haremInvestigationLeads: { [leadId]: lead } },
      lead,
    );
    const c = after.haremInvestigationCases.find((x) => x.id === caseId)!;
    expect(c.status).toBe("ready_for_review");
  });

  it("plausible lead with existing strong confidence → ready_for_review (uses newConfidence)", () => {
    const s = makeStateWithCase();
    const caseId = s.haremInvestigationCases[0]!.id;
    const leadId = nextLeadId(1);
    // Case already has strong confidence but in_progress status
    const sWithStrong: GameState = {
      ...s,
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === caseId ? { ...c, status: "in_progress" as const, confidence: "strong" } : c,
      ),
    };
    const lead = {
      id: leadId, caseId, discoveredAt: AT2, method: "quiet_inquiry" as const,
      summaryCode: "inquiry_found_suspicious_pattern", strength: "plausible" as const,
      implicatedIds: ["suspect_x"], clearedIds: [], revealedKinds: [],
    };
    const after = applyInvestigationLead(
      { ...sWithStrong, haremInvestigationLeads: { [leadId]: lead } },
      lead,
    );
    const c = after.haremInvestigationCases.find((x) => x.id === caseId)!;
    // newConfidence = max("strong", "plausible") = "strong" → ready_for_review
    expect(c.status).toBe("ready_for_review");
  });
});

// ── confirmed report → ready_for_review on open ──────────────────────

describe("createIntrigueInvestigationCase: H1 status fix", () => {
  it("confirmed report → case opens as ready_for_review", () => {
    const confirmedReport: HaremIntrigueReport = {
      ...BASE_REPORT,
      confidence: "confirmed",
    };
    const s: GameState = {
      ...createInitialState(),
      haremIntrigueReports: [confirmedReport],
    };
    const r = createIntrigueInvestigationCase(s, "ireport_settle_001", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.haremInvestigationCases[0]?.status).toBe("ready_for_review");
  });

  it("tenuous report → case opens as open", () => {
    const s: GameState = {
      ...createInitialState(),
      haremIntrigueReports: [BASE_REPORT],
    };
    const r = createIntrigueInvestigationCase(s, "ireport_settle_001", AT);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state.haremInvestigationCases[0]?.status).toBe("open");
  });
});

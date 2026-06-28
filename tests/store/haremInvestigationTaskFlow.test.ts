/**
 * Phase 5B-2：Store 层调查任务流程集成测试。
 * 验证：AP 原子、rollover 时长、取消案件同步取消任务、裁定持久化。
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState, HaremIntrigueReport, HaremIncident } from "../../src/engine/state/types";

import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import { createIntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/createCase";

const db = loadRealContent();
const AT = makeGameTime(1, 3, "early");

const TEST_REPORT: HaremIntrigueReport = {
  id: "ireport_flow_001",
  source: { incidentId: "incident_flow_001" },
  reportKind: "rumor",
  createdAt: AT,
  status: "unread",
  knownTargetIds: ["lu_huaijin"],
  suspectedActorIds: ["xu_qinghuan"],
  suspectedKinds: ["slander"],
  knownOutcome: "harm_observed",
  confidence: "tenuous",
  summaryCode: "rumor_heard",
};

const TEST_INCIDENT: HaremIncident = {
  id: "incident_flow_001",
  schemeId: "scheme_flow_001",
  kind: "slander",
  actorId: "xu_qinghuan",
  targetId: "lu_huaijin",
  success: true,
  observationLevel: "exposed",
  resolvedAt: AT,
  consequencesApplied: true,
};

function makeStoreWithCase() {
  const base = createNewGameState(db);
  const s: GameState = {
    ...base,
    haremIntrigueReports: [TEST_REPORT],
    haremIncidents: [TEST_INCIDENT],
    standing: {
      ...base.standing,
      lu_huaijin: { ...(base.standing["lu_huaijin"] ?? {}), lifecycle: "active" } as unknown as GameState["standing"][string],
      xu_qinghuan: { ...(base.standing["xu_qinghuan"] ?? {}), lifecycle: "active" } as unknown as GameState["standing"][string],
    },
  };
  const r = createIntrigueInvestigationCase(s, "ireport_flow_001", AT);
  if (!r.ok) throw new Error("case setup: " + JSON.stringify(r.error));
  const store = createGameStore();
  (store as unknown as { state: GameState }).state = r.value.state;
  return { store, caseId: r.value.caseId };
}

describe("startHaremInvestigationTask", () => {
  it("AP insufficient → error, state unchanged", () => {
    const { store, caseId } = makeStoreWithCase();
    // Drain all AP via SKIP_REMAINDER is hard; instead set AP to 0 directly
    const s = (store as unknown as { state: GameState }).state;
    (store as unknown as { state: GameState }).state = {
      ...s,
      calendar: { ...s.calendar, ap: 0 },
    };
    const result = store.startHaremInvestigationTask(db, caseId, "quiet_inquiry");
    expect(result.ok).toBe(false);
    expect((store as unknown as { state: GameState }).state.haremInvestigationTasks).toEqual({});
  });

  it("valid task → taskId returned, task written, case → in_progress, AP decremented", () => {
    const { store, caseId } = makeStoreWithCase();
    const before = (store as unknown as { state: GameState }).state;
    const apBefore = before.calendar.ap;
    const result = store.startHaremInvestigationTask(db, caseId, "quiet_inquiry");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { taskId } = result.value;
    const after = (store as unknown as { state: GameState }).state;
    const task = after.haremInvestigationTasks[taskId];
    expect(task).toBeDefined();
    expect(task?.status).toBe("pending");
    expect(task?.method).toBe("quiet_inquiry");
    const c = after.haremInvestigationCases.find((x) => x.id === caseId);
    expect(c?.status).toBe("in_progress");
    // AP spent (quiet_inquiry costs 1)
    expect(after.calendar.ap).toBeLessThan(apBefore);
  });

  it("B1: requestedAt is the CURRENT period (before AP advance)", () => {
    const { store, caseId } = makeStoreWithCase();
    const before = (store as unknown as { state: GameState }).state;
    const expectedDayIndex = before.calendar.dayIndex;
    const result = store.startHaremInvestigationTask(db, caseId, "quiet_inquiry");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = (store as unknown as { state: GameState }).state;
    const task = after.haremInvestigationTasks[result.value.taskId];
    // requestedAt.dayIndex should equal the calendar day BEFORE spending AP
    expect(task?.requestedAt.dayIndex).toBe(expectedDayIndex);
    // dueAt should be exactly durationDays later (quiet_inquiry = 2)
    expect(task?.dueAt.dayIndex).toBe(expectedDayIndex + 2);
  });

  it("cannot start second task when one is pending", () => {
    const { store, caseId } = makeStoreWithCase();
    const r1 = store.startHaremInvestigationTask(db, caseId, "quiet_inquiry");
    expect(r1.ok).toBe(true);
    const r2 = store.startHaremInvestigationTask(db, caseId, "quiet_inquiry");
    expect(r2.ok).toBe(false);
  });
});

describe("cancelHaremInvestigation", () => {
  it("B2: cancelling case also cancels all pending tasks atomically", () => {
    const { store, caseId } = makeStoreWithCase();
    const r = store.startHaremInvestigationTask(db, caseId, "quiet_inquiry");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const { taskId } = r.value;
    const cancelResult = store.cancelHaremInvestigation(caseId);
    expect(cancelResult.ok).toBe(true);
    const after = (store as unknown as { state: GameState }).state;
    expect(after.haremInvestigationCases.find((c) => c.id === caseId)?.status).toBe("cancelled");
    expect(after.haremInvestigationTasks[taskId]?.status).toBe("cancelled");
  });
});

describe("reviewHaremInvestigation", () => {
  function makeReadyForReviewStore() {
    const { store, caseId } = makeStoreWithCase();
    // Manually put case into ready_for_review
    const s = (store as unknown as { state: GameState }).state;
    const idx = s.haremInvestigationCases.findIndex((c) => c.id === caseId);
    const cases = [...s.haremInvestigationCases];
    cases[idx] = {
      ...cases[idx]!,
      status: "ready_for_review",
      suspectIds: ["xu_qinghuan"],
      confidence: "strong",
    };
    (store as unknown as { state: GameState }).state = { ...s, haremInvestigationCases: cases };
    return { store, caseId };
  }

  it("B3: confirm decision persists confirmedCulpritId", () => {
    const { store, caseId } = makeReadyForReviewStore();
    // Upgrade confidence to confirmed first (required by reviewHaremInvestigation)
    const s = (store as unknown as { state: GameState }).state;
    const idx = s.haremInvestigationCases.findIndex((c) => c.id === caseId);
    const cases = [...s.haremInvestigationCases];
    cases[idx] = { ...cases[idx]!, confidence: "confirmed" };
    (store as unknown as { state: GameState }).state = { ...s, haremInvestigationCases: cases };

    const result = store.reviewHaremInvestigation(caseId, { type: "confirm", suspectId: "xu_qinghuan" });
    expect(result.ok).toBe(true);
    const after = (store as unknown as { state: GameState }).state;
    const c = after.haremInvestigationCases.find((x) => x.id === caseId)!;
    expect(c.status).toBe("closed_confirmed");
    expect(c.confirmedCulpritId).toBe("xu_qinghuan");
    expect(c.closureReason).toBe("culprit_confirmed");
  });

  it("confirm requires confidence=confirmed", () => {
    const { store, caseId } = makeReadyForReviewStore();
    // confidence is "strong", not "confirmed"
    const result = store.reviewHaremInvestigation(caseId, { type: "confirm", suspectId: "xu_qinghuan" });
    expect(result.ok).toBe(false);
  });

  it("continue resets to open", () => {
    const { store, caseId } = makeReadyForReviewStore();
    const result = store.reviewHaremInvestigation(caseId, { type: "continue" });
    expect(result.ok).toBe(true);
    const after = (store as unknown as { state: GameState }).state;
    expect(after.haremInvestigationCases.find((c) => c.id === caseId)?.status).toBe("open");
  });

  it("close_unresolved → closed_unresolved", () => {
    const { store, caseId } = makeReadyForReviewStore();
    const result = store.reviewHaremInvestigation(caseId, { type: "close_unresolved" });
    expect(result.ok).toBe(true);
    const after = (store as unknown as { state: GameState }).state;
    const c = after.haremInvestigationCases.find((x) => x.id === caseId)!;
    expect(c.status).toBe("closed_unresolved");
    expect(c.closureReason).toBe("insufficient_evidence");
    expect(c.confirmedCulpritId).toBeUndefined();
  });

  it("review on non-ready_for_review status → error", () => {
    const { store, caseId } = makeStoreWithCase();
    const result = store.reviewHaremInvestigation(caseId, { type: "close_unresolved" });
    expect(result.ok).toBe(false);
  });
});

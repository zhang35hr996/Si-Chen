/**
 * Phase 5B-2：调查行动可用性与参数验证。
 */
import { describe, expect, it } from "vitest";
import { availableInvestigationActions, validateCanStartTask } from "../../src/engine/characters/haremInvestigation/actions";
import { createIntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/createCase";
import { createInitialState } from "../../src/engine/state/initialState";
import type { GameState } from "../../src/engine/state/types";
import type { HaremIntrigueReport } from "../../src/engine/state/types";
import { makeGameTime } from "../../src/engine/calendar/time";

const AT = makeGameTime(1, 3, "early");

const BASE_REPORT: HaremIntrigueReport = {
  id: "ireport_act_001",
  source: { incidentId: "incident_001" },
  reportKind: "anomaly",
  createdAt: AT,
  status: "unread",
  knownTargetIds: ["target_a"],
  suspectedActorIds: ["suspect_b"],
  suspectedKinds: ["slander"],
  knownOutcome: "harm_observed",
  confidence: "tenuous",
  summaryCode: "anomaly_observed",
};

function makeState(overrides: Partial<HaremIntrigueReport> = {}): GameState {
  const s: GameState = {
    ...createInitialState(),
    haremIntrigueReports: [{ ...BASE_REPORT, ...overrides }],
    standing: {
      target_a: { lifecycle: "active" } as unknown as GameState["standing"][string],
      suspect_b: { lifecycle: "active" } as unknown as GameState["standing"][string],
    },
  };
  const r = createIntrigueInvestigationCase(s, "ireport_act_001", AT);
  if (!r.ok) throw new Error("setup: " + JSON.stringify(r.error));
  return r.value.state;
}

describe("availableInvestigationActions", () => {
  it("open case with alive target + suspect → three actions", () => {
    const s = makeState();
    const actions = availableInvestigationActions(s, "icase_ireport_act_001");
    expect(actions.map((a) => a.method).sort()).toEqual([
      "question_suspect",
      "question_target",
      "quiet_inquiry",
    ]);
  });

  it("question_target returns subjectCandidateIds = aliveTargets", () => {
    const s = makeState();
    const actions = availableInvestigationActions(s, "icase_ireport_act_001");
    const qt = actions.find((a) => a.method === "question_target");
    expect(qt?.subjectCandidateIds).toEqual(["target_a"]);
  });

  it("question_suspect returns subjectCandidateIds = aliveSuspects", () => {
    const s = makeState();
    const actions = availableInvestigationActions(s, "icase_ireport_act_001");
    const qs = actions.find((a) => a.method === "question_suspect");
    expect(qs?.subjectCandidateIds).toEqual(["suspect_b"]);
  });

  it("deceased target → question_target not available", () => {
    const s: GameState = {
      ...makeState(),
      standing: {
        target_a: { lifecycle: "deceased" } as GameState["standing"][string],
        suspect_b: { lifecycle: "active" } as unknown as GameState["standing"][string],
      },
    };
    const actions = availableInvestigationActions(s, "icase_ireport_act_001");
    expect(actions.some((a) => a.method === "question_target")).toBe(false);
  });

  it("case with existing pending task → no actions", () => {
    const s = makeState();
    const caseId = "icase_ireport_act_001";
    const withTask: GameState = {
      ...s,
      haremInvestigationTasks: {
        "itask_000001": {
          id: "itask_000001",
          caseId,
          method: "quiet_inquiry",
          requestedAt: AT,
          dueAt: makeGameTime(1, 3, "mid"),
          status: "pending",
        },
      },
    };
    expect(availableInvestigationActions(withTask, caseId)).toEqual([]);
  });

  it("ready_for_review case → no actions", () => {
    const s = makeState();
    const caseId = "icase_ireport_act_001";
    const idx = s.haremInvestigationCases.findIndex((c) => c.id === caseId);
    const cases = [...s.haremInvestigationCases];
    cases[idx] = { ...cases[idx]!, status: "ready_for_review" };
    const withReview: GameState = { ...s, haremInvestigationCases: cases };
    expect(availableInvestigationActions(withReview, caseId)).toEqual([]);
  });

  it("non-existent case → empty", () => {
    const s = makeState();
    expect(availableInvestigationActions(s, "icase_does_not_exist")).toEqual([]);
  });
});

describe("validateCanStartTask", () => {
  it("question_target without subjectId → error", () => {
    const s = makeState();
    const c = s.haremInvestigationCases[0]!;
    expect(validateCanStartTask(s, c, "question_target", undefined)).toMatch(/须指定/);
  });

  it("question_target with invalid subjectId (not in knownTargetIds) → error", () => {
    const s = makeState();
    const c = s.haremInvestigationCases[0]!;
    expect(validateCanStartTask(s, c, "question_target", "suspect_b")).toMatch(/knownTargetIds/);
  });

  it("question_target with valid alive target → ok", () => {
    const s = makeState();
    const c = s.haremInvestigationCases[0]!;
    expect(validateCanStartTask(s, c, "question_target", "target_a")).toBeNull();
  });

  it("question_suspect without subjectId → error", () => {
    const s = makeState();
    const c = s.haremInvestigationCases[0]!;
    expect(validateCanStartTask(s, c, "question_suspect", undefined)).toMatch(/须指定/);
  });

  it("question_suspect with non-suspect subjectId → error", () => {
    const s = makeState();
    const c = s.haremInvestigationCases[0]!;
    expect(validateCanStartTask(s, c, "question_suspect", "target_a")).toMatch(/嫌疑人名单/);
  });

  it("quiet_inquiry on open case → ok", () => {
    const s = makeState();
    const c = s.haremInvestigationCases[0]!;
    expect(validateCanStartTask(s, c, "quiet_inquiry", undefined)).toBeNull();
  });

  it("cancelled case → error", () => {
    const s = makeState();
    const caseId = "icase_ireport_act_001";
    const idx = s.haremInvestigationCases.findIndex((c) => c.id === caseId);
    const cases = [...s.haremInvestigationCases];
    cases[idx] = { ...cases[idx]!, status: "cancelled", closedAt: AT, closureReason: "player_cancelled" };
    const c = cases[idx]!;
    expect(validateCanStartTask({ ...s, haremInvestigationCases: cases }, c, "quiet_inquiry")).toMatch(/不允许/);
  });

  it("ready_for_review case → error", () => {
    const s = makeState();
    const caseId = "icase_ireport_act_001";
    const idx = s.haremInvestigationCases.findIndex((c) => c.id === caseId);
    const cases = [...s.haremInvestigationCases];
    cases[idx] = { ...cases[idx]!, status: "ready_for_review" };
    const c = cases[idx]!;
    expect(validateCanStartTask({ ...s, haremInvestigationCases: cases }, c, "quiet_inquiry")).toMatch(/待裁定/);
  });

  it("existing pending task → error", () => {
    const s = makeState();
    const caseId = "icase_ireport_act_001";
    const withTask: GameState = {
      ...s,
      haremInvestigationTasks: {
        "itask_000001": {
          id: "itask_000001",
          caseId,
          method: "quiet_inquiry",
          requestedAt: AT,
          dueAt: makeGameTime(1, 3, "mid"),
          status: "pending",
        },
      },
    };
    const c = s.haremInvestigationCases[0]!;
    expect(validateCanStartTask(withTask, c, "quiet_inquiry")).toMatch(/等待结算/);
  });
});

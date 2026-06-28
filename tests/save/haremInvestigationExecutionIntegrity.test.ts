/**
 * Phase 5B-2：调查执行层存档完整性校验。
 * 验证 validateHaremInvestigationLinks 在异常数据时能检测到所有约束违反。
 */
import { describe, expect, it } from "vitest";
import { validateHaremInvestigationLinks } from "../../src/engine/characters/haremInvestigation/stateValidation";
import { createIntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/createCase";
import { createInitialState } from "../../src/engine/state/initialState";
import type { GameState, HaremIntrigueReport } from "../../src/engine/state/types";
import type { IntrigueInvestigationTask, IntrigueInvestigationLead } from "../../src/engine/characters/haremInvestigation/types";
import { makeGameTime } from "../../src/engine/calendar/time";

const AT = makeGameTime(1, 3, "early");
const AT2 = makeGameTime(1, 3, "mid");

const BASE_REPORT: HaremIntrigueReport = {
  id: "ireport_integ_001",
  source: { incidentId: "incident_integ_001" },
  reportKind: "exposure",
  createdAt: AT,
  status: "unread",
  knownTargetIds: ["target_integ"],
  suspectedActorIds: ["suspect_integ"],
  suspectedKinds: ["slander"],
  knownOutcome: "harm_observed",
  confidence: "tenuous",
  summaryCode: "exposure_detected",
};

function makeBaseState(): GameState {
  const s: GameState = {
    ...createInitialState(),
    haremIntrigueReports: [BASE_REPORT],
    standing: {
      target_integ: { lifecycle: "active" } as unknown as GameState["standing"][string],
    },
  };
  const r = createIntrigueInvestigationCase(s, "ireport_integ_001", AT);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.state;
}

function makeInput(s: GameState) {
  return {
    haremIntrigueReports: s.haremIntrigueReports,
    haremInvestigationCases: s.haremInvestigationCases,
    haremInvestigationTasks: s.haremInvestigationTasks,
    haremInvestigationLeads: s.haremInvestigationLeads,
    haremInvestigationNextSeq: s.haremInvestigationNextSeq,
    incidentIds: new Set(["incident_integ_001"]),
  };
}

const BASE_TASK: IntrigueInvestigationTask = {
  id: "itask_000001",
  caseId: "icase_ireport_integ_001",
  method: "quiet_inquiry",
  requestedAt: AT,
  dueAt: AT2,
  status: "pending",
};

const BASE_LEAD: IntrigueInvestigationLead = {
  id: "ilead_000001",
  caseId: "icase_ireport_integ_001",
  discoveredAt: AT2,
  method: "quiet_inquiry",
  summaryCode: "inquiry_limited_findings",
  strength: "tenuous",
  implicatedIds: [],
  clearedIds: [],
  revealedKinds: [],
};

describe("validateHaremInvestigationLinks — execution integrity", () => {
  it("clean state → no errors", () => {
    expect(validateHaremInvestigationLinks(makeInput(makeBaseState()))).toEqual([]);
  });

  it("task with unknown caseId → INTRIGUE_TASK_ORPHAN", () => {
    const s = makeBaseState();
    const input = {
      ...makeInput(s),
      haremInvestigationTasks: {
        "itask_000001": { ...BASE_TASK, caseId: "icase_nonexistent" },
      },
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_TASK_ORPHAN")).toBe(true);
  });

  it("task.leadId pointing to nonexistent lead → INTRIGUE_TASK_ORPHAN_LEAD", () => {
    const s = makeBaseState();
    const input = {
      ...makeInput(s),
      haremInvestigationTasks: {
        "itask_000001": { ...BASE_TASK, status: "resolved" as const, resolvedAt: AT2, leadId: "ilead_999999" },
      },
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_TASK_ORPHAN_LEAD")).toBe(true);
  });

  it("lead with unknown caseId → INTRIGUE_LEAD_ORPHAN", () => {
    const s = makeBaseState();
    const input = {
      ...makeInput(s),
      haremInvestigationLeads: {
        "ilead_000001": { ...BASE_LEAD, caseId: "icase_nonexistent" },
      },
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_LEAD_ORPHAN")).toBe(true);
  });

  it("pending task must not have resolvedAt → INTRIGUE_TASK_LIFECYCLE", () => {
    const s = makeBaseState();
    const input = {
      ...makeInput(s),
      haremInvestigationTasks: {
        "itask_000001": { ...BASE_TASK, resolvedAt: AT2 },
      },
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_TASK_LIFECYCLE")).toBe(true);
  });

  it("resolved task must have resolvedAt → INTRIGUE_TASK_LIFECYCLE", () => {
    const s = makeBaseState();
    const input = {
      ...makeInput(s),
      haremInvestigationTasks: {
        "itask_000001": { ...BASE_TASK, status: "resolved" as const, leadId: "ilead_000001" },
      },
      haremInvestigationLeads: {
        "ilead_000001": BASE_LEAD,
      },
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_TASK_LIFECYCLE")).toBe(true);
  });

  it("pending task → case.status must be in_progress → INTRIGUE_TASK_CASE_STATUS", () => {
    const s = makeBaseState(); // case is "open"
    const input = {
      ...makeInput(s),
      haremInvestigationTasks: {
        "itask_000001": BASE_TASK,
      },
      haremInvestigationNextSeq: 2,
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_TASK_CASE_STATUS")).toBe(true);
  });

  it("in_progress case must have exactly one pending task → INTRIGUE_CASE_PENDING_TASK_COUNT", () => {
    const s = makeBaseState();
    const caseId = "icase_ireport_integ_001";
    const cases = s.haremInvestigationCases.map((c) =>
      c.id === caseId ? { ...c, status: "in_progress" as const } : c,
    );
    const input = {
      ...makeInput({ ...s, haremInvestigationCases: cases }),
      haremInvestigationTasks: {}, // no pending tasks
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_CASE_PENDING_TASK_COUNT")).toBe(true);
  });

  it("closed_confirmed without confirmedCulpritId → INTRIGUE_CASE_MISSING_CULPRIT", () => {
    const s = makeBaseState();
    const caseId = "icase_ireport_integ_001";
    const cases = s.haremInvestigationCases.map((c) =>
      c.id === caseId
        ? { ...c, status: "closed_confirmed" as const, closedAt: AT2, closureReason: "culprit_confirmed" as const }
        : c,
    );
    const errs = validateHaremInvestigationLinks({ ...makeInput(s), haremInvestigationCases: cases });
    expect(errs.some((e) => e.code === "INTRIGUE_CASE_MISSING_CULPRIT")).toBe(true);
  });

  it("confirmedCulpritId not in suspectIds → INTRIGUE_CASE_CULPRIT_NOT_SUSPECT", () => {
    const s = makeBaseState();
    const caseId = "icase_ireport_integ_001";
    const cases = s.haremInvestigationCases.map((c) =>
      c.id === caseId
        ? {
            ...c,
            status: "closed_confirmed" as const,
            closedAt: AT2,
            closureReason: "culprit_confirmed" as const,
            confirmedCulpritId: "somebody_else", // not in suspectIds
          }
        : c,
    );
    const errs = validateHaremInvestigationLinks({ ...makeInput(s), haremInvestigationCases: cases });
    expect(errs.some((e) => e.code === "INTRIGUE_CASE_CULPRIT_NOT_SUSPECT")).toBe(true);
  });

  it("haremInvestigationNextSeq too low → INTRIGUE_SEQ_TOO_LOW", () => {
    const s = makeBaseState();
    const input = {
      ...makeInput(s),
      haremInvestigationTasks: {
        "itask_000005": { ...BASE_TASK, id: "itask_000005" },
      },
      haremInvestigationCases: s.haremInvestigationCases.map((c) =>
        c.id === BASE_TASK.caseId ? { ...c, status: "in_progress" as const } : c,
      ),
      haremInvestigationNextSeq: 5, // should be > 5 (i.e., 6 or more)
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_SEQ_TOO_LOW")).toBe(true);
  });

  it("Record key ≠ object id → INTRIGUE_TASK_KEY_MISMATCH", () => {
    const s = makeBaseState();
    const input = {
      ...makeInput(s),
      haremInvestigationTasks: {
        "itask_000099": { ...BASE_TASK, id: "itask_000001" }, // key ≠ id
      },
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_TASK_KEY_MISMATCH")).toBe(true);
  });

  it("case.leadIds contains unknown lead → INTRIGUE_LEAD_MISSING", () => {
    const s = makeBaseState();
    const caseId = "icase_ireport_integ_001";
    const cases = s.haremInvestigationCases.map((c) =>
      c.id === caseId ? { ...c, leadIds: ["ilead_000099"] } : c,
    );
    const errs = validateHaremInvestigationLinks({ ...makeInput(s), haremInvestigationCases: cases });
    expect(errs.some((e) => e.code === "INTRIGUE_LEAD_MISSING")).toBe(true);
  });
});

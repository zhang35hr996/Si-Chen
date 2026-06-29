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

  it("resolved task leadId points to lead with different caseId → INTRIGUE_TASK_LEAD_CASE_MISMATCH", () => {
    const s = makeBaseState();
    const wrongCaseLead = { ...BASE_LEAD, id: "ilead_000001", caseId: "icase_other" };
    const input = {
      ...makeInput(s),
      haremInvestigationTasks: {
        "itask_000001": { ...BASE_TASK, status: "resolved" as const, resolvedAt: AT2, leadId: "ilead_000001" },
      },
      haremInvestigationLeads: { "ilead_000001": wrongCaseLead },
      haremInvestigationNextSeq: 2,
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_TASK_LEAD_CASE_MISMATCH")).toBe(true);
  });

  it("lead exists but is not in case.leadIds → INTRIGUE_LEAD_NOT_IN_CASE", () => {
    const s = makeBaseState();
    // lead points to correct case, but case.leadIds doesn't include it
    const input = {
      ...makeInput(s),
      haremInvestigationLeads: { "ilead_000001": BASE_LEAD },
      haremInvestigationNextSeq: 2,
    };
    const errs = validateHaremInvestigationLinks(input);
    expect(errs.some((e) => e.code === "INTRIGUE_LEAD_NOT_IN_CASE")).toBe(true);
  });
});

// ── 5B-2B2a：证据线索 sourceEvidenceNodeId / claims 引用完整性 ──────────
describe("5B-2B2a: evidence lead reference integrity", () => {
  const EAT = makeGameTime(1, 1, "early");
  const TRUTH = {
    id: "itruth_inc_ev", incidentId: "inc_ev", eventFamily: "heir_health_anomaly",
    causeType: "natural_illness", culpritIds: [], accusedIds: [], framingTargetIds: [],
    method: "none", motive: "none", concealment: 0,
    evidenceNodes: [{
      id: "n_med", type: "medical", factCode: "diag",
      claims: [{ kind: "supports_cause", causeType: "natural_illness" }],
      difficulty: 10, decayPerPeriod: 0, discoverableBy: ["medical_examination"],
      prerequisiteEvidenceIds: [], misleading: false,
    }],
    generatedAt: EAT, sourceKey: "k",
  };
  const EV_CASE = {
    id: "icase_ev", source: { kind: "investigation_incident", reportId: "iarep_ev", incidentId: "inc_ev" },
    openedAt: EAT, openedFromReportKind: "anomaly", status: "open",
    knownTargetIds: ["heir_001"], suspectIds: ["lu_huaijin"], suspectedKinds: [],
    confidence: "plausible", leadIds: ["ilead_000001"],
  };
  const LEGACY_CASE = {
    id: "icase_leg", source: { kind: "legacy_intrigue", reportId: "ireport_leg", incidentId: "inc_leg" },
    openedAt: EAT, openedFromReportKind: "exposure", status: "open",
    knownTargetIds: ["x"], suspectIds: [], suspectedKinds: [], confidence: "tenuous", leadIds: ["ilead_000002"],
  };

  function codesFor(leads: Record<string, unknown>, cases: unknown[] = [EV_CASE]) {
    return validateHaremInvestigationLinks({
      haremIntrigueReports: [],
      haremInvestigationCases: cases,
      haremInvestigationTasks: {},
      haremInvestigationLeads: leads,
      haremInvestigationNextSeq: 999,
      incidentIds: new Set(),
      investigationPublicReports: [],
      investigationIncidentIds: new Set(["inc_ev"]),
      investigationTruths: [TRUTH],
    } as unknown as Parameters<typeof validateHaremInvestigationLinks>[0]).map((e) => e.code);
  }

  const evLead = (over: Record<string, unknown>) => ({
    id: "ilead_000001", caseId: "icase_ev", discoveredAt: EAT, method: "medical_examination",
    summaryCode: "evidence_diag", strength: "plausible", implicatedIds: [], clearedIds: [], revealedKinds: [],
    ...over,
  });

  it("LV-01: sourceEvidenceNodeId 指向不存在节点 → ORPHAN_NODE", () => {
    expect(codesFor({ ilead_000001: evLead({ sourceEvidenceNodeId: "ghost" }) })).toContain("INTRIGUE_LEAD_EVIDENCE_ORPHAN_NODE");
  });

  it("LV-02: 节点 discoverableBy 不含 lead.method → METHOD_MISMATCH", () => {
    expect(codesFor({ ilead_000001: evLead({ sourceEvidenceNodeId: "n_med", method: "obtain_testimony" }) })).toContain("INTRIGUE_LEAD_EVIDENCE_METHOD_MISMATCH");
  });

  it("LV-03: 同案件同节点重复发现 → DUP_NODE", () => {
    const leads = {
      ilead_000001: evLead({ sourceEvidenceNodeId: "n_med" }),
      ilead_000003: evLead({ id: "ilead_000003", sourceEvidenceNodeId: "n_med" }),
    };
    const caseWithBoth = { ...EV_CASE, leadIds: ["ilead_000001", "ilead_000003"] };
    expect(codesFor(leads, [caseWithBoth])).toContain("INTRIGUE_LEAD_EVIDENCE_DUP_NODE");
  });

  it("LV-04: 旧宫斗案件线索携带 sourceEvidenceNodeId → EVIDENCE_ON_LEGACY", () => {
    const legacyLead = { id: "ilead_000002", caseId: "icase_leg", discoveredAt: EAT, method: "quiet_inquiry", summaryCode: "x", strength: "tenuous", implicatedIds: [], clearedIds: [], revealedKinds: [], sourceEvidenceNodeId: "n_med" };
    expect(codesFor({ ilead_000002: legacyLead }, [LEGACY_CASE])).toContain("INTRIGUE_LEAD_EVIDENCE_ON_LEGACY");
  });

  it("LV-05: claims 与 implicatedIds 不一致 → CLAIM_MISMATCH", () => {
    const lead = evLead({ sourceEvidenceNodeId: "n_med", implicatedIds: ["someone"], claims: [] });
    expect(codesFor({ ilead_000001: lead })).toContain("INTRIGUE_LEAD_CLAIM_MISMATCH");
  });

  it("LV-06: 合法证据线索无以上任何错误", () => {
    const lead = evLead({ sourceEvidenceNodeId: "n_med", claims: [{ kind: "supports_cause", causeType: "natural_illness" }] });
    const codes = codesFor({ ilead_000001: lead });
    for (const c of ["INTRIGUE_LEAD_EVIDENCE_ORPHAN_NODE", "INTRIGUE_LEAD_EVIDENCE_METHOD_MISMATCH", "INTRIGUE_LEAD_EVIDENCE_DUP_NODE", "INTRIGUE_LEAD_EVIDENCE_ON_LEGACY", "INTRIGUE_LEAD_CLAIM_MISMATCH"]) {
      expect(codes).not.toContain(c);
    }
  });
});

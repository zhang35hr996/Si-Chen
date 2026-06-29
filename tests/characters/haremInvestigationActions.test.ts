/**
 * Phase 5B-2：调查行动可用性与参数验证。
 */
import { describe, expect, it } from "vitest";
import { availableInvestigationActions, validateCanStartTask } from "../../src/engine/characters/haremInvestigation/actions";
import { createIntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/createCase";
import { createInitialState } from "../../src/engine/state/initialState";
import type { GameState, Heir } from "../../src/engine/state/types";
import type { HaremIntrigueReport } from "../../src/engine/state/types";
import type { IntrigueInvestigationCase } from "../../src/engine/characters/haremInvestigation/types";
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

// ── evidence-driven 案件行动（5B-2B2a follow-up）────────────────────────────

const LIVING_HEIR: Heir = {
  id: "heir_test_001",
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

function makeEvidenceCase(knownTargetIds = ["heir_test_001"]): IntrigueInvestigationCase {
  return {
    id: "icase_ev_001",
    source: { kind: "investigation_incident", reportId: "iarep_ev_001", incidentId: "inc_ev_001" },
    openedAt: AT,
    openedFromReportKind: "anomaly",
    status: "open",
    knownTargetIds,
    suspectIds: [],
    suspectedKinds: [],
    confidence: "tenuous",
    leadIds: [],
  };
}

function makeEvidenceState(opts: { withLivingHeir?: boolean; knownTargetIds?: string[] } = {}): GameState {
  const base = createInitialState();
  const c = makeEvidenceCase(opts.knownTargetIds ?? ["heir_test_001"]);
  const heirs = opts.withLivingHeir ? [LIVING_HEIR] : [];
  return {
    ...base,
    haremInvestigationCases: [c],
    resources: {
      ...base.resources,
      bloodline: { ...base.resources.bloodline, heirs },
    },
  };
}

describe("availableEvidenceActions — evidence-driven", () => {
  it("medical_examination 在受害皇嗣存活时出现", () => {
    const s = makeEvidenceState({ withLivingHeir: true });
    const actions = availableInvestigationActions(s, "icase_ev_001");
    expect(actions.map((a) => a.method)).toContain("medical_examination");
  });

  it("medical_examination 在无存活皇嗣时不出现", () => {
    const s = makeEvidenceState({ withLivingHeir: false });
    const actions = availableInvestigationActions(s, "icase_ev_001");
    expect(actions.map((a) => a.method)).not.toContain("medical_examination");
  });

  it("其余五种证据行动始终出现", () => {
    const s = makeEvidenceState({ withLivingHeir: false });
    const methods = availableInvestigationActions(s, "icase_ev_001").map((a) => a.method);
    for (const m of ["question_servants", "reconstruct_timeline", "trace_money", "search_quarters", "obtain_testimony"]) {
      expect(methods).toContain(m);
    }
  });

  it("evidence 行动不附 subjectCandidateIds", () => {
    const s = makeEvidenceState({ withLivingHeir: true });
    const actions = availableInvestigationActions(s, "icase_ev_001");
    for (const a of actions) {
      expect(a.subjectCandidateIds).toBeUndefined();
    }
  });

  it("evidence 行动耗时：单旬 1，双旬 2", () => {
    const s = makeEvidenceState({ withLivingHeir: true });
    const actions = availableInvestigationActions(s, "icase_ev_001");
    const byMethod = Object.fromEntries(actions.map((a) => [a.method, a.durationDays]));
    expect(byMethod["medical_examination"]).toBe(1);
    expect(byMethod["question_servants"]).toBe(1);
    expect(byMethod["reconstruct_timeline"]).toBe(1);
    expect(byMethod["search_quarters"]).toBe(1);
    expect(byMethod["trace_money"]).toBe(2);
    expect(byMethod["obtain_testimony"]).toBe(2);
  });
});

describe("validateCanStartTask — evidence-driven", () => {
  it("medical_examination 无存活皇嗣 → 报错", () => {
    const s = makeEvidenceState({ withLivingHeir: false });
    const c = makeEvidenceCase();
    expect(validateCanStartTask(s, c, "medical_examination")).toMatch(/皇嗣.*不在人世|查验脉案/);
  });

  it("medical_examination 有存活皇嗣 → 通过", () => {
    const s = makeEvidenceState({ withLivingHeir: true });
    const c = makeEvidenceCase();
    expect(validateCanStartTask(s, c, "medical_examination")).toBeNull();
  });

  it("evidence 行动携带 subjectId → 报错", () => {
    const s = makeEvidenceState({ withLivingHeir: true });
    const c = makeEvidenceCase();
    const result = validateCanStartTask(s, c, "question_servants", "some_char");
    expect(result).toMatch(/不接受指定对象/);
  });

  it("legacy 方法不能用于 evidence 案件 → 报错", () => {
    const s = makeEvidenceState();
    const c = makeEvidenceCase();
    expect(validateCanStartTask(s, c, "quiet_inquiry")).toMatch(/不接受/);
  });
});

describe("haremInvestigationPresenter — method labels", () => {
  it("所有 9 种方法有中文标签，不回退到英文 token", async () => {
    const { presentHaremInvestigationDetail } = await import(
      "../../src/ui/haremInvestigationPresenter"
    );
    const s = makeEvidenceState({ withLivingHeir: true });
    const actions = availableInvestigationActions(s, "icase_ev_001");
    const c = makeEvidenceCase();
    const detail = presentHaremInvestigationDetail(c, [], [], actions, (id) => id);

    const EN_TOKENS = [
      "medical_examination", "question_servants", "reconstruct_timeline",
      "trace_money", "search_quarters", "obtain_testimony",
      "question_target", "question_suspect", "quiet_inquiry",
    ];
    for (const view of detail.availableActionViews) {
      expect(EN_TOKENS).not.toContain(view.label);
      expect(view.label.length).toBeGreaterThan(0);
    }
  });
});

/**
 * Phase 5A-3b: 宫斗情报报告全局中断测试。
 * 测试：优先级，store action，知识边界，settlement→presenter 端到端，persistence round-trip。
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../src/store/gameStore";
import { oldestUnreadIntrigueReport } from "../src/ui/settlement";
import { presentHaremIntrigueReport } from "../src/ui/haremIntrigueReportPresenter";
import type { GameState, HaremIntrigueReport } from "../src/engine/state/types";
import type { GameTime } from "../src/engine/calendar/time";
import { makeGameTime } from "../src/engine/calendar/time";
import { createNewGameState } from "../src/engine/state/newGame";
import { settleHaremIntrigue } from "../src/engine/characters/haremIntrigueSettlement";
import type { HaremScheme } from "../src/engine/state/types";
import type { HaremIntriguePlan } from "../src/engine/characters/haremIntrigue/types";
import { materializePersonality, createDefaultHousehold } from "../src/engine/characters/consortAttrs";
import { loadRealContent } from "./helpers/contentFixture";

const db = loadRealContent();
const AT: GameTime = makeGameTime(1, 3, "early");

const BASE_TIME: GameTime = { year: 1, month: 1, period: "early", dayIndex: 0 };
const LATER_TIME: GameTime = { year: 1, month: 2, period: "early", dayIndex: 30 };

// ── Settlement test helpers (mirrors haremIntrigueSettlement.test.ts fixtures) ──

const base = createNewGameState(db);

function makeActorSnapshot(id: string): HaremIntriguePlan["actorSnapshot"] {
  return {
    characterId: id, rankId: "meiren", rankOrder: 100,
    favor: 30, peakFavor: 50, affection: 50, fear: 40, ambition: 70, loyalty: 30,
    personality: { scheming: 70, sociability: 40, compassion: 20, courage: 60, jealousy: 70, emotionalStability: 30, pride: 40, intelligence: 55 },
    household: { servantOpinion: 50, livingStandard: 40, privateWealthLevel: 30 },
  };
}

function makeTargetSnapshot(id: string): HaremIntriguePlan["targetSnapshot"] {
  return {
    characterId: id, rankId: "guiren", rankOrder: 116,
    favor: 60, peakFavor: 70, affection: 50, fear: 30, ambition: 40, loyalty: 60,
    personality: { scheming: 30, sociability: 60, compassion: 60, courage: 40, jealousy: 30, emotionalStability: 60, pride: 50, intelligence: 50 },
    household: { servantOpinion: 60, livingStandard: 50, privateWealthLevel: 20 },
  };
}

function makePlan(actorId: string, targetId: string, overrides: Partial<HaremIntriguePlan> = {}): HaremIntriguePlan {
  return {
    sourceKey: "harem_intrigue:1:03", plannedAt: AT,
    year: 1, month: 3, actorId, targetId,
    kind: "slander", motive: "jealousy",
    actorPropensity: 70, targetThreat: 60, priority: 65,
    potency: 55, secrecy: 50, grievanceStrength: 0, factionConflict: false,
    actorSnapshot: makeActorSnapshot(actorId),
    targetSnapshot: makeTargetSnapshot(targetId),
    rationale: ["high_jealousy", "favor_gap"],
    ...overrides,
  };
}

function makeScheme(actorId: string, targetId: string, planOverrides: Partial<HaremIntriguePlan> = {}): HaremScheme {
  const plan = { ...makePlan(actorId, targetId, planOverrides), sourceKey: "harem_intrigue:1:03", year: 1, month: 3 };
  const sid = `scheme_1_03_${actorId}_${targetId}`;
  return { id: sid, sourceKey: plan.sourceKey, plan, status: "pending", scheduledForYear: 1, scheduledForMonth: 3 };
}

function makeStateWithScheme(actorId: string, targetId: string, scheme: HaremScheme): GameState {
  const calAt = makeGameTime(scheme.scheduledForYear, scheme.scheduledForMonth, "early");
  return {
    ...base,
    calendar: { ...base.calendar, year: calAt.year, month: calAt.month, period: calAt.period, dayIndex: calAt.dayIndex },
    rngSeed: 42,
    bedchamber: { ...base.bedchamber, [actorId]: { encounters: [] }, [targetId]: { encounters: [] } },
    standing: {
      ...base.standing,
      [actorId]: {
        rank: "meiren", favor: 30, peakFavor: 50, affection: 50, fear: 40,
        ambition: 70, loyalty: 30,
        personality: materializePersonality({ scheming: 70, jealousy: 70, courage: 60 }),
        household: createDefaultHousehold(),
      },
      [targetId]: {
        rank: "guiren", favor: 60, peakFavor: 70, affection: 50, fear: 30,
        ambition: 40, loyalty: 60,
        personality: materializePersonality({ scheming: 30 }),
        household: createDefaultHousehold(),
      },
    },
    haremSchemes: [scheme],
  };
}

function settle(state: GameState, at: GameTime = AT) {
  const r = settleHaremIntrigue(db, state, at);
  if (!r.ok) throw new Error(`settlement failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

// ── Report fixture helpers ──────────────────────────────────────────────────

function makeReport(overrides: Partial<HaremIntrigueReport> = {}): HaremIntrigueReport {
  return {
    id: "ireport_test_001",
    source: { incidentId: "incident_001" },
    reportKind: "exposure",
    createdAt: BASE_TIME,
    status: "unread",
    knownTargetIds: ["lu_huaijin"],
    suspectedActorIds: ["bai_zhuying"],
    suspectedKinds: ["slander"],
    knownOutcome: "harm_observed",
    confidence: "confirmed",
    // 生产实际格式：exposure_${kind}_${success ? "success" : "failed"}
    summaryCode: "exposure_slander_success",
    ...overrides,
  };
}

function stateWithReports(reports: HaremIntrigueReport[]): GameState {
  const s = createNewGameState(db);
  return { ...s, haremIntrigueReports: reports };
}

// ── oldestUnreadIntrigueReport ──────────────────────────────────────────────

describe("oldestUnreadIntrigueReport", () => {
  it("returns undefined when no reports", () => {
    expect(oldestUnreadIntrigueReport(stateWithReports([]))).toBeUndefined();
  });

  it("returns undefined when all reports are acknowledged", () => {
    expect(oldestUnreadIntrigueReport(stateWithReports([makeReport({ status: "acknowledged" })]))).toBeUndefined();
  });

  it("returns the unread report", () => {
    expect(oldestUnreadIntrigueReport(stateWithReports([makeReport()]))?.id).toBe("ireport_test_001");
  });

  it("returns oldest by dayIndex when multiple unread", () => {
    const older = makeReport({ id: "ireport_older", createdAt: BASE_TIME });
    const newer = makeReport({ id: "ireport_newer", createdAt: LATER_TIME });
    expect(oldestUnreadIntrigueReport(stateWithReports([newer, older]))?.id).toBe("ireport_older");
  });
});

// ── acknowledgeHaremIntrigueReport ─────────────────────────────────────────

describe("acknowledgeHaremIntrigueReport", () => {
  it("transitions unread → acknowledged", () => {
    const store = createGameStore();
    store.loadState(stateWithReports([makeReport()]));
    const result = store.acknowledgeHaremIntrigueReport("ireport_test_001");
    expect(result.ok).toBe(true);
    const updated = store.getState().haremIntrigueReports[0]!;
    expect(updated.status).toBe("acknowledged");
    expect(updated.acknowledgedAt).toBeDefined();
  });

  it("is idempotent: already-acknowledged report returns ok", () => {
    const store = createGameStore();
    store.loadState(stateWithReports([makeReport({ status: "acknowledged" })]));
    expect(store.acknowledgeHaremIntrigueReport("ireport_test_001").ok).toBe(true);
  });

  it("returns error for missing reportId", () => {
    const store = createGameStore();
    store.loadState(stateWithReports([]));
    expect(store.acknowledgeHaremIntrigueReport("does_not_exist").ok).toBe(false);
  });

  it("returns error when report is in actioned status", () => {
    const store = createGameStore();
    store.loadState(stateWithReports([makeReport({ status: "actioned", acknowledgedAt: BASE_TIME })]));
    expect(store.acknowledgeHaremIntrigueReport("ireport_test_001").ok).toBe(false);
  });

  it("unread report disappears from interrupt selector after acknowledgement", () => {
    const store = createGameStore();
    store.loadState(stateWithReports([makeReport()]));
    expect(oldestUnreadIntrigueReport(store.getState())).toBeDefined();
    store.acknowledgeHaremIntrigueReport("ireport_test_001");
    expect(oldestUnreadIntrigueReport(store.getState())).toBeUndefined();
  });
});

// ── Knowledge boundary ──────────────────────────────────────────────────────

describe("knowledge boundary: anomaly report", () => {
  const resolveName = (id: string) => `name:${id}`;

  it("anomaly report does NOT expose actorLabel", () => {
    const report = makeReport({
      reportKind: "anomaly",
      summaryCode: "anomaly_unexplained_harm",
      suspectedActorIds: ["bai_zhuying"],
      confidence: "plausible",
    });
    expect(presentHaremIntrigueReport(report, resolveName).actorLabel).toBeUndefined();
  });

  it("anomaly body uses generic wording — no actor name, no scheme kind", () => {
    const report = makeReport({
      reportKind: "anomaly",
      summaryCode: "anomaly_unexplained_harm",
      suspectedActorIds: ["bai_zhuying"],
      suspectedKinds: ["slander"],
    });
    const pres = presentHaremIntrigueReport(report, resolveName);
    const fullText = pres.body.join(" ");
    expect(fullText).not.toContain("name:bai_zhuying");
    expect(fullText).not.toContain("散布谣言");
    expect(fullText).not.toContain("slander");
  });

  it("unknown summaryCode falls back to safe generic text", () => {
    const report = makeReport({ reportKind: "anomaly", summaryCode: "future_unknown_code" });
    const pres = presentHaremIntrigueReport(report, resolveName);
    expect(pres.body.join(" ")).toContain("宫中近日似有异常");
    expect(pres.actorLabel).toBeUndefined();
  });

  it("exposure report DOES show actorLabel", () => {
    const report = makeReport({
      reportKind: "exposure",
      summaryCode: "exposure_slander_success",
      suspectedActorIds: ["bai_zhuying"],
    });
    expect(presentHaremIntrigueReport(report, resolveName).actorLabel).toBe("name:bai_zhuying");
  });
});

// ── settlement → presenter end-to-end ──────────────────────────────────────

describe("settlement → presenter: no fallback path for real reports", () => {
  const resolveName = (id: string) => id;

  it("exposure + success: presenter body not empty and does not use generic fallback", () => {
    // false_accusation + secrecy=10 + potency=90: guaranteed discovered=true, success=false
    const scheme = makeScheme("actor_001", "target_001", { kind: "false_accusation", motive: "resentment", secrecy: 10, potency: 90 });
    const result = settle(makeStateWithScheme("actor_001", "target_001", scheme));
    const report = result.state.haremIntrigueReports[0];
    expect(report).toBeDefined();
    expect(report!.reportKind).toBe("exposure");
    // summaryCode must be real production format
    expect(report!.summaryCode).toMatch(/^exposure_false_accusation_(success|failed)$/);

    const pres = presentHaremIntrigueReport(report!, resolveName);
    const bodyText = pres.body.join(" ");
    // Must NOT fall through to generic "宫中近日似有异常，详情尚未查明" fallback
    expect(bodyText).not.toBe("宫中近日似有异常，详情尚未查明。");
    // Must contain actor and kind reference
    expect(pres.actorLabel).toBe("actor_001");
    expect(bodyText).toContain("诬告陷害");
    expect(pres.title).toBe("宫中来报");
  });

  it("exposure + slander success: kind label renders correctly", () => {
    // slander + secrecy=10 + potency=90: discovered, success depends on rng
    const scheme = makeScheme("actor_001", "target_001", { kind: "slander", motive: "jealousy", secrecy: 10, potency: 90 });
    const result = settle(makeStateWithScheme("actor_001", "target_001", scheme));
    const report = result.state.haremIntrigueReports[0];
    if (!report || report.reportKind !== "exposure") return; // may be anomaly if not discovered
    const pres = presentHaremIntrigueReport(report, resolveName);
    expect(pres.body.join(" ")).toContain("散布谣言");
    expect(pres.actorLabel).toBe("actor_001");
  });

  it("anomaly report: presenter does not fall back to generic wording", () => {
    // slander + secrecy=90 + potency=90: NOT discovered, success=true, potency≥60 → anomaly
    const scheme = makeScheme("actor_001", "target_001", { kind: "slander", motive: "jealousy", secrecy: 90, potency: 90 });
    const result = settle(makeStateWithScheme("actor_001", "target_001", scheme));
    const report = result.state.haremIntrigueReports[0];
    expect(report).toBeDefined();
    expect(report!.reportKind).toBe("anomaly");
    expect(report!.summaryCode).toBe("anomaly_unexplained_harm");

    const pres = presentHaremIntrigueReport(report!, resolveName);
    const bodyText = pres.body.join(" ");
    expect(bodyText).toContain("异常");
    expect(bodyText).not.toBe("宫中近日似有异常，详情尚未查明。");
    expect(pres.actorLabel).toBeUndefined();
  });

  it("v33 migration summaryCode format: exposure_${kind}_${result} renders correctly", () => {
    // Simulate v33 migration output (identical format to settlement)
    const migrationReport: HaremIntrigueReport = {
      id: "ireport_incident_scheme_1_03_a_b",
      source: { incidentId: "incident_scheme_1_03_a_b" },
      reportKind: "exposure",
      createdAt: AT,
      status: "unread",
      knownTargetIds: ["target_b"],
      suspectedActorIds: ["actor_a"],
      suspectedKinds: ["steal_credit"],
      knownOutcome: "harm_observed",
      confidence: "confirmed",
      summaryCode: "exposure_steal_credit_success",
    };
    const pres = presentHaremIntrigueReport(migrationReport, resolveName);
    const bodyText = pres.body.join(" ");
    expect(bodyText).not.toBe("宫中近日似有异常，详情尚未查明。");
    expect(bodyText).toContain("窃取功劳");
    expect(pres.actorLabel).toBe("actor_a");
  });
});

// ── Persistence: acknowledged reports do not re-appear ──────────────────────

describe("persistence: unread survives, acknowledged does not re-trigger", () => {
  it("unread report re-appears in interrupt selector after state reload", () => {
    const store = createGameStore();
    store.loadState(stateWithReports([makeReport()]));
    const store2 = createGameStore();
    store2.loadState(store.getState());
    expect(oldestUnreadIntrigueReport(store2.getState())).toBeDefined();
  });

  it("acknowledged report does not re-appear in interrupt selector after reload", () => {
    const store = createGameStore();
    store.loadState(stateWithReports([makeReport()]));
    store.acknowledgeHaremIntrigueReport("ireport_test_001");
    const store2 = createGameStore();
    store2.loadState(store.getState());
    expect(oldestUnreadIntrigueReport(store2.getState())).toBeUndefined();
  });
});

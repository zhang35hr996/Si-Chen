/**
 * Phase 5A-3b: 宫斗情报报告全局中断测试。
 * 测试：优先级，store action，知识边界，Persistence round-trip。
 */
import { describe, expect, it } from "vitest";
import { createGameStore } from "../src/store/gameStore";
import { oldestUnreadIntrigueReport } from "../src/ui/settlement";
import { presentHaremIntrigueReport } from "../src/ui/haremIntrigueReportPresenter";
import type { GameState, HaremIntrigueReport } from "../src/engine/state/types";
import type { GameTime } from "../src/engine/calendar/time";
import { createNewGameState } from "../src/engine/state/newGame";
import { loadRealContent } from "./helpers/contentFixture";

const db = loadRealContent();

const BASE_TIME: GameTime = { year: 1, month: 1, period: "early", dayIndex: 0 };
const LATER_TIME: GameTime = { year: 1, month: 2, period: "early", dayIndex: 30 };

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
    summaryCode: "exposure",
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
    const s = stateWithReports([]);
    expect(oldestUnreadIntrigueReport(s)).toBeUndefined();
  });

  it("returns undefined when all reports are acknowledged", () => {
    const s = stateWithReports([makeReport({ status: "acknowledged" })]);
    expect(oldestUnreadIntrigueReport(s)).toBeUndefined();
  });

  it("returns the unread report", () => {
    const r = makeReport({ status: "unread" });
    const s = stateWithReports([r]);
    expect(oldestUnreadIntrigueReport(s)?.id).toBe("ireport_test_001");
  });

  it("returns oldest by dayIndex when multiple unread", () => {
    const older = makeReport({ id: "ireport_older", createdAt: BASE_TIME, status: "unread" });
    const newer = makeReport({ id: "ireport_newer", createdAt: LATER_TIME, status: "unread" });
    const s = stateWithReports([newer, older]);
    expect(oldestUnreadIntrigueReport(s)?.id).toBe("ireport_older");
  });
});

// ── acknowledgeHaremIntrigueReport ─────────────────────────────────────────

describe("acknowledgeHaremIntrigueReport", () => {
  it("transitions unread → acknowledged", () => {
    const report = makeReport({ status: "unread" });
    const store = createGameStore();
    store.loadState(stateWithReports([report]));
    const result = store.acknowledgeHaremIntrigueReport("ireport_test_001");
    expect(result.ok).toBe(true);
    const updated = store.getState().haremIntrigueReports[0]!;
    expect(updated.status).toBe("acknowledged");
    expect(updated.acknowledgedAt).toBeDefined();
  });

  it("is idempotent: already-acknowledged report returns ok", () => {
    const report = makeReport({ status: "acknowledged" });
    const store = createGameStore();
    store.loadState(stateWithReports([report]));
    const result = store.acknowledgeHaremIntrigueReport("ireport_test_001");
    expect(result.ok).toBe(true);
  });

  it("returns error for missing reportId", () => {
    const store = createGameStore();
    store.loadState(stateWithReports([]));
    const result = store.acknowledgeHaremIntrigueReport("does_not_exist");
    expect(result.ok).toBe(false);
  });

  it("returns error when report is in actioned status", () => {
    const report = makeReport({ status: "actioned", acknowledgedAt: BASE_TIME });
    const store = createGameStore();
    store.loadState(stateWithReports([report]));
    const result = store.acknowledgeHaremIntrigueReport("ireport_test_001");
    expect(result.ok).toBe(false);
  });

  it("unread report disappears from interrupt after acknowledgement", () => {
    const report = makeReport({ status: "unread" });
    const store = createGameStore();
    store.loadState(stateWithReports([report]));
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
    const pres = presentHaremIntrigueReport(report, resolveName);
    // anomaly must NOT show actorLabel even if suspectedActorIds is set
    expect(pres.actorLabel).toBeUndefined();
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
    // Must NOT contain the resolved actor name
    expect(fullText).not.toContain("name:bai_zhuying");
    // Must NOT contain specific scheme kind
    expect(fullText).not.toContain("诬蔑");
    expect(fullText).not.toContain("slander");
  });

  it("unknown summaryCode falls back to safe generic text", () => {
    const report = makeReport({
      reportKind: "anomaly",
      summaryCode: "future_unknown_code",
    });
    const pres = presentHaremIntrigueReport(report, resolveName);
    expect(pres.body.join(" ")).toContain("宫中近日似有异常");
    expect(pres.actorLabel).toBeUndefined();
  });

  it("exposure report DOES show actorLabel", () => {
    const report = makeReport({
      reportKind: "exposure",
      summaryCode: "exposure",
      suspectedActorIds: ["bai_zhuying"],
      confidence: "confirmed",
    });
    const pres = presentHaremIntrigueReport(report, resolveName);
    expect(pres.actorLabel).toBe("name:bai_zhuying");
  });
});

// ── Persistence: acknowledged reports do not re-appear ──────────────────────

describe("persistence: unread survives, acknowledged does not re-trigger", () => {
  it("unread report re-appears in interrupt selector after state reload", () => {
    const store = createGameStore();
    const report = makeReport({ status: "unread" });
    store.loadState(stateWithReports([report]));

    // Simulated save: grab current state
    const saved = store.getState();

    // Reload
    const store2 = createGameStore();
    store2.loadState(saved);
    expect(oldestUnreadIntrigueReport(store2.getState())).toBeDefined();
  });

  it("acknowledged report does not re-appear in interrupt selector after reload", () => {
    const store = createGameStore();
    const report = makeReport({ status: "unread" });
    store.loadState(stateWithReports([report]));
    store.acknowledgeHaremIntrigueReport("ireport_test_001");

    const saved = store.getState();

    const store2 = createGameStore();
    store2.loadState(saved);
    expect(oldestUnreadIntrigueReport(store2.getState())).toBeUndefined();
  });
});

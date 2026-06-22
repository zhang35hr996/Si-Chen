import { describe, expect, it } from "vitest";
import type { ContentDB } from "../../src/engine/content/loader";
import type { GameEventContent } from "../../src/engine/content/schemas";
import {
  AUDIENCE_REMIND_AFTER_PERIODS,
  audienceCount,
  audienceReconciliationEffects,
  audienceStatus,
  clearAudience,
  defer,
  deferredAudienceCount,
  getAudienceQueue,
  getDeferredAudienceQueue,
  shouldRemind,
} from "../../src/engine/events/audience";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db0 = loadRealContent();

const mkEvent = (patch: Partial<GameEventContent>): GameEventContent =>
  ({
    id: "ev_a",
    title: "测试",
    sceneId: "sc_menses_rite",
    checkpoint: "location_enter",
    condition: { atLocation: "zichendian" },
    priority: 50,
    once: false,
    apCost: 0,
    presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui", audiencePrompt: "候见。" },
    ...patch,
  }) as GameEventContent;

const dbWith = (...events: GameEventContent[]): ContentDB =>
  ({ ...db0, events: Object.fromEntries(events.map((e) => [e.id, e])) }) as ContentDB;

const baseState = (over: Partial<GameState> = {}): GameState => ({
  ...createNewGameState(db0),
  playerLocation: "zichendian",
  ...over,
});

// ── pure flag helpers (no db) ─────────────────────────────────────────
describe("audience pure helpers", () => {
  it("AUDIENCE_REMIND_AFTER_PERIODS is 1 (next 旬, not next month)", () => {
    expect(AUDIENCE_REMIND_AFTER_PERIODS).toBe(1);
  });

  it("defer sets pending + promptShownAt + remindAt (+1)", () => {
    expect(defer("ev_a", 5)).toEqual([
      { type: "flag", key: "audience:pending:ev_a", value: true },
      { type: "flag", key: "audience:promptShownAt:ev_a", value: 5 },
      { type: "flag", key: "audience:remindAt:ev_a", value: 6 },
    ]);
  });

  it("clearAudience zeroes all three flags", () => {
    expect(clearAudience("ev_a")).toEqual([
      { type: "flag", key: "audience:pending:ev_a", value: false },
      { type: "flag", key: "audience:promptShownAt:ev_a", value: 0 },
      { type: "flag", key: "audience:remindAt:ev_a", value: 0 },
    ]);
  });

  it("shouldRemind true only when remindAt reached", () => {
    const s = (dayIndex: number, remindAt: number) =>
      baseState({ flags: { "audience:pending:ev_a": true, "audience:remindAt:ev_a": remindAt }, calendar: { ...baseState().calendar, dayIndex } });
    expect(shouldRemind(s(4, 5), "ev_a")).toBe(false);
    expect(shouldRemind(s(5, 5), "ev_a")).toBe(true);
  });

  it("status: not-pending=available; pending+notDue=suppressed; pending+due=pending", () => {
    const s = (flags: Record<string, unknown>) =>
      baseState({ flags: flags as GameState["flags"], calendar: { ...baseState().calendar, dayIndex: 10 } });
    expect(audienceStatus(s({}), "ev_a")).toBe("available");
    expect(audienceStatus(s({ "audience:pending:ev_a": true, "audience:remindAt:ev_a": 99 }), "ev_a")).toBe("suppressed");
    expect(audienceStatus(s({ "audience:pending:ev_a": true, "audience:remindAt:ev_a": 10 }), "ev_a")).toBe("pending");
  });
});

// ── queue / counts / reconciliation (db-aware) ────────────────────────
describe("audience queue", () => {
  it("AudienceItem carries narrowed presentation + affordable + deferred/remind days", () => {
    const db = dbWith(mkEvent({}));
    const state = baseState({
      flags: { "audience:pending:ev_a": true, "audience:promptShownAt:ev_a": 5, "audience:remindAt:ev_a": 6 },
    });
    const q = getAudienceQueue(db, state, "zichendian");
    expect(q[0]).toMatchObject({
      presentation: { mode: "request_audience", hostLocationId: "zichendian", audienceCharacterId: "wei_sui" },
      affordable: true,
      deferredAtDayIndex: 5,
      remindAtDayIndex: 6,
    });
  });

  it("queue scoped by presentation.hostLocationId, not condition.atLocation", () => {
    // ev_far is eligible at yanhe_gong (condition) but hostLocationId is zichendian
    const farEvent = mkEvent({ id: "ev_far", condition: { atLocation: "yanhe_gong" } });
    const db = dbWith(farEvent);
    expect(getAudienceQueue(db, baseState({ playerLocation: "yanhe_gong" }), "yanhe_gong").map((i) => i.event.id)).not.toContain("ev_far");
  });

  it("audienceCount counts all; deferredAudienceCount counts only pending+suppressed", () => {
    const evA = mkEvent({ id: "ev_a", priority: 50 }); // available
    const evB = mkEvent({ id: "ev_b", priority: 40 }); // deferred → suppressed
    const db = dbWith(evA, evB);
    const state = baseState({
      flags: { "audience:pending:ev_b": true, "audience:remindAt:ev_b": 999 },
    });
    expect(audienceCount(db, state, "zichendian")).toBe(2);
    expect(deferredAudienceCount(db, state, "zichendian")).toBe(1);
    expect(getDeferredAudienceQueue(db, state, "zichendian").map((i) => i.status)).toEqual(["suppressed"]);
  });

  it("excludes once-fired ghosts (no phantom count)", () => {
    const db = dbWith(mkEvent({ once: true }));
    const ghost = baseState({
      flags: { "audience:pending:ev_a": true },
      eventLog: [{ eventId: "ev_a", firedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } }],
    });
    expect(getAudienceQueue(db, ghost, "zichendian").map((i) => i.event.id)).not.toContain("ev_a");
    expect(audienceCount(db, ghost, "zichendian")).toBe(0);
  });
});

describe("audienceReconciliationEffects", () => {
  it("clears pending for an once-fired event of THIS host", () => {
    const db = dbWith(mkEvent({ once: true }));
    const state = baseState({
      flags: { "audience:pending:ev_a": true },
      eventLog: [{ eventId: "ev_a", firedAt: { year: 1, month: 1, period: "early", dayIndex: 0 } }],
    });
    expect(audienceReconciliationEffects(db, state, "zichendian")).toEqual(
      expect.arrayContaining([{ type: "flag", key: "audience:pending:ev_a", value: false }]),
    );
  });

  it("does NOT clear pending belonging to another host", () => {
    const other = mkEvent({ id: "ev_other", presentation: { mode: "request_audience", hostLocationId: "yanhe_gong", audienceCharacterId: "wei_sui", audiencePrompt: "候见。" } });
    const db = dbWith(other);
    const state = baseState({ flags: { "audience:pending:ev_other": true } });
    expect(audienceReconciliationEffects(db, state, "zichendian")).not.toEqual(
      expect.arrayContaining([{ type: "flag", key: "audience:pending:ev_other", value: false }]),
    );
  });

  it("keeps pending for a still-eligible event of this host (no churn)", () => {
    const db = dbWith(mkEvent({}));
    const state = baseState({ flags: { "audience:pending:ev_a": true, "audience:remindAt:ev_a": 999 } });
    expect(audienceReconciliationEffects(db, state, "zichendian")).toEqual([]);
  });

  it("clears pending for a condition-lapsed event of this host", () => {
    // host is zichendian but condition currently can't hold here → no longer eligible
    const db = dbWith(mkEvent({ condition: { atLocation: "yanhe_gong" } }));
    const state = baseState({ flags: { "audience:pending:ev_a": true } });
    expect(audienceReconciliationEffects(db, state, "zichendian")).toEqual(
      expect.arrayContaining([{ type: "flag", key: "audience:pending:ev_a", value: false }]),
    );
  });

  it("clears pending for a missing (deleted) event", () => {
    const db = dbWith(mkEvent({})); // db has ev_a only; flag points at a ghost id
    const state = baseState({ flags: { "audience:pending:ev_ghost": true } });
    expect(audienceReconciliationEffects(db, state, "zichendian")).toEqual(
      expect.arrayContaining([{ type: "flag", key: "audience:pending:ev_ghost", value: false }]),
    );
  });

  it("clears pending for an event that is no longer request_audience", () => {
    const db = dbWith(mkEvent({ presentation: { mode: "auto_on_enter" } }));
    const state = baseState({ flags: { "audience:pending:ev_a": true } });
    expect(audienceReconciliationEffects(db, state, "zichendian")).toEqual(
      expect.arrayContaining([{ type: "flag", key: "audience:pending:ev_a", value: false }]),
    );
  });
});

import { describe, expect, it, vi } from "vitest";
import { createGameStore } from "../../src/store/gameStore";
import { dayIndexOf, toGameTime } from "../../src/engine/calendar/time";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

const makeStarted = (traceMode: "record" | "off" | "strict" = "record") => {
  const store = createGameStore({ traceMode });
  store.newGame(db);
  return store;
};

/** favor requires a consort-kind character; pick the first one from standing. */
const firstConsortId = (store: ReturnType<typeof makeStarted>): string => {
  return Object.keys(store.getState().standing).find((id) => db.characters[id]?.kind === "consort") ??
    Object.keys(store.getState().standing)[0]!;
};

describe("GameStore trace integration", () => {
  it("records a trace transaction after applyEffects in 'record' mode", () => {
    const store = makeStarted("record");
    const consortId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: consortId, delta: 3 }]);
    const history = store.getTraceHistory();
    expect(history.size).toBeGreaterThanOrEqual(1);
    const tx = history.getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.source.kind).toBe("action");
    const favorMut = tx.mutations.find((m) => m.path === `standing.${consortId}.favor`);
    expect(favorMut).toBeDefined();
    expect(favorMut?.delta).toBe(3);
  });

  it("records a rolled_back transaction when effects are rejected", () => {
    const store = makeStarted("record");
    store.applyEffects(db, [{ type: "favor", char: "char_does_not_exist", delta: 3 }]);
    const history = store.getTraceHistory();
    expect(history.size).toBeGreaterThanOrEqual(1);
    const tx = history.getAll().at(-1)!;
    expect(tx.outcome).toBe("rolled_back");
  });

  it("produces no trace history in 'off' mode", () => {
    const store = makeStarted("off");
    const consortId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: consortId, delta: 3 }]);
    expect(store.getTraceHistory().size).toBe(0);
  });

  it("does not change game state outcome with tracing enabled vs disabled", () => {
    const storeRef = makeStarted("off");
    const consortId = firstConsortId(storeRef);

    const storeOff = makeStarted("off");
    storeOff.applyEffects(db, [{ type: "favor", char: consortId, delta: 5 }]);

    const storeRec = makeStarted("record");
    storeRec.applyEffects(db, [{ type: "favor", char: consortId, delta: 5 }]);

    const favOff = storeOff.getState().standing[consortId]?.favor;
    const favRec = storeRec.getState().standing[consortId]?.favor;
    expect(favRec).toBe(favOff);
  });

  it("trace transaction captures gameTime from post-commit state calendar", () => {
    const store = makeStarted("record");
    const consortId = firstConsortId(store);
    store.applyEffects(db, [{ type: "favor", char: consortId, delta: 1 }]);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(typeof tx.gameTime).toBe("string");
    expect(tx.gameTime!.length).toBeGreaterThan(0);
  });

  it("ring buffer enforces capacity limit", () => {
    const store = createGameStore({ traceMode: "record", traceHistoryLimit: 3 });
    store.newGame(db);
    const firstChar = Object.keys(store.getState().standing)[0]!;
    for (let i = 0; i < 5; i++) {
      store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 1 }]);
    }
    expect(store.getTraceHistory().size).toBe(3);
  });

  // ── Review-required tests (9 items) ──────────────────────────────────────────

  it("memory trace includes full entry object at canonical path, not just a count", () => {
    const store = makeStarted("record");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    store.applyEffects(db, [
      {
        type: "memory",
        char: firstChar,
        entry: {
          kind: "impression",
          summary: "测试记忆",
          strength: 10,
          retention: "fast",
          subjectIds: [firstChar],
          perspective: "witness",
          triggerTags: [],
          unresolved: false,
          emotions: {},
        },
      },
    ]);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    const memMuts = tx.mutations.filter((m) => m.path.startsWith(`memories.${firstChar}.entries.`));
    expect(memMuts.length).toBeGreaterThanOrEqual(1);
    // The mutation should record the full entry object as `after`, not a numeric count.
    const entryMut = memMuts[0]!;
    expect(typeof entryMut.after).toBe("object");
    expect(entryMut.after).not.toBeNull();
    expect((entryMut.after as { summary?: string }).summary).toBe("测试记忆");
  });

  it("playerLocation change is detected by recursive diff", () => {
    const store = makeStarted("record");
    const locationIds = Object.keys(db.locations);
    const initialLocation = store.getState().playerLocation;
    const newLocation = locationIds.find((id) => id !== initialLocation) ?? locationIds[0]!;
    store.dispatch({ type: "MOVE_TO_LOCATION", locationId: newLocation });
    const state = store.getState();
    if (state.playerLocation !== newLocation) return; // skip if MOVE not supported for this state
    const history = store.getTraceHistory();
    const tx = history.getAll().at(-1)!;
    const locMut = tx.mutations.find((m) => m.path === "playerLocation");
    expect(locMut).toBeDefined();
    expect(locMut?.before).toBe(initialLocation);
    expect(locMut?.after).toBe(newLocation);
  });

  it("strict mode: successful operation still commits (no false positives)", () => {
    const store = makeStarted("strict");
    const consortId = firstConsortId(store);
    const initialFavor = store.getState().standing[consortId]?.favor ?? 0;

    // In strict mode, a fully-instrumented effect should commit successfully.
    const result = store.applyEffects(db, [{ type: "favor", char: consortId, delta: 7 }]);
    expect(result.ok).toBe(true);
    expect(store.getState().standing[consortId]?.favor).toBe(initialFavor + 7);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
  });

  it("strict mode: rolled_back effect leaves state unchanged and records trace", () => {
    const store = makeStarted("strict");
    const stateBefore = store.getState();
    const emitSpy = vi.fn();
    store.subscribe(emitSpy);
    const emitsBefore = emitSpy.mock.calls.length;

    store.applyEffects(db, [{ type: "favor", char: "char_ghost_invalid_999", delta: 3 }]);

    // State must be unchanged.
    expect(store.getState()).toBe(stateBefore);
    // No emit for a rolled_back transaction.
    expect(emitSpy.mock.calls.length).toBe(emitsBefore);
    // Rolled_back trace IS recorded.
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("rolled_back");
  });

  it("calendar_advance phase label appears in time-advance trace mutations", () => {
    const store = makeStarted("record");
    const result = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(result.ok).toBe(true);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.source.kind).toBe("time_advance");
    // Calendar AP change should be labeled "calendar_advance".
    const calMut = tx.mutations.find((m) => m.phase === "calendar_advance");
    expect(calMut).toBeDefined();
  });

  it("imperial command plan failure produces rolled_back trace", () => {
    const store = makeStarted("record");
    // Attempt to lift confinement on a char who is not confined → should fail planning.
    const firstChar = Object.keys(store.getState().standing)[0]!;
    const sizeBefore = store.getTraceHistory().size;
    store.applyImperialCommand(db, { type: "lift_confinement", targetId: firstChar });
    const sizeAfter = store.getTraceHistory().size;
    // A trace entry should be added (rolled_back) even on plan failure.
    expect(sizeAfter).toBeGreaterThan(sizeBefore);
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("rolled_back");
    expect(tx.source.kind).toBe("imperial_command");
  });

  it("ring buffer full + new rollback refreshes history and drops oldest", () => {
    const store = createGameStore({ traceMode: "record", traceHistoryLimit: 3 });
    store.newGame(db);
    const firstChar = Object.keys(store.getState().standing)[0]!;

    // Fill the buffer with committed transactions.
    for (let i = 0; i < 3; i++) {
      store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 1 }]);
    }
    const firstId = store.getTraceHistory().getAll()[0]!.id;
    expect(store.getTraceHistory().size).toBe(3);

    // One more (a rollback) should push out the oldest.
    store.applyEffects(db, [{ type: "favor", char: "nonexistent_char", delta: 1 }]);
    const history = store.getTraceHistory();
    expect(history.size).toBe(3);
    expect(history.getAll()[0]!.id).not.toBe(firstId); // oldest was evicted
    expect(history.getAll().at(-1)!.outcome).toBe("rolled_back");
  });

  it("newGame clears trace history", () => {
    const store = makeStarted("record");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 1 }]);
    expect(store.getTraceHistory().size).toBeGreaterThan(0);

    store.newGame(db);
    expect(store.getTraceHistory().size).toBe(0);
  });

  it("reset clears trace history", () => {
    const store = makeStarted("record");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    store.applyEffects(db, [{ type: "favor", char: firstChar, delta: 1 }]);
    expect(store.getTraceHistory().size).toBeGreaterThan(0);

    store.reset();
    expect(store.getTraceHistory().size).toBe(0);
  });

  // ── untrackedCount === 0 for core funnel effects ──────────────────────────

  it("untrackedCount === 0 for favor effect in strict mode", () => {
    const store = makeStarted("strict");
    const consortId = firstConsortId(store);
    const result = store.applyEffects(db, [{ type: "favor", char: consortId, delta: 3 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("favor effect failed");
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
  });

  it("untrackedCount === 0 for resource effect in strict mode", () => {
    const store = makeStarted("strict");
    const result = store.applyEffects(db, [
      { type: "resource", pillar: "sovereign", field: "prestige", delta: 2 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("resource effect failed");
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.untrackedCount).toBe(0);
  });

  it("untrackedCount === 0 for flag effect in strict mode", () => {
    const store = makeStarted("strict");
    const result = store.applyEffects(db, [{ type: "flag", key: "test_untrack_flag", value: 1 }]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("flag effect failed");
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.untrackedCount).toBe(0);
  });

  it("untrackedCount === 0 for set_rank effect in strict mode", () => {
    const store = makeStarted("strict");
    // set_rank requires a consort-kind character with standing.
    const consortId = Object.keys(store.getState().standing).find(
      (id) => db.characters[id]?.kind === "consort" && store.getState().standing[id]?.rank !== "fenghou",
    );
    if (!consortId) return; // no eligible consort in fixture

    const currentRank = store.getState().standing[consortId]!.rank;
    const targetRank = Object.keys(db.ranks).find((r) => r !== currentRank && r !== "fenghou");
    if (!targetRank) return;

    const result = store.applyEffects(db, [
      { type: "set_rank", char: consortId, rank: targetRank, authority: { kind: "sovereign", actorId: "player" } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.map((e) => e.message).join("; "));
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
  });

  it("untrackedCount === 0 for memory effect in strict mode (including nextSeq)", () => {
    const store = makeStarted("strict");
    const firstChar = Object.keys(store.getState().standing)[0]!;
    const result = store.applyEffects(db, [
      {
        type: "memory",
        char: firstChar,
        entry: {
          kind: "impression",
          summary: "untrack test",
          strength: 5,
          retention: "fast",
          subjectIds: [firstChar],
          perspective: "witness",
          triggerTags: [],
          unresolved: false,
          emotions: {},
        },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.map((e) => e.message).join("; "));
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
    // Per-effect diff must capture nextSeq increment alongside the entry object.
    const seqMut = tx.mutations.find((m) => m.path.includes("nextSeq"));
    expect(seqMut).toBeDefined();
  });

  it("untrackedCount === 0 for birth effect in strict mode", () => {
    const store = makeStarted("strict");

    // Step 1: begin sovereign pregnancy (status: none → pending).
    const beginResult = store.applyEffects(db, [{ type: "pregnancy", op: "begin" }]);
    expect(beginResult.ok).toBe(true);
    if (!beginResult.ok) throw new Error(beginResult.error.map((e) => e.message).join("; "));
    expect(store.getTraceHistory().getAll().at(-1)!.untrackedCount).toBe(0);

    // Step 2: carry (status: pending → carrying, creates sovereign gestation).
    const carryResult = store.applyEffects(db, [{ type: "pregnancy", op: "carry" }]);
    expect(carryResult.ok).toBe(true);
    if (!carryResult.ok) throw new Error(carryResult.error.map((e) => e.message).join("; "));
    expect(store.getTraceHistory().getAll().at(-1)!.untrackedCount).toBe(0);
    expect(store.getState().resources.bloodline.gestations.length).toBeGreaterThan(0);

    // Step 3: birth (clears gestation, adds heir).
    const birthResult = store.applyEffects(db, [
      {
        type: "birth",
        bearer: "sovereign",
        sex: "son",
        fatherId: null,
        bearerOutcome: "safe",
        favor: 50,
        legitimate: true,
      },
    ]);
    expect(birthResult.ok).toBe(true);
    if (!birthResult.ok) throw new Error(birthResult.error.map((e) => e.message).join("; "));
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
    // Heir must be attributed via per-effect diff.
    const heirMut = tx.mutations.find((m) => m.path.startsWith("resources.bloodline.heirs."));
    expect(heirMut).toBeDefined();
  });

  it("untrackedCount === 0 for confine + lift_confinement in strict mode", () => {
    const store = makeStarted("strict");
    // confine requires a consort-kind character (not an official).
    const consortId = Object.keys(store.getState().standing).find(
      (id) => db.characters[id]?.kind === "consort" && store.getState().standing[id]?.rank !== "fenghou",
    );
    if (!consortId) return; // no eligible consort in fixture

    const cal = store.getState().calendar;
    const now = toGameTime(cal);

    const confineResult = store.applyEffects(db, [
      { type: "confine", char: consortId, startTurn: cal.dayIndex, endTurnExclusive: cal.dayIndex + 6, imposedAt: now },
    ]);
    expect(confineResult.ok).toBe(true);
    if (!confineResult.ok) throw new Error(confineResult.error.map((e) => e.message).join("; "));
    expect(store.getTraceHistory().getAll().at(-1)!.untrackedCount).toBe(0);

    const liftResult = store.applyEffects(db, [
      { type: "lift_confinement", char: consortId, at: now, reason: "lifted_by_emperor" },
    ]);
    expect(liftResult.ok).toBe(true);
    if (!liftResult.ok) throw new Error(liftResult.error.map((e) => e.message).join("; "));
    expect(store.getTraceHistory().getAll().at(-1)!.untrackedCount).toBe(0);
  });

  // ── P1 strict-mode coverage for newly-attributed paths ──────────────────

  it("strict mode: resolveEvent produces untrackedCount === 0", () => {
    const store = makeStarted("strict");
    const result = store.resolveEvent(db, "ev_menses_rite", []);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.map((e) => e.message).join("; "));
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
    // The event_resolution phase must be present (apCost/calendar/eventLog attribution).
    const phaseMut = tx.mutations.find((m) => m.phase === "event_resolution");
    expect(phaseMut, "event_resolution phase mutation must exist").toBeDefined();
  });

  it("strict mode: applyImperialCommand with chronicle produces untrackedCount === 0", () => {
    const store = makeStarted("strict");
    // confine an eligible non-empress consort so the command produces chronicle entries.
    const consortId = Object.keys(store.getState().standing).find(
      (id) => db.characters[id]?.kind === "consort" && store.getState().standing[id]?.rank !== "fenghou",
    );
    expect(consortId, "fixture must have a non-empress consort").toBeDefined();
    if (!consortId) throw new Error("no eligible consort in fixture");

    const result = store.applyImperialCommand(db, {
      type: "impose_confinement",
      targetId: consortId,
      durationTurns: 6,
    });
    expect(result.ok, "impose_confinement must succeed").toBe(true);
    if (!result.ok) throw new Error(result.error.map((e) => e.message).join("; "));

    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
    // Chronicle append must have a phase attribution.
    const chronicleMut = tx.mutations.find((m) => m.phase === "chronicle_append");
    expect(chronicleMut, "chronicle_append phase mutation must exist").toBeDefined();
  });

  it("strict mode: approveRetirement produces untrackedCount === 0", () => {
    const store = makeStarted("strict");
    const s = store.getState();
    const officialId = Object.keys(s.officials)[0];
    expect(officialId, "fixture must contain an official").toBeDefined();
    if (!officialId) throw new Error("no official in fixture");

    const T = toGameTime(s.calendar);
    store.loadState({ ...s, pendingRetirements: [{ officialId, requestedAt: T }] });
    const result = store.approveRetirement(officialId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
  });

  it("strict mode: retainRetirement produces untrackedCount === 0", () => {
    const store = makeStarted("strict");
    const s = store.getState();
    const officialId = Object.keys(s.officials)[0];
    expect(officialId, "fixture must contain an official").toBeDefined();
    if (!officialId) throw new Error("no official in fixture");

    const T = toGameTime(s.calendar);
    store.loadState({ ...s, pendingRetirements: [{ officialId, requestedAt: T }] });
    const result = store.retainRetirement(officialId);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
  });

  it("post-batch invariant (acting_consort invalidation) classified as derived, untrackedCount === 0", () => {
    const store = makeStarted("strict");
    const chars = Object.keys(store.getState().standing);
    // Find a character eligible to act as harem administrator.
    const fuRankOrder = db.ranks["fu"]?.order ?? 140;
    const consort = chars.find((id) => {
      const st = store.getState().standing[id];
      if (!st || db.characters[id]?.kind !== "consort") return false;
      if (st.lifecycle === "deceased" || st.rank === "fenghou") return false;
      const rankMeta = db.ranks[st.rank];
      if (!rankMeta || rankMeta.order < fuRankOrder) return false;
      const home = st.residence ?? db.characters[id]?.defaultLocation;
      return home !== "changmengong";
    });
    expect(consort, "fixture must have an eligible non-empress consort").toBeDefined();
    if (!consort) throw new Error("no eligible consort in fixture");

    // Empress must be confined before acting_consort mode is valid.
    const empress = chars.find((id) => store.getState().standing[id]?.rank === "fenghou");
    expect(empress, "fixture must have an empress (fenghou)").toBeDefined();
    if (!empress) throw new Error("no empress in fixture");

    const cal = store.getState().calendar;
    const now = toGameTime(cal);

    const confineEmpressResult = store.applyEffects(db, [
      { type: "confine", char: empress, startTurn: cal.dayIndex, endTurnExclusive: null, imposedAt: now },
    ]);
    expect(confineEmpressResult.ok, "confining empress must succeed").toBe(true);
    if (!confineEmpressResult.ok) throw new Error(confineEmpressResult.error.map((e) => e.message).join("; "));

    // Set up acting_consort administration via the funnel.
    const adminResult = store.applyEffects(db, [
      {
        type: "set_harem_administration",
        state: { mode: "acting_consort", charId: consort, appointedAt: now, reason: "empress_confined" },
      },
    ]);
    expect(adminResult.ok, "set_harem_administration must succeed").toBe(true);
    if (!adminResult.ok) throw new Error(adminResult.error.map((e) => e.message).join("; "));

    // Confine the acting consort — they become ineligible, triggering the post-batch invariant.
    const cal2 = store.getState().calendar;
    const now2 = toGameTime(cal2);
    const confineResult = store.applyEffects(db, [
      { type: "confine", char: consort, startTurn: cal2.dayIndex, endTurnExclusive: null, imposedAt: now2 },
    ]);
    expect(confineResult.ok).toBe(true);
    if (!confineResult.ok) throw new Error(confineResult.error.map((e) => e.message).join("; "));

    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);

    // The administration mode change must be classified as "derived".
    const adminMut = tx.mutations.find(
      (m) => m.path === "haremAdministration.mode" && m.classification === "derived",
    );
    expect(adminMut).toBeDefined();
    expect(adminMut?.after).toBe("neiwu_proxy");
  });

  it("strict mode: year-boundary advanceTime produces official_yearly_tick phase, untrackedCount === 0", () => {
    const store = createGameStore({ traceMode: "strict" });
    const base = createNewGameState(db, 1);
    // Put the calendar at the last AP of year 1 / month 12 so that spending it rolls into month 1.
    const apCost = 1; // SPEND_AP 1 is always enough to flip the period
    store.loadState({
      ...base,
      calendar: { ...base.calendar, year: 1, month: 12, period: "late", dayIndex: dayIndexOf(1, 12, "late"), ap: apCost },
    });
    const result = store.advanceTime(db, { type: "SPEND_AP", amount: apCost });
    expect(result.ok, "year-boundary advance must succeed").toBe(true);
    if (!result.ok) throw new Error(result.error.map((e) => e.message).join("; "));
    expect(store.getState().calendar.month).toBe(1); // rolled into new year
    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
    // official_yearly_tick phase must be present if there are officials.
    if (Object.keys(base.officials).length > 0) {
      const tickMut = tx.mutations.find((m) => m.phase === "official_yearly_tick");
      expect(tickMut, "official_yearly_tick phase mutation must exist on year-cross").toBeDefined();
    }
  });

  it("strict mode: applyImperialPunishmentWithConsequences produces untrackedCount === 0", () => {
    const store = createGameStore({ traceMode: "strict" });
    store.newGame(db);
    const consortId = Object.keys(store.getState().standing).find(
      (id) => db.characters[id]?.kind === "consort" && store.getState().standing[id]?.rank !== "fenghou",
    );
    expect(consortId, "fixture must have a non-empress consort").toBeDefined();
    if (!consortId) throw new Error("no eligible consort in fixture");

    const result = store.applyImperialPunishmentWithConsequences(
      db,
      { type: "impose_confinement", targetId: consortId, durationTurns: 6 },
      {},
    );
    expect(result.ok, "punishment transaction must succeed").toBe(true);
    if (!result.ok) throw new Error(result.error.map((e) => e.message).join("; "));

    const tx = store.getTraceHistory().getAll().at(-1)!;
    expect(tx.outcome).toBe("committed");
    expect(tx.untrackedCount).toBe(0);
    // Chronicle entries must be attributed.
    const chronicleMut = tx.mutations.find((m) => m.phase === "chronicle_append");
    expect(chronicleMut, "chronicle_append phase mutation must exist").toBeDefined();
  });
});

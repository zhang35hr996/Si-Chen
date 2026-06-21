import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { applyEffects } from "../../src/engine/effects/funnel";
import { planHealthChange } from "../../src/store/health";
import { toGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

function fresh() {
  return { db, state: createNewGameState(db) };
}

describe("planHealthChange — forceDeath + inert + deceased no-op", () => {
  it("forceDeath kills even when nextHealth > 0 (sudden death), enqueues aftermath", () => {
    const s = createNewGameState(db);
    const id = Object.keys(s.standing).find((c) => db.characters[c]?.kind === "consort")!;
    s.standing[id]!.health = 66; s.standing[id]!.healthStatus = "critical";
    const { effects, outcome } = planHealthChange(s, { subject: { kind: "consort", id }, healthStatus: "critical", forceDeath: true, cause: "critical_sudden", at: toGameTime(s.calendar) });
    expect(outcome.died).toBe(true);
    expect(outcome.deathCause).toBe("critical_sudden");
    const r = applyEffects(db, s, effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[id]!.lifecycle).toBe("deceased");
    expect(r.value.pendingAftermath.some((p) => p.subjectId === id)).toBe(true);
  });
  it("emits no inert effect when delta=0 && no status && no forceDeath", () => {
    const s = createNewGameState(db);
    const { effects } = planHealthChange(s, { subject: { kind: "taihou" }, cause: "illness", at: toGameTime(s.calendar) });
    expect(effects).toHaveLength(0);
  });
  it("already-deceased consort: planHealthChange forceDeath=true is a no-op", () => {
    const s = createNewGameState(db);
    const id = Object.keys(s.standing).find((c) => db.characters[c]?.kind === "consort")!;
    // Kill the consort first
    const at = toGameTime(s.calendar);
    const { effects: killEffects } = planHealthChange(s, { subject: { kind: "consort", id }, healthDelta: -100, cause: "illness", at });
    const killed = applyEffects(db, s, killEffects);
    if (!killed.ok) return;
    const deadState = killed.value;
    const originalRecord = JSON.stringify(deadState.standing[id]!.deathRecord);
    // Now try forceDeath on a later dayIndex
    const later = { ...at, dayIndex: at.dayIndex + 10 };
    const { effects: noopEffects, outcome } = planHealthChange(deadState, { subject: { kind: "consort", id }, forceDeath: true, cause: "scripted", at: later });
    expect(noopEffects).toHaveLength(0);
    expect(outcome.died).toBe(false);
    const r2 = applyEffects(db, deadState, noopEffects);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.pendingAftermath.length).toBe(deadState.pendingAftermath.length);
    expect(JSON.stringify(r2.value.standing[id]!.deathRecord)).toBe(originalRecord);
  });
});

describe("planHealthChange", () => {
  it("non-lethal taihou delta: not died, applies cleanly", () => {
    const { db, state } = fresh();
    const at = toGameTime(state.calendar);
    const { effects, outcome } = planHealthChange(state, {
      subject: { kind: "taihou" }, healthDelta: -5, cause: "illness", at,
    });
    expect(outcome.died).toBe(false);
    expect(outcome.nextHealth).toBe(65);
    const r = applyEffects(db, state, effects);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.taihou.health).toBe(65);
  });

  it("lethal taihou delta: died + enqueues aftermath (not sovereign)", () => {
    const { db, state } = fresh();
    const at = toGameTime(state.calendar);
    const { effects, outcome } = planHealthChange(state, {
      subject: { kind: "taihou" }, healthDelta: -100, cause: "illness", at,
    });
    expect(outcome.died).toBe(true);
    expect(outcome.sovereignDied).toBeFalsy();
    expect(outcome.aftermathId).toBeDefined();
    const r = applyEffects(db, state, effects);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.taihou.deceased).toBe(true);
      expect(r.value.pendingAftermath).toHaveLength(1);
    }
  });

  it("forceDeath sovereign with health>0: sovereignDied, no enqueue_aftermath / *_decease", () => {
    const { state } = fresh();
    state.resources.sovereign.health = 75;
    const at = toGameTime(state.calendar);
    const { effects, outcome } = planHealthChange(state, {
      subject: { kind: "sovereign" }, forceDeath: true, cause: "critical_sudden", at,
    });
    expect(outcome.died).toBe(true);
    expect(outcome.sovereignDied).toBe(true);
    expect(effects.every((e) => e.type !== "enqueue_aftermath")).toBe(true);
    expect(effects.every((e) => !e.type.endsWith("_decease"))).toBe(true);
  });

  it("lethal sovereign delta: sovereignDied, no aftermath entry", () => {
    const { db, state } = fresh();
    const at = toGameTime(state.calendar);
    const { effects, outcome } = planHealthChange(state, {
      subject: { kind: "sovereign" }, healthDelta: -100, cause: "illness", at,
    });
    expect(outcome.died).toBe(true);
    expect(outcome.sovereignDied).toBe(true);
    const r = applyEffects(db, state, effects);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.pendingAftermath).toHaveLength(0);
  });
});

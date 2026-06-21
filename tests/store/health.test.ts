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

  it("lethal sovereign delta: sovereignDied, no aftermath entry", () => {
    const { db, state } = fresh();
    const at = toGameTime(state.calendar);
    const { effects, outcome } = planHealthChange(state, {
      subject: { kind: "sovereign" }, healthDelta: -100, cause: "illness", at,
    });
    expect(outcome.died).toBe(true);
    expect(outcome.sovereignDied).toBe(true);
    const r = applyEffects(db, state, effects);
    if (r.ok) expect(r.value.pendingAftermath).toHaveLength(0);
  });
});

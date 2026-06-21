/**
 * Task 5: GameStore.resolveTimedAction — action-before-time atomic transaction.
 * The action effect must settle on a still-alive subject BEFORE the cross-month
 * tick that kills it, all in ONE commit.
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { loadGameContent } from "../../src/engine/content/viteSource";
import type { GameState, Heir } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load: " + content.error.map((e) => e.message).join("\n"));
const db = content.value;

/** A living heir, born last year, critical with 1 health → guaranteed to die in any tick. */
function dyingHeir(year: number): Heir {
  return {
    id: "heir_test",
    sex: "son",
    fatherId: null,
    bearer: "sovereign",
    birthAt: { year: year - 1, month: 1, period: "early", dayIndex: 0 },
    favor: 50,
    legitimate: true,
    petName: "",
    education: { scholarship: 0, martial: 0, virtue: 0 },
    health: 1,
    talent: 50,
    diligence: 50,
    ambition: 0,
    closeness: 0,
    support: 0,
    faction: "none",
    lifecycle: "alive",
    healthStatus: "critical",
  };
}

function withHeir(state: GameState, heir: Heir): GameState {
  return {
    ...state,
    resources: {
      ...state.resources,
      bloodline: { ...state.resources.bloodline, heirs: [...state.resources.bloodline.heirs, heir] },
    },
  };
}

describe("resolveTimedAction action-before-time", () => {
  it("applies the action effect while the subject is alive, then the cross-month tick kills it (one commit)", () => {
    const store = new GameStore();
    store.newGame(db);
    const year = store.getState().calendar.year;
    store.loadState(withHeir(store.getState(), dyingHeir(year)));

    // Drive to the last 旬 so the next SKIP_REMAINDER crosses the month.
    while (store.getState().calendar.period !== "late") {
      store.advanceTime(db, { type: "SKIP_REMAINDER" });
    }
    // The heir is still alive going in.
    const heirBefore = store.getState().resources.bloodline.heirs.find((h) => h.id === "heir_test");
    expect(heirBefore?.lifecycle).toBe("alive");
    expect(heirBefore?.favor).toBe(50);

    // Action: +5 favor on the heir, then cross-month time advance (tick kills it).
    const r = store.resolveTimedAction(
      db,
      [{ type: "child_favor", heirId: "heir_test", delta: 5 }],
      { type: "SKIP_REMAINDER" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.monthChanged).toBe(true);
    expect(r.value.healthOutcome).not.toBeNull();

    const heirAfter = store.getState().resources.bloodline.heirs.find((h) => h.id === "heir_test");
    // action applied while alive: favor 50 → 55
    expect(heirAfter?.favor).toBe(55);
    // then the cross-month tick killed it
    expect(heirAfter?.lifecycle).toBe("deceased");
  });

  it("advanceTime is resolveTimedAction with no action effects", () => {
    const store = new GameStore();
    store.newGame(db);
    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
  });
});

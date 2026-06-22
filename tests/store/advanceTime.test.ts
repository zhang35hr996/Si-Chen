/**
 * Task 5: GameStore.advanceTime — atomic time transaction crossing month → monthly health tick.
 * Covers: within-month no tick; cross-month tick once; reload no re-run; atomic rollback.
 * Uses the repo's content loader (loadGameContent) and `new GameStore(); store.newGame(db)`.
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { monthOrdinal } from "../../src/engine/calendar/time";
import type { Heir } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load: " + content.error.map((e) => e.message).join("\n"));
const db = content.value;

function freshStore() {
  const store = new GameStore();
  store.newGame(db);
  return store;
}

describe("advanceTime monthly tick", () => {
  it("within a month does NOT run the tick (monthChanged false)", () => {
    const store = freshStore(); // year1 month1 early, ap full
    const before = monthOrdinal(store.getState().calendar);
    const r = store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // one AP spent from a full day → stays in month1, no rollover, no tick
    expect(monthOrdinal(store.getState().calendar)).toBe(before);
    expect(r.value.monthChanged).toBe(false);
    expect(r.value.healthOutcome).toBeNull();
  });

  it("crossing into a new month runs the tick exactly once (monthChanged true, healthOutcome set)", () => {
    const store = freshStore();
    let crossed = false;
    for (let i = 0; i < 6 && !crossed; i++) {
      const before = monthOrdinal(store.getState().calendar);
      const r = store.advanceTime(db, { type: "SKIP_REMAINDER" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      if (monthOrdinal(store.getState().calendar) !== before) {
        expect(r.value.monthChanged).toBe(true);
        expect(r.value.healthOutcome).not.toBeNull();
        crossed = true;
      } else {
        expect(r.value.monthChanged).toBe(false);
        expect(r.value.healthOutcome).toBeNull();
      }
    }
    expect(crossed).toBe(true);
  });

  it("reload at the already-advanced calendar does NOT re-run for that month", () => {
    const store = freshStore();
    // advance until we cross into month 2
    let guard = 0;
    while (store.getState().calendar.month === 1 && guard++ < 10) {
      store.advanceTime(db, { type: "SKIP_REMAINDER" });
    }
    expect(store.getState().calendar.month).toBe(2);
    const saved = store.getState();

    const reloaded = new GameStore();
    reloaded.loadState(saved);
    const before = monthOrdinal(reloaded.getState().calendar);
    // a within-month advance after reload must NOT run a tick
    const r = reloaded.advanceTime(db, { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(monthOrdinal(reloaded.getState().calendar)).toBe(before);
    expect(r.value.monthChanged).toBe(false);
    expect(r.value.healthOutcome).toBeNull();
  });

  it("atomic rollback: if the health tick throws, calendar does NOT advance and state is unchanged", () => {
    const store = freshStore();
    // Inject an alive heir with NO birthAt → currentAgeOf throws in the tick.
    const broken = {
      id: "heir_broken",
      sex: "son",
      fatherId: null,
      bearer: "sovereign",
      // birthAt intentionally omitted → heirAge reads undefined.year → throws
      favor: 50,
      legitimate: true,
      petName: "",
      education: { scholarship: 0, martial: 0, virtue: 0 },
      health: 100,
      talent: 50,
      diligence: 50,
      ambition: 0,
      closeness: 0,
      support: 0,
      faction: "none",
      lifecycle: "alive",
    } as unknown as Heir;
    const corrupted = {
      ...store.getState(),
      resources: {
        ...store.getState().resources,
        bloodline: {
          ...store.getState().resources.bloodline,
          heirs: [...store.getState().resources.bloodline.heirs, broken],
        },
      },
    };
    store.loadState(corrupted);

    // Drive to the last 旬 so the next SKIP_REMAINDER crosses the month.
    while (store.getState().calendar.period !== "late") {
      const r = store.advanceTime(db, { type: "SKIP_REMAINDER" });
      // within-month advances are fine (no tick yet)
      expect(r.ok).toBe(true);
    }
    const prior = store.getState();
    const priorMonth = prior.calendar.month;
    const priorPeriod = prior.calendar.period;

    let notified = 0;
    store.subscribe(() => notified++);

    // This SKIP_REMAINDER crosses the month → tick → throws → whole tx rejected.
    const r = store.advanceTime(db, { type: "SKIP_REMAINDER" });
    expect(r.ok).toBe(false);
    // state must be byte-identical reference (no mutation, no emit)
    expect(store.getState()).toBe(prior);
    expect(store.getState().calendar.month).toBe(priorMonth);
    expect(store.getState().calendar.period).toBe(priorPeriod);
    expect(notified).toBe(0);
  });
});

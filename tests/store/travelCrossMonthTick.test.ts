/**
 * Task 6 item 5: travel's time-advance routes through the unified atomic entry,
 * so cross-month travel runs the monthly health tick (and can end the game).
 */
import { describe, expect, it } from "vitest";
import { GameStore } from "../../src/store/gameStore";
import { loadGameContent } from "../../src/engine/content/viteSource";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed: " + content.error.map((e) => e.message).join("\n"));
const db = content.value;

/**
 * Drive to the last 旬 (late) and drain AP down to exactly 1, so the next
 * SPEND_AP amount:1 exhausts the 旬 AND it's the last 旬 → crosses the month.
 */
function toLastPeriodOneAp(store: GameStore): void {
  let guard = 0;
  while (store.getState().calendar.period !== "late" && guard++ < 50) {
    store.advanceTime(db, { type: "SKIP_REMAINDER" });
  }
  // Burn AP in the late 旬 until exactly 1 remains.
  while (store.getState().calendar.ap > 1 && guard++ < 50) {
    store.advanceTime(db, { type: "SPEND_AP", amount: 1 });
  }
}

describe("travelAndAdvance cross-month health tick", () => {
  it("MOVE + SPEND_AP across a month boundary runs the monthly tick (monthChanged + healthOutcome)", () => {
    const store = new GameStore();
    store.newGame(db);
    toLastPeriodOneAp(store);
    const target = "cining_gong";
    const before = store.getState().playerLocation;
    expect(before).not.toBe(target);

    const r = store.travelAndAdvance(
      db,
      [{ type: "MOVE_TO_LOCATION", locationId: target }],
      { type: "SPEND_AP", amount: 1 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.monthChanged).toBe(true);
    expect(r.value.healthOutcome).not.toBeNull();
    // The MOVE committed in the same transaction.
    expect(store.getState().playerLocation).toBe(target);
  });

  it("sovereign death on cross-month travel writes gameOver in the same transaction", () => {
    const store = new GameStore();
    store.newGame(db);
    toLastPeriodOneAp(store);
    // Make the sovereign die in the upcoming tick.
    const s = store.getState();
    store.loadState({
      ...s,
      resources: {
        ...s.resources,
        sovereign: { ...s.resources.sovereign, health: 1, healthStatus: "critical" },
      },
    });
    expect(store.getState().gameOver).toBeUndefined();

    const r = store.travelAndAdvance(
      db,
      [{ type: "MOVE_TO_LOCATION", locationId: "cining_gong" }],
      { type: "SPEND_AP", amount: 1 },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.healthOutcome?.sovereignDied).toBe(true);
    expect(store.getState().gameOver?.cause).toBe("sovereign_death");
  });

  it("exitPalace path (no MOVE, just SPEND_AP) also runs the cross-month tick", () => {
    const store = new GameStore();
    store.newGame(db);
    toLastPeriodOneAp(store);
    const r = store.travelAndAdvance(db, [], { type: "SPEND_AP", amount: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.monthChanged).toBe(true);
    expect(r.value.healthOutcome).not.toBeNull();
  });
});

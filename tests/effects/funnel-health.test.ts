import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

function freshState() {
  const loaded = loadGameContent();
  if (!loaded.ok) throw new Error("content");
  return { db: loaded.value, state: createNewGameState(loaded.value) };
}

describe("health funnel effects", () => {
  it("set_taihou_health clamps and sets status", () => {
    const { db, state } = freshState();
    const r = applyEffects(db, state, [
      { type: "set_taihou_health", healthDelta: -200, healthStatus: "critical" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.taihou.health).toBe(0);
      expect(r.value.taihou.healthStatus).toBe("critical");
    }
  });

  it("enqueue_aftermath is idempotent on id", () => {
    const { db, state } = freshState();
    const ev = {
      type: "enqueue_aftermath" as const,
      id: "death:taihou:taihou:99",
      kind: "taihou" as const,
      subjectId: "taihou",
      at: { year: state.calendar.year, month: state.calendar.month, period: state.calendar.period, dayIndex: state.calendar.dayIndex },
    };
    const r = applyEffects(db, state, [ev, ev]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.pendingAftermath.filter((a) => a.id === ev.id)).toHaveLength(1);
  });
});

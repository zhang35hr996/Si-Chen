import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { toGameTime } from "../../src/engine/calendar/time";

function freshState() {
  const loaded = loadGameContent();
  if (!loaded.ok) throw new Error("content");
  return { db: loaded.value, state: createNewGameState(loaded.value) };
}

describe("health funnel effects", () => {
  it("consort_decease clears carrier gestation (断胎) and is idempotent on re-death", () => {
    const { db, state } = freshState();
    const id = Object.keys(state.standing).find((c) => (db.characters[c] ?? state.generatedConsorts[c])?.kind === "consort")!;
    const at = toGameTime(state.calendar);
    state.resources.bloodline.gestations.push({ carrier: id, conceivedAt: at });
    const r1 = applyEffects(db, state, [{ type: "consort_decease", char: id, at, cause: "illness" }]);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    expect(r1.value.resources.bloodline.gestations.some((g) => g.carrier === id)).toBe(false);
    expect(r1.value.standing[id]!.lifecycle).toBe("deceased");
    // re-death is a no-op (already deceased; deathRecord preserved)
    const before = JSON.stringify(r1.value.standing[id]!.deathRecord);
    const r2 = applyEffects(db, r1.value, [{ type: "consort_decease", char: id, at, cause: "scripted" }]);
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(JSON.stringify(r2.value.standing[id]!.deathRecord)).toBe(before);
  });

  it("consort_decease 首次置死时清陈旧 recoverUntilMonth（勿留「已故仍在休养」）", () => {
    const { db, state } = freshState();
    const id = Object.keys(state.standing).find((c) => (db.characters[c] ?? state.generatedConsorts[c])?.kind === "consort")!;
    const at = toGameTime(state.calendar);
    state.standing[id]!.recoverUntilMonth = 9; // 顺产/child_dies 先写休养截止
    const r = applyEffects(db, state, [{ type: "consort_decease", char: id, at, cause: "childbirth" }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.standing[id]!.lifecycle).toBe("deceased");
    expect(r.value.standing[id]!.recoverUntilMonth).toBeUndefined();
  });

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

import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { toGameTime } from "../../src/engine/calendar/time";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";
import type { EventEffect } from "../../src/engine/content/schemas";

function stateWithOneHeir() {
  const db = loadRealContent();
  let state = createNewGameState(db);
  for (const e of [{ type: "pregnancy", op: "begin" }, { type: "pregnancy", op: "carry" }] as EventEffect[]) {
    state = (applyEffects(db, state, [e]) as { value: typeof state }).value;
  }
  state = (applyEffects(db, state, [{ type: "birth", bearer: "sovereign", fatherId: null, sex: "daughter", legitimate: true, favor: 50, bearerOutcome: "safe" }]) as { value: typeof state }).value;
  return { db, state, heirId: state.resources.bloodline.heirs[0]!.id };
}

describe("heir_died 效果", () => {
  it("标记 deceased + deceasedAt，不删数组，通过 schema 不变量", () => {
    const { db, state, heirId } = stateWithOneHeir();
    const r = applyEffects(db, state, [{ type: "heir_died", heirId }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const heir = r.value.resources.bloodline.heirs.find((h) => h.id === heirId)!;
    expect(heir.lifecycle).toBe("deceased");
    expect(heir.deceasedAt).toEqual(toGameTime(state.calendar));
    expect(r.value.resources.bloodline.heirs).toHaveLength(1); // 不删
    expect(gameStateSchema.safeParse(r.value).success).toBe(true); // deceased⇒有 deceasedAt 满足
  });

  it("未知皇嗣 / 已死皇嗣 → 拒绝（reject-all）", () => {
    const { db, state, heirId } = stateWithOneHeir();
    expect(applyEffects(db, state, [{ type: "heir_died", heirId: "heir_999999" }]).ok).toBe(false);
    const once = applyEffects(db, state, [{ type: "heir_died", heirId }]) as { value: typeof state };
    expect(applyEffects(db, once.value, [{ type: "heir_died", heirId }]).ok).toBe(false);
  });
});

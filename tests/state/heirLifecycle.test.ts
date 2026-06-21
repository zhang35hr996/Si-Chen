import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { createNewGameState } from "../../src/engine/state/newGame";
import { makeGameTime } from "../../src/engine/calendar/time";
import { loadRealContent } from "../helpers/contentFixture";
import type { EventEffect } from "../../src/engine/content/schemas";

/** 造一个帝王自孕→生产的最小路径，使 bloodline.heirs 落一胎。 */
function stateWithOneHeir() {
  const db = loadRealContent();
  let state = createNewGameState(db);
  const seq: EventEffect[] = [
    { type: "pregnancy", op: "begin" },
    { type: "pregnancy", op: "carry" },
  ];
  for (const e of seq) {
    const r = applyEffects(db, state, [e]);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    state = r.value;
  }
  const birth = applyEffects(db, state, [
    { type: "birth", bearer: "sovereign", fatherId: null, sex: "daughter", legitimate: true, favor: 50, bearerOutcome: "safe" },
  ]);
  if (!birth.ok) throw new Error(JSON.stringify(birth.error));
  return { db, state: birth.value };
}

describe("Heir.lifecycle", () => {
  it("出生的皇嗣 lifecycle 为 alive，且通过 schema", () => {
    const { state } = stateWithOneHeir();
    const heir = state.resources.bloodline.heirs[0]!;
    expect(heir.lifecycle).toBe("alive");
    expect(heir.deceasedAt).toBeUndefined();
    expect(gameStateSchema.safeParse(state).success).toBe(true);
  });

  it("跨字段不变量：alive+deceasedAt / deceased 无 deceasedAt 被 schema 拒绝", () => {
    const { state } = stateWithOneHeir();
    const bad1 = structuredClone(state);
    bad1.resources.bloodline.heirs[0]!.deceasedAt = makeGameTime(1, 3, "mid"); // alive + deceasedAt
    expect(gameStateSchema.safeParse(bad1).success).toBe(false);
    const bad2 = structuredClone(state);
    bad2.resources.bloodline.heirs[0]!.lifecycle = "deceased"; // deceased 无 deceasedAt
    expect(gameStateSchema.safeParse(bad2).success).toBe(false);
  });
});

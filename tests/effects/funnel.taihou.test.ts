import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("set_taihou_illness", () => {
  it("flips taihou.ill through the funnel", () => {
    const s0 = createNewGameState(db);
    expect(s0.taihou.ill).toBe(false);
    const r = applyEffects(db, s0, [{ type: "set_taihou_illness", ill: true }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.taihou.ill).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadGameContent } from "../../src/engine/content/viteSource";

function loadTestContent() {
  const loaded = loadGameContent();
  if (!loaded.ok) throw new Error("content");
  return loaded.value;
}

describe("set_sovereign_health", () => {
  it("uncapped lethal delta + status", () => {
    const db = loadTestContent(); const s = createNewGameState(db);
    const r = applyEffects(db, s, [{ type: "set_sovereign_health", healthDelta: -100, healthStatus: "critical" }]);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.value.resources.sovereign.health).toBe(0); expect(r.value.resources.sovereign.healthStatus).toBe("critical"); }
  });
});

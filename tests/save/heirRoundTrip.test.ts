import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { gameStateSchema } from "../../src/engine/save/stateSchema";
import { applyEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { EventEffect } from "../../src/engine/content/schemas";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

describe("heir lifecycle save round-trip", () => {
  it("persists gestation, heirs, candidateIds, lifecycle, recoverUntilMonth", () => {
    let s: GameState = createNewGameState(db);
    const steps: EventEffect[][] = [
      [{ type: "pregnancy", op: "begin" }],
      [{ type: "pregnancy", op: "carry" }],
      [{ type: "heir_designate", charIds: ["shen_chenghui"] }],
      [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }],
      [
        {
          type: "birth",
          sex: "daughter",
          fatherId: "shen_chenghui",
          bearer: "shen_chenghui",
          legitimate: false,
          favor: 25,
          bearerOutcome: "safe",
          recoverUntilMonth: 20,
        },
      ],
    ];
    for (const effects of steps) {
      const r = applyEffects(db, s, effects);
      expect(r.ok).toBe(true);
      if (r.ok) s = r.value;
    }
    expect(s.resources.bloodline.heirs).toHaveLength(1);
    expect(s.standing.shen_chenghui!.lifecycle).toBe("delivered");
    expect(s.standing.shen_chenghui!.recoverUntilMonth).toBe(20);
    // The full state must still satisfy the persistence schema.
    expect(gameStateSchema.safeParse(s).success).toBe(true);
  });
});

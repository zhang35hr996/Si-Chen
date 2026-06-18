import { describe, expect, it } from "vitest";
import { loadGameContent } from "../../src/engine/content/viteSource";
import { applyEffects, validateEffects } from "../../src/engine/effects/funnel";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { EventEffect } from "../../src/engine/content/schemas";
import type { GameState } from "../../src/engine/state/types";

const content = loadGameContent();
if (!content.ok) throw new Error("content failed to load");
const db = content.value;

function apply(s: GameState, effects: EventEffect[]): GameState {
  const r = applyEffects(db, s, effects);
  if (!r.ok) throw new Error(r.error.map((e) => e.message).join("；"));
  return r.value;
}

function selfCarrying(s: GameState): GameState {
  return apply(apply(s, [{ type: "pregnancy", op: "begin" }]), [{ type: "pregnancy", op: "carry" }]);
}

describe("multi-line gestation coexistence", () => {
  it("sovereign can re-conceive after a transfer → both consort and sovereign gestations coexist", () => {
    let s = selfCarrying(createNewGameState(db));
    s = apply(s, [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }]);
    // After transfer: pregnancy back to none, consort carrying.
    expect(s.resources.bloodline.pregnancy.status).toBe("none");
    expect(s.resources.bloodline.gestations.map((g) => g.carrier)).toEqual(["shen_chenghui"]);

    // The sovereign re-conceives and carries — now two gestations exist.
    s = selfCarrying(s);
    expect(s.resources.bloodline.pregnancy.status).toBe("carrying");
    expect(s.resources.bloodline.gestations.map((g) => g.carrier).sort()).toEqual(
      ["shen_chenghui", "sovereign"].sort(),
    );
    expect(s.standing.shen_chenghui!.lifecycle).toBe("carrying");
  });

  it("birth of a consort removes only that gestation and leaves the sovereign's own pregnancy intact", () => {
    let s = selfCarrying(createNewGameState(db));
    s = apply(s, [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }]);
    s = selfCarrying(s); // sovereign carrying again, consort still carrying
    s = apply(s, [
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
    ]);
    // consort gestation gone, sovereign's own pregnancy untouched
    expect(s.resources.bloodline.gestations.map((g) => g.carrier)).toEqual(["sovereign"]);
    expect(s.resources.bloodline.pregnancy.status).toBe("carrying");
    expect(s.standing.shen_chenghui!.lifecycle).toBe("delivered");
  });
});

describe("candidate annotation lifecycle", () => {
  it("transfer clears every candidate annotation except the final carrier", () => {
    let s = selfCarrying(createNewGameState(db));
    s = apply(s, [{ type: "heir_designate", charIds: ["shen_chenghui", "chu_jun"] }]);
    expect(s.standing.shen_chenghui!.lifecycle).toBe("candidate");
    expect(s.standing.chu_jun!.lifecycle).toBe("candidate");

    s = apply(s, [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }]);
    expect(s.standing.shen_chenghui!.lifecycle).toBe("carrying");
    expect(s.standing.chu_jun!.lifecycle).toBe("normal"); // candidate annotation cleared
    expect(s.resources.bloodline.pregnancy.candidateIds).toEqual([]);
  });

  it("abort clears every candidate annotation", () => {
    let s = selfCarrying(createNewGameState(db));
    s = apply(s, [{ type: "heir_designate", charIds: ["shen_chenghui"] }]);
    s = apply(s, [{ type: "pregnancy_abort" }]);
    expect(s.standing.shen_chenghui!.lifecycle).toBe("normal");
    expect(s.resources.bloodline.pregnancy.candidateIds).toEqual([]);
    expect(s.resources.bloodline.gestations).toEqual([]);
  });

  it("heir_candidate add is single-at-a-time and remove clears it", () => {
    let s = apply(createNewGameState(db), [{ type: "pregnancy", op: "begin" }]); // pending self-pregnancy
    s = apply(s, [{ type: "heir_candidate", op: "add", char: "shen_chenghui" }]);
    expect(s.resources.bloodline.pregnancy.candidateIds).toEqual(["shen_chenghui"]);

    // adding another replaces the previous one (only one candidate at a time)
    s = apply(s, [{ type: "heir_candidate", op: "add", char: "chu_jun" }]);
    expect(s.standing.shen_chenghui!.lifecycle).toBe("normal");
    expect(s.standing.chu_jun!.lifecycle).toBe("candidate");
    expect(s.resources.bloodline.pregnancy.candidateIds).toEqual(["chu_jun"]);

    s = apply(s, [{ type: "heir_candidate", op: "remove", char: "chu_jun" }]);
    expect(s.standing.chu_jun!.lifecycle).toBe("normal");
    expect(s.resources.bloodline.pregnancy.candidateIds).toEqual([]);
  });

  it("heir_candidate add requires an active self-pregnancy", () => {
    const s = createNewGameState(db); // not pregnant
    expect(
      validateEffects(db, s, [{ type: "heir_candidate", op: "add", char: "shen_chenghui" }]),
    ).toHaveLength(1);
  });

  it("heir_candidate cannot mark a carrying consort", () => {
    let s = selfCarrying(createNewGameState(db));
    s = apply(s, [{ type: "pregnancy_transfer", carrierId: "shen_chenghui", atMonth: 3 }]);
    s = selfCarrying(s); // sovereign pregnant again so the add-gate passes
    expect(
      validateEffects(db, s, [{ type: "heir_candidate", op: "add", char: "shen_chenghui" }]),
    ).toHaveLength(1);
  });
});

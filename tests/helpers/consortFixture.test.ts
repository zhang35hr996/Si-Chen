/**
 * Invariants for the withConsort test fixture itself (review follow-up):
 *  - injecting an empress fixture replaces the generated empress (no double huanghou)
 *  - the maternal family is merged with state.rngSeed (not a hardcoded seed) and stays valid
 *  - merging a legacy family does NOT clobber unrelated official-world mutations
 */
import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { loadRealContent } from "./contentFixture";
import { withConsort } from "./consortFixture";

const db = loadRealContent();

describe("withConsort fixture invariants", () => {
  it("injecting the empress fixture (shen_zhibai) replaces the generated empress — exactly one huanghou", () => {
    const s = withConsort(createNewGameState(db, 7), db, "shen_zhibai");
    const empresses = Object.entries(s.standing)
      .filter(([, st]) => st.rank === "huanghou" && st.lifecycle !== "deceased")
      .map(([id]) => id);
    expect(empresses).toEqual(["shen_zhibai"]);
    // the previous generated empress is gone from every per-character map
    const genEmpressId = "generated_empress_7";
    expect(s.standing[genEmpressId]).toBeUndefined();
    expect(s.generatedConsorts[genEmpressId]).toBeUndefined();
    expect(s.memories[genEmpressId]).toBeUndefined();
    expect(s.bedchamber[genEmpressId]).toBeUndefined();
    expect(validateOfficialWorld(s, db)).toEqual([]);
  });

  it("merges the maternal family under state.rngSeed and passes integrity across seeds", () => {
    for (const seed of [1, 7, 42, 100]) {
      const s = withConsort(createNewGameState(db, seed), db, "lu_huaijin");
      expect(s.officials["official_fam_lu_main"]).toBeDefined();
      expect(s.officials["official_fam_lu_main"]!.postId).toBe("guozijian_jijiu");
      expect(s.standing["lu_huaijin"]!.birthFamilyId).toBe("fam_lu_main");
      expect(validateOfficialWorld(s, db)).toEqual([]);
    }
  });

  it("does not clobber an unrelated prior official-world mutation (retirement is preserved)", () => {
    const base = createNewGameState(db, 1);
    const victimId = Object.keys(base.officials).find(
      (id) => base.officials[id]!.postId !== null && id !== "official_fam_lu_main",
    )!;
    const mutated = {
      ...base,
      officials: {
        ...base.officials,
        [victimId]: {
          ...base.officials[victimId]!,
          status: "retired" as const,
          postId: null,
          statusReason: "retirement" as const,
          statusChangedAt: base.calendar,
        },
      },
    };
    const s = withConsort(mutated, db, "lu_huaijin");
    expect(s.officials[victimId]!.status).toBe("retired"); // preserved, not regenerated away
    expect(validateOfficialWorld(s, db)).toEqual([]);
  });
});

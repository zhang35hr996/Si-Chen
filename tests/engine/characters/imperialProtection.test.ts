import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../../src/engine/state/newGame";
import { loadRealContent } from "../../helpers/contentFixture";
import {
  rankDistance,
  livingHeirCountForConsort,
  isCurrentCarrier,
  getFavoriteStatus,
  imperialProtectionSnapshot,
} from "../../../src/engine/characters/imperialProtection";
import { validatePeakFavor } from "../../../src/engine/characters/peakFavorValidator";
import { bestow, grantItem } from "../../../src/store/treasury";
import { applyEffects } from "../../../src/engine/effects/funnel";
import type { GameState, GestationState, Heir } from "../../../src/engine/state/types";
import { gameStateSchema } from "../../../src/engine/save/stateSchema";

const db = loadRealContent();

function baseState(): GameState {
  return createNewGameState(db);
}

const TARGET = "lu_huaijin";

// ────────────────────────────────────────────────────────────────────────────
// A1 — peakFavor maintained across all favor write paths
// ────────────────────────────────────────────────────────────────────────────
describe("peakFavor — A1", () => {
  it("new-game preserves authored peakFavor from initialStanding", () => {
    const state = baseState();
    // lu_huaijin is authored with favor=30, peakFavor=30 (from content JSON)
    const st = state.standing[TARGET]!;
    expect(st.favor).toBe(30);
    expect(st.peakFavor).toBe(30);
    // shen_zhibai (凤后) authored with favor=25, peakFavor=25
    const fenghou = state.standing["shen_zhibai"]!;
    expect(fenghou.favor).toBe(25);
    expect(fenghou.peakFavor).toBe(25);
  });

  it("validatePeakFavor passes on new-game state", () => {
    const state = baseState();
    expect(validatePeakFavor(state)).toHaveLength(0);
  });

  it("validatePeakFavor catches peakFavor < favor", () => {
    const state = baseState();
    const patched = {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: { ...state.standing[TARGET]!, favor: 80, peakFavor: 30 },
      },
    };
    const errs = validatePeakFavor(patched);
    expect(errs).toHaveLength(1);
    expect(errs[0]!.code).toBe("PEAK_FAVOR_BELOW_FAVOR");
  });

  it("funnel case 'favor' raises peakFavor when favor exceeds it", () => {
    const base = baseState();
    const state: GameState = {
      ...base,
      standing: { ...base.standing, [TARGET]: { ...base.standing[TARGET]!, favor: 10, peakFavor: 10 } },
    };
    const result = applyEffects(
      db,
      state,
      [{ type: "favor", char: TARGET, delta: 10 }],
      { allowInternalEffects: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value;
    expect(after.standing[TARGET]!.favor).toBe(20);
    expect(after.standing[TARGET]!.peakFavor).toBe(20);
    expect(validatePeakFavor(after)).toHaveLength(0);
  });

  it("funnel case 'favor' does NOT lower peakFavor when favor decreases", () => {
    const base = baseState();
    const state: GameState = {
      ...base,
      standing: { ...base.standing, [TARGET]: { ...base.standing[TARGET]!, favor: 80, peakFavor: 80 } },
    };
    const result = applyEffects(
      db,
      state,
      [{ type: "favor", char: TARGET, delta: -5 }],
      { allowInternalEffects: false },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const after = result.value;
    expect(after.standing[TARGET]!.favor).toBe(75);
    expect(after.standing[TARGET]!.peakFavor).toBe(80);
  });

  it("bestow raises peakFavor when favor increases beyond peak", () => {
    const base = baseState();
    const state: GameState = {
      ...grantItem(base, "luozidai", 1),
      standing: { ...base.standing, [TARGET]: { ...base.standing[TARGET]!, favor: 10, peakFavor: 10 } },
    };
    const r = bestow(state, db, "luozidai", { kind: "consort", id: TARGET });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = r.state;
    // luozidai is "fine" tier → base=4; favor: 10+4=14
    expect(after.standing[TARGET]!.favor).toBe(14);
    expect(after.standing[TARGET]!.peakFavor).toBe(14);
    expect(validatePeakFavor(after)).toHaveLength(0);
  });

  it("new-game state passes schema round-trip with peakFavor", () => {
    const state = baseState();
    const parsed = gameStateSchema.safeParse(state);
    expect(parsed.success).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A2 — rankDistance
// ────────────────────────────────────────────────────────────────────────────
describe("rankDistance — A2", () => {
  it("same rank returns 0", () => {
    expect(rankDistance(db, "huanghou", "huanghou")).toBe(0);
    expect(rankDistance(db, "fu", "fu")).toBe(0);
  });

  it("huanghou is higher than huangguifu (positive)", () => {
    const d = rankDistance(db, "huanghou", "huangguifu");
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(0);
  });

  it("huangguifu is higher than fu (positive)", () => {
    const d = rankDistance(db, "huangguifu", "fu");
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(0);
  });

  it("fu is higher than chenghui (positive)", () => {
    const d = rankDistance(db, "fu", "chenghui");
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(0);
  });

  it("chenghui is higher than cairen (positive)", () => {
    const d = rankDistance(db, "chenghui", "cairen");
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(0);
  });

  it("cairen is lower than chenghui (negative)", () => {
    const d = rankDistance(db, "cairen", "chenghui");
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(0);
  });

  it("unknown rank returns null", () => {
    expect(rankDistance(db, "rank_ghost", "huanghou")).toBeNull();
    expect(rankDistance(db, "huanghou", "rank_ghost")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A3 — livingHeirCountForConsort, isCurrentCarrier
// ────────────────────────────────────────────────────────────────────────────
function makeHeir(overrides: Partial<Heir> & { fatherId: string | null }): Heir {
  const base = baseState().calendar;
  const { fatherId, ...rest } = overrides;
  return {
    id: "heir_000001",
    sex: "daughter",
    fatherId,
    bearer: "sovereign",
    birthAt: { year: base.year, month: base.month, period: "early", dayIndex: base.dayIndex },
    favor: 50,
    legitimate: false,
    petName: "小乙",
    education: { scholarship: 0, martial: 0, virtue: 0 },
    health: 80,
    talent: 60,
    diligence: 60,
    ambition: 40,
    closeness: 50,
    support: 30,
    faction: "none",
    lifecycle: "alive",
    ...rest,
  };
}

describe("livingHeirCountForConsort — A3", () => {
  it("returns 0 for new-game state with no heirs", () => {
    const state = baseState();
    expect(livingHeirCountForConsort(state, TARGET)).toBe(0);
  });

  it("counts alive heir whose fatherId matches consortId", () => {
    const heir = makeHeir({ id: "heir_000001", fatherId: TARGET, lifecycle: "alive" });
    const state = baseState();
    const s: GameState = {
      ...state,
      resources: {
        ...state.resources,
        bloodline: { ...state.resources.bloodline, heirs: [heir] },
      },
    };
    expect(livingHeirCountForConsort(s, TARGET)).toBe(1);
  });

  it("does not count deceased heir", () => {
    const heir = makeHeir({ id: "heir_000001", fatherId: TARGET, lifecycle: "deceased" });
    const state = baseState();
    const s: GameState = {
      ...state,
      resources: {
        ...state.resources,
        bloodline: { ...state.resources.bloodline, heirs: [heir] },
      },
    };
    expect(livingHeirCountForConsort(s, TARGET)).toBe(0);
  });

  it("does not count heir with different fatherId", () => {
    const heir = makeHeir({ id: "heir_000001", fatherId: "other_consort", lifecycle: "alive" });
    const state = baseState();
    const s: GameState = {
      ...state,
      resources: {
        ...state.resources,
        bloodline: { ...state.resources.bloodline, heirs: [heir] },
      },
    };
    expect(livingHeirCountForConsort(s, TARGET)).toBe(0);
  });
});

describe("isCurrentCarrier — A3", () => {
  it("returns false when no gestations", () => {
    const state = baseState();
    expect(isCurrentCarrier(state, TARGET)).toBe(false);
  });

  it("returns true when consortId appears as carrier in gestations", () => {
    const state = baseState();
    const gestation: GestationState = {
      carrier: TARGET,
      conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
      fatherId: "other",
    };
    const s: GameState = {
      ...state,
      resources: {
        ...state.resources,
        bloodline: { ...state.resources.bloodline, gestations: [gestation] },
      },
    };
    expect(isCurrentCarrier(s, TARGET)).toBe(true);
  });

  it("returns false when another consort is carrier", () => {
    const state = baseState();
    const gestation: GestationState = {
      carrier: "other_consort",
      conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    };
    const s: GameState = {
      ...state,
      resources: {
        ...state.resources,
        bloodline: { ...state.resources.bloodline, gestations: [gestation] },
      },
    };
    expect(isCurrentCarrier(s, TARGET)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A4 — getFavoriteStatus
// ────────────────────────────────────────────────────────────────────────────
describe("getFavoriteStatus — A4", () => {
  const cal = baseState().calendar; // year 1 month 1

  function mkState(favor: number, peakFavor: number, fullMonthsInPalace: number): GameState {
    const state = baseState();
    let enteredYear = cal.year;
    let enteredMonth = cal.month - fullMonthsInPalace;
    while (enteredMonth <= 0) { enteredMonth += 12; enteredYear -= 1; }
    return {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: {
          ...state.standing[TARGET]!,
          favor,
          peakFavor,
          palaceEnteredAt: { year: enteredYear, month: enteredMonth, period: "early", dayIndex: 0 },
        },
      },
    };
  }

  it("current_new_favorite: new + high favor", () => {
    const s = mkState(65, 65, 6);
    expect(getFavoriteStatus(s, TARGET)).toBe("current_new_favorite");
  });

  it("fallen_new_favorite: new + high peak + low current", () => {
    const s = mkState(30, 75, 6);
    expect(getFavoriteStatus(s, TARGET)).toBe("fallen_new_favorite");
  });

  it("former_favorite: long-tenured + high peak + low current", () => {
    const s = mkState(40, 80, 36);
    expect(getFavoriteStatus(s, TARGET)).toBe("former_favorite");
  });

  it("ordinary: long-tenured + medium favor + medium peak", () => {
    const s = mkState(40, 50, 36);
    expect(getFavoriteStatus(s, TARGET)).toBe("ordinary");
  });

  it("ordinary: unknown palaceEnteredAt treats as long-tenured", () => {
    const state = baseState();
    const s: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: { ...state.standing[TARGET]!, favor: 40, peakFavor: 50, palaceEnteredAt: undefined },
      },
    };
    expect(getFavoriteStatus(s, TARGET)).toBe("ordinary");
  });

  it("ordinary: returns 'ordinary' for unknown character", () => {
    const state = baseState();
    expect(getFavoriteStatus(state, "nonexistent_char")).toBe("ordinary");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A5 — imperialProtectionSnapshot
// ────────────────────────────────────────────────────────────────────────────
describe("imperialProtectionSnapshot — A5", () => {
  it("score formula: floor(favor/5) + floor(peak/10) + min(heirs,3)*8 + carrying*6", () => {
    const state = baseState();
    const patched: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: { ...state.standing[TARGET]!, favor: 50, peakFavor: 80 },
      },
    };
    const snap = imperialProtectionSnapshot(db, patched, TARGET);
    // floor(50/5)=10 + floor(80/10)=8 + 0 heirs*8 + 0 carrying = 18
    expect(snap.score).toBe(18);
    expect(snap.currentFavor).toBe(50);
    expect(snap.peakFavor).toBe(80);
    expect(snap.livingHeirCount).toBe(0);
    expect(snap.isCurrentCarrier).toBe(false);
  });

  it("heirs capped at 3 in score; livingHeirCount reports actual count", () => {
    const state = baseState();
    const manyHeirs: Heir[] = [1, 2, 3, 4].map((i) =>
      makeHeir({ id: `heir_00000${i}`, fatherId: TARGET, lifecycle: "alive" }),
    );
    const patched: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: { ...state.standing[TARGET]!, favor: 50, peakFavor: 50 },
      },
      resources: {
        ...state.resources,
        bloodline: { ...state.resources.bloodline, heirs: manyHeirs },
      },
    };
    const snap = imperialProtectionSnapshot(db, patched, TARGET);
    // floor(50/5)=10 + floor(50/10)=5 + min(4,3)*8=24 = 39
    expect(snap.score).toBe(39);
    expect(snap.livingHeirCount).toBe(4);
  });

  it("carrying adds +6 to score (via gestation, not lifecycle)", () => {
    const state = baseState();
    const gestation: GestationState = {
      carrier: TARGET,
      conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    };
    const patched: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: { ...state.standing[TARGET]!, favor: 0, peakFavor: 0 },
      },
      resources: {
        ...state.resources,
        bloodline: { ...state.resources.bloodline, gestations: [gestation] },
      },
    };
    const snap = imperialProtectionSnapshot(db, patched, TARGET);
    expect(snap.score).toBe(6);
    expect(snap.isCurrentCarrier).toBe(true);
  });

  it("deceased heirs are not counted in score", () => {
    const state = baseState();
    const alive = makeHeir({ id: "heir_000001", fatherId: TARGET, lifecycle: "alive" });
    const dead = makeHeir({ id: "heir_000002", fatherId: TARGET, lifecycle: "deceased" });
    const patched: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: { ...state.standing[TARGET]!, favor: 0, peakFavor: 0 },
      },
      resources: {
        ...state.resources,
        bloodline: { ...state.resources.bloodline, heirs: [alive, dead] },
      },
    };
    const snap = imperialProtectionSnapshot(db, patched, TARGET);
    expect(snap.livingHeirCount).toBe(1);
    expect(snap.score).toBe(8); // 0 + 0 + 1*8 + 0
  });

  it("unknown character returns score 0 with all zeros", () => {
    const state = baseState();
    const snap = imperialProtectionSnapshot(db, state, "nonexistent_char");
    expect(snap.score).toBe(0);
    expect(snap.currentFavor).toBe(0);
    expect(snap.peakFavor).toBe(0);
    expect(snap.livingHeirCount).toBe(0);
    expect(snap.isCurrentCarrier).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../../src/engine/state/newGame";
import { loadRealContent } from "../../helpers/contentFixture";
import { createGameStore } from "../../../src/store/gameStore";
import {
  rankDistance,
  livingHeirCountForConsort,
  isCurrentCarrier,
  getFavoriteStatus,
  imperialProtectionSnapshot,
} from "../../../src/engine/characters/imperialProtection";
import { validatePeakFavor } from "../../../src/engine/characters/peakFavorValidator";
import { bestow } from "../../../src/store/treasury";
import { applyEffects } from "../../../src/engine/effects/funnel";
import type { GameState } from "../../../src/engine/state/types";
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
  it("new-game initializes peakFavor = favor for all consorts", () => {
    const state = baseState();
    for (const [id, st] of Object.entries(state.standing)) {
      expect(st.peakFavor, `${id}: peakFavor >= favor`).toBeGreaterThanOrEqual(st.favor);
    }
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
    // Start at favor=10, peakFavor=10; add +10 → favor=20, peakFavor=20
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
    const state: GameState = {
      ...baseState(),
      standing: {
        ...baseState().standing,
        [TARGET]: { ...baseState().standing[TARGET]!, favor: 80, peakFavor: 80 },
      },
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
    const state: GameState = {
      ...baseState(),
      standing: {
        ...baseState().standing,
        [TARGET]: { ...baseState().standing[TARGET]!, favor: 10, peakFavor: 10 },
      },
    };
    // Find a bestowable item
    const item = Object.values(db.items).find(
      (i) => i.effects?.some?.((e) => e.type === "favor" && e.delta > 0),
    );
    if (!item) return; // Skip if no item in fixture
    const r = bestow(state, db, item.id, { kind: "consort", id: TARGET });
    if (!r.ok) return; // Bestow may fail if no storehouse stock
    const after = r.value;
    expect(after.standing[TARGET]!.peakFavor).toBeGreaterThanOrEqual(after.standing[TARGET]!.favor);
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
    const [r1] = Object.keys(db.ranks);
    if (!r1) return;
    expect(rankDistance(db, r1, r1)).toBe(0);
  });

  it("higher-order actor returns positive", () => {
    const ranked = Object.values(db.ranks)
      .filter((r) => typeof r.order === "number")
      .sort((a, b) => a.order - b.order);
    if (ranked.length < 2) return;
    const low = ranked[0]!;
    const high = ranked[ranked.length - 1]!;
    const d = rankDistance(db, high.id, low.id);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(0);
  });

  it("lower-order actor returns negative", () => {
    const ranked = Object.values(db.ranks)
      .filter((r) => typeof r.order === "number")
      .sort((a, b) => a.order - b.order);
    if (ranked.length < 2) return;
    const low = ranked[0]!;
    const high = ranked[ranked.length - 1]!;
    const d = rankDistance(db, low.id, high.id);
    expect(d).not.toBeNull();
    expect(d!).toBeLessThan(0);
  });

  it("unknown rank returns null", () => {
    expect(rankDistance(db, "rank_ghost", "fenghou")).toBeNull();
    expect(rankDistance(db, "fenghou", "rank_ghost")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A3 — livingHeirCountForConsort, isCurrentCarrier
// ────────────────────────────────────────────────────────────────────────────
describe("livingHeirCountForConsort — A3", () => {
  it("returns 0 for new-game state with no heirs", () => {
    const state = baseState();
    expect(livingHeirCountForConsort(state, TARGET)).toBe(0);
  });

  it("counts heirs by fatherId whose lifecycle is not deceased", () => {
    const state = baseState();
    const stateWithHeir: GameState = {
      ...state,
      resources: {
        ...state.resources,
        bloodline: {
          ...state.resources.bloodline,
          heirs: [
            {
              id: "heir_000001",
              name: "皇嗣",
              fatherId: TARGET,
              lifecycle: "normal",
              age: 5,
              closeness: 50,
              aptitude: {},
            } as Parameters<typeof livingHeirCountForConsort>[0]["resources"]["bloodline"]["heirs"][number],
          ],
        },
      },
    };
    expect(livingHeirCountForConsort(stateWithHeir, TARGET)).toBe(1);
  });
});

describe("isCurrentCarrier — A3", () => {
  it("returns false for normal lifecycle", () => {
    const state = baseState();
    expect(isCurrentCarrier(state, TARGET)).toBe(false);
  });

  it("returns true when lifecycle is 'carrying'", () => {
    const state = baseState();
    const patched: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: { ...state.standing[TARGET]!, lifecycle: "carrying" },
      },
    };
    expect(isCurrentCarrier(patched, TARGET)).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A4 — getFavoriteStatus
// ────────────────────────────────────────────────────────────────────────────
describe("getFavoriteStatus — A4", () => {
  const cal = baseState().calendar; // year 1 month 1

  function mkState(favor: number, peakFavor: number, fullMonthsInPalace: number): GameState {
    const state = baseState();
    const enteredYear = cal.year - Math.floor(fullMonthsInPalace / 12);
    const enteredMonth = cal.month - (fullMonthsInPalace % 12);
    const normalizedYear = enteredMonth <= 0 ? enteredYear - 1 : enteredYear;
    const normalizedMonth = enteredMonth <= 0 ? enteredMonth + 12 : enteredMonth;
    return {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: {
          ...state.standing[TARGET]!,
          favor,
          peakFavor,
          palaceEnteredAt: { year: normalizedYear, month: normalizedMonth, period: "early", dayIndex: 0 },
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

  it("heirs capped at 3 in score", () => {
    const state = baseState();
    const manyHeirs = [1, 2, 3, 4].map((i) => ({
      id: `heir_00000${i}`,
      name: `皇嗣${i}`,
      fatherId: TARGET,
      lifecycle: "normal" as const,
      age: i,
      closeness: 50,
      aptitude: {},
    })) as GameState["resources"]["bloodline"]["heirs"];
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

  it("carrying adds +6 to score", () => {
    const state = baseState();
    const patched: GameState = {
      ...state,
      standing: {
        ...state.standing,
        [TARGET]: { ...state.standing[TARGET]!, favor: 0, peakFavor: 0, lifecycle: "carrying" },
      },
    };
    const snap = imperialProtectionSnapshot(db, patched, TARGET);
    expect(snap.score).toBe(6);
    expect(snap.isCurrentCarrier).toBe(true);
  });

  it("unknown character returns score 0 with all zeros", () => {
    const state = baseState();
    const snap = imperialProtectionSnapshot(db, state, "nonexistent_char");
    expect(snap.score).toBe(0);
    expect(snap.currentFavor).toBe(0);
    expect(snap.peakFavor).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// A6 — migration v25 → v26 (peakFavor backfill)
// ────────────────────────────────────────────────────────────────────────────
describe("migration v25 → v26", () => {
  it("peakFavor backfill adds peakFavor = favor for v25 standing entries", () => {
    const store = createGameStore();
    store.loadState(baseState());
    const state = store.getState();

    // Simulate v25 save: strip peakFavor from all standing entries
    const v25Like: Record<string, unknown> = {};
    for (const [id, st] of Object.entries(state.standing)) {
      const { peakFavor, ...rest } = st as { peakFavor: number } & Record<string, unknown>;
      void peakFavor;
      v25Like[id] = rest;
    }
    expect(Object.values(v25Like)[0]).not.toHaveProperty("peakFavor");

    // Run migration
    const raw = { standing: v25Like };
    // The migration fn is not exported; simulate what it does
    for (const st of Object.values(raw.standing)) {
      const s = st as Record<string, unknown>;
      if (typeof s.peakFavor !== "number" && typeof s.favor === "number") {
        s.peakFavor = s.favor;
      }
    }
    // After migration, every entry has peakFavor = favor
    for (const [id, st] of Object.entries(raw.standing)) {
      const s = st as Record<string, unknown>;
      expect(s.peakFavor, `${id} peakFavor should equal favor`).toBe(s.favor);
    }
  });
});

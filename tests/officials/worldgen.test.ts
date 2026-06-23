import { describe, expect, it } from "vitest";
import { createNewGameState } from "../../src/engine/state/newGame";
import { generateOfficialWorld } from "../../src/engine/officials/worldgen";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import {
  getOfficialRelativesOfConsort,
  getPalaceRelativesOfOfficial,
} from "../../src/engine/officials/selectors";
import { OFFICIAL_MIN_AGE, PARENT_CHILD_MAX_GAP, PARENT_CHILD_MIN_GAP } from "../../src/engine/officials/constraints";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const T = { year: 1, month: 1, period: "early" as const, dayIndex: 0 };

function ageOf(state: ReturnType<typeof createNewGameState>, id: string): number | undefined {
  return (
    state.officials[id]?.age ??
    state.familyMembers[id]?.age ??
    (db.characters[id] ?? state.generatedConsorts[id])?.profile.age
  );
}

describe("generateOfficialWorld — determinism", () => {
  it("same seed → identical officials/families/members/kinship", () => {
    expect(generateOfficialWorld(db, 1, T)).toEqual(generateOfficialWorld(db, 1, T));
  });

  it("different seeds → different worlds", () => {
    const a = generateOfficialWorld(db, 1, T);
    const b = generateOfficialWorld(db, 2, T);
    expect(a.officials).not.toEqual(b.officials);
  });

  it("createNewGameState is stable across runs", () => {
    expect(createNewGameState(db, 7).officials).toEqual(createNewGameState(db, 7).officials);
    expect(createNewGameState(db, 7).kinship).toEqual(createNewGameState(db, 7).kinship);
  });

  it("queries do not consume RNG or mutate state (regen equals after querying)", () => {
    const state = createNewGameState(db, 3);
    const before = structuredClone(state.officials);
    for (let i = 0; i < 50; i++) {
      getPalaceRelativesOfOfficial(state, "official_fam_0001");
      getOfficialRelativesOfConsort(state, "shen_zhibai");
    }
    expect(state.officials).toEqual(before);
    expect(generateOfficialWorld(db, 3, T).officials).toEqual(createNewGameState(db, 3).officials);
  });
});

describe("generateOfficialWorld — seats", () => {
  const state = createNewGameState(db, 1);
  it("no post exceeds its seatCount; single-seat posts never doubly occupied", () => {
    const used: Record<string, number> = {};
    for (const o of Object.values(state.officials)) {
      if (o.postId) used[o.postId] = (used[o.postId] ?? 0) + 1;
    }
    for (const [postId, n] of Object.entries(used)) {
      expect(n).toBeLessThanOrEqual(db.officialPosts[postId]!.seatCount);
    }
  });

  it("most posts remain vacant (structure supports 空缺)", () => {
    const occupied = new Set(Object.values(state.officials).map((o) => o.postId).filter(Boolean));
    expect(occupied.size).toBeLessThan(Object.keys(db.officialPosts).length);
  });
});

describe("generateOfficialWorld — gender & identity", () => {
  const state = createNewGameState(db, 1);
  it("no family member (male or otherwise) holds an official seat", () => {
    for (const m of Object.values(state.familyMembers)) {
      expect(state.officials[m.id]).toBeUndefined();
    }
  });

  it("内卿/男郎 are male; matriarch/sister/daughter are female", () => {
    for (const m of Object.values(state.familyMembers)) {
      const expected = m.role === "consort_in" || m.role === "son" ? "male" : "female";
      expect(m.sex).toBe(expected);
    }
  });
});

describe("generateOfficialWorld — ages", () => {
  const state = createNewGameState(db, 1);
  it("every official meets 入仕年龄", () => {
    for (const o of Object.values(state.officials)) {
      expect(o.age).toBeGreaterThanOrEqual(OFFICIAL_MIN_AGE);
    }
  });

  it("every mother edge respects parent-child age gap", () => {
    for (const k of state.kinship) {
      if (k.type !== "mother") continue;
      const childAge = ageOf(state, k.fromPersonId);
      const motherAge = ageOf(state, k.toPersonId);
      expect(childAge).toBeDefined();
      expect(motherAge).toBeDefined();
      const gap = motherAge! - childAge!;
      expect(gap).toBeGreaterThanOrEqual(PARENT_CHILD_MIN_GAP);
      expect(gap).toBeLessThanOrEqual(PARENT_CHILD_MAX_GAP);
    }
  });

  it("generated world passes central validation (no dup mother / dup edge / bad age)", () => {
    expect(validateOfficialWorld(state, db)).toEqual([]);
  });
});

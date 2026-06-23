/**
 * 殿选侍君的母族与亲缘持久化（review F5）：世家子弟入宫后母族关联与亲缘边必须原子写入，
 * 且经存档 round-trip 仍在；候选生母只能取自在任有效官员；动态侍君不被存档误判为 missing。
 */
import { describe, it, expect } from "vitest";
import {
  addGeneratedConsort,
  generateCandidates,
  type Candidate,
} from "../../src/store/grandSelection";
import {
  getOfficialRelativesOfConsort,
  getPalaceRelativesOfOfficial,
} from "../../src/engine/officials/selectors";
import { validateOfficialWorld } from "../../src/engine/officials/validation";
import { createNewGameState } from "../../src/engine/state/newGame";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

/** 找一位带 motherOfficialId 的世家候选（跨年扫描）。 */
function findShijia(state: GameState): Candidate {
  for (const year of [1, 4, 7, 10, 13]) {
    const cand = generateCandidates(db, state, year).find((c) => c.motherOfficialId);
    if (cand) return cand;
  }
  throw new Error("no shijia candidate found");
}

describe("grand selection — family persistence", () => {
  it("世家候选礼官词为『官职之男』，且生母为在任官员", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    expect(cand.announce).toContain("之男");
    const mother = state.officials[cand.motherOfficialId!]!;
    expect(mother.status).toBe("active");
    expect(mother.postId).not.toBeNull();
  });

  it("入宫后双向亲缘可查，且通过 validator", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const motherId = cand.motherOfficialId!;
    const next = addGeneratedConsort(state, cand.content, "guiren", 18, motherId);

    expect(getOfficialRelativesOfConsort(next, cand.content.id).map((o) => o.id)).toContain(motherId);
    expect(getPalaceRelativesOfOfficial(next, motherId)).toContain(cand.content.id);
    expect(next.standing[cand.content.id]!.birthFamilyId).toBe(state.officials[motherId]!.familyId);
    expect(validateOfficialWorld(next, db)).toEqual([]);
  });

  it("重复落库幂等：不产生重复亲缘边", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const motherId = cand.motherOfficialId!;
    const once = addGeneratedConsort(state, cand.content, "guiren", 18, motherId);
    const twice = addGeneratedConsort(once, cand.content, "guiren", 18, motherId);
    expect(twice.kinship.length).toBe(once.kinship.length);
  });

  it("动态侍君存档 round-trip 后母族与亲缘仍在（不被判 missing character）", () => {
    const state = createNewGameState(db, 1);
    const cand = findShijia(state);
    const motherId = cand.motherOfficialId!;
    const next = addGeneratedConsort(state, cand.content, "guiren", 18, motherId);

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, next, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1234 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.standing[cand.content.id]!.birthFamilyId).toBe(state.officials[motherId]!.familyId);
    expect(getOfficialRelativesOfConsort(loaded.value.state, cand.content.id).map((o) => o.id)).toContain(motherId);
  });

  it("候选生母不取自已故官员", () => {
    const state = createNewGameState(db, 1);
    for (const id of Object.keys(state.officials)) {
      state.officials[id] = { ...state.officials[id]!, status: "dead", postId: null };
    }
    for (const year of [1, 4, 7]) {
      for (const c of generateCandidates(db, state, year)) {
        expect(c.motherOfficialId).toBeUndefined();
      }
    }
  });
});

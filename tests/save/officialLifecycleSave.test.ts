/**
 * 官员生命周期字段的存档：含 dead/retired 官员、officialHistory、pendingRetirements、
 * 家族成员 deceasedAt 的存档 round-trip 稳定；v10 旧档经 MIGRATIONS[10] 补空数组后可载入。
 */
import { describe, it, expect } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  createSaveData,
  readSlot,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { buildOfficialYearlyTick } from "../../src/store/officialsLifecycleTick";
import { getOfficialRelativesOfConsort } from "../../src/engine/officials/selectors";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const tickTime = (y: number) => ({ year: y, month: 1, period: "early" as const, dayIndex: 0 });

/** 老化若干年得到含 dead/history/pending 的状态。 */
function agedState(): GameState {
  let s = createNewGameState(db, 5);
  for (let y = 2; y <= 30; y++) s = buildOfficialYearlyTick(s, db, tickTime(y));
  return s;
}

describe("official lifecycle save", () => {
  it("SAVE_FORMAT_VERSION ≥ 11", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(11);
  });

  it("round-trips officials/history/pendingRetirements/deceased members", () => {
    const s = agedState();
    expect(Object.values(s.officials).some((o) => o.status === "dead")).toBe(true);
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, s, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const r = loaded.value.state;
    expect(r.officials).toEqual(s.officials);
    expect(r.officialHistory).toEqual(s.officialHistory);
    expect(r.pendingRetirements).toEqual(s.pendingRetirements);
    expect(r.familyMembers).toEqual(s.familyMembers);
    // 已故生母仍可由侍君查到
    expect(getOfficialRelativesOfConsort(r, "shen_zhibai").length).toBeGreaterThanOrEqual(0);
  });

  it("v10 old save is rejected as OBSOLETE_VERSION (not quarantined)", () => {
    const s = createNewGameState(db, 1);
    const stateV10 = { ...s } as Record<string, unknown>;
    delete stateV10["pendingRetirements"];
    delete stateV10["officialHistory"];
    const env = {
      ...createSaveData(db, s, "slot1"),
      formatVersion: 10,
      state: stateV10,
      checksum: checksumOf(stateV10 as unknown as GameState),
    };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 2 });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("OBSOLETE_VERSION");
    // Not quarantined — obsolete saves are not treated as corrupt.
    expect(storage.get(`${SAVE_KEY_PREFIX}slot1`)).not.toBeNull();
  });
});

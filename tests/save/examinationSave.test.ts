/** 候补池/科举字段存档（Phase 3 PR3A）：round-trip 稳定；v11 旧档经 MIGRATIONS[11] 补空。 */
import { describe, it, expect } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import {
  createSaveData,
  readSlot,
  SAVE_FORMAT_VERSION,
  SAVE_KEY_PREFIX,
} from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { settleAnnualExamination } from "../../src/engine/officials/examination";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

describe("examination save", () => {
  it("SAVE_FORMAT_VERSION ≥ 12", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(12);
  });

  it("round-trips officialCandidates + examinationResults", () => {
    let s = createNewGameState(db, 1);
    s = settleAnnualExamination(s, db, 1, at(1));
    s = settleAnnualExamination(s, db, 2, at(2));
    expect(Object.keys(s.officialCandidates).length).toBeGreaterThan(0);

    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, s, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.officialCandidates).toEqual(s.officialCandidates);
    expect(loaded.value.state.examinationResults).toEqual(s.examinationResults);
  });

  it("v11 old save (no candidate fields) migrates to current via MIGRATIONS[11]", () => {
    const s = createNewGameState(db, 1);
    const stateV11 = { ...s } as Record<string, unknown>;
    delete stateV11["officialCandidates"];
    delete stateV11["examinationResults"];
    const env = {
      ...createSaveData(db, s, "slot1"),
      formatVersion: 11,
      state: stateV11,
      checksum: checksumOf(stateV11 as unknown as GameState),
    };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 2 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.officialCandidates).toEqual({});
    expect(loaded.value.state.examinationResults).toEqual([]);
  });
});

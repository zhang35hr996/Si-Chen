/** 授官溯源存档（Phase 3 PR3B）：history.appointment round-trip；v12 旧档经 MIGRATIONS[12] 升 v13。 */
import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import { createSaveData, readSlot, SAVE_FORMAT_VERSION, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { appointOfficialCandidate } from "../../src/engine/officials/appointment";
import { settleAnnualExamination, getEligibleOfficialCandidates } from "../../src/engine/officials/examination";
import { getVacantPosts } from "../../src/engine/officials/selectors";
import { createNewGameState } from "../../src/engine/state/newGame";
import type { GameState } from "../../src/engine/state/types";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();
const at = (y: number) => ({ year: y, month: 2, period: "early" as const, dayIndex: 0 });

describe("appointment save", () => {
  it("SAVE_FORMAT_VERSION ≥ 13", () => {
    expect(SAVE_FORMAT_VERSION).toBeGreaterThanOrEqual(13);
  });

  it("round-trips an appointment (official + candidate + history provenance)", () => {
    const base = settleAnnualExamination(createNewGameState(db, 1), db, 1, at(1));
    const c = getEligibleOfficialCandidates(base)[0]!;
    const r = appointOfficialCandidate(base, db, c.id, getVacantPosts(base, db)[0]!.postId, at(1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(createSaveData(db, r.value, "slot1")));
    const loaded = readSlot(storage, db, "slot1", { now: () => 1 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.officials).toEqual(r.value.officials);
    expect(loaded.value.state.officialCandidates).toEqual(r.value.officialCandidates);
    expect(loaded.value.state.officialHistory).toEqual(r.value.officialHistory);
  });

  it("v12 old save (history entries without appointment) migrates to v13", () => {
    const s = createNewGameState(db, 1) as unknown as Record<string, unknown>;
    const env = { ...createSaveData(db, s as unknown as GameState, "slot1"), formatVersion: 12, checksum: checksumOf(s as unknown as GameState) };
    const storage = createMemoryStorage();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(env));
    const loaded = readSlot(storage, db, "slot1", { now: () => 2 });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.officialHistory).toEqual([]); // 旧档原本就无 appointment
  });
});

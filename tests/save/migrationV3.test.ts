import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("save migration v2 → v3", () => {
  it("backfills petName/education on heirs lacking them", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    (state.resources.bloodline.heirs as unknown as Record<string, unknown>[]).push({
      id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
      birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 }, favor: 50, legitimate: true,
      lifecycle: "alive",
    });
    const v3 = createSaveData(db, state, "slot1");
    const v2State = structuredClone(v3.state) as unknown as Record<string, unknown>;
    const bloodline = (v2State.resources as { bloodline: Record<string, unknown> }).bloodline;
    for (const h of bloodline.heirs as Record<string, unknown>[]) {
      delete h.petName; delete h.givenName; delete h.education; delete h.adoptiveFatherId;
    }
    const envelope = { ...v3, formatVersion: 2, state: v2State, checksum: checksumOf(v2State) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const heir = loaded.value.state.resources.bloodline.heirs[0]!;
    expect(heir.petName).toBe("");
    expect(heir.education).toEqual({ scholarship: 5, martial: 5, virtue: 5 });
  });
});

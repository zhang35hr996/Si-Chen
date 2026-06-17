import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

/** Build a v1-shaped save blob (single `gestation`) from a current state. */
function v1Blob(): { raw: string; carrier: string } {
  const state = createNewGameState(db);
  const v2 = createSaveData(db, state, "slot1");
  // Downgrade to the v1 on-disk shape: single `gestation` instead of `gestations`.
  const v1State = structuredClone(v2.state) as unknown as Record<string, unknown>;
  const bloodline = (v1State.resources as { bloodline: Record<string, unknown> }).bloodline;
  const gest = {
    carrier: "shen_chenghui",
    conceivedAt: { year: 1, month: 1, period: "early", dayIndex: 0 },
    fatherId: "shen_chenghui",
    transferredAtMonth: 3,
  };
  delete bloodline.gestations;
  bloodline.gestation = gest;
  const envelope = { ...v2, formatVersion: 1, state: v1State, checksum: checksumOf(v1State) };
  return { raw: JSON.stringify(envelope), carrier: gest.carrier };
}

describe("save migration v1 → v2", () => {
  it("migrates single `gestation` into `gestations[]` and loads cleanly", () => {
    const storage = createMemoryStorage();
    const { raw, carrier } = v1Blob();
    storage.set(`${SAVE_KEY_PREFIX}slot1`, raw);

    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.resources.bloodline.gestations).toHaveLength(1);
    expect(loaded.value.state.resources.bloodline.gestations[0]!.carrier).toBe(carrier);
    expect("gestation" in loaded.value.state.resources.bloodline).toBe(false);
  });

  it("migrates an absent gestation into an empty array", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    const v2 = createSaveData(db, state, "slot1");
    const v1State = structuredClone(v2.state) as unknown as Record<string, unknown>;
    const bloodline = (v1State.resources as { bloodline: Record<string, unknown> }).bloodline;
    delete bloodline.gestations; // v1 had no gestation at all
    const envelope = { ...v2, formatVersion: 1, state: v1State, checksum: checksumOf(v1State) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.state.resources.bloodline.gestations).toEqual([]);
  });
});

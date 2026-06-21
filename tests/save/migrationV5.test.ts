import { describe, expect, it } from "vitest";
import { checksumOf } from "../../src/engine/save/canonical";
import { createSaveData, readSlot, SAVE_KEY_PREFIX } from "../../src/engine/save/saveSystem";
import { createMemoryStorage } from "../../src/engine/save/storage";
import { createNewGameState } from "../../src/engine/state/newGame";
import { loadRealContent } from "../helpers/contentFixture";

const db = loadRealContent();

describe("save migration v4 → v5 (属性系统重构)", () => {
  it("splits court → sovereign+nation and backfills heir attributes", () => {
    const storage = createMemoryStorage();
    const state = createNewGameState(db);
    (state.resources.bloodline.heirs as unknown as Record<string, unknown>[]).push({
      id: "heir_000001", sex: "daughter", fatherId: null, bearer: "sovereign",
      birthAt: { year: 1, month: 1, period: "early", dayIndex: 0 }, favor: 50, legitimate: true,
      petName: "", education: { scholarship: 5, martial: 5, virtue: 5 },
      lifecycle: "alive",
    });
    const v5 = createSaveData(db, state, "slot1");

    // Simulate a v4 save: old court pillar + heirs lacking the new attribute fields.
    const v4State = structuredClone(v5.state) as unknown as Record<string, unknown>;
    const resources = v4State.resources as Record<string, unknown>;
    delete resources.sovereign;
    delete resources.nation;
    resources.court = { authority: 42, publicSupport: 33, factionPressure: 17 };
    const bloodline = resources.bloodline as { heirs: Record<string, unknown>[] };
    for (const h of bloodline.heirs) {
      delete h.health; delete h.talent; delete h.diligence;
      delete h.ambition; delete h.closeness; delete h.support; delete h.faction;
    }
    const envelope = { ...v5, formatVersion: 4, state: v4State, checksum: checksumOf(v4State) };
    storage.set(`${SAVE_KEY_PREFIX}slot1`, JSON.stringify(envelope));

    const loaded = readSlot(storage, db, "slot1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const { sovereign, nation } = loaded.value.state.resources;
    expect(sovereign.prestige).toBe(42); // 圣威→威望
    expect(nation.publicSupport).toBe(33); // 民心保留
    expect(nation.clanDiscontent).toBe(17); // 派系压力→宗室不满
    expect((loaded.value.state.resources as unknown as Record<string, unknown>).court).toBeUndefined();
    const heir = loaded.value.state.resources.bloodline.heirs[0]!;
    expect(heir.health).toBe(60);
    expect(heir.faction).toBe("none");
  });
});
